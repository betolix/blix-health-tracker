import { createMcpHandler } from '@modelcontextprotocol/server';
import {
  FetchError,
  JwtExpiredError,
  JwtInvalidAudienceError,
  JwtInvalidIssuerError,
  JwtInvalidSignatureAlgorithmError,
  JwtInvalidSignatureError,
  JwtNotBeforeError,
  JwtParseError,
  JwtWithoutValidKidError,
  KidNotFoundInJwksError,
} from 'aws-jwt-verify/error';
import {
  InsufficientProbeScopeError,
  MCP_RESOURCE,
  PROBE_SCOPE,
  verifyDailyTargetReadToken,
  verifyFoodCreateToken,
  verifyFoodDeleteToken,
  verifyFoodReadToken,
  verifyFoodUpdateToken,
  verifyIdentityProbeToken,
  verifyVitalCreateToken,
  verifyVitalDeleteToken,
  verifyVitalReadToken,
  verifyVitalUpdateToken,
} from './auth0-probe';
import {
  DAILY_TARGET_READ_SCOPE,
  FOOD_CREATE_SCOPE,
  FOOD_DELETE_SCOPE,
  FOOD_READ_SCOPE,
  FOOD_UPDATE_SCOPE,
  InsufficientOAuthScopeError,
  VITAL_CREATE_SCOPE,
  VITAL_DELETE_SCOPE,
  VITAL_READ_SCOPE,
  VITAL_UPDATE_SCOPE,
} from './oauth-scope';
import {
  classifyMcpRequestAuth,
  InvalidProtectedMcpRequestError,
} from './mcp-request-auth';
import { handler as disabledHandler } from './disabled-handler';
import { createIdentityProbeServer } from './identity-probe-server';
import { listSyntheticFoodEntries } from './synthetic-food-entry-probe';

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  readFoodEntries,
  type FoodEntryReadInput,
} from './food-entry-reader';
import {
  readVitals,
  type VitalReadInput,
} from './vital-reader';
import {
  createVital,
  deleteVital,
  updateVital,
  type CreateVitalInput,
  type DeleteVitalInput,
  type UpdateVitalInput,
} from './vital-writer';
import {
  readDailyTargets,
  type DailyTargetReadInput,
} from './daily-target-reader';
import {
  createFoodEntry,
  deleteFoodEntry,
  updateFoodEntry,
  type CreateFoodEntryInput,
  type DeleteFoodEntryInput,
  type UpdateFoodEntryInput,
} from './food-entry-writer';

// Deployed by resource.ts. The real FoodEntry tool remains fail-closed unless a reader is explicitly injected.
type HttpEvent = {
  rawPath?: string;
  body?: string | null;
  isBase64Encoded?: boolean;
  headers?: Record<string, string | undefined>;
  requestContext?: { http?: { method?: string } };
};

function classifyAuthFailure(error: unknown): string {
  if (
    error instanceof InsufficientProbeScopeError ||
    error instanceof InsufficientOAuthScopeError
  ) return 'scope';
  if (error instanceof JwtInvalidAudienceError) return 'audience';
  if (error instanceof JwtInvalidIssuerError) return 'issuer';
  if (error instanceof JwtExpiredError) return 'expired';
  if (error instanceof JwtNotBeforeError) return 'not-before';
  if (error instanceof JwtInvalidSignatureError) return 'signature';
  if (error instanceof JwtInvalidSignatureAlgorithmError) return 'algorithm';
  if (error instanceof JwtParseError) return 'jwt-format';
  if (
    error instanceof JwtWithoutValidKidError ||
    error instanceof KidNotFoundInJwksError
  ) return 'jwks-key';
  if (error instanceof FetchError) return 'jwks-fetch';

  if (error instanceof Error) {
    switch (error.message) {
      case 'Unexpected OAuth client': return 'oauth-client';
      case 'Required JWT timestamps missing': return 'timestamps';
      case 'Missing authenticated subject': return 'subject';
      case 'Unexpected JWT algorithm': return 'algorithm';
    }
  }

  return 'other';
}

function safeDiagnosticLog(details: {
  stage: string;
  method?: string;
  path?: string;
  authHeaderCount?: number;
  operation?: string;
  rpcMethod?: string;
  authFailure?: string;
  status?: number;
}) {
  console.info('[blix-mcp-diagnostic]', JSON.stringify(details));
}

const RESOURCE_METADATA = `${MCP_RESOURCE}.well-known/oauth-protected-resource`;

function errorResponse(
  statusCode: number,
  error: string,
  requiredScope: string = PROBE_SCOPE,
) {
  safeDiagnosticLog({
    stage: 'auth-error-response',
    status: statusCode,
  });

  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'WWW-Authenticate':
        `Bearer resource_metadata="${RESOURCE_METADATA}", scope="${requiredScope}"` +
        (statusCode === 403 ? ', error="insufficient_scope"' : ''),
    },
    body: JSON.stringify({ error }),
  };
}

function bearerToken(headers: HttpEvent['headers']): string | undefined {
  const authHeaders = Object.entries(headers ?? {}).filter(
    ([name]) => name.toLowerCase() === 'authorization'
  );
  if (authHeaders.length !== 1) return undefined;
  const match = /^Bearer ([^\s]+)$/.exec(authHeaders[0][1] ?? '');
  return match?.[1];
}

// Only these protocol operations disclose public, non-user-specific metadata.
// All other requests remain protected, except an anonymous call to the sole
// identity_probe tool, which returns an MCP auth challenge (never a fingerprint).
function anonymousMcpOperation(body: string | undefined):
  'discovery' | 'probe-challenge' | undefined {
  if (!body) return undefined;
  try {
    const rpc: unknown = JSON.parse(body);
    if (!rpc || typeof rpc !== 'object' || Array.isArray(rpc)) {
      return undefined;
    }
    const message = rpc as {
      jsonrpc?: unknown;
      method?: unknown;
      params?: unknown;
    };
    if (message.jsonrpc !== '2.0') return undefined;
    if (
      message.method === 'server/discover' ||
      message.method === 'initialize' ||
      message.method === 'tools/list' ||
      message.method === 'notifications/initialized'
    ) {
      return 'discovery';
    }
    if (message.method === 'tools/call') {
      const params = message.params;
      if (
        params && typeof params === 'object' && !Array.isArray(params) &&
        ((params as { name?: unknown }).name === 'identity_probe' ||
         (params as { name?: unknown }).name === 'ownership_probe' ||
         (params as { name?: unknown }).name === 'food_entries_probe')
      ) {
        return 'probe-challenge';
      }
    }
  } catch {
    // Invalid JSON never bypasses authentication.
  }
  return undefined;
}

type ProbeVerifier = (
  token: string
) => Promise<{ fingerprint: string; verifiedSubject: string }>;

type FoodVerifier = (
  token: string
) => Promise<{ verifiedSubject: string }>;

type FoodWriteVerifier = (
  token: string
) => Promise<{ verifiedSubject: string }>;

type VitalVerifier = (
  token: string
) => Promise<{ verifiedSubject: string }>;

type DailyTargetVerifier = (
  token: string
) => Promise<{ verifiedSubject: string }>;

type RealFoodReader = (
  input: FoodEntryReadInput,
) => ReturnType<typeof readFoodEntries>;

type RealFoodCreator = (
  input: CreateFoodEntryInput,
) => ReturnType<typeof createFoodEntry>;

type RealFoodUpdater = (
  input: UpdateFoodEntryInput,
) => ReturnType<typeof updateFoodEntry>;

type RealFoodDeleter = (
  input: DeleteFoodEntryInput,
) => ReturnType<typeof deleteFoodEntry>;

type RealVitalReader = (
  input: VitalReadInput,
) => ReturnType<typeof readVitals>;

type RealVitalCreator = (
  input: CreateVitalInput,
) => ReturnType<typeof createVital>;

type RealVitalUpdater = (
  input: UpdateVitalInput,
) => ReturnType<typeof updateVital>;

type RealVitalDeleter = (
  input: DeleteVitalInput,
) => ReturnType<typeof deleteVital>;

type RealDailyTargetReader = (
  input: DailyTargetReadInput,
) => ReturnType<typeof readDailyTargets>;

const dynamoDb = new DynamoDBClient({});

const productionFoodReader: RealFoodReader = (input) =>
  readFoodEntries(input, {
    tableName: process.env.FOOD_ENTRY_TABLE_NAME ?? '',
    send: (command) => dynamoDb.send(command),
  });

const productionFoodWriterDependencies = {
  tableName: process.env.FOOD_ENTRY_TABLE_NAME ?? '',
  put: (command: any) => dynamoDb.send(command),
  update: (command: any) => dynamoDb.send(command),
  delete: (command: any) => dynamoDb.send(command),
};

const productionFoodCreator: RealFoodCreator = (input) =>
  createFoodEntry(input, productionFoodWriterDependencies);

const productionFoodUpdater: RealFoodUpdater = (input) =>
  updateFoodEntry(input, productionFoodWriterDependencies);

const productionFoodDeleter: RealFoodDeleter = (input) =>
  deleteFoodEntry(input, productionFoodWriterDependencies);

const productionVitalReader: RealVitalReader = (input) =>
  readVitals(input, {
    tableName: process.env.VITAL_TABLE_NAME ?? '',
    send: (command) => dynamoDb.send(command),
  });

const productionVitalWriterDependencies = {
  tableName: process.env.VITAL_TABLE_NAME ?? '',
  put: (command: any) => dynamoDb.send(command),
  update: (command: any) => dynamoDb.send(command),
  delete: (command: any) => dynamoDb.send(command),
};

const productionVitalCreator: RealVitalCreator = (input) =>
  createVital(input, productionVitalWriterDependencies);

const productionVitalUpdater: RealVitalUpdater = (input) =>
  updateVital(input, productionVitalWriterDependencies);

const productionVitalDeleter: RealVitalDeleter = (input) =>
  deleteVital(input, productionVitalWriterDependencies);

const productionDailyTargetReader: RealDailyTargetReader = (input) =>
  readDailyTargets(input, {
    tableName: process.env.DAILY_TARGET_TABLE_NAME ?? '',
    send: (command) => dynamoDb.send(command),
  });

export function createIdentityProbeHandler(
  verifyToken: ProbeVerifier = verifyIdentityProbeToken,
  readSyntheticFood: typeof listSyntheticFoodEntries = listSyntheticFoodEntries,
  verifyFoodToken: FoodVerifier = verifyFoodReadToken,
  readRealFood?: RealFoodReader,
  verifyVitalToken: VitalVerifier = verifyVitalReadToken,
  readRealVitals?: RealVitalReader,
  verifyDailyTargetToken: DailyTargetVerifier = verifyDailyTargetReadToken,
  readRealDailyTargets?: RealDailyTargetReader,
  verifyFoodCreate: FoodWriteVerifier = verifyFoodCreateToken,
  createRealFood?: RealFoodCreator,
  verifyFoodUpdate: FoodWriteVerifier = verifyFoodUpdateToken,
  updateRealFood?: RealFoodUpdater,
  verifyFoodDelete: FoodWriteVerifier = verifyFoodDeleteToken,
  deleteRealFood?: RealFoodDeleter,
  verifyVitalCreate: FoodWriteVerifier = verifyVitalCreateToken,
  createRealVital?: RealVitalCreator,
  verifyVitalUpdate: FoodWriteVerifier = verifyVitalUpdateToken,
  updateRealVital?: RealVitalUpdater,
  verifyVitalDelete: FoodWriteVerifier = verifyVitalDeleteToken,
  deleteRealVital?: RealVitalDeleter,
) {
  return async (event: HttpEvent) => {
    const method = event.requestContext?.http?.method;
    const path = event.rawPath;

    safeDiagnosticLog({
      stage: 'request',
      method,
      path,
      authHeaderCount: Object.entries(event.headers ?? {}).filter(
        ([name]) => name.toLowerCase() === 'authorization'
      ).length,
    });

    if (method === 'GET' && path === '/.well-known/oauth-protected-resource') {
      return disabledHandler(event);
    }
    if (path !== '/mcp') {
      return disabledHandler(event);
    }
    if (method !== 'POST') {
      return {
        statusCode: 405,
        headers: { Allow: 'POST', 'Cache-Control': 'no-store' },
        body: '',
      };
    }

    const body = event.body == null
      ? undefined
      : event.isBase64Encoded
        ? Buffer.from(event.body, 'base64').toString('utf8')
        : event.body;
    const anonymousOperation = anonymousMcpOperation(body);

    let requestAuth: ReturnType<typeof classifyMcpRequestAuth> | undefined;
    try {
      requestAuth = classifyMcpRequestAuth(body);
    } catch (error) {
      if (!(error instanceof InvalidProtectedMcpRequestError)) {
        throw error;
      }
    }

    const requiredScope =
      requestAuth?.kind === 'protected-tool'
        ? requestAuth.requiredScope
        : PROBE_SCOPE;

    let rpcMethod: string | undefined;
    try {
      const rpc: unknown = body ? JSON.parse(body) : undefined;
      if (rpc && typeof rpc === 'object' && !Array.isArray(rpc)) {
        const candidate = (rpc as { method?: unknown }).method;
        if (typeof candidate === 'string') {
          rpcMethod = candidate;
        }
      }
    } catch {
      // Diagnostic only: never log the body or parsing error contents.
    }
    const authHeaders = Object.entries(event.headers ?? {}).filter(
      ([name]) => name.toLowerCase() === 'authorization'
    );

    safeDiagnosticLog({
      stage: 'mcp-operation',
      method,
      path,
      authHeaderCount: authHeaders.length,
      operation: anonymousOperation ?? 'protected-or-unrecognized',
      rpcMethod,
    });


    let fingerprint: string | undefined;
    let verifiedSubject: string | undefined;
    if (authHeaders.length > 0) {
      // A supplied, malformed/ambiguous/invalid token must never be ignored.
      const token = bearerToken(event.headers);
      if (!token) {
        safeDiagnosticLog({
          stage: 'auth-rejection',
          authFailure: 'bearer-format',
          status: 401,
        });
        return errorResponse(401, 'unauthorized', requiredScope);
      }

      // Unknown or malformed protected operations never receive a fallback
      // verifier merely because the caller supplied Authorization.
      if (!requestAuth) {
        return errorResponse(401, 'unauthorized', requiredScope);
      }

      try {
        if (
          requestAuth.kind === 'protected-tool' &&
          requestAuth.requiredScope === FOOD_READ_SCOPE
        ) {
          ({ verifiedSubject } = await verifyFoodToken(token));
        } else if (
          requestAuth.kind === 'protected-tool' &&
          requestAuth.requiredScope === FOOD_CREATE_SCOPE
        ) {
          ({ verifiedSubject } = await verifyFoodCreate(token));
        } else if (
          requestAuth.kind === 'protected-tool' &&
          requestAuth.requiredScope === FOOD_UPDATE_SCOPE
        ) {
          ({ verifiedSubject } = await verifyFoodUpdate(token));
        } else if (
          requestAuth.kind === 'protected-tool' &&
          requestAuth.requiredScope === FOOD_DELETE_SCOPE
        ) {
          ({ verifiedSubject } = await verifyFoodDelete(token));
        } else if (
          requestAuth.kind === 'protected-tool' &&
          requestAuth.requiredScope === VITAL_READ_SCOPE
        ) {
          ({ verifiedSubject } = await verifyVitalToken(token));
        } else if (
          requestAuth.kind === 'protected-tool' &&
          requestAuth.requiredScope === VITAL_CREATE_SCOPE
        ) {
          ({ verifiedSubject } = await verifyVitalCreate(token));
        } else if (
          requestAuth.kind === 'protected-tool' &&
          requestAuth.requiredScope === VITAL_UPDATE_SCOPE
        ) {
          ({ verifiedSubject } = await verifyVitalUpdate(token));
        } else if (
          requestAuth.kind === 'protected-tool' &&
          requestAuth.requiredScope === VITAL_DELETE_SCOPE
        ) {
          ({ verifiedSubject } = await verifyVitalDelete(token));
        } else if (
          requestAuth.kind === 'protected-tool' &&
          requestAuth.requiredScope === DAILY_TARGET_READ_SCOPE
        ) {
          ({ verifiedSubject } = await verifyDailyTargetToken(token));
        } else if (requestAuth.kind === 'discovery') {
          try {
            ({ fingerprint, verifiedSubject } = await verifyToken(token));
          } catch (error) {
            // Discovery is shared by tools protected by different scopes.
            // Fall back to food:read only when the token was otherwise valid
            // but lacked probe:identity. Never fall back on invalid JWTs.
            if (!(error instanceof InsufficientProbeScopeError)) {
              throw error;
            }

            try {
              ({ verifiedSubject } = await verifyFoodToken(token));
            } catch (foodError) {
              if (!(foodError instanceof InsufficientOAuthScopeError)) {
                throw foodError;
              }

              try {
                ({ verifiedSubject } = await verifyFoodCreate(token));
              } catch (createError) {
                if (!(createError instanceof InsufficientOAuthScopeError)) {
                  throw createError;
                }

                try {
                  ({ verifiedSubject } = await verifyFoodUpdate(token));
                } catch (updateError) {
                  if (!(updateError instanceof InsufficientOAuthScopeError)) {
                    throw updateError;
                  }

                  try {
                    ({ verifiedSubject } = await verifyFoodDelete(token));
                  } catch (deleteError) {
                    if (!(deleteError instanceof InsufficientOAuthScopeError)) {
                      throw deleteError;
                    }

                    try {
                      ({ verifiedSubject } = await verifyVitalToken(token));
                    } catch (vitalError) {
                      if (!(vitalError instanceof InsufficientOAuthScopeError)) {
                        throw vitalError;
                      }

                      try {
                        ({ verifiedSubject } = await verifyVitalCreate(token));
                      } catch (vitalCreateError) {
                        if (!(vitalCreateError instanceof InsufficientOAuthScopeError)) {
                          throw vitalCreateError;
                        }

                        try {
                          ({ verifiedSubject } = await verifyVitalUpdate(token));
                        } catch (vitalUpdateError) {
                          if (!(vitalUpdateError instanceof InsufficientOAuthScopeError)) {
                            throw vitalUpdateError;
                          }

                          try {
                            ({ verifiedSubject } = await verifyVitalDelete(token));
                          } catch (vitalDeleteError) {
                            if (!(vitalDeleteError instanceof InsufficientOAuthScopeError)) {
                              throw vitalDeleteError;
                            }

                            ({ verifiedSubject } = await verifyDailyTargetToken(token));
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        } else {
          ({ fingerprint, verifiedSubject } = await verifyToken(token));
        }
      } catch (error) {
        const insufficientScope =
          error instanceof InsufficientProbeScopeError ||
          error instanceof InsufficientOAuthScopeError;

        safeDiagnosticLog({
          stage: 'auth-rejection',
          authFailure: classifyAuthFailure(error),
          status: insufficientScope ? 403 : 401,
        });

        return errorResponse(
          insufficientScope ? 403 : 401,
          insufficientScope ? 'insufficient_scope' : 'unauthorized',
          requiredScope,
        );
      }
    } else if (
      requestAuth?.kind === 'protected-tool' &&
      anonymousOperation !== 'probe-challenge'
    ) {
      return errorResponse(401, 'unauthorized', requiredScope);
    } else if (!anonymousOperation) {
      return errorResponse(401, 'unauthorized', requiredScope);
    }

    // MCP v2 serves both the 2026 discovery protocol and legacy clients.
    // A fresh server is constructed for this request only.
    const mcp = createMcpHandler(
      () => createIdentityProbeServer(
        fingerprint,
        verifiedSubject,
        readSyntheticFood,
        readRealFood,
        readRealVitals,
        readRealDailyTargets,
        createRealFood,
        updateRealFood,
        deleteRealFood,
        createRealVital,
        updateRealVital,
        deleteRealVital,
      ),
      { responseMode: 'json' }
    );

    try {
      const request = new Request(`${MCP_RESOURCE}mcp`, {
        method: 'POST',
        headers: event.headers as Record<string, string> | undefined,
        body,
      });

      const response = await mcp.fetch(request);
      const responseBody = await response.text();

      safeDiagnosticLog({
        stage: 'mcp-response',
        method,
        path,
        operation: anonymousOperation ?? 'authenticated-or-unrecognized',
        status: response.status,
      });

      return {
        statusCode: response.status,
        headers: {
          ...Object.fromEntries(response.headers.entries()),
          'Cache-Control': 'no-store',
        },
        body: responseBody,
      };
    } finally {
      await mcp.close();
    }
  };
}

export const handler = createIdentityProbeHandler(
  verifyIdentityProbeToken,
  listSyntheticFoodEntries,
  verifyFoodReadToken,
  productionFoodReader,
  verifyVitalReadToken,
  productionVitalReader,
  verifyDailyTargetReadToken,
  productionDailyTargetReader,
  verifyFoodCreateToken,
  productionFoodCreator,
  verifyFoodUpdateToken,
  productionFoodUpdater,
  verifyFoodDeleteToken,
  productionFoodDeleter,
  verifyVitalCreateToken,
  productionVitalCreator,
  verifyVitalUpdateToken,
  productionVitalUpdater,
  verifyVitalDeleteToken,
  productionVitalDeleter,
);

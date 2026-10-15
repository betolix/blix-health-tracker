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
  verifyFoodReadToken,
  verifyIdentityProbeToken,
} from './auth0-probe';
import {
  FOOD_READ_SCOPE,
  InsufficientOAuthScopeError,
} from './oauth-scope';
import {
  classifyMcpRequestAuth,
  InvalidProtectedMcpRequestError,
} from './mcp-request-auth';
import { handler as disabledHandler } from './disabled-handler';
import { createIdentityProbeServer } from './identity-probe-server';
import { listSyntheticFoodEntries } from './synthetic-food-entry-probe';

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

export function createIdentityProbeHandler(
  verifyToken: ProbeVerifier = verifyIdentityProbeToken,
  readSyntheticFood: typeof listSyntheticFoodEntries = listSyntheticFoodEntries,
  verifyFoodToken: FoodVerifier = verifyFoodReadToken,
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

            ({ verifiedSubject } = await verifyFoodToken(token));
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
      () => createIdentityProbeServer(fingerprint, verifiedSubject, readSyntheticFood),
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

export const handler = createIdentityProbeHandler();

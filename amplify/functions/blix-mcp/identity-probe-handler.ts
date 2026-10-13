import { createMcpHandler } from '@modelcontextprotocol/server';
import {
  InsufficientProbeScopeError,
  MCP_RESOURCE,
  PROBE_SCOPE,
  verifyIdentityProbeToken,
} from './auth0-probe';
import { handler as disabledHandler } from './disabled-handler';
import { createIdentityProbeServer } from './identity-probe-server';

// Deployed by resource.ts. This handler exposes only the synthetic identity probe.
type HttpEvent = {
  rawPath?: string;
  body?: string | null;
  isBase64Encoded?: boolean;
  headers?: Record<string, string | undefined>;
  requestContext?: { http?: { method?: string } };
};

function safeDiagnosticLog(details: {
  stage: string;
  method?: string;
  path?: string;
  authHeaderCount?: number;
  operation?: string;
  rpcMethod?: string;
  status?: number;
}) {
  console.info('[blix-mcp-diagnostic]', JSON.stringify(details));
}

const RESOURCE_METADATA = `${MCP_RESOURCE}.well-known/oauth-protected-resource`;

function errorResponse(statusCode: number, error: string) {
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
        `Bearer resource_metadata="${RESOURCE_METADATA}", scope="${PROBE_SCOPE}"` +
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
        (params as { name?: unknown }).name === 'identity_probe'
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
) => Promise<{ fingerprint: string }>;

export function createIdentityProbeHandler(
  verifyToken: ProbeVerifier = verifyIdentityProbeToken
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
    if (authHeaders.length > 0) {
      // A supplied, malformed/ambiguous/invalid token must never be ignored.
      const token = bearerToken(event.headers);
      if (!token) return errorResponse(401, 'unauthorized');
      try {
        ({ fingerprint } = await verifyToken(token));
      } catch (error) {
        return errorResponse(
          error instanceof InsufficientProbeScopeError ? 403 : 401,
          error instanceof InsufficientProbeScopeError
            ? 'insufficient_scope'
            : 'unauthorized'
        );
      }
    } else if (!anonymousOperation) {
      return errorResponse(401, 'unauthorized');
    }

    // MCP v2 serves both the 2026 discovery protocol and legacy clients.
    // A fresh server is constructed for this request only.
    const mcp = createMcpHandler(
      () => createIdentityProbeServer(fingerprint),
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

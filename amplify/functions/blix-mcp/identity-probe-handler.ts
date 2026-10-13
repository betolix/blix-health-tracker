import { WebStandardStreamableHTTPServerTransport } from
  '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {
  InsufficientProbeScopeError,
  MCP_RESOURCE,
  PROBE_SCOPE,
  verifyIdentityProbeToken,
} from './auth0-probe';
import { handler as disabledHandler } from './disabled-handler';
import { createIdentityProbeServer } from './identity-probe-server';

// NOT an Amplify entry point. resource.ts must continue pointing to
// disabled-handler.ts until separate explicit approval to deploy.
type HttpEvent = {
  rawPath?: string;
  body?: string | null;
  isBase64Encoded?: boolean;
  headers?: Record<string, string | undefined>;
  requestContext?: { http?: { method?: string } };
};

const RESOURCE_METADATA = `${MCP_RESOURCE}.well-known/oauth-protected-resource`;

function errorResponse(statusCode: number, error: string) {
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

type ProbeVerifier = (
  token: string
) => Promise<{ fingerprint: string }>;

export function createIdentityProbeHandler(
  verifyToken: ProbeVerifier = verifyIdentityProbeToken
) {
  return async (event: HttpEvent) => {
    const method = event.requestContext?.http?.method;
    const path = event.rawPath;

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

    const token = bearerToken(event.headers);
    if (!token) return errorResponse(401, 'unauthorized');

    let fingerprint: string;
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

    const server = createIdentityProbeServer(fingerprint);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    try {
      await server.connect(transport);
      const body = event.body == null
        ? undefined
        : event.isBase64Encoded
          ? Buffer.from(event.body, 'base64')
          : event.body;
      const request = new Request(`${MCP_RESOURCE}mcp`, {
        method: 'POST',
        headers: event.headers as Record<string, string> | undefined,
        body,
      });
      const response = await transport.handleRequest(request);
      const responseBody = await response.text();
      return {
        statusCode: response.status,
        headers: {
          ...Object.fromEntries(response.headers.entries()),
          'Cache-Control': 'no-store',
        },
        body: responseBody,
      };
    } finally {
      await server.close();
    }
  };
}

export const handler = createIdentityProbeHandler();

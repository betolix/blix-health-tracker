import { verifyBlixToken } from './auth';
import { handleMcpRequest } from './mcp-http';

type HttpEvent = {
  body?: string | null;
  isBase64Encoded?: boolean;
  headers?: Record<string, string | undefined>;
  requestContext?: {
    http?: {
      method?: string;
    };
  };
};

function unauthorized() {
  return {
    statusCode: 401,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'WWW-Authenticate': 'Bearer realm="blix-mcp"',
    },
    body: JSON.stringify({
      error: 'unauthorized',
    }),
  };
}

function getAuthorizationHeader(
  headers: Record<string, string | undefined> = {}
) {
  const entry = Object.entries(headers).find(
    ([name]) => name.toLowerCase() === 'authorization'
  );

  return entry?.[1];
}

export const handler = async (event: HttpEvent) => {
  const authorization = getAuthorizationHeader(event.headers);

  if (!authorization?.startsWith('Bearer ')) {
    return unauthorized();
  }

  const token = authorization.slice('Bearer '.length).trim();

  if (!token) {
    return unauthorized();
  }

  try {
    // Nothing reaches MCP unless Cognito authentication succeeds.
    await verifyBlixToken(token);
  } catch {
    return unauthorized();
  }

  const method = event.requestContext?.http?.method ?? 'POST';

  const body =
    event.body == null
      ? undefined
      : event.isBase64Encoded
        ? Buffer.from(event.body, 'base64')
        : event.body;

  const request = new Request('https://blix.local/mcp', {
    method,
    headers: event.headers as Record<string, string>,
    body:
      method === 'GET' || method === 'HEAD'
        ? undefined
        : body,
  });

  const response = await handleMcpRequest(request);

  const responseBody = await response.text();

  return {
    statusCode: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body: responseBody,
  };
};

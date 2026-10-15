import { FOOD_READ_SCOPE, PROBE_SCOPE } from './oauth-scope';

const RESOURCE =
  'https://xa2eims733qub3334xn6yky7re0ytosu.lambda-url.us-east-1.on.aws/';

const AUTH0_ISSUER =
  'https://dev-0nvmmicnskv1kx50.us.auth0.com/';

type LambdaEvent = {
  rawPath?: string;
  requestContext?: {
    http?: {
      method?: string;
    };
  };
};

export const handler = async (event: LambdaEvent) => {
  const method = event?.requestContext?.http?.method;
  const path = event?.rawPath;

  if (
    method === 'GET' &&
    (
      path === '/.well-known/oauth-protected-resource' ||
      path === '/.well-known/oauth-protected-resource/mcp' ||
      path === '/mcp/.well-known/oauth-protected-resource'
    )
  ) {
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
      body: JSON.stringify({
        resource: RESOURCE,
        authorization_servers: [AUTH0_ISSUER],
        scopes_supported: [PROBE_SCOPE, FOOD_READ_SCOPE],
      }),
    };
  }

  // Any route not explicitly allowed above remains disabled.
  return {
    statusCode: 503,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify({
      error: 'service_unavailable',
      message: 'Blix MCP is not enabled.',
    }),
  };
};

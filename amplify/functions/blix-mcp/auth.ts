import { CognitoJwtVerifier } from 'aws-jwt-verify';

function requiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing configuration: ${name}`);
  }

  return value;
}

function createVerifier() {
  const resource = requiredEnv('BLIX_MCP_RESOURCE');

  return CognitoJwtVerifier.create({
    userPoolId: requiredEnv('BLIX_COGNITO_POOL_ID'),
    clientId: requiredEnv('BLIX_OAUTH_CLIENT_ID'),
    tokenUse: 'access',
    scope: requiredEnv('BLIX_OAUTH_SCOPE'),

    customJwtCheck: ({ payload }) => {
      const audience = payload.aud;

      const matches =
        audience === resource ||
        (Array.isArray(audience) &&
          audience.includes(resource));

      if (!matches) {
        throw new Error('Invalid token audience');
      }
    },
  });
}

// Reuse the verifier and its signing-key cache.
let verifier: ReturnType<typeof createVerifier> | undefined;

export async function verifyBlixToken(token: string) {
  verifier ??= createVerifier();

  const payload = await verifier.verify(token);

  if (!payload.sub) {
    throw new Error('Missing authenticated user');
  }

  return {
    userId: payload.sub,
  };
}

import { createHash } from 'node:crypto';
import { JwtVerifier } from 'aws-jwt-verify';
import type { JwksCache } from 'aws-jwt-verify/jwk';

// These values must exactly match Auth0 discovery and the protected resource.
export const AUTH0_ISSUER =
  'https://dev-0nvmmicnskv1kx50.us.auth0.com/';
export const MCP_RESOURCE =
  'https://xa2eims733qub3334xn6yky7re0ytosu.lambda-url.us-east-1.on.aws/';
export const PROBE_SCOPE = 'probe:identity';
export const CHATGPT_CIMD_CLIENT_ID =
  'https://chatgpt.com/oauth/client.json';

export class InsufficientProbeScopeError extends Error {
  constructor() {
    super('Insufficient probe scope');
  }
}

export function createIdentityProbeVerifier(jwksCache?: JwksCache) {
  return JwtVerifier.create(
    {
      issuer: AUTH0_ISSUER,
      audience: MCP_RESOURCE,
      jwksUri: `${AUTH0_ISSUER}.well-known/jwks.json`,
      customJwtCheck: ({ payload, header }) => {
        if (header.alg !== 'RS256') {
          throw new Error('Unexpected JWT algorithm');
        }
        if (
          typeof payload.exp !== 'number' ||
          !Number.isFinite(payload.exp) ||
          typeof payload.iat !== 'number' ||
          !Number.isFinite(payload.iat)
        ) {
          throw new Error('Required JWT timestamps missing');
        }
        if (typeof payload.sub !== 'string' || !payload.sub.trim()) {
          throw new Error('Missing authenticated subject');
        }
        // Pin the OAuth client to ChatGPT's CIMD identifier.
        // Never accept an arbitrary third-party Auth0 client for this probe.
        if (payload.azp !== CHATGPT_CIMD_CLIENT_ID) {
          throw new Error('Unexpected OAuth client');
        }
      },
    },
    jwksCache ? { jwksCache } : undefined
  );
}

const verifier = createIdentityProbeVerifier();

export async function verifyIdentityProbeToken(
  token: string,
  tokenVerifier = verifier
) {
  // This verifier is intentionally separate from the old Cognito verifier.
  // It validates Auth0-issued API access tokens, not ID tokens.
  const payload = await tokenVerifier.verify(token);
  const grantedScopes =
    typeof payload.scope === 'string' ? payload.scope.split(/\s+/) : [];
  if (!grantedScopes.includes(PROBE_SCOPE)) {
    throw new InsufficientProbeScopeError();
  }

  // Opaque, stable probe identifier: do not expose email, JWT or raw sub.
  // This is NOT an Auth0 -> Cognito owner mapping.
  const verifiedSubject = payload.sub;
  if (typeof verifiedSubject !== 'string' || !verifiedSubject.trim()) {
    throw new Error('Missing authenticated subject');
  }
  const fingerprint = createHash('sha256')
    .update(`blix-identity-probe-v1:${verifiedSubject}`)
    .digest('hex')
    .slice(0, 24);

  return { fingerprint, verifiedSubject };
}

import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { SimpleJwksCache } from 'aws-jwt-verify/jwk';
import {
  AUTH0_ISSUER,
  CHATGPT_CIMD_CLIENT_ID,
  MCP_RESOURCE,
  createIdentityProbeVerifier,
  verifyDailyTargetReadToken,
  verifyFoodReadToken,
  verifyIdentityProbeToken,
  verifyVitalReadToken,
} from './auth0-probe';
import {
  DAILY_TARGET_READ_SCOPE,
  FOOD_READ_SCOPE,
  PROBE_SCOPE,
  VITAL_READ_SCOPE,
} from './oauth-scope';

const trusted = generateKeyPairSync('rsa', { modulusLength: 2048 });
const untrusted = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = trusted.publicKey.export({ format: 'jwk' });

if (!jwk.n || !jwk.e) {
  throw new Error('Synthetic RSA public key is incomplete');
}

const jwksCache = new SimpleJwksCache();
const jwksUri = `${AUTH0_ISSUER}.well-known/jwks.json`;

jwksCache.addJwks(jwksUri, {
  keys: [{
    kty: 'RSA',
    n: jwk.n,
    e: jwk.e,
    kid: 'food-read-test-key',
    alg: 'RS256',
    use: 'sig',
  }],
});

const verifier = createIdentityProbeVerifier(jwksCache);

function token(
  scope: string,
  overrides: Record<string, unknown> = {},
  signingKey = trusted.privateKey,
): string {
  const now = Math.floor(Date.now() / 1000);

  const header = {
    alg: 'RS256',
    typ: 'JWT',
    kid: 'food-read-test-key',
  };

  const payload = {
    iss: AUTH0_ISSUER,
    aud: MCP_RESOURCE,
    sub: 'oidc|blix-cognito|11111111-1111-4111-8111-111111111111',
    azp: CHATGPT_CIMD_CLIENT_ID,
    scope,
    iat: now,
    exp: now + 300,
    ...overrides,
  };

  const unsigned =
    `${Buffer.from(JSON.stringify(header)).toString('base64url')}.` +
    `${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;

  const signature = sign(
    'RSA-SHA256',
    Buffer.from(unsigned),
    signingKey,
  ).toString('base64url');

  return `${unsigned}.${signature}`;
}

async function rejects(fn: () => Promise<unknown>) {
  await assert.rejects(fn);
}

const probeOnly = token(PROBE_SCOPE);
const foodOnly = token(FOOD_READ_SCOPE);
const vitalOnly = token(VITAL_READ_SCOPE);
const targetOnly = token(DAILY_TARGET_READ_SCOPE);
const allScopes = token(
  `${PROBE_SCOPE} ${FOOD_READ_SCOPE} ${VITAL_READ_SCOPE} ${DAILY_TARGET_READ_SCOPE}`
);

// probe:identity authorizes only the synthetic probe verifier.
await verifyIdentityProbeToken(probeOnly, verifier);
await rejects(() => verifyFoodReadToken(probeOnly, verifier));

// food:read authorizes only the real FoodEntry verifier.
const foodIdentity = await verifyFoodReadToken(foodOnly, verifier);
assert.equal(
  foodIdentity.verifiedSubject,
  'oidc|blix-cognito|11111111-1111-4111-8111-111111111111',
);
await rejects(() => verifyIdentityProbeToken(foodOnly, verifier));

// vitals:read authorizes only the Vital verifier.
const vitalIdentity = await verifyVitalReadToken(vitalOnly, verifier);
assert.equal(
  vitalIdentity.verifiedSubject,
  'oidc|blix-cognito|11111111-1111-4111-8111-111111111111',
);
await rejects(() => verifyFoodReadToken(vitalOnly, verifier));
await rejects(() => verifyIdentityProbeToken(vitalOnly, verifier));

await rejects(() => verifyVitalReadToken(foodOnly, verifier));
await rejects(() => verifyVitalReadToken(probeOnly, verifier));

// targets:read authorizes only the DailyTarget verifier.
const targetIdentity = await verifyDailyTargetReadToken(
  targetOnly,
  verifier,
);
assert.equal(
  targetIdentity.verifiedSubject,
  'oidc|blix-cognito|11111111-1111-4111-8111-111111111111',
);

await rejects(() =>
  verifyIdentityProbeToken(targetOnly, verifier)
);
await rejects(() =>
  verifyFoodReadToken(targetOnly, verifier)
);
await rejects(() =>
  verifyVitalReadToken(targetOnly, verifier)
);

await rejects(() =>
  verifyDailyTargetReadToken(probeOnly, verifier)
);
await rejects(() =>
  verifyDailyTargetReadToken(foodOnly, verifier)
);
await rejects(() =>
  verifyDailyTargetReadToken(vitalOnly, verifier)
);

// A token explicitly granted all capabilities may satisfy all.
await verifyIdentityProbeToken(allScopes, verifier);
await verifyFoodReadToken(allScopes, verifier);
await verifyVitalReadToken(allScopes, verifier);
await verifyDailyTargetReadToken(allScopes, verifier);

// food:read is not sufficient unless the JWT itself is cryptographically
// valid and bound to the expected issuer, audience, and OAuth client.
await rejects(() =>
  verifyFoodReadToken(
    token(FOOD_READ_SCOPE, {}, untrusted.privateKey),
    verifier,
  ),
);

await rejects(() =>
  verifyFoodReadToken(
    token(FOOD_READ_SCOPE, { iss: 'https://invalid.example/' }),
    verifier,
  ),
);

await rejects(() =>
  verifyFoodReadToken(
    token(FOOD_READ_SCOPE, { aud: 'https://invalid.example/resource' }),
    verifier,
  ),
);

await rejects(() =>
  verifyFoodReadToken(
    token(FOOD_READ_SCOPE, { azp: 'unexpected-oauth-client' }),
    verifier,
  ),
);

console.log('PASS: probe:identity cannot authorize FoodEntry reads');
console.log('PASS: food:read cannot authorize synthetic probes');
console.log('PASS: food:read returns only verified server-side identity');
console.log('PASS: vitals:read is isolated from probe and food scopes');
console.log('PASS: targets:read is isolated from probe, food and vital scopes');
console.log('PASS: explicitly combined scopes satisfy all verifiers');
console.log('PASS: food:read rejects an untrusted signature');
console.log('PASS: food:read rejects an unexpected issuer');
console.log('PASS: food:read rejects an unexpected audience');
console.log('PASS: food:read rejects an unexpected OAuth client');

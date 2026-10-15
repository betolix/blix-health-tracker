import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { SimpleJwksCache } from 'aws-jwt-verify/jwk';
import {
  AUTH0_ISSUER,
  CHATGPT_CIMD_CLIENT_ID,
  MCP_RESOURCE,
  createIdentityProbeVerifier,
  verifyDailyTargetCreateToken,
  verifyDailyTargetDeleteToken,
  verifyDailyTargetReadToken,
  verifyDailyTargetUpdateToken,
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
  DAILY_TARGET_CREATE_SCOPE,
  DAILY_TARGET_DELETE_SCOPE,
  DAILY_TARGET_READ_SCOPE,
  DAILY_TARGET_UPDATE_SCOPE,
  FOOD_CREATE_SCOPE,
  FOOD_DELETE_SCOPE,
  FOOD_READ_SCOPE,
  FOOD_UPDATE_SCOPE,
  PROBE_SCOPE,
  VITAL_CREATE_SCOPE,
  VITAL_DELETE_SCOPE,
  VITAL_READ_SCOPE,
  VITAL_UPDATE_SCOPE,
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
const foodCreateOnly = token(FOOD_CREATE_SCOPE);
const foodUpdateOnly = token(FOOD_UPDATE_SCOPE);
const foodDeleteOnly = token(FOOD_DELETE_SCOPE);
const vitalOnly = token(VITAL_READ_SCOPE);
const vitalCreateOnly = token(VITAL_CREATE_SCOPE);
const vitalUpdateOnly = token(VITAL_UPDATE_SCOPE);
const vitalDeleteOnly = token(VITAL_DELETE_SCOPE);
const targetOnly = token(DAILY_TARGET_READ_SCOPE);
const targetCreateOnly = token(DAILY_TARGET_CREATE_SCOPE);
const targetUpdateOnly = token(DAILY_TARGET_UPDATE_SCOPE);
const targetDeleteOnly = token(DAILY_TARGET_DELETE_SCOPE);

const allScopes = token(
  [
    PROBE_SCOPE,
    FOOD_READ_SCOPE,
    FOOD_CREATE_SCOPE,
    FOOD_UPDATE_SCOPE,
    FOOD_DELETE_SCOPE,
    VITAL_READ_SCOPE,
    VITAL_CREATE_SCOPE,
    VITAL_UPDATE_SCOPE,
    VITAL_DELETE_SCOPE,
    DAILY_TARGET_READ_SCOPE,
    DAILY_TARGET_CREATE_SCOPE,
    DAILY_TARGET_UPDATE_SCOPE,
    DAILY_TARGET_DELETE_SCOPE,
  ].join(' ')
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

// Vital write capabilities are cryptographically verified and isolated.
const vitalCreateIdentity = await verifyVitalCreateToken(
  vitalCreateOnly,
  verifier,
);
const vitalUpdateIdentity = await verifyVitalUpdateToken(
  vitalUpdateOnly,
  verifier,
);
const vitalDeleteIdentity = await verifyVitalDeleteToken(
  vitalDeleteOnly,
  verifier,
);

for (const identity of [
  vitalCreateIdentity,
  vitalUpdateIdentity,
  vitalDeleteIdentity,
]) {
  assert.equal(
    identity.verifiedSubject,
    'oidc|blix-cognito|11111111-1111-4111-8111-111111111111',
  );
}

// Vital read cannot authorize Vital writes.
await rejects(() =>
  verifyVitalCreateToken(vitalOnly, verifier)
);
await rejects(() =>
  verifyVitalUpdateToken(vitalOnly, verifier)
);
await rejects(() =>
  verifyVitalDeleteToken(vitalOnly, verifier)
);

// Vital write scopes cannot authorize one another.
await rejects(() =>
  verifyVitalUpdateToken(vitalCreateOnly, verifier)
);
await rejects(() =>
  verifyVitalDeleteToken(vitalCreateOnly, verifier)
);
await rejects(() =>
  verifyVitalCreateToken(vitalUpdateOnly, verifier)
);
await rejects(() =>
  verifyVitalDeleteToken(vitalUpdateOnly, verifier)
);
await rejects(() =>
  verifyVitalCreateToken(vitalDeleteOnly, verifier)
);
await rejects(() =>
  verifyVitalUpdateToken(vitalDeleteOnly, verifier)
);

// Vital write scopes cannot authorize reads or probes.
for (const writeOnly of [
  vitalCreateOnly,
  vitalUpdateOnly,
  vitalDeleteOnly,
]) {
  await rejects(() =>
    verifyVitalReadToken(writeOnly, verifier)
  );
  await rejects(() =>
    verifyIdentityProbeToken(writeOnly, verifier)
  );
}

// Vital write verifiers require a trusted JWT signature.
await rejects(() =>
  verifyVitalCreateToken(
    token(VITAL_CREATE_SCOPE, {}, untrusted.privateKey),
    verifier,
  ),
);

await rejects(() =>
  verifyVitalUpdateToken(
    token(VITAL_UPDATE_SCOPE, {}, untrusted.privateKey),
    verifier,
  ),
);

await rejects(() =>
  verifyVitalDeleteToken(
    token(VITAL_DELETE_SCOPE, {}, untrusted.privateKey),
    verifier,
  ),
);

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

// DailyTarget write capabilities are cryptographically verified and isolated.
const targetCreateIdentity = await verifyDailyTargetCreateToken(
  targetCreateOnly,
  verifier,
);
const targetUpdateIdentity = await verifyDailyTargetUpdateToken(
  targetUpdateOnly,
  verifier,
);
const targetDeleteIdentity = await verifyDailyTargetDeleteToken(
  targetDeleteOnly,
  verifier,
);

for (const identity of [
  targetCreateIdentity,
  targetUpdateIdentity,
  targetDeleteIdentity,
]) {
  assert.equal(
    identity.verifiedSubject,
    'oidc|blix-cognito|11111111-1111-4111-8111-111111111111',
  );
}

// DailyTarget read cannot authorize writes.
await rejects(() =>
  verifyDailyTargetCreateToken(targetOnly, verifier)
);
await rejects(() =>
  verifyDailyTargetUpdateToken(targetOnly, verifier)
);
await rejects(() =>
  verifyDailyTargetDeleteToken(targetOnly, verifier)
);

// DailyTarget write scopes cannot authorize one another.
await rejects(() =>
  verifyDailyTargetUpdateToken(targetCreateOnly, verifier)
);
await rejects(() =>
  verifyDailyTargetDeleteToken(targetCreateOnly, verifier)
);
await rejects(() =>
  verifyDailyTargetCreateToken(targetUpdateOnly, verifier)
);
await rejects(() =>
  verifyDailyTargetDeleteToken(targetUpdateOnly, verifier)
);
await rejects(() =>
  verifyDailyTargetCreateToken(targetDeleteOnly, verifier)
);
await rejects(() =>
  verifyDailyTargetUpdateToken(targetDeleteOnly, verifier)
);

// DailyTarget write scopes cannot authorize reads or probes.
for (const writeOnly of [
  targetCreateOnly,
  targetUpdateOnly,
  targetDeleteOnly,
]) {
  await rejects(() =>
    verifyDailyTargetReadToken(writeOnly, verifier)
  );
  await rejects(() =>
    verifyIdentityProbeToken(writeOnly, verifier)
  );
}

// DailyTarget write verifiers require a trusted JWT signature.
await rejects(() =>
  verifyDailyTargetCreateToken(
    token(DAILY_TARGET_CREATE_SCOPE, {}, untrusted.privateKey),
    verifier,
  ),
);

await rejects(() =>
  verifyDailyTargetUpdateToken(
    token(DAILY_TARGET_UPDATE_SCOPE, {}, untrusted.privateKey),
    verifier,
  ),
);

await rejects(() =>
  verifyDailyTargetDeleteToken(
    token(DAILY_TARGET_DELETE_SCOPE, {}, untrusted.privateKey),
    verifier,
  ),
);

// FoodEntry write capabilities are cryptographically verified and isolated.
const createIdentity = await verifyFoodCreateToken(
  foodCreateOnly,
  verifier,
);
const updateIdentity = await verifyFoodUpdateToken(
  foodUpdateOnly,
  verifier,
);
const deleteIdentity = await verifyFoodDeleteToken(
  foodDeleteOnly,
  verifier,
);

for (const identity of [
  createIdentity,
  updateIdentity,
  deleteIdentity,
]) {
  assert.equal(
    identity.verifiedSubject,
    'oidc|blix-cognito|11111111-1111-4111-8111-111111111111',
  );
}

// Read cannot authorize writes.
await rejects(() =>
  verifyFoodCreateToken(foodOnly, verifier)
);
await rejects(() =>
  verifyFoodUpdateToken(foodOnly, verifier)
);
await rejects(() =>
  verifyFoodDeleteToken(foodOnly, verifier)
);

// Each write scope authorizes only its own operation.
await rejects(() =>
  verifyFoodUpdateToken(foodCreateOnly, verifier)
);
await rejects(() =>
  verifyFoodDeleteToken(foodCreateOnly, verifier)
);
await rejects(() =>
  verifyFoodCreateToken(foodUpdateOnly, verifier)
);
await rejects(() =>
  verifyFoodDeleteToken(foodUpdateOnly, verifier)
);
await rejects(() =>
  verifyFoodCreateToken(foodDeleteOnly, verifier)
);
await rejects(() =>
  verifyFoodUpdateToken(foodDeleteOnly, verifier)
);

// Write scopes cannot authorize reads or probes.
for (const writeOnly of [
  foodCreateOnly,
  foodUpdateOnly,
  foodDeleteOnly,
]) {
  await rejects(() =>
    verifyFoodReadToken(writeOnly, verifier)
  );
  await rejects(() =>
    verifyIdentityProbeToken(writeOnly, verifier)
  );
}

// Each write verifier still requires a cryptographically trusted JWT.
await rejects(() =>
  verifyFoodCreateToken(
    token(FOOD_CREATE_SCOPE, {}, untrusted.privateKey),
    verifier,
  ),
);

await rejects(() =>
  verifyFoodUpdateToken(
    token(FOOD_UPDATE_SCOPE, {}, untrusted.privateKey),
    verifier,
  ),
);

await rejects(() =>
  verifyFoodDeleteToken(
    token(FOOD_DELETE_SCOPE, {}, untrusted.privateKey),
    verifier,
  ),
);

// A token explicitly granted all capabilities may satisfy all.
await verifyIdentityProbeToken(allScopes, verifier);
await verifyFoodReadToken(allScopes, verifier);
await verifyFoodCreateToken(allScopes, verifier);
await verifyFoodUpdateToken(allScopes, verifier);
await verifyFoodDeleteToken(allScopes, verifier);
await verifyVitalReadToken(allScopes, verifier);
await verifyVitalCreateToken(allScopes, verifier);
await verifyVitalUpdateToken(allScopes, verifier);
await verifyVitalDeleteToken(allScopes, verifier);
await verifyDailyTargetReadToken(allScopes, verifier);
await verifyDailyTargetCreateToken(allScopes, verifier);
await verifyDailyTargetUpdateToken(allScopes, verifier);
await verifyDailyTargetDeleteToken(allScopes, verifier);

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
console.log('PASS: vitals:create, vitals:update and vitals:delete are cryptographically verified');
console.log('PASS: Vital write scopes are mutually isolated');
console.log('PASS: Vital write scopes cannot authorize reads or probes');
console.log('PASS: Vital write verifiers reject untrusted signatures');
console.log('PASS: targets:read is isolated from probe, food and vital scopes');
console.log('PASS: targets:create, targets:update and targets:delete are cryptographically verified');
console.log('PASS: DailyTarget write scopes are mutually isolated');
console.log('PASS: DailyTarget write scopes cannot authorize reads or probes');
console.log('PASS: DailyTarget write verifiers reject untrusted signatures');
console.log('PASS: food:create, food:update and food:delete are cryptographically verified');
console.log('PASS: FoodEntry write scopes are mutually isolated');
console.log('PASS: FoodEntry write scopes cannot authorize reads or probes');
console.log('PASS: FoodEntry write verifiers reject untrusted signatures');
console.log('PASS: explicitly combined scopes satisfy all verifiers');
console.log('PASS: food:read rejects an untrusted signature');
console.log('PASS: food:read rejects an unexpected issuer');
console.log('PASS: food:read rejects an unexpected audience');
console.log('PASS: food:read rejects an unexpected OAuth client');

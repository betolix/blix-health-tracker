import {
  generateKeyPairSync,
  sign,
  type KeyObject,
} from 'node:crypto';
import { SimpleJwksCache } from 'aws-jwt-verify/jwk';
import {
  AUTH0_ISSUER,
  CHATGPT_CIMD_CLIENT_ID,
  MCP_RESOURCE,
  PROBE_SCOPE,
  createIdentityProbeVerifier,
  verifyIdentityProbeToken,
} from './auth0-probe';

const TEST_CLIENT_ID = CHATGPT_CIMD_CLIENT_ID;
const JWKS_URI = `${AUTH0_ISSUER}.well-known/jwks.json`;

const trusted = generateKeyPairSync('rsa', { modulusLength: 2048 });
const untrusted = generateKeyPairSync('rsa', { modulusLength: 2048 });

const trustedJwk = trusted.publicKey.export({ format: 'jwk' });

if (!trustedJwk.n || !trustedJwk.e) {
  throw new Error('Synthetic RSA public key is missing required JWK fields');
}

const jwksCache = new SimpleJwksCache();

jwksCache.addJwks(JWKS_URI, {
  keys: [
    {
      kty: 'RSA',
      n: trustedJwk.n,
      e: trustedJwk.e,
      kid: 'test-key',
      alg: 'RS256',
      use: 'sig',
    },
  ],
});

const verifier = createIdentityProbeVerifier(jwksCache);

type Claims = {
  iss?: string;
  aud?: string;
  sub?: string;
  azp?: string;
  scope?: string;
  iat?: number;
  exp?: number;
  jti?: string;
};

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function makeToken(
  overrides: Partial<Claims> = {},
  options: {
    privateKey?: KeyObject;
    alg?: 'RS256' | 'RS512';
  } = {}
): string {
  const now = Math.floor(Date.now() / 1000);
  const alg = options.alg ?? 'RS256';

  const header = {
    alg,
    typ: 'JWT',
    kid: 'test-key',
  };

  const payload: Claims = {
    iss: AUTH0_ISSUER,
    aud: MCP_RESOURCE,
    sub: 'synthetic-user-a',
    azp: TEST_CLIENT_ID,
    scope: PROBE_SCOPE,
    iat: now,
    exp: now + 300,
    jti: 'synthetic-jti',
    ...overrides,
  };

  const unsigned = `${base64url(header)}.${base64url(payload)}`;

  const signature = sign(
    alg === 'RS256' ? 'RSA-SHA256' : 'RSA-SHA512',
    Buffer.from(unsigned),
    options.privateKey ?? trusted.privateKey
  ).toString('base64url');

  return `${unsigned}.${signature}`;
}

async function expectRejected(
  name: string,
  token: string,
  tokenVerifier = verifier
) {
  try {
    await verifyIdentityProbeToken(token, tokenVerifier);
    throw new Error(`${name}: token was unexpectedly accepted`);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === `${name}: token was unexpectedly accepted`
    ) {
      throw error;
    }
    console.log(`PASS: ${name}`);
  }
}

async function main() {
  const valid = await verifyIdentityProbeToken(makeToken(), verifier);

  if (!valid.fingerprint) {
    throw new Error('valid RS256 token did not produce a fingerprint');
  }
  console.log('PASS: valid synthetic RS256 token accepted');

  await expectRejected(
    'missing probe scope rejected',
    makeToken({ scope: 'some:other_scope' })
  );

  await expectRejected(
    'wrong audience rejected',
    makeToken({ aud: 'https://wrong.example/' })
  );

  await expectRejected(
    'wrong OAuth client rejected',
    makeToken({ azp: 'unexpected-client' })
  );

  await expectRejected(
    'expired token rejected',
    makeToken({ exp: Math.floor(Date.now() / 1000) - 60 })
  );

  await expectRejected(
    'wrong issuer rejected',
    makeToken({ iss: 'https://wrong.example/' })
  );

  await expectRejected(
    'invalid signature rejected',
    makeToken({}, { privateKey: untrusted.privateKey })
  );

  await expectRejected(
    'non-RS256 token rejected',
    makeToken({}, { alg: 'RS512' })
  );

  const now = Math.floor(Date.now() / 1000);

  await expectRejected(
    'missing iat rejected',
    makeToken({ iat: undefined })
  );

  await expectRejected(
    'missing subject rejected',
    makeToken({ sub: undefined })
  );

  await expectRejected(
    'missing OAuth client rejected',
    makeToken({ azp: undefined })
  );

  const a1 = await verifyIdentityProbeToken(
    makeToken({
      sub: 'synthetic-user-a',
      jti: `a1-${now}`,
    }),
    verifier
  );

  const a2 = await verifyIdentityProbeToken(
    makeToken({
      sub: 'synthetic-user-a',
      jti: `a2-${now}`,
    }),
    verifier
  );

  const b = await verifyIdentityProbeToken(
    makeToken({
      sub: 'synthetic-user-b',
      jti: `b-${now}`,
    }),
    verifier
  );

  if (a1.fingerprint !== a2.fingerprint) {
    throw new Error(
      'same synthetic identity produced different fingerprints'
    );
  }
  console.log('PASS: same identity produces stable fingerprint');

  if (a1.fingerprint === b.fingerprint) {
    throw new Error(
      'different synthetic identities produced same fingerprint'
    );
  }
  console.log('PASS: different identities produce different fingerprints');

  console.log('PASS: all synthetic identity-probe tests passed');
}

main().catch((error) => {
  console.error('FAIL:', error);
  process.exitCode = 1;
});

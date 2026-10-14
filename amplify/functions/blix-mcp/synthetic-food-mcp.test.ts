import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createIdentityProbeHandler } from './identity-probe-handler';
import { syntheticFoodIdentityKeyFromVerifiedAuth0Subject } from './synthetic-food-entry-probe';

const A = '11111111-2222-3333-4444-555555555555';
const B = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const subject = (sub: string) => `oidc|blix-cognito|${sub}`;

const oldTable = process.env.SYNTHETIC_FOOD_TABLE_NAME;
const oldIndex = process.env.SYNTHETIC_FOOD_INDEX_NAME;
process.env.SYNTHETIC_FOOD_TABLE_NAME = 'synthetic-food-table';
process.env.SYNTHETIC_FOOD_INDEX_NAME = 'byIdentityKey';

after(() => {
  if (oldTable === undefined) delete process.env.SYNTHETIC_FOOD_TABLE_NAME;
  else process.env.SYNTHETIC_FOOD_TABLE_NAME = oldTable;
  if (oldIndex === undefined) delete process.env.SYNTHETIC_FOOD_INDEX_NAME;
  else process.env.SYNTHETIC_FOOD_INDEX_NAME = oldIndex;
});

const calls: string[] = [];
const fakeReader = async (verifiedSubject: unknown) => {
  const key = syntheticFoodIdentityKeyFromVerifiedAuth0Subject(verifiedSubject);
  calls.push(key);

  return [{
    id: key === syntheticFoodIdentityKeyFromVerifiedAuth0Subject(subject(A))
      ? 'synthetic-a' : 'synthetic-b',
    date: '2099-01-01',
    name: 'Synthetic meal',
    calories: 100,
  }];
};

const fakeVerifier = async (token: string) => {
  if (token === 'synthetic-a') {
    return { fingerprint: 'test-a', verifiedSubject: subject(A) };
  }
  if (token === 'synthetic-b') {
    return { fingerprint: 'test-b', verifiedSubject: subject(B) };
  }
  throw new Error('Invalid synthetic token');
};

const seedCalls: string[] = [];
const fakeSeeder = async (verifiedSubject: unknown) => {
  const key = syntheticFoodIdentityKeyFromVerifiedAuth0Subject(verifiedSubject);
  seedCalls.push(key);
  return 3;
};

const handler = createIdentityProbeHandler(fakeVerifier, fakeReader, fakeSeeder);

async function rpc(method: string, params: Record<string, unknown>, token?: string) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'mcp-protocol-version': '2026-07-28',
    'mcp-method': method,
  };
  if (typeof params.name === 'string') headers['mcp-name'] = params.name;
  if (token) headers.authorization = `Bearer ${token}`;

  const response = await handler({
    rawPath: '/mcp',
    requestContext: { http: { method: 'POST' } },
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params: {
        ...params,
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientInfo': {
            name: 'blix-synthetic-gate-test',
            version: '1.0.0',
          },
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    }),
  });

  let data: any;
  try { data = JSON.parse(response.body); } catch { data = undefined; }
  return { status: response.statusCode, data };
}

test('tools/list exposes exactly the four synthetic-only probes', async () => {
  const res = await rpc('tools/list', {});
  assert.equal(res.status, 200);
  assert.deepEqual(res.data?.result?.tools?.map((x: any) => x.name), [
    'identity_probe',
    'ownership_probe',
    'food_entries_probe',
    'seed_synthetic_food_probe',
  ]);
  const food = res.data?.result?.tools?.find((x: any) => x.name === 'food_entries_probe');
  assert.deepEqual(food?.securitySchemes, [{ type: 'oauth2', scopes: ['probe:identity'] }]);
  assert.deepEqual(food?.inputSchema?.properties, {});
  assert.equal(food?.inputSchema?.additionalProperties, false);

  const seed = res.data?.result?.tools?.find((x: any) => x.name === 'seed_synthetic_food_probe');
  assert.deepEqual(seed?.securitySchemes, [{ type: 'oauth2', scopes: ['probe:identity'] }]);
  assert.deepEqual(seed?.inputSchema?.properties, {});
  assert.equal(seed?.inputSchema?.additionalProperties, false);
  assert.equal(seed?.annotations?.readOnlyHint, false);
  assert.equal(seed?.annotations?.idempotentHint, false);
});

test('anonymous seed probe is challenged and never writes', async () => {
  const before = seedCalls.length;
  const res = await rpc('tools/call', { name: 'seed_synthetic_food_probe', arguments: {} });
  assert.equal(res.status, 200);
  assert.equal(res.data?.result?.isError, true);
  assert.ok(res.data?.result?._meta?.['mcp/www_authenticate']);
  assert.equal(seedCalls.length, before);
});

test('authenticated seed probe derives identity server-side and returns only a count', async () => {
  const before = seedCalls.length;
  const res = await rpc('tools/call',
    { name: 'seed_synthetic_food_probe', arguments: {} }, 'synthetic-a');

  assert.equal(res.status, 200);
  assert.equal(seedCalls.length, before + 1);
  assert.equal(
    seedCalls.at(-1),
    syntheticFoodIdentityKeyFromVerifiedAuth0Subject(subject(A)),
  );

  const result = JSON.parse(res.data.result.content[0].text);
  assert.deepEqual(result, { synthetic: true, seeded: 3 });
});

test('seed probe rejects caller-supplied owner or row data before writing', async () => {
  const before = seedCalls.length;
  const res = await rpc('tools/call', {
    name: 'seed_synthetic_food_probe',
    arguments: { owner: 'forged', name: 'caller-controlled' },
  }, 'synthetic-a');

  assert.ok(res.status === 200 || res.status === 400);
  assert.equal(seedCalls.length, before);
  assert.notEqual(res.data?.result?.isError, false);
});

test('anonymous food probe is challenged and never reads', async () => {
  const before = calls.length;
  const res = await rpc('tools/call', { name: 'food_entries_probe', arguments: {} });
  assert.equal(res.status, 200);
  assert.equal(res.data?.result?.isError, true);
  assert.ok(res.data?.result?._meta?.['mcp/www_authenticate']);
  assert.equal(calls.length, before);
});

test('synthetic A/B tokens produce isolated synthetic-only results', async () => {
  const a = await rpc('tools/call',
    { name: 'food_entries_probe', arguments: {} }, 'synthetic-a');
  const b = await rpc('tools/call',
    { name: 'food_entries_probe', arguments: {} }, 'synthetic-b');

  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  const aResult = JSON.parse(a.data.result.content[0].text);
  const bResult = JSON.parse(b.data.result.content[0].text);

  assert.equal(aResult.synthetic, true);
  assert.equal(bResult.synthetic, true);
  assert.deepEqual(aResult.entries.map((x: any) => x.id), ['synthetic-a']);
  assert.deepEqual(bResult.entries.map((x: any) => x.id), ['synthetic-b']);
  assert.notEqual(calls.at(-2), calls.at(-1));
});

test('invalid token fails before any synthetic read', async () => {
  const before = calls.length;
  const res = await rpc('tools/call',
    { name: 'food_entries_probe', arguments: {} }, 'synthetic-invalid');
  assert.equal(res.status, 401);
  assert.equal(calls.length, before);
});

test('caller-supplied owner cannot select another account', async () => {
  const before = calls.length;
  const res = await rpc('tools/call',
    { name: 'food_entries_probe', arguments: { owner: 'forged' } }, 'synthetic-a');
  assert.ok(res.status === 200 || res.status === 400);
  assert.equal(calls.length, before);
  assert.notEqual(res.data?.result?.isError, false);
});

test('missing synthetic configuration fails closed', async () => {
  const before = calls.length;
  delete process.env.SYNTHETIC_FOOD_TABLE_NAME;
  try {
    const res = await rpc('tools/call',
      { name: 'food_entries_probe', arguments: {} }, 'synthetic-a');
    assert.equal(res.status, 200);
    assert.equal(res.data?.result?.isError, true);
    assert.equal(calls.length, before);
  } finally {
    process.env.SYNTHETIC_FOOD_TABLE_NAME = 'synthetic-food-table';
  }
});

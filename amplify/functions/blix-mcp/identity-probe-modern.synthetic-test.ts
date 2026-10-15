import assert from 'node:assert/strict';
import { createIdentityProbeHandler } from './identity-probe-handler';

const handler = createIdentityProbeHandler(async () => {
  throw new Error('Synthetic test: no tokens accepted');
});

const meta = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientInfo': {
    name: 'blix-synthetic-test',
    version: '1.0.0',
  },
  'io.modelcontextprotocol/clientCapabilities': {},
};

async function rpc(
  method: string,
  params: Record<string, unknown>,
  modern = true,
  authorization?: string
) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  };

  if (modern) {
    headers['mcp-protocol-version'] = '2026-07-28';
    headers['mcp-method'] = method;

    if (typeof params.name === 'string') {
      headers['mcp-name'] = params.name;
    }
  }

  if (authorization) {
    headers.authorization = authorization;
  }

  const response = await handler({
    rawPath: '/mcp',
    requestContext: { http: { method: 'POST' } },
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params: modern ? { ...params, _meta: meta } : params,
    }),
  });

  let data: any;

  try {
    data = JSON.parse(response.body);
  } catch {
    data = undefined;
  }

  console.log(`${method}: HTTP ${response.statusCode}`);

  return { status: response.statusCode, data };
}

async function metadata(path: string) {
  const response = await handler({
    rawPath: path,
    requestContext: { http: { method: 'GET' } },
    headers: {},
  });

  let data: any;
  try {
    data = JSON.parse(response.body);
  } catch {
    data = undefined;
  }

  return { status: response.statusCode, data };
}

async function main() {
  const metadataPaths = [
    '/.well-known/oauth-protected-resource',
    '/.well-known/oauth-protected-resource/mcp',
    '/mcp/.well-known/oauth-protected-resource',
  ];

  const metadataResponses = [];
  for (const path of metadataPaths) {
    metadataResponses.push(await metadata(path));
  }

  for (const response of metadataResponses) {
    assert.equal(response.status, 200, 'Protected-resource metadata route failed');
    assert.deepEqual(
      response.data,
      metadataResponses[0].data,
      'Protected-resource metadata routes must remain identical'
    );
  }
  assert.equal(
    typeof metadataResponses[0].data?.resource,
    'string',
    'Protected-resource metadata must advertise a resource'
  );
  assert.ok(
    Array.isArray(metadataResponses[0].data?.authorization_servers),
    'Protected-resource metadata must advertise authorization servers'
  );
  assert.deepEqual(
    metadataResponses[0].data?.scopes_supported,
    [
      'probe:identity',
      'food:read',
      'food:create',
      'food:update',
      'food:delete',
      'vitals:read',
      'targets:read',
    ],
    'Protected-resource metadata must advertise exactly the supported MCP scopes'
  );
  console.log('PASS: all protected-resource metadata routes are consistent');

  const discovery = await rpc('server/discover', {});

  assert.equal(discovery.status, 200, 'Modern discovery failed');
  assert.ok(
    discovery.data?.result?.supportedVersions?.includes('2026-07-28'),
    'Modern protocol not advertised'
  );
  console.log('PASS: MCP 2026 discovery');

  const listing = await rpc('tools/list', {});

  assert.equal(listing.status, 200, 'Modern tools/list failed');
  assert.deepEqual(
    listing.data?.result?.tools?.map((tool: any) => tool.name),
    [
      'identity_probe',
      'ownership_probe',
      'food_entries_probe',
      'read_food_entries',
      'create_food_entry',
      'update_food_entry',
      'delete_food_entry',
      'read_vitals',
      'read_daily_targets',
    ],
    'Unexpected tools exposed'
  );

  const listedTools = listing.data?.result?.tools ?? [];
  const probeNames = [
    'identity_probe',
    'ownership_probe',
    'food_entries_probe',
  ];

  for (const name of probeNames) {
    const tool = listedTools.find((candidate: any) => candidate.name === name);

    assert.deepEqual(
      tool?.securitySchemes,
      [{ type: 'oauth2', scopes: ['probe:identity'] }],
      `${name} must require only probe:identity`
    );

    assert.deepEqual(
      tool?._meta?.securitySchemes,
      [{ type: 'oauth2', scopes: ['probe:identity'] }],
      `${name} _meta must require only probe:identity`
    );
  }

  const realFood = listedTools.find(
    (tool: any) => tool.name === 'read_food_entries'
  );

  assert.deepEqual(
    realFood?.securitySchemes,
    [{ type: 'oauth2', scopes: ['food:read'] }],
    'read_food_entries must require only food:read'
  );

  assert.deepEqual(
    realFood?._meta?.securitySchemes,
    [{ type: 'oauth2', scopes: ['food:read'] }],
    'read_food_entries _meta must require only food:read'
  );

  assert.equal(
    listedTools.some((tool: any) =>
      [
        'add_food',
        'write_food_entries',
        'update_food_entries',
        'delete_food_entries',
      ].includes(tool.name)
    ),
    false,
    'No legacy or unapproved write tools may be exposed'
  );

  console.log(
    'PASS: scoped FoodEntry reads/writes plus Vital and DailyTarget reads exposed'
  );

  const anonymous = await rpc('tools/call', {
    name: 'identity_probe',
    arguments: {},
  });

  assert.equal(anonymous.status, 200);
  assert.equal(anonymous.data?.result?.isError, true);
  assert.ok(
    anonymous.data?.result?._meta?.['mcp/www_authenticate'],
    'Missing authentication challenge'
  );
  console.log('PASS: anonymous probe requires authentication');

  const forbidden = await rpc('tools/call', {
    name: 'add_food',
    arguments: {},
  });

  assert.equal(forbidden.status, 401);
  console.log('PASS: health operation blocked');

  const invalid = await rpc(
    'tools/list',
    {},
    true,
    'Bearer synthetic-invalid-token'
  );

  assert.equal(invalid.status, 401);
  console.log('PASS: invalid token rejected');

  const legacy = await rpc(
    'initialize',
    {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: {
        name: 'blix-legacy-test',
        version: '1.0.0',
      },
    },
    false
  );

  assert.equal(legacy.status, 200);
  console.log('PASS: legacy MCP compatibility');

  console.log('PASS: all MCP HTTP synthetic tests');
}

main().catch((error) => {
  console.error('FAIL:', error.message);
  process.exitCode = 1;
});

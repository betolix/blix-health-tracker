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

async function main() {
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
    ['identity_probe', 'ownership_probe'],
    'Unexpected tools exposed'
  );
  console.log('PASS: only two synthetic probes exposed');

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

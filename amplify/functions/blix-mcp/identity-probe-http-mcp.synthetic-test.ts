import { createIdentityProbeHandler } from './identity-probe-handler';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const syntheticFingerprint = 'synthetic-http-fingerprint';

const handler = createIdentityProbeHandler(async (token) => {
  if (token !== 'synthetic-valid-token') {
    throw new Error('Invalid synthetic token');
  }
  return { fingerprint: syntheticFingerprint };
});

async function postMcp(body: unknown) {
  return handler({
    rawPath: '/mcp',
    headers: {
      Authorization: 'Bearer synthetic-valid-token',
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    requestContext: { http: { method: 'POST' } },
    body: JSON.stringify(body),
  });
}

async function main() {
  const initialize = await postMcp({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: {
        name: 'blix-http-synthetic-test',
        version: '0.1.0',
      },
    },
  });

  assert(initialize.statusCode === 200, 'Initialize must return HTTP 200');

  const initializeBody = JSON.parse(initialize.body);
  assert(
    initializeBody.result?.serverInfo?.name === 'blix-identity-probe',
    'Unexpected MCP server identity'
  );

  console.log('PASS: authenticated HTTP MCP initialize succeeds');

  const list = await postMcp({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
    params: {},
  });

  assert(list.statusCode === 200, 'tools/list must return HTTP 200');

  const listBody = JSON.parse(list.body);
  const tools = listBody.result?.tools;

  assert(
    Array.isArray(tools) &&
      tools.length === 1 &&
      tools[0].name === 'identity_probe',
    'Expected only identity_probe'
  );

  const schemes =
    tools[0]._meta?.securitySchemes;

  assert(
    Array.isArray(schemes) &&
      schemes.length === 1 &&
      schemes[0].type === 'oauth2' &&
      Array.isArray(schemes[0].scopes) &&
      schemes[0].scopes.length === 1 &&
      schemes[0].scopes[0] === 'probe:identity',
    'Expected probe-only OAuth metadata'
  );

  console.log('PASS: authenticated HTTP tools/list exposes only identity_probe');

  const call = await postMcp({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'identity_probe',
      arguments: {},
    },
  });

  assert(call.statusCode === 200, 'tools/call must return HTTP 200');

  const callBody = JSON.parse(call.body);
  const content = callBody.result?.content;

  assert(
    Array.isArray(content) &&
      content.length === 1 &&
      content[0].type === 'text',
    'Expected one text result'
  );

  const probe = JSON.parse(content[0].text);

  assert(probe.authenticated === true, 'Expected authenticated=true');
  assert(
    probe.identity_fingerprint === syntheticFingerprint,
    'Unexpected synthetic fingerprint'
  );

  console.log('PASS: authenticated HTTP identity_probe returns synthetic identity');
  console.log('PASS: complete synthetic HTTP-to-MCP path passed');
}

main().catch((error) => {
  console.error('FAIL:', error);
  process.exitCode = 1;
});

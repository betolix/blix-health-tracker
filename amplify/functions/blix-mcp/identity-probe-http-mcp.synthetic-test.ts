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

function parseMcpBody(body: string) {
  try {
    return JSON.parse(body);
  } catch {
    const dataLines = body
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice('data:'.length).trim())
      .filter(Boolean);

    for (const data of dataLines) {
      try {
        return JSON.parse(data);
      } catch {
        // Continue until a JSON MCP event is found.
      }
    }

    throw new Error('Expected JSON or SSE-wrapped JSON MCP response');
  }
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

  const initializeBody = parseMcpBody(initialize.body);
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

  const listBody = parseMcpBody(list.body);
  const tools = listBody.result?.tools;

  assert(
    Array.isArray(tools) &&
      JSON.stringify(tools.map((tool: any) => tool.name)) ===
        JSON.stringify([
          'identity_probe',
          'ownership_probe',
          'food_entries_probe',
          'read_food_entries',
          'create_food_entry',
          'update_food_entry',
          'delete_food_entry',
          'read_vitals',
    'create_vital',
    'update_vital',
    'delete_vital',
      'read_daily_targets',
      'create_daily_target',
      'update_daily_target',
      'delete_daily_target',
        ]),
    'Unexpected HTTP MCP tool contract'
  );

  const identityTool = tools.find(
    (tool: any) => tool.name === 'identity_probe'
  );

  const schemes =
    identityTool?._meta?.securitySchemes;

  assert(
    Array.isArray(schemes) &&
      schemes.length === 1 &&
      schemes[0].type === 'oauth2' &&
      Array.isArray(schemes[0].scopes) &&
      schemes[0].scopes.length === 1 &&
      schemes[0].scopes[0] === 'probe:identity',
    'Expected probe-only OAuth metadata'
  );

  const realFood = tools.find(
    (tool: any) => tool.name === 'read_food_entries'
  );

  const realFoodSchemes = realFood?._meta?.securitySchemes;

  assert(
    Array.isArray(realFoodSchemes) &&
      realFoodSchemes.length === 1 &&
      realFoodSchemes[0].type === 'oauth2' &&
      Array.isArray(realFoodSchemes[0].scopes) &&
      realFoodSchemes[0].scopes.length === 1 &&
      realFoodSchemes[0].scopes[0] === 'food:read',
    'Expected food-only OAuth metadata'
  );

  console.log('PASS: authenticated HTTP tools/list exposes current scoped tool contract');

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

  const callBody = parseMcpBody(call.body);
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

import { handleMcpRequest }
  from '../amplify/functions/blix-mcp/mcp-http';

const request = new Request('https://localhost/mcp', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
  },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: {
        name: 'blix-http-smoke-test',
        version: '0.1.0',
      },
    },
  }),
});

const response = await handleMcpRequest(request);
const body = await response.text();

console.log('HTTP status:', response.status);
console.log('Content-Type:', response.headers.get('content-type'));
console.log('Response:', body);

if (response.status !== 200) {
  throw new Error(`Expected HTTP 200, got ${response.status}`);
}

const parsed = JSON.parse(body);

if (parsed.result?.serverInfo?.name !== 'blix-health-tracker') {
  throw new Error('Unexpected MCP server identity');
}

console.log('PASS: Blix MCP Streamable HTTP initialization succeeded.');

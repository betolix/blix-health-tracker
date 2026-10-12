import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createBlixMcpServer } from '../amplify/functions/blix-mcp/server';

const server = createBlixMcpServer();

const client = new Client(
  { name: 'blix-local-test', version: '0.1.0' },
  { capabilities: {} }
);

const [clientTransport, serverTransport] =
  InMemoryTransport.createLinkedPair();

try {
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const tools = await client.listTools();

  console.log('Available tools:', tools.tools.map(t => t.name));

  if (!tools.tools.some(t => t.name === 'add_food')) {
    throw new Error('add_food tool was not discovered');
  }

  const result = await client.callTool({
    name: 'add_food',
    arguments: {
      date: '2026-10-10',
      name: 'Local test meal',
      calories: 100,
      source: 'estimated',
    },
  });

  console.log('Tool response:', JSON.stringify(result, null, 2));

  if (result.isError !== true) {
    throw new Error('Expected add_food to reject the write');
  }

  console.log('PASS: Tool discovered; database write rejected.');
} finally {
  await client.close();
  await server.close();
}

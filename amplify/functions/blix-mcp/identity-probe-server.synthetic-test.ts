import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createIdentityProbeServer } from './identity-probe-server';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function connectedClient(fingerprint?: string) {
  const server = createIdentityProbeServer(fingerprint);
  const client = new Client({
    name: 'blix-identity-probe-synthetic-test',
    version: '0.1.0',
  });

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return { server, client };
}

async function main() {
  {
    const { server, client } = await connectedClient();

    try {
      const listed = await client.listTools();
      assert(listed.tools.length === 1, 'Expected exactly one tool');

      const tool = listed.tools[0];
      assert(tool.name === 'identity_probe', 'Unexpected tool');

      const schemes = (
        tool._meta as {
          securitySchemes?: Array<{
            type?: string;
            scopes?: string[];
          }>;
        } | undefined
      )?.securitySchemes;

      assert(
        Array.isArray(schemes) &&
          schemes.length === 1 &&
          schemes[0].type === 'oauth2' &&
          Array.isArray(schemes[0].scopes) &&
          schemes[0].scopes.length === 1 &&
          schemes[0].scopes[0] === 'probe:identity',
        'Expected probe-only OAuth security scheme'
      );

      console.log('PASS: identity_probe advertises probe-only OAuth metadata');

      const result = await client.callTool({
        name: 'identity_probe',
        arguments: {},
      });

      assert(result.isError === true, 'Unauthenticated probe must fail');

      const challenge = (
        result._meta as {
          'mcp/www_authenticate'?: string[];
        } | undefined
      )?.['mcp/www_authenticate'];

      assert(
        Array.isArray(challenge) &&
          challenge.length === 1 &&
          challenge[0].includes('resource_metadata=') &&
          challenge[0].includes('error="invalid_token"'),
        'Expected MCP authentication challenge'
      );

      console.log('PASS: unauthenticated probe returns MCP auth challenge');
    } finally {
      await client.close();
      await server.close();
    }
  }

  {
    const fingerprint = 'synthetic-fingerprint';
    const { server, client } = await connectedClient(fingerprint);

    try {
      const result = await client.callTool({
        name: 'identity_probe',
        arguments: {},
      });

      assert(result.isError !== true, 'Authenticated probe unexpectedly failed');

      const content = result.content as Array<{
        type: string;
        text?: string;
      }>;

      const text = content.find(
        (item) => item.type === 'text'
      );

      assert(
        text?.type === 'text' && typeof text.text === 'string',
        'Expected text result'
      );

      const parsed = JSON.parse(text.text);
      assert(parsed.authenticated === true, 'Expected authenticated=true');
      assert(
        parsed.identity_fingerprint === fingerprint,
        'Fingerprint mismatch'
      );

      console.log('PASS: authenticated probe returns only expected identity data');
    } finally {
      await client.close();
      await server.close();
    }
  }

  console.log('PASS: all synthetic MCP identity-probe server tests passed');
}

main().catch((error) => {
  console.error('FAIL:', error);
  process.exitCode = 1;
});

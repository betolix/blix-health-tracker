import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { createBlixMcpServer } from './server';

// Internal transport implementation.
//
// SECURITY: Do not expose this function through an HTTP endpoint
// until OAuth authentication and authorization are implemented.

export async function handleMcpRequest(
  request: Request
): Promise<Response> {

  const server = createBlixMcpServer();

  // Stateless: each request gets its own server and transport.
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  await server.connect(transport);

  try {
    const response = await transport.handleRequest(request);

    // Fully consume the response before closing the transport.
    const body = await response.arrayBuffer();

    return new Response(body.byteLength ? body : null, {
      status: response.status,
      headers: response.headers,
    });

  } finally {
    await server.close();
  }
}

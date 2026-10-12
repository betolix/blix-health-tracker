export const handler = async () => {
  return {
    statusCode: 503,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify({
      error: 'service_unavailable',
      message: 'Blix MCP is not enabled.',
    }),
  };
};

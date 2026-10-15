import {
  requiredOAuthScopeForTool,
  UnknownProtectedToolError,
} from './mcp-tool-scope.ts';

export type McpRequestAuth =
  | {
      kind: 'discovery';
      requiredScope: undefined;
    }
  | {
      kind: 'protected-tool';
      toolName: string;
      requiredScope: string;
    };

export class InvalidProtectedMcpRequestError extends Error {
  constructor() {
    super('Invalid protected MCP request');
  }
}

const DISCOVERY_METHODS = new Set([
  'server/discover',
  'initialize',
  'tools/list',
  'notifications/initialized',
]);

export function classifyMcpRequestAuth(
  body: string | undefined,
): McpRequestAuth {
  if (!body) {
    throw new InvalidProtectedMcpRequestError();
  }

  let rpc: unknown;

  try {
    rpc = JSON.parse(body);
  } catch {
    throw new InvalidProtectedMcpRequestError();
  }

  if (
    !rpc ||
    typeof rpc !== 'object' ||
    Array.isArray(rpc)
  ) {
    throw new InvalidProtectedMcpRequestError();
  }

  const message = rpc as {
    jsonrpc?: unknown;
    method?: unknown;
    params?: unknown;
  };

  if (
    message.jsonrpc !== '2.0' ||
    typeof message.method !== 'string'
  ) {
    throw new InvalidProtectedMcpRequestError();
  }

  if (DISCOVERY_METHODS.has(message.method)) {
    return {
      kind: 'discovery',
      requiredScope: undefined,
    };
  }

  if (message.method !== 'tools/call') {
    throw new InvalidProtectedMcpRequestError();
  }

  if (
    !message.params ||
    typeof message.params !== 'object' ||
    Array.isArray(message.params)
  ) {
    throw new InvalidProtectedMcpRequestError();
  }

  const toolName = (message.params as { name?: unknown }).name;

  try {
    const requiredScope = requiredOAuthScopeForTool(toolName);

    return {
      kind: 'protected-tool',
      toolName: toolName as string,
      requiredScope,
    };
  } catch (error) {
    if (error instanceof UnknownProtectedToolError) {
      throw new InvalidProtectedMcpRequestError();
    }

    throw error;
  }
}

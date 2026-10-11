import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { addFoodSchema } from './food-schema';

export function createBlixMcpServer() {
  const server = new McpServer({
    name: 'blix-health-tracker',
    version: '0.1.0',
  });

  server.registerTool(
    'add_food',
    {
      title: 'Add food to Blix',

      description:
        'Save a food or meal entry to the authenticated user’s Blix health tracker.',

      inputSchema: addFoodSchema,

      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },

    async (input) => {
      const result = addFoodSchema.safeParse(input);

      if (!result.success) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: 'Invalid food entry.',
            },
          ],
        };
      }

      // No database writes until authentication is implemented.
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: 'Blix authentication is not configured yet. No food was saved.',
          },
        ],
      };
    }
  );

  return server;
}

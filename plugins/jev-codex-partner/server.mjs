import { pathToFileURL } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { EVALUATE_TOOL } from './src/contracts.mjs';
import { resolveApiKey } from './src/api-key.mjs';
import { handleEvaluate } from './src/evaluate-handler.mjs';

export function createServer(deps = {}) {
  const server = new Server(
    { name: 'jev-codex-partner', version: '0.1.5' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [EVALUATE_TOOL],
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    if (request.params.name !== EVALUATE_TOOL.name) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${request.params.name}`);
    }
    return handleEvaluate(request.params.arguments, deps, { signal: extra.signal });
  });

  return server;
}

async function main() {
  const server = createServer({ apiKey: resolveApiKey() });
  await server.connect(new StdioServerTransport());
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}

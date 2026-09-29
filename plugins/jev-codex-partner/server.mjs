import { pathToFileURL } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { EVALUATE_TOOL, PLUGIN_VERSION, RECORD_OUTCOME_TOOL } from './src/contracts.mjs';
import { resolveApiKey } from './src/api-key.mjs';
import { handleEvaluate } from './src/evaluate-handler.mjs';
import { handleRecordOutcome } from './src/outcome-handler.mjs';
import { createOutcomeLedger } from './src/outcome-ledger.mjs';

export function createServer(deps = {}) {
  const server = new Server(
    { name: 'jev-codex-partner', version: PLUGIN_VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [EVALUATE_TOOL, RECORD_OUTCOME_TOOL],
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    if (request.params.name === EVALUATE_TOOL.name) {
      return handleEvaluate(request.params.arguments, deps, { signal: extra.signal });
    }
    if (request.params.name === RECORD_OUTCOME_TOOL.name) {
      return handleRecordOutcome(request.params.arguments, deps);
    }
    throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${request.params.name}`);
  });

  return server;
}

async function main() {
  const server = createServer({
    apiKey: resolveApiKey(),
    outcomeLedger: createOutcomeLedger({ directory: process.env.JEV_OUTCOME_LEDGER_DIR }),
  });
  await server.connect(new StdioServerTransport());
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}

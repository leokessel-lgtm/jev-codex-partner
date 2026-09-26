import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { handleEvaluate } from '../src/evaluate-handler.mjs';
import { createServer } from '../server.mjs';

const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SERVER_PATH = fileURLToPath(new URL('../server.mjs', import.meta.url));
const VALID_INPUT = {
  purpose: 'Decide whether the candidate release is ready.',
  state: { release: 'candidate' },
  questions: {
    ready: { type: 'boolean', instructions: 'Is the candidate ready?' },
  },
  data_classification: 'synthetic',
  sensitive_transfer_approved: false,
};
const RAW_RESPONSE = {
  model: 'typesafe-ai/jev',
  answers: {
    ready: { type: 'boolean', probability: 0.92 },
  },
  usage: { inputTokens: 20, outputTokens: 4 },
  providerMetadata: {
    gateway: {
      routing: {
        originalModelId: 'typesafe-ai/jev',
        resolvedProvider: 'typesafe-ai',
        canonicalSlug: 'typesafe-ai/jev',
        finalProvider: 'typesafe-ai',
      },
      cost: '0.000001',
      marketCost: '0.000001',
      surchargeCost: '0',
      gatewayCost: '0.000001',
      generationId: 'gen_contract',
    },
  },
};
const NORMALISED_EVALUATION = {
  provider: 'typesafe-ai',
  requestedModel: 'typesafe-ai/jev',
  resolvedModel: 'typesafe-ai/jev',
  pluginVersion: '0.1.6',
  answers: {
    ready: { type: 'boolean', probability: 0.92 },
  },
  usage: { inputTokens: 20, outputTokens: 4 },
  cost: {
    cost: '0.000001',
    marketCost: '0.000001',
    surchargeCost: '0',
    gatewayCost: '0.000001',
  },
  requestId: 'gen_contract',
  gatewayRequestId: 'gateway-request-123',
  durationMs: 17,
  attempts: 1,
  dataClassification: 'synthetic',
  warnings: ['JEV output is advisory; typed output does not establish correctness.'],
};

test('handler returns the stable success envelope after validation, gateway and normalisation', async () => {
  const signal = new AbortController().signal;
  let request;
  const result = await handleEvaluate(VALID_INPUT, {
    gatewayClient: {
      async evaluate(value) {
        request = value;
        return {
          raw: RAW_RESPONSE,
          durationMs: 17,
          attempts: 1,
          requestId: 'gateway-request-123',
        };
      },
    },
  }, { signal });

  assert.deepEqual(request, {
    providerPayload: {
      model: 'typesafe-ai/jev',
      state: { release: 'candidate' },
      questions: VALID_INPUT.questions,
      providerOptions: {
        gateway: { disallowPromptTraining: true, only: ['typesafe-ai'] },
      },
    },
    signal,
  });
  assert.deepEqual(result, callResult({ ok: true, evaluation: NORMALISED_EVALUATION }));
});

test('handler accepts an Object.prototype question ID without inferred confidence metadata', async () => {
  const input = {
    ...VALID_INPUT,
    questions: {
      toString: { type: 'boolean', instructions: 'Is the evidence sufficient?' },
    },
  };
  const raw = {
    ...RAW_RESPONSE,
    answers: {
      toString: { type: 'boolean', probability: 0.92 },
    },
  };

  const result = await handleEvaluate(input, {
    gatewayClient: {
      async evaluate() {
        return {
          raw,
          durationMs: 17,
          attempts: 1,
          requestId: 'gateway-request-123',
        };
      },
    },
  }, {});

  assert.equal(result.structuredContent.ok, true);
  assert.deepEqual(result.structuredContent.evaluation.answers.toString, {
    type: 'boolean',
    probability: 0.92,
  });
});

test('handler returns a stable validation failure without constructing or calling a gateway', async () => {
  let gatewayCalls = 0;
  const invalid = { ...VALID_INPUT, purpose: '' };
  const result = await handleEvaluate(invalid, {
    gatewayClient: {
      async evaluate() {
        gatewayCalls += 1;
        throw new Error('must not be called');
      },
    },
  }, {});

  assert.equal(gatewayCalls, 0);
  assert.deepEqual(result, callResult({
    ok: false,
    error: {
      code: 'invalid_input',
      message: [{ path: '/purpose', message: 'must NOT have fewer than 1 characters' }],
      retryable: false,
    },
  }, true));
});

test('handler returns a stable missing-key failure before fetch', async () => {
  let fetchCalls = 0;
  const result = await handleEvaluate(VALID_INPUT, {
    apiKey: '',
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error('must not be called');
    },
  }, {});

  assert.equal(fetchCalls, 0);
  assert.deepEqual(result, callResult({
    ok: false,
    error: {
      code: 'gateway_not_configured',
      message: 'AI Gateway is not configured. Set AI_GATEWAY_API_KEY in the MCP server environment.',
      retryable: false,
      attempts: 0,
    },
  }, true));
});

test('in-process MCP server lists only evaluate and passes the request signal to the handler', async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  let observedSignal;
  const server = createServer({
    gatewayClient: {
      async evaluate({ signal }) {
        observedSignal = signal;
        return {
          raw: RAW_RESPONSE,
          durationMs: 17,
          attempts: 1,
          requestId: 'gateway-request-123',
        };
      },
    },
  });
  const client = new Client({ name: 'jev-contract-test', version: '1.0.0' });

  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    assert.equal(client.getServerVersion().version, '0.1.6');
    const listing = await client.listTools();
    assert.equal(listing.tools.length, 1);
    assertToolContract(listing.tools[0]);

    const result = await client.callTool({ name: 'evaluate', arguments: VALID_INPUT });
    assert.deepEqual(result, callResult({ ok: true, evaluation: NORMALISED_EVALUATION }));
    assert.ok(observedSignal instanceof AbortSignal);
  } finally {
    await client.close();
  }
});

test('real stdio server lists and calls the mocked evaluate tool without a live request', async () => {
  const fixture = createStdioFixture({ apiKey: 'stdio-contract-key' });
  try {
    await fixture.client.connect(fixture.transport);
    assert.equal(fixture.client.getServerVersion().version, '0.1.6');
    const listing = await fixture.client.listTools();
    assert.equal(listing.tools.length, 1);
    assertToolContract(listing.tools[0]);

    const result = await fixture.client.callTool({ name: 'evaluate', arguments: VALID_INPUT });
    assert.ok(Number.isInteger(result.structuredContent.evaluation.durationMs));
    assert.ok(result.structuredContent.evaluation.durationMs >= 0);
    const evaluation = {
      ...NORMALISED_EVALUATION,
      durationMs: result.structuredContent.evaluation.durationMs,
    };
    assert.deepEqual(result, callResult({ ok: true, evaluation }));
    assert.deepEqual(readLog(fixture.fetchLog), ['fetch']);
  } finally {
    await fixture.close();
  }
});

test('real stdio server rejects invalid input with zero fetches', async () => {
  const fixture = createStdioFixture();
  try {
    await fixture.client.connect(fixture.transport);

    const invalid = await fixture.client.callTool({
      name: 'evaluate',
      arguments: { ...VALID_INPUT, purpose: '' },
    });
    assert.equal(invalid.isError, true);
    assert.equal(invalid.structuredContent.error.code, 'invalid_input');

    assert.deepEqual(readLog(fixture.fetchLog), []);
  } finally {
    await fixture.close();
  }
});

test('real stdio request cancellation reaches the mocked fetch signal', async () => {
  const fixture = createStdioFixture({ apiKey: 'stdio-contract-key' });
  try {
    await fixture.client.connect(fixture.transport);
    const controller = new AbortController();
    const pending = fixture.client.callTool({
      name: 'evaluate',
      arguments: {
        ...VALID_INPUT,
        state: { waitForCancellation: true },
      },
    }, undefined, { signal: controller.signal });

    await waitForLog(fixture.fetchLog, 'waiting');
    controller.abort();
    await assert.rejects(pending, (error) => (
      error?.name === 'McpError' && /AbortError/u.test(error.message)
    ));
    await waitForLog(fixture.fetchLog, 'aborted');
    assert.deepEqual(readLog(fixture.fetchLog), ['fetch', 'waiting', 'aborted']);
  } finally {
    await fixture.close();
  }
});

test('MCP configuration exposes only prompted jev_partner.evaluate', () => {
  const config = JSON.parse(fs.readFileSync(path.join(REPOSITORY_ROOT, '.mcp.json'), 'utf8'));
  assert.deepEqual(Object.keys(config.mcpServers), ['jev_partner']);
  assert.deepEqual(Object.keys(config.mcpServers.jev_partner.tools), ['evaluate']);
  assert.equal(config.mcpServers.jev_partner.tools.evaluate.approval_mode, 'prompt');
});

function callResult(envelope, isError = false) {
  const result = {
    content: [{ type: 'text', text: JSON.stringify(envelope) }],
    structuredContent: envelope,
  };
  if (isError) result.isError = true;
  return result;
}

function assertToolContract(tool) {
  assert.equal(tool.name, 'evaluate');
  assert.deepEqual(tool.annotations, {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true,
  });
  assert.equal('idempotentHint' in tool.annotations, false);
}

function createStdioFixture({ apiKey } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jev-server-contract-'));
  const fetchLog = path.join(directory, 'fetch.log');
  const preload = `
    import fs from 'node:fs';
    const raw = ${JSON.stringify(RAW_RESPONSE)};
    globalThis.fetch = async (_url, init) => {
      fs.appendFileSync(process.env.JEV_TEST_FETCH_LOG, 'fetch\\n');
      const request = JSON.parse(init.body);
      if (request.state?.waitForCancellation === true) {
        fs.appendFileSync(process.env.JEV_TEST_FETCH_LOG, 'waiting\\n');
        return await new Promise((_resolve, reject) => {
          const abort = () => {
            fs.appendFileSync(process.env.JEV_TEST_FETCH_LOG, 'aborted\\n');
            reject(new DOMException('Aborted', 'AbortError'));
          };
          if (init.signal.aborted) abort();
          else init.signal.addEventListener('abort', abort, { once: true });
        });
      }
      return new Response(JSON.stringify(raw), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'gateway-request-123',
        },
      });
    };
  `;
  const env = { ...getDefaultEnvironment(), JEV_TEST_FETCH_LOG: fetchLog };
  if (apiKey === undefined) delete env.AI_GATEWAY_API_KEY;
  else env.AI_GATEWAY_API_KEY = apiKey;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [`--import=data:text/javascript,${encodeURIComponent(preload)}`, SERVER_PATH],
    cwd: REPOSITORY_ROOT,
    env,
    stderr: 'pipe',
  });
  const client = new Client({ name: 'jev-stdio-contract-test', version: '1.0.0' });
  return {
    client,
    transport,
    fetchLog,
    async close() {
      await client.close();
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

function readLog(logPath) {
  if (!fs.existsSync(logPath)) return [];
  return fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean);
}

async function waitForLog(logPath, expected) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (readLog(logPath).includes(expected)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`Timed out waiting for stdio fetch log entry: ${expected}`);
}

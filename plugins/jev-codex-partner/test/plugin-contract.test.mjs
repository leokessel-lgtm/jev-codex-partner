import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  EVALUATE_INPUT_SCHEMA,
  EVALUATE_TOOL,
  GATEWAY_URL,
  MAX_REQUEST_BYTES,
  MAX_RESPONSE_BYTES,
  MAX_STATE_QUESTION_BYTES,
  MODEL_ID,
  PLUGIN_VERSION,
  PROVIDER_OPTIONS,
  ZDR_PROVIDER_OPTIONS,
} from '../src/contracts.mjs';

test('plugin and MCP configuration expose one prompted evaluator', () => {
  const plugin = JSON.parse(fs.readFileSync('.codex-plugin/plugin.json', 'utf8'));
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const packageLock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
  const mcp = JSON.parse(fs.readFileSync('.mcp.json', 'utf8'));
  assert.equal(plugin.name, 'jev-codex-partner');
  assert.match(plugin.version, /^0\.1\.6\+codex\.\d{14}$/u);
  assert.equal(packageJson.version, '0.1.6');
  assert.equal(packageJson.private, true);
  assert.equal(
    packageJson.scripts['benchmark:live'],
    'node bin/run-evaluation.mjs benchmarks/synthetic-cases.json --live',
  );
  assert.match(
    fs.readFileSync('README.md', 'utf8'),
    /npm run benchmark:live -- --confirm-synthetic/u,
  );
  assert.equal(packageLock.version, '0.1.6');
  assert.equal(packageLock.packages[''].version, '0.1.6');
  assert.equal(plugin.repository, 'https://github.com/leokessel-lgtm/jev-codex-partner');
  assert.equal(plugin.homepage, 'https://github.com/leokessel-lgtm/jev-codex-partner#readme');
  assert.equal(plugin.author.url, 'https://github.com/leokessel-lgtm');
  assert.deepEqual(plugin.interface.capabilities, ['Interactive', 'Read']);
  assert.equal(plugin.skills, './skills/');
  assert.equal(plugin.mcpServers, './.mcp.json');
  assert.deepEqual(Object.keys(mcp.mcpServers), ['jev_partner']);
  assert.deepEqual(mcp.mcpServers.jev_partner.env_vars, ['AI_GATEWAY_API_KEY']);
  assert.equal(mcp.mcpServers.jev_partner.tools.evaluate.approval_mode, 'prompt');
  assert.equal(fs.existsSync('skills/.keep'), false);
  assert.match(plugin.description, /governed.*JEV.*external.*billable/i);
  assert.match(plugin.interface.longDescription, /prompted.*external.*billable/i);
  assert.match(plugin.interface.defaultPrompt, /bounded.*JEV.*probabilit/i);
  assert.equal(plugin.author.name, 'Leo Kesselring');
  assert.equal(plugin.interface.developerName, 'Leo Kesselring');
  assert.doesNotMatch(JSON.stringify(plugin), /plugin scaffold|local developer|help me use/i);
});

test('shared evaluator contracts expose fixed routing, limits and typed questions', () => {
  assert.equal(GATEWAY_URL, 'https://ai-gateway.vercel.sh/v1/evaluate');
  assert.equal(MODEL_ID, 'typesafe-ai/jev');
  assert.equal(PLUGIN_VERSION, '0.1.6');
  assert.deepEqual(PROVIDER_OPTIONS, {
    gateway: { disallowPromptTraining: true, only: ['typesafe-ai'] },
  });
  assert.deepEqual(ZDR_PROVIDER_OPTIONS, {
    gateway: { zeroDataRetention: true, only: ['typesafe-ai'] },
  });
  assert.equal(MAX_REQUEST_BYTES, 64_000);
  assert.equal(MAX_STATE_QUESTION_BYTES, 32_000);
  assert.equal(MAX_RESPONSE_BYTES, 1_048_576);
  assert.equal(EVALUATE_TOOL.name, 'evaluate');
  assert.deepEqual(EVALUATE_INPUT_SCHEMA.required, [
    'purpose',
    'state',
    'questions',
    'data_classification',
    'sensitive_transfer_approved',
  ]);
  assert.equal(EVALUATE_INPUT_SCHEMA.properties.questions.type, 'object');
  assert.match(EVALUATE_INPUT_SCHEMA.properties.questions.propertyNames.pattern, /^\^\[A-Za-z\]/);
  const questionTypes = EVALUATE_INPUT_SCHEMA.properties.questions.additionalProperties.oneOf
    .map((schema) => schema.properties.type.const);
  assert.deepEqual(questionTypes, ['boolean', 'choice', 'score']);
  assert.deepEqual(requireDirectDependencies(), {
    '@modelcontextprotocol/sdk': '1.30.0',
    ajv: '8.20.0',
    'ajv-formats': '3.0.1',
  });
});

function requireDirectDependencies() {
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  return packageJson.dependencies;
}

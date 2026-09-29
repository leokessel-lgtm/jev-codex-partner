import { createOutcomeLedger } from '../../src/outcome-ledger.mjs';

const [directory, childId] = process.argv.slice(2);
const ledger = createOutcomeLedger({
  directory,
  now: () => new Date('2026-09-30T12:34:56.000Z'),
  randomUUID: () => `${childId.padStart(8, '0')}-0000-4000-8000-${String(Math.random()).slice(2).padEnd(12, '0').slice(0, 12)}`,
});
const input = {
  questions: { q: { type: 'boolean' } },
  ledger: { record: true },
};
const evaluation = {
  provider: 'typesafe-ai', requestedModel: 'typesafe-ai/jev', resolvedModel: 'typesafe-ai/jev',
  pluginVersion: '0.1.9', answers: { q: { type: 'boolean', probability: 0.8 } },
  usage: { inputTokens: 1, outputTokens: 1 },
  cost: { cost: '0', marketCost: '0', surchargeCost: '0', gatewayCost: '0' },
  durationMs: 1, attempts: 1, dataClassification: 'synthetic',
};

await Promise.all(Array.from({ length: 25 }, () => ledger.recordEvaluation({ input, evaluation })));

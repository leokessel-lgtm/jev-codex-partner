import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillDir = path.join(repo, 'skills', 'jev-codex-partner');
const skillPath = path.join(skillDir, 'SKILL.md');
const evidenceSkillDir = path.join(repo, 'skills', 'jev-evidence-evaluation');
const evidenceSkillPath = path.join(evidenceSkillDir, 'SKILL.md');

test('JEV partner skill documents the governed automatic-selection contract', () => {
  assert.ok(fs.existsSync(skillPath), 'SKILL.md must exist');
  const skill = fs.readFileSync(skillPath, 'utf8');
  assert.match(skill, /^---\nname: jev-codex-partner\ndescription: Use TypeSafe JEV through the local partner tool for bounded Boolean, Choice or Score evaluation, classification, routing or rubric assessment when typed probabilities add value; do not use it for generation, research, arithmetic, planning or autonomous consequential decisions\.\n---/m);

  for (const phrase of ['Boolean', 'Choice', 'Score', 'automatic discovery', 'briefly explain why JEV fits', 'advisory-only', 'no authority expansion', 'no automatic Antigravity run', 'no model selection', 'no universal confidence threshold', 'ordinary deterministic code']) {
    assert.match(skill, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), `missing skill requirement: ${phrase}`);
  }
  for (const reference of ['references/selection-and-governance.md', 'references/question-design.md']) {
    assert.match(skill, new RegExp(`\\(${reference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`), `SKILL.md must link ${reference}`);
    assert.ok(fs.existsSync(path.join(skillDir, reference)), `${reference} must exist`);
  }
  for (const markdown of [skill, fs.readFileSync(path.join(skillDir, 'references', 'selection-and-governance.md'), 'utf8'), fs.readFileSync(path.join(skillDir, 'references', 'question-design.md'), 'utf8')]) {
    assert.doesNotMatch(markdown, /TODO|FIXME|TBD|<SCaffold|\[\[.*?\]\]/i);
  }
});

test('references cover selection exclusions and governance boundaries', () => {
  const selection = fs.readFileSync(path.join(skillDir, 'references', 'selection-and-governance.md'), 'utf8');
  const questions = fs.readFileSync(path.join(skillDir, 'references', 'question-design.md'), 'utf8');
  for (const phrase of ['generation', 'research', 'math', 'counting', 'dates', 'planning', 'precision', 'private', 'sensitive', 'exact-transfer approval', 'minimal-state', 'credentials', 'advisory-only', 'authority']) {
    assert.match(`${selection}\n${questions}`, new RegExp(phrase, 'i'), `missing reference requirement: ${phrase}`);
  }
  assert.match(questions, /provider mechanics/i);
  assert.match(questions, /question examples/i);
  assert.match(questions, /bounded batch of independent questions/i);
  assert.match(questions, /manual Boolean workaround/i);
  assert.match(questions, /semantics differ from Choice/i);
  assert.match(questions, /never automatically trigger another request/i);
});

test('evidence evaluation skill is Boolean-only, discoverable and fail-closed', () => {
  assert.ok(fs.existsSync(evidenceSkillPath), 'jev-evidence-evaluation/SKILL.md must exist');
  const skill = fs.readFileSync(evidenceSkillPath, 'utf8');

  assert.match(skill, /^---\nname: jev-evidence-evaluation\ndescription: Use when evaluating whether supplied evidence supports a claim or citation, or whether two supplied statements are semantically equivalent; applies Boolean-only JEV judgement with privacy-first transfer controls and explicit local-only overrides\.\n---/m);

  for (const phrase of [
    'Boolean-only',
    'claim-to-evidence support',
    'citation support',
    'semantic equivalence',
    'brief visible notice',
    'public or synthetic',
    'workspace-derived',
    'ambiguous provenance',
    'private by default',
    'exact-transfer approval',
    'no JEV',
    'local only',
    'advisory-only',
    'no authority expansion',
  ]) {
    assert.match(skill, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), `missing evidence skill requirement: ${phrase}`);
  }

  for (const exclusion of ['generation', 'research', 'arithmetic', 'counting', 'dates', 'planning', 'current facts', 'deterministic checks', 'consequential approvals']) {
    assert.match(skill, new RegExp(exclusion, 'i'), `missing evidence skill exclusion: ${exclusion}`);
  }

  assert.match(skill, /Do not use Choice or Score through this skill\./u);
  assert.match(skill, /JEV fits this evidence check\. An external, potentially billable TypeSafe JEV evaluation will run through Vercel AI Gateway\./u);
  assert.match(skill, /publicly accessible without authentication/u);
  assert.match(skill, /Pasted, paraphrased or workspace-summarised text is ambiguous unless its public provenance is established/u);

  assert.doesNotMatch(skill, /TODO|FIXME|TBD|<SCaffold|\[\[.*?\]\]/i);
});

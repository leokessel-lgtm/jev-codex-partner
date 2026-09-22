import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillDir = path.join(repo, 'skills', 'jev-codex-partner');
const skillPath = path.join(skillDir, 'SKILL.md');

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
});

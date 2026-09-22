import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(pluginRoot, '../..');

test('repository exposes the JEV plugin through its local marketplace', () => {
  const marketplacePath = path.join(repositoryRoot, '.agents/plugins/marketplace.json');
  const marketplace = JSON.parse(fs.readFileSync(marketplacePath, 'utf8'));
  assert.equal(marketplace.name, 'leo-jev-codex-partner');
  assert.deepEqual(marketplace.plugins.map(({ name }) => name), ['jev-codex-partner']);
  assert.deepEqual(marketplace.plugins[0].source, {
    source: 'local',
    path: './plugins/jev-codex-partner',
  });
  assert.equal(marketplace.plugins[0].policy.installation, 'AVAILABLE');
  assert.equal(marketplace.plugins[0].policy.authentication, 'ON_USE');
  for (const file of ['README.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'SECURITY.md']) {
    assert.equal(fs.existsSync(path.join(repositoryRoot, file)), true, `${file} is required`);
  }
  assert.equal(fs.existsSync(path.join(repositoryRoot, '.codex-marketplace')), false);
});

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
  const isShareableRepository = fs.existsSync(path.join(repositoryRoot, 'CHANGELOG.md'));
  const plugin = marketplace.plugins.find(({ name }) => name === 'jev-codex-partner');

  assert.equal(marketplace.name, isShareableRepository ? 'leo-jev-codex-partner' : 'plugins-cli');
  assert.ok(plugin, 'the active marketplace must expose jev-codex-partner');
  if (isShareableRepository) {
    assert.deepEqual(marketplace.plugins.map(({ name }) => name), ['jev-codex-partner']);
  }
  assert.deepEqual(plugin.source, {
    source: 'local',
    path: './plugins/jev-codex-partner',
  });
  assert.equal(plugin.policy.installation, 'AVAILABLE');
  assert.equal(plugin.policy.authentication, 'ON_USE');
  if (isShareableRepository) {
    const readme = fs.readFileSync(path.join(repositoryRoot, 'README.md'), 'utf8');
    const dependencyInstall = readme.indexOf('npm --prefix plugins/jev-codex-partner ci --omit=dev');
    const marketplaceInstall = readme.indexOf('codex plugin marketplace add .');

    assert.ok(dependencyInstall >= 0, 'public install must install runtime dependencies');
    assert.ok(marketplaceInstall > dependencyInstall, 'dependencies must be installed before marketplace registration');
    assert.doesNotMatch(readme, /plugin marketplace add leokessel-lgtm\/jev-codex-partner/u);
    for (const file of ['README.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'SECURITY.md']) {
      assert.equal(fs.existsSync(path.join(repositoryRoot, file)), true, `${file} is required`);
    }
    assert.equal(fs.existsSync(path.join(repositoryRoot, '.codex-marketplace')), false);
  }
});

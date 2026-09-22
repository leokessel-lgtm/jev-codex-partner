import assert from 'node:assert/strict';
import test from 'node:test';

test('API key resolution prefers the environment and falls back to the macOS Keychain', async () => {
  const module = await import('../src/api-key.mjs').catch(() => ({}));
  assert.equal(typeof module.resolveApiKey, 'function');

  let calls = 0;
  const direct = module.resolveApiKey({
    env: { AI_GATEWAY_API_KEY: 'environment-key' },
    platform: 'darwin',
    account: 'leo',
    execFileSyncImpl() {
      calls += 1;
      return 'must-not-be-used';
    },
  });
  assert.equal(direct, 'environment-key');
  assert.equal(calls, 0);

  let observed;
  const fallback = module.resolveApiKey({
    env: {},
    platform: 'darwin',
    account: 'leo',
    execFileSyncImpl(command, args, options) {
      observed = { command, args, options };
      return 'keychain-key\n';
    },
  });
  assert.equal(fallback, 'keychain-key');
  assert.deepEqual(observed, {
    command: '/usr/bin/security',
    args: [
      'find-generic-password',
      '-a',
      'leo',
      '-s',
      'codex-jev-partner-ai-gateway',
      '-w',
    ],
    options: {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    },
  });
});

test('API key resolution fails closed when Keychain lookup is unavailable', async () => {
  const module = await import('../src/api-key.mjs').catch(() => ({}));
  assert.equal(typeof module.resolveApiKey, 'function');
  assert.equal(module.resolveApiKey({
    env: {},
    platform: 'darwin',
    account: 'leo',
    execFileSyncImpl() {
      throw new Error('Keychain unavailable');
    },
  }), '');
  assert.equal(module.resolveApiKey({
    env: {},
    platform: 'linux',
    account: 'leo',
    execFileSyncImpl() {
      throw new Error('must not be called');
    },
  }), '');
});

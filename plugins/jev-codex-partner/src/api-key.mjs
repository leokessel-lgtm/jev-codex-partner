import { execFileSync } from 'node:child_process';
import { userInfo } from 'node:os';

const KEYCHAIN_SERVICE = 'codex-jev-partner-ai-gateway';
const SECURITY_COMMAND = '/usr/bin/security';

export function resolveApiKey({
  env = process.env,
  platform = process.platform,
  account = userInfo().username,
  execFileSyncImpl = execFileSync,
} = {}) {
  if (typeof env.AI_GATEWAY_API_KEY === 'string' && env.AI_GATEWAY_API_KEY.length > 0) {
    return env.AI_GATEWAY_API_KEY;
  }

  if (platform !== 'darwin') {
    return '';
  }

  try {
    return execFileSyncImpl(
      SECURITY_COMMAND,
      ['find-generic-password', '-a', account, '-s', KEYCHAIN_SERVICE, '-w'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
  } catch {
    return '';
  }
}

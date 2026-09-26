import assert from 'node:assert/strict';
import test from 'node:test';
import { createGatewayClient } from '../src/gateway-client.mjs';

const TEST_CREDENTIAL = ['test', 'key', 'never', 'print'].join('-');
const PROVIDER_PAYLOAD = {
  model: 'typesafe-ai/jev',
  state: { release: 'candidate' },
  questions: {
    ready: { type: 'boolean', instructions: 'Is the release ready?' },
  },
  providerOptions: {
    gateway: { disallowPromptTraining: true, only: ['typesafe-ai'] },
  },
};
const SUCCESS_BODY = { model: 'typesafe-ai/jev', answers: {} };

function response(body = SUCCESS_BODY, init = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...init.headers },
    ...init,
  });
}

function createClock(start = 1_000) {
  let value = start;
  return {
    now: () => value,
    advance(milliseconds) {
      value += milliseconds;
    },
  };
}

function clientWith(overrides = {}) {
  const clock = overrides.clock ?? createClock();
  const delays = [];
  const sleep = overrides.sleep ?? (async (milliseconds) => {
    delays.push(milliseconds);
    clock.advance(milliseconds);
  });
  const client = createGatewayClient({
    apiKey: TEST_CREDENTIAL,
    fetchImpl: async () => response(),
    sleep,
    random: () => 0,
    now: clock.now,
    attemptTimeoutMs: 10_000,
    totalTimeoutMs: 25_000,
    maxAttempts: 3,
    maxResponseBytes: 1_048_576,
    ...overrides,
  });
  return { client, clock, delays };
}

async function captureError(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail('Expected the operation to reject');
}

test('missing key rejects before making a request', async () => {
  let calls = 0;
  const { client } = clientWith({
    apiKey: '',
    fetchImpl: async () => {
      calls += 1;
      return response();
    },
  });

  const error = await captureError(client.evaluate({ providerPayload: PROVIDER_PAYLOAD }));

  assert.equal(calls, 0);
  assert.deepEqual(error.toJSON(), {
    code: 'gateway_not_configured',
    message: 'AI Gateway is not configured. Set AI_GATEWAY_API_KEY in the MCP server environment.',
    retryable: false,
    attempts: 0,
  });
});

test('request uses the fixed URL, method, headers, redirect policy, model and provider options', async () => {
  let observed;
  const { client } = clientWith({
    fetchImpl: async (url, init) => {
      observed = { url, init };
      return response(SUCCESS_BODY, { headers: { 'x-request-id': 'request-123' } });
    },
  });

  const result = await client.evaluate({ providerPayload: PROVIDER_PAYLOAD });
  const headers = new Headers(observed.init.headers);

  assert.equal(observed.url, 'https://ai-gateway.vercel.sh/v1/evaluate');
  assert.equal(observed.init.method, 'POST');
  assert.equal(headers.get('content-type'), 'application/json');
  assert.equal(headers.get('authorization'), `Bearer ${TEST_CREDENTIAL}`);
  assert.equal(observed.init.redirect, 'error');
  assert.ok(observed.init.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(observed.init.body), PROVIDER_PAYLOAD);
  assert.deepEqual(result, {
    raw: SUCCESS_BODY,
    durationMs: 0,
    attempts: 1,
    requestId: 'request-123',
  });
});

test('429 retry then success makes two requests with the first fixed delay', async () => {
  let calls = 0;
  const { client, delays } = clientWith({
    fetchImpl: async () => {
      calls += 1;
      return calls === 1 ? response({ error: 'busy' }, { status: 429 }) : response();
    },
  });

  const result = await client.evaluate({ providerPayload: PROVIDER_PAYLOAD });

  assert.equal(calls, 2);
  assert.deepEqual(delays, [250]);
  assert.equal(result.attempts, 2);
});

test('repeated 529 retry responses stop after three requests', async () => {
  let calls = 0;
  const { client, delays } = clientWith({
    fetchImpl: async () => {
      calls += 1;
      return response({ error: 'overloaded' }, { status: 529 });
    },
  });

  const error = await captureError(client.evaluate({ providerPayload: PROVIDER_PAYLOAD }));

  assert.equal(calls, 3);
  assert.deepEqual(delays, [250, 750]);
  assert.equal(error.code, 'gateway_unavailable');
  assert.equal(error.status, 529);
  assert.equal(error.retryable, true);
  assert.equal(error.attempts, 3);
});

for (const [status, code] of [
  [401, 'gateway_authentication_failed'],
  [422, 'gateway_request_rejected'],
  [418, 'gateway_request_failed'],
]) {
  test(`${status} request failure is never retried`, async () => {
    let calls = 0;
    const { client, delays } = clientWith({
      fetchImpl: async () => {
        calls += 1;
        return response({ error: 'terminal' }, { status });
      },
    });

    const error = await captureError(client.evaluate({ providerPayload: PROVIDER_PAYLOAD }));

    assert.equal(calls, 1);
    assert.deepEqual(delays, []);
    assert.equal(error.code, code);
    assert.equal(error.status, status);
    assert.equal(error.retryable, false);
    assert.equal(error.attempts, 1);
  });
}

test('generic 403 is classified as forbidden without retrying or claiming a ZDR cause', async () => {
  let calls = 0;
  const { client, delays } = clientWith({
    fetchImpl: async () => {
      calls += 1;
      return response({ error: 'Access denied by account policy.' }, { status: 403 });
    },
  });

  const error = await captureError(client.evaluate({ providerPayload: PROVIDER_PAYLOAD }));

  assert.equal(calls, 1);
  assert.deepEqual(delays, []);
  assert.equal(error.code, 'gateway_forbidden');
  assert.equal(error.status, 403);
  assert.equal(error.retryable, false);
  assert.equal(error.attempts, 1);
  assert.doesNotMatch(error.message, /zero data retention|ZDR/iu);
});

test('known 403 ZDR plan restriction receives the specific non-retryable code', async () => {
  let calls = 0;
  const { client, delays } = clientWith({
    fetchImpl: async () => {
      calls += 1;
      return response({
        error: 'Zero Data Retention (ZDR) is only available for Pro and Enterprise plans. Current plan: hobby.',
      }, { status: 403 });
    },
  });

  const error = await captureError(client.evaluate({ providerPayload: PROVIDER_PAYLOAD }));

  assert.equal(calls, 1);
  assert.deepEqual(delays, []);
  assert.equal(error.code, 'gateway_zdr_unavailable');
  assert.equal(error.status, 403);
  assert.equal(error.retryable, false);
  assert.equal(error.attempts, 1);
  assert.match(error.message, /zero data retention|ZDR/iu);
});

test('retryable network failure stays within three attempts', async () => {
  let calls = 0;
  const { client, delays } = clientWith({
    fetchImpl: async () => {
      calls += 1;
      throw new TypeError('connection reset');
    },
  });

  const error = await captureError(client.evaluate({ providerPayload: PROVIDER_PAYLOAD }));

  assert.equal(calls, 3);
  assert.deepEqual(delays, [250, 750]);
  assert.equal(error.code, 'gateway_network_error');
  assert.equal(error.retryable, true);
  assert.equal(error.attempts, 3);
});

test('Retry-After retry delay is capped at 2,000 ms', async () => {
  let calls = 0;
  const { client, delays } = clientWith({
    fetchImpl: async () => {
      calls += 1;
      return calls === 1
        ? response({ error: 'busy' }, { status: 429, headers: { 'retry-after': '99' } })
        : response();
    },
  });

  await client.evaluate({ providerPayload: PROVIDER_PAYLOAD });

  assert.deepEqual(delays, [2_000]);
});

test('per-attempt timeout aborts an in-flight request without retry', async () => {
  const { client } = clientWith({
    attemptTimeoutMs: 10,
    totalTimeoutMs: 100,
    now: Date.now,
    fetchImpl: async (_url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }),
  });

  const error = await captureError(client.evaluate({ providerPayload: PROVIDER_PAYLOAD }));

  assert.equal(error.code, 'gateway_timeout');
  assert.equal(error.retryable, false);
  assert.equal(error.attempts, 1);
});

test('25-second total timeout stops before another retry request', async () => {
  let calls = 0;
  const clock = createClock(0);
  const { client } = clientWith({
    clock,
    fetchImpl: async () => {
      calls += 1;
      throw new TypeError('temporary network failure');
    },
    sleep: async () => {
      clock.advance(25_000);
    },
  });

  const error = await captureError(client.evaluate({ providerPayload: PROVIDER_PAYLOAD }));

  assert.equal(calls, 1);
  assert.equal(error.code, 'gateway_total_timeout');
  assert.equal(error.attempts, 1);
});

test('total timeout aborts an in-flight request', async () => {
  const { client } = clientWith({
    attemptTimeoutMs: 100,
    totalTimeoutMs: 10,
    now: Date.now,
    fetchImpl: async (_url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }),
  });

  const error = await captureError(client.evaluate({ providerPayload: PROVIDER_PAYLOAD }));

  assert.equal(error.code, 'gateway_total_timeout');
  assert.equal(error.attempts, 1);
});

test('caller abort during retry backoff stops immediately', async () => {
  const caller = new AbortController();
  let calls = 0;
  let markSleepStarted;
  const sleepStarted = new Promise((resolve) => {
    markSleepStarted = resolve;
  });
  const { client } = clientWith({
    fetchImpl: async () => {
      calls += 1;
      return response({ error: 'busy' }, { status: 429 });
    },
    sleep: async () => {
      markSleepStarted();
      return new Promise(() => {});
    },
  });

  const pending = client.evaluate({ providerPayload: PROVIDER_PAYLOAD, signal: caller.signal });
  await sleepStarted;
  caller.abort(new Error('stop requested'));
  const error = await captureError(pending);

  assert.equal(calls, 1);
  assert.equal(error.code, 'gateway_aborted');
  assert.equal(error.retryable, false);
  assert.equal(error.attempts, 1);
});

test('caller abort during in-flight fetch stops immediately', async () => {
  const caller = new AbortController();
  let calls = 0;
  let markFetchStarted;
  const fetchStarted = new Promise((resolve) => {
    markFetchStarted = resolve;
  });
  const { client } = clientWith({
    fetchImpl: async (_url, { signal }) => {
      calls += 1;
      markFetchStarted();
      return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    },
  });

  const pending = client.evaluate({ providerPayload: PROVIDER_PAYLOAD, signal: caller.signal });
  await fetchStarted;
  caller.abort(new Error('stop requested'));
  const error = await captureError(pending);

  assert.equal(calls, 1);
  assert.equal(error.code, 'gateway_aborted');
  assert.equal(error.attempts, 1);
});

test('abort-shaped fetch error is terminal even when no owned abort signal fired', async () => {
  let calls = 0;
  const abortFailure = new Error('upstream operation aborted');
  abortFailure.name = 'AbortError';
  const { client, delays } = clientWith({
    fetchImpl: async () => {
      calls += 1;
      throw abortFailure;
    },
  });

  const error = await captureError(client.evaluate({ providerPayload: PROVIDER_PAYLOAD }));

  assert.equal(calls, 1);
  assert.deepEqual(delays, []);
  assert.equal(error.code, 'gateway_aborted');
  assert.equal(error.retryable, false);
  assert.equal(error.attempts, 1);
  assert.equal(Object.hasOwn(error, 'cause'), false);
});

test('redirect response is rejected and is not followed or retried', async () => {
  let calls = 0;
  const { client } = clientWith({
    fetchImpl: async () => {
      calls += 1;
      return new Response(null, { status: 302, headers: { location: 'https://example.com/' } });
    },
  });

  const error = await captureError(client.evaluate({ providerPayload: PROVIDER_PAYLOAD }));

  assert.equal(calls, 1);
  assert.equal(error.code, 'gateway_redirect_rejected');
  assert.equal(error.status, 302);
  assert.equal(error.retryable, false);
});

test('redirect rejection from native fetch is rejected and is not retried', async () => {
  let calls = 0;
  const { client } = clientWith({
    fetchImpl: async () => {
      calls += 1;
      throw new TypeError('fetch failed', { cause: new Error('unexpected redirect') });
    },
  });

  const error = await captureError(client.evaluate({ providerPayload: PROVIDER_PAYLOAD }));

  assert.equal(calls, 1);
  assert.equal(error.code, 'gateway_redirect_rejected');
  assert.equal(error.retryable, false);
  assert.equal(error.attempts, 1);
  assert.equal(Object.hasOwn(error, 'cause'), false);
});

test('chunked response size over 1,048,576 bytes is rejected without Content-Length', async () => {
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(700_000));
      controller.enqueue(new Uint8Array(400_000));
    },
    cancel() {
      cancelled = true;
    },
  });
  const { client } = clientWith({
    fetchImpl: async () => new Response(body, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  });

  const error = await captureError(client.evaluate({ providerPayload: PROVIDER_PAYLOAD }));

  assert.equal(error.code, 'gateway_response_too_large');
  assert.equal(error.retryable, false);
  assert.equal(error.attempts, 1);
  assert.equal(cancelled, true);
});

test('response size error remains terminal when stream cancellation rejects', async () => {
  let calls = 0;
  let cancelCalls = 0;
  const { client, delays } = clientWith({
    fetchImpl: async () => {
      calls += 1;
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(1_048_577));
        },
        cancel() {
          cancelCalls += 1;
          return Promise.reject(new Error('stream cancellation failed'));
        },
      });
      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  const error = await captureError(client.evaluate({ providerPayload: PROVIDER_PAYLOAD }));

  assert.equal(calls, 1);
  assert.equal(cancelCalls, 1);
  assert.deepEqual(delays, []);
  assert.equal(error.code, 'gateway_response_too_large');
  assert.equal(error.retryable, false);
  assert.equal(error.attempts, 1);
  assert.equal(Object.hasOwn(error, 'cause'), false);
});

test('redact removes the credential and Authorization header value from errors, stacks and MCP-safe details', async () => {
  const exposed = `network error ${TEST_CREDENTIAL}; Authorization: Bearer ${TEST_CREDENTIAL}`;
  const { client } = clientWith({
    maxAttempts: 1,
    fetchImpl: async () => {
      throw new TypeError(exposed);
    },
  });

  const error = await captureError(client.evaluate({ providerPayload: PROVIDER_PAYLOAD }));
  const surfaced = [error.message, error.stack, JSON.stringify(error)].join('\n');

  assert.doesNotMatch(surfaced, new RegExp(TEST_CREDENTIAL, 'u'));
  assert.doesNotMatch(surfaced, /Authorization: Bearer/iu);
  assert.equal(Object.hasOwn(error, 'cause'), false);
});

test('redact sanitises provider detail and request identifiers before surfacing them', async () => {
  const unsafeHeader = `Bearer ${TEST_CREDENTIAL}`;
  const { client } = clientWith({
    fetchImpl: async () => response(
      { error: `Rejected Authorization: Bearer ${TEST_CREDENTIAL}` },
      { status: 422, headers: { 'x-request-id': unsafeHeader } },
    ),
  });

  const error = await captureError(client.evaluate({ providerPayload: PROVIDER_PAYLOAD }));
  const surfaced = [error.message, error.stack, JSON.stringify(error)].join('\n');

  assert.doesNotMatch(surfaced, new RegExp(TEST_CREDENTIAL, 'u'));
  assert.doesNotMatch(surfaced, /Authorization: Bearer/iu);
  assert.equal(error.providerRequestId, '[REDACTED]');
});

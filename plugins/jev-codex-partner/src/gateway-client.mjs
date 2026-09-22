import {
  GATEWAY_URL,
  MAX_RESPONSE_BYTES,
  MODEL_ID,
} from './contracts.mjs';
import { sanitiseText } from './error-sanitisation.mjs';

const RETRY_DELAYS_MS = [250, 750];
const MAX_RETRY_AFTER_MS = 2_000;
const ATTEMPT_TIMEOUT = Symbol('attempt-timeout');
const TOTAL_TIMEOUT = Symbol('total-timeout');
const RESPONSE_TOO_LARGE = Symbol('response-too-large');

export function createGatewayClient({
  apiKey,
  fetchImpl = globalThis.fetch,
  sleep = defaultSleep,
  random = Math.random,
  now = Date.now,
  attemptTimeoutMs = 10_000,
  totalTimeoutMs = 25_000,
  maxAttempts = 3,
  maxResponseBytes = MAX_RESPONSE_BYTES,
}) {
  async function evaluate({ providerPayload, signal: callerSignal } = {}) {
    if (typeof apiKey !== 'string' || apiKey.length === 0) {
      throw gatewayError({
        code: 'gateway_not_configured',
        message: 'AI Gateway is not configured. Set AI_GATEWAY_API_KEY in the MCP server environment.',
        retryable: false,
        attempts: 0,
      });
    }

    const startedAt = now();
    const deadline = startedAt + totalTimeoutMs;
    let attempts = 0;
    const totalController = new AbortController();
    const totalTimer = scheduleAbort(totalController, totalTimeoutMs, TOTAL_TIMEOUT);

    try {
      if (callerSignal?.aborted) {
        throw abortError(attempts);
      }

      while (attempts < maxAttempts) {
        if (now() >= deadline || totalController.signal.aborted) {
          throw totalTimeoutError(attempts);
        }

        attempts += 1;
        const attemptController = new AbortController();
        const remainingMs = Math.max(0, deadline - now());
        const attemptTimer = scheduleAbort(
          attemptController,
          Math.min(attemptTimeoutMs, remainingMs),
          ATTEMPT_TIMEOUT,
        );
        const composed = composeSignals([
          callerSignal,
          totalController.signal,
          attemptController.signal,
        ]);
        let retryDelayMs;
        let terminalError;

        try {
          const response = await fetchImpl(GATEWAY_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: MODEL_ID,
              state: providerPayload.state,
              questions: providerPayload.questions,
              providerOptions: providerPayload.providerOptions,
            }),
            redirect: 'error',
            signal: composed.signal,
          });

          const providerRequestId = safeProviderRequestId(response.headers, apiKey);
          if (response.status >= 300 && response.status < 400) {
            throw gatewayError({
              code: 'gateway_redirect_rejected',
              message: `AI Gateway redirect response was rejected (HTTP ${response.status}).`,
              retryable: false,
              status: response.status,
              providerRequestId,
              attempts,
            });
          }

          const bodyText = await readBoundedBody(
            response,
            maxResponseBytes,
            attemptController,
            attempts,
          );

          if (!response.ok) {
            const httpFailure = createHttpError({
              status: response.status,
              detail: providerDetail(bodyText),
              providerRequestId,
              attempts,
              apiKey,
            });
            if (httpFailure.retryable && attempts < maxAttempts) {
              retryDelayMs = retryDelay(response.headers, attempts, random, now);
            }
            throw httpFailure;
          }

          let raw;
          try {
            raw = JSON.parse(bodyText);
          } catch {
            throw gatewayError({
              code: 'gateway_invalid_response',
              message: 'AI Gateway returned invalid JSON.',
              retryable: false,
              providerRequestId,
              attempts,
            });
          }

          return {
            raw,
            durationMs: Math.max(0, now() - startedAt),
            attempts,
            requestId: providerRequestId,
          };
        } catch (error) {
          if (callerSignal?.aborted) {
            terminalError = abortError(attempts);
          } else if (totalController.signal.aborted || now() >= deadline) {
            terminalError = totalTimeoutError(attempts);
          } else if (attemptController.signal.aborted && attemptController.signal.reason === ATTEMPT_TIMEOUT) {
            terminalError = attemptTimeoutError(attempts);
          } else if (error instanceof GatewayClientError) {
            terminalError = error;
          } else if (error?.name === 'AbortError') {
            terminalError = gatewayError({
              code: 'gateway_aborted',
              message: 'AI Gateway request was aborted.',
              retryable: false,
              attempts,
            });
          } else if (isRedirectRejection(error)) {
            terminalError = gatewayError({
              code: 'gateway_redirect_rejected',
              message: 'AI Gateway redirect response was rejected.',
              retryable: false,
              attempts,
            });
          } else {
            terminalError = gatewayError({
              code: 'gateway_network_error',
              message: `AI Gateway network failure: ${safeText(error, apiKey)}`,
              retryable: true,
              attempts,
            });
            if (attempts < maxAttempts) {
              retryDelayMs = defaultRetryDelay(attempts, random);
            }
          }
        } finally {
          clearTimeout(attemptTimer);
          composed.cleanup();
        }

        if (!terminalError.retryable || attempts >= maxAttempts) {
          throw terminalError;
        }

        const delayMs = retryDelayMs ?? defaultRetryDelay(attempts, random);
        try {
          await waitForRetry({
            milliseconds: Math.min(delayMs, Math.max(0, deadline - now())),
            sleep,
            callerSignal,
            totalSignal: totalController.signal,
          });
        } catch {
          if (callerSignal?.aborted) throw abortError(attempts);
          throw totalTimeoutError(attempts);
        }

        if (callerSignal?.aborted) throw abortError(attempts);
        if (totalController.signal.aborted || now() >= deadline) {
          throw totalTimeoutError(attempts);
        }
      }

      throw gatewayError({
        code: 'gateway_network_error',
        message: 'AI Gateway request failed within the configured attempt budget.',
        retryable: true,
        attempts,
      });
    } finally {
      clearTimeout(totalTimer);
    }
  }

  return { evaluate };
}

class GatewayClientError extends Error {
  constructor({ code, message, retryable, status, providerRequestId, attempts }) {
    super(message);
    this.name = 'GatewayClientError';
    this.code = code;
    this.retryable = retryable;
    if (status !== undefined) this.status = status;
    if (providerRequestId !== undefined) this.providerRequestId = providerRequestId;
    this.attempts = attempts;
  }

  toJSON() {
    const result = {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
    };
    if (this.status !== undefined) result.status = this.status;
    if (this.providerRequestId !== undefined) result.providerRequestId = this.providerRequestId;
    result.attempts = this.attempts;
    return result;
  }
}

function gatewayError(fields) {
  return new GatewayClientError(fields);
}

function createHttpError({ status, detail, providerRequestId, attempts, apiKey }) {
  const safeDetail = detail ? `: ${safeText(detail, apiKey)}` : '';
  if (status === 401) {
    return gatewayError({
      code: 'gateway_authentication_failed',
      message: 'AI Gateway authentication failed (HTTP 401).',
      retryable: false,
      status,
      providerRequestId,
      attempts,
    });
  }
  if (status === 422) {
    return gatewayError({
      code: 'gateway_request_rejected',
      message: `AI Gateway rejected the evaluation (HTTP 422)${safeDetail}.`,
      retryable: false,
      status,
      providerRequestId,
      attempts,
    });
  }
  if (status === 429) {
    return gatewayError({
      code: 'gateway_rate_limited',
      message: `AI Gateway rate limited the evaluation (HTTP 429)${safeDetail}.`,
      retryable: true,
      status,
      providerRequestId,
      attempts,
    });
  }
  if (status === 529) {
    return gatewayError({
      code: 'gateway_unavailable',
      message: `AI Gateway is temporarily unavailable (HTTP 529)${safeDetail}.`,
      retryable: true,
      status,
      providerRequestId,
      attempts,
    });
  }
  return gatewayError({
    code: 'gateway_request_failed',
    message: `AI Gateway request failed (HTTP ${status})${safeDetail}.`,
    retryable: false,
    status,
    providerRequestId,
    attempts,
  });
}

function abortError(attempts) {
  return gatewayError({
    code: 'gateway_aborted',
    message: 'AI Gateway request was cancelled by the caller.',
    retryable: false,
    attempts,
  });
}

function attemptTimeoutError(attempts) {
  return gatewayError({
    code: 'gateway_timeout',
    message: 'AI Gateway request exceeded the per-attempt timeout.',
    retryable: false,
    attempts,
  });
}

function totalTimeoutError(attempts) {
  return gatewayError({
    code: 'gateway_total_timeout',
    message: 'AI Gateway request exceeded the total timeout.',
    retryable: false,
    attempts,
  });
}

async function readBoundedBody(response, maximumBytes, attemptController, attempts) {
  if (response.body === null) return '';

  const reader = response.body.getReader();
  const chunks = [];
  let byteLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
    byteLength += chunk.byteLength;
    if (byteLength > maximumBytes) {
      attemptController.abort(RESPONSE_TOO_LARGE);
      try {
        Promise.resolve(reader.cancel()).catch(() => {});
      } catch {
        // Stream cancellation is best-effort after the request is aborted.
      }
      throw gatewayError({
        code: 'gateway_response_too_large',
        message: `AI Gateway response exceeded ${maximumBytes} bytes.`,
        retryable: false,
        attempts,
      });
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, byteLength).toString('utf8');
}

function providerDetail(bodyText) {
  if (!bodyText) return '';
  try {
    const parsed = JSON.parse(bodyText);
    if (typeof parsed.error === 'string') return parsed.error;
    if (parsed.error && typeof parsed.error.message === 'string') return parsed.error.message;
    if (typeof parsed.message === 'string') return parsed.message;
  } catch {
    return bodyText;
  }
  return '';
}

function safeProviderRequestId(headers, apiKey) {
  const value = headers.get('x-request-id') ?? headers.get('x-vercel-id');
  return value === null ? undefined : safeText(value, apiKey);
}

function safeText(value, apiKey) {
  const source = value instanceof Error ? value.message : String(value ?? '');
  const structurallySanitised = sanitiseText(source);
  const withoutKnownCredential = apiKey.length > 0
    ? structurallySanitised.replaceAll(apiKey, '[REDACTED]')
    : structurallySanitised;
  return sanitiseText(withoutKnownCredential);
}

function isRedirectRejection(error) {
  const messages = [error?.message, error?.cause?.message];
  return messages.some((message) => (
    typeof message === 'string' && /unexpected redirect/iu.test(message)
  ));
}

function retryDelay(headers, attempts, random, now) {
  const retryAfter = parseRetryAfter(headers.get('retry-after'), now());
  return retryAfter ?? defaultRetryDelay(attempts, random);
}

function parseRetryAfter(value, currentTimeMs) {
  if (value === null) return undefined;
  const trimmed = value.trim();
  if (/^(?:\d+|\d*\.\d+)$/u.test(trimmed)) {
    return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, Number(trimmed) * 1_000));
  }
  const requestedAt = Date.parse(trimmed);
  if (!Number.isFinite(requestedAt)) return undefined;
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, requestedAt - currentTimeMs));
}

function defaultRetryDelay(attempts, random) {
  const base = RETRY_DELAYS_MS[Math.min(attempts - 1, RETRY_DELAYS_MS.length - 1)];
  const sample = Math.min(1, Math.max(0, Number(random()) || 0));
  const jitter = Math.min(100, Math.floor(sample * 101));
  return base + jitter;
}

function scheduleAbort(controller, milliseconds, reason) {
  return setTimeout(() => controller.abort(reason), Math.max(0, milliseconds));
}

function composeSignals(signals) {
  const controller = new AbortController();
  const listeners = [];
  for (const signal of signals.filter(Boolean)) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    const listener = () => controller.abort(signal.reason);
    signal.addEventListener('abort', listener, { once: true });
    listeners.push([signal, listener]);
  }
  return {
    signal: controller.signal,
    cleanup() {
      for (const [signal, listener] of listeners) {
        signal.removeEventListener('abort', listener);
      }
    },
  };
}

function waitForRetry({ milliseconds, sleep, callerSignal, totalSignal }) {
  const composed = composeSignals([callerSignal, totalSignal]);
  if (composed.signal.aborted) {
    composed.cleanup();
    return Promise.reject(composed.signal.reason);
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => finish(reject, composed.signal.reason);
    const finish = (settle, value) => {
      composed.signal.removeEventListener('abort', onAbort);
      composed.cleanup();
      settle(value);
    };
    composed.signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve()
      .then(() => sleep(milliseconds, composed.signal))
      .then(() => finish(resolve), (error) => finish(reject, error));
  });
}

function defaultSleep(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(resolve, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

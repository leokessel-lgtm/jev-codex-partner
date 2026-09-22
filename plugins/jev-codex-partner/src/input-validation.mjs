import Ajv from 'ajv';
import {
  EVALUATE_INPUT_SCHEMA,
  MAX_REQUEST_BYTES,
  MAX_STATE_QUESTION_BYTES,
  MODEL_ID,
  PROVIDER_OPTIONS,
  ZDR_PROVIDER_OPTIONS,
} from './contracts.mjs';
import { containsCredentialValue } from './error-sanitisation.mjs';

const ajv = new Ajv({
  allErrors: true,
  strict: true,
  coerceTypes: false,
  useDefaults: false,
});
const validateSchema = ajv.compile(EVALUATE_INPUT_SCHEMA);

const CREDENTIAL_KEYS = new Set([
  'apikey',
  'xapikey',
  'authorization',
  'password',
  'secret',
  'clientsecret',
  'privatekey',
  'accesstoken',
  'refreshtoken',
  'authtoken',
  'idtoken',
  'sessiontoken',
  'token',
  'credential',
  'credentials',
]);

export function validateEvaluateInput(raw) {
  if (!validateSchema(raw)) {
    return {
      ok: false,
      errors: validateSchema.errors.map(({ instancePath, message }) => ({
        path: instancePath || '$',
        message,
      })),
    };
  }

  if (
    (raw.data_classification === 'private' || raw.data_classification === 'sensitive')
    && raw.sensitive_transfer_approved !== true
  ) {
    return validationFailure(
      '$.sensitive_transfer_approved',
      'must be true for private or sensitive data',
    );
  }

  let providerPayload;
  try {
    const customSerialiserPath = findCustomSerialiserPath(raw);
    if (customSerialiserPath !== null) {
      return validationFailure(customSerialiserPath, 'custom JSON serializers are not allowed');
    }
    if (serialisedBytes(raw) > MAX_REQUEST_BYTES) {
      return validationFailure('$', `complete request must not exceed ${MAX_REQUEST_BYTES} bytes`);
    }
    const credentialPath = findCredentialPath(raw);
    if (credentialPath !== null) {
      return validationFailure(credentialPath, 'must not contain credential material');
    }

    providerPayload = {
      model: MODEL_ID,
      state: raw.state,
      questions: raw.questions,
      providerOptions: raw.data_classification === 'private'
        || raw.data_classification === 'sensitive'
        ? ZDR_PROVIDER_OPTIONS
        : PROVIDER_OPTIONS,
    };

    if (serialisedBytes(providerPayload) > MAX_REQUEST_BYTES) {
      return validationFailure('$', `provider payload must not exceed ${MAX_REQUEST_BYTES} bytes`);
    }

    const stateBytes = serialisedBytes(raw.state);
    const longestQuestionBytes = Math.max(
      ...Object.values(raw.questions).map((question) => serialisedBytes(question)),
    );
    if (stateBytes + longestQuestionBytes > MAX_STATE_QUESTION_BYTES) {
      return validationFailure(
        '$.state',
        `state plus longest question must not exceed ${MAX_STATE_QUESTION_BYTES} bytes`,
      );
    }
  } catch {
    return validationFailure('$', 'must be JSON serialisable');
  }

  return { ok: true, value: raw, providerPayload };
}

export function findCredentialPath(value) {
  return findCredential(value, '$', new Set());
}

function findCredential(value, path, visited) {
  if (containsCredentialValue(value)) return path;
  if (value === null || typeof value !== 'object') return null;
  if (visited.has(value)) return null;
  visited.add(value);

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findCredential(value[index], `${path}[${index}]`, visited);
      if (found !== null) return found;
    }
    return null;
  }

  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (isCredentialKey(key)) return childPath;
    const found = findCredential(child, childPath, visited);
    if (found !== null) return found;
  }
  return null;
}

function normaliseCredentialKey(key) {
  return key.toLowerCase().replace(/[_-]/gu, '');
}

function isCredentialKey(key) {
  const normalised = normaliseCredentialKey(key);
  return CREDENTIAL_KEYS.has(normalised)
    || /(?:apikey|authorization|password|secret|privatekey|token|credentials?)$/u.test(normalised);
}

function findCustomSerialiserPath(value, path = '$', visited = new Set()) {
  if (value === null || typeof value !== 'object') return null;
  if (visited.has(value)) return null;
  visited.add(value);

  if (hasToJsonProperty(value)) return `${path}.toJSON`;
  for (const [key, child] of Object.entries(value)) {
    const childPath = Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`;
    const found = findCustomSerialiserPath(child, childPath, visited);
    if (found !== null) return found;
  }
  return null;
}

function hasToJsonProperty(value) {
  let current = value;
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, 'toJSON');
    if (descriptor !== undefined) {
      return descriptor.get !== undefined || typeof descriptor.value === 'function';
    }
    current = Object.getPrototypeOf(current);
  }
  return false;
}

function serialisedBytes(value) {
  const serialised = JSON.stringify(value);
  if (serialised === undefined) throw new TypeError('Value is not JSON serialisable');
  return Buffer.byteLength(serialised, 'utf8');
}

function validationFailure(path, message) {
  return { ok: false, errors: [{ path, message }] };
}

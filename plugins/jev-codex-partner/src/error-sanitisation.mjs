const MAX_SURFACED_DETAIL_BYTES = 4_096;

const PEM_PRIVATE_KEY_BLOCK = /-----BEGIN ([^-\r\n]*PRIVATE KEY)-----[\s\S]*?-----END \1-----/gu;
const PEM_PRIVATE_KEY_REMAINDER = /-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*$/gu;
const PEM_PRIVATE_KEY_MARKER = /-----BEGIN [^-\r\n]*PRIVATE KEY-----/gu;
const BEARER_CANDIDATE = /\b(Bearer)[ \t]+([A-Za-z0-9._~+/-]+=*)/giu;
const JWT_CANDIDATE = /\b[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu;
const OPAQUE_VENDOR_TOKEN = /\b(?:sk-(?:live-|test-)?[A-Za-z0-9_-]{16,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github[_]pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{20,}|(?:vcp|vercel|npm|hf)_[A-Za-z0-9_-]{20,})\b/gu;
const TEXTUAL_CREDENTIAL_ASSIGNMENT = /\b((?:[A-Za-z0-9]+[-_])*(?:x[-_]?api[-_]?key|api[-_]?key|client[-_]?secret|(?:auth|id|session|access|refresh|oauth|bearer|client|service|device|csrf|xsrf)[-_]?token|private[-_]?key|password|secret|authorization|credential|token))(\s*[:=]\s*)(?:"[^"\r\n]+"|'[^'\r\n]+'|[^\s,;]+)/giu;

export function containsCredentialValue(value) {
  if (typeof value !== 'string') return false;
  if ([PEM_PRIVATE_KEY_BLOCK, PEM_PRIVATE_KEY_MARKER].some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(value);
  })) return true;
  if (containsBearerCredential(value)) return true;

  for (const pattern of [OPAQUE_VENDOR_TOKEN, TEXTUAL_CREDENTIAL_ASSIGNMENT]) {
    pattern.lastIndex = 0;
    if (pattern.test(value)) return true;
  }

  JWT_CANDIDATE.lastIndex = 0;
  return [...value.matchAll(JWT_CANDIDATE)].some(({ 0: candidate }) => isCredibleJwt(candidate));
}

export function sanitiseText(value) {
  const source = value instanceof Error ? value.message : String(value ?? '');
  const redacted = source
    .replace(PEM_PRIVATE_KEY_BLOCK, '[REDACTED]')
    .replace(PEM_PRIVATE_KEY_REMAINDER, '[REDACTED]')
    .replace(BEARER_CANDIDATE, (candidate, scheme, token, offset, input) => (
      isBearerCredential(input, candidate, scheme, token, offset) ? '[REDACTED]' : candidate
    ))
    .replace(TEXTUAL_CREDENTIAL_ASSIGNMENT, (_candidate, key, separator) => (
      `${key}${separator}[REDACTED]`
    ))
    .replace(OPAQUE_VENDOR_TOKEN, '[REDACTED]')
    .replace(JWT_CANDIDATE, (candidate) => (
      isCredibleJwt(candidate) ? '[REDACTED]' : candidate
    ));
  return truncateUtf8(redacted, MAX_SURFACED_DETAIL_BYTES);
}

function containsBearerCredential(value) {
  BEARER_CANDIDATE.lastIndex = 0;
  return [...value.matchAll(BEARER_CANDIDATE)].some((match) => (
    isBearerCredential(value, match[0], match[1], match[2], match.index)
  ));
}

function isBearerCredential(source, candidate, scheme, token, offset) {
  const before = source.slice(0, offset);
  const after = source.slice(offset + candidate.length);
  const isCompleteValue = source.trim() === candidate;
  const isAuthorisationHeader = /(?:^|[\r\n])[\t ]*Authorization[\t ]*:[\t ]*$/iu.test(before);
  const hasTokenStructure = /[0-9\-._~+/=]/u.test(token);
  const hasCredentialLength = /^[A-Za-z]{20,}$/u.test(token);
  const punctuationTerminated = scheme.toLowerCase() === 'bearer'
    && (after.length === 0 || /^[,:;.!?)\]}]/u.test(after));
  return isCompleteValue || isAuthorisationHeader || hasTokenStructure
    || hasCredentialLength || punctuationTerminated;
}

function isCredibleJwt(candidate) {
  const [encodedHeader, encodedPayload] = candidate.split('.');
  try {
    const header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8'));
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    return isRecord(header) && typeof header.alg === 'string' && header.alg.length > 0
      && isRecord(payload);
  } catch {
    return false;
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function truncateUtf8(value, maximumBytes) {
  let bytes = 0;
  let result = '';
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, 'utf8');
    if (bytes + characterBytes > maximumBytes) break;
    result += character;
    bytes += characterBytes;
  }
  return result;
}

// UTF-8 safe Base64 helpers. btoa/atob only handle Latin-1, so we go through bytes.

export function utf8ToBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function base64ToUtf8(b64) {
  // GitHub wraps base64 content at 60 chars with newlines.
  const binary = atob(String(b64).replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// Normalise line endings only (CRLF/CR -> LF). Tabs and indentation are left untouched.
export function normalizeNewlines(text) {
  return String(text).replace(/\r\n?/g, '\n');
}

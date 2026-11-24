// Validation for runtime messages sent to the service worker.
// Only the extension's own pages may send messages, only allow-listed types are accepted,
// and every payload must have exactly the expected shape. No message can trigger a GitHub
// write: writes only happen in the review window after explicit user clicks.

export const CATEGORY_IDS = ['auto', 'code', 'dsa', 'commands', 'sql', 'config', 'notes', 'docs', 'research', 'prompt', 'resource'];

const SCHEMAS = {
  'capture-active-tab': { category: (v) => v === undefined || CATEGORY_IDS.includes(v) },
};

/**
 * @param {unknown} msg
 * @param {chrome.runtime.MessageSender} sender
 * @param {{ id: string, baseUrl: string }} self  chrome.runtime.id and chrome.runtime.getURL('')
 * @returns {{ ok: true, type: string } | { ok: false, reason: string }}
 */
export function validateMessage(msg, sender, self) {
  if (!sender || sender.id !== self.id) return { ok: false, reason: 'sender is not this extension' };
  if (typeof sender.url !== 'string' || !sender.url.startsWith(self.baseUrl)) return { ok: false, reason: 'sender is not an extension page' };
  if (sender.origin !== undefined && `${sender.origin}/` !== self.baseUrl) return { ok: false, reason: 'unexpected origin' };
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return { ok: false, reason: 'payload is not an object' };
  const schema = Object.prototype.hasOwnProperty.call(SCHEMAS, msg.type) ? SCHEMAS[msg.type] : null;
  if (!schema) return { ok: false, reason: 'unknown message type' };
  for (const key of Object.keys(msg)) {
    if (key === 'type') continue;
    if (!Object.prototype.hasOwnProperty.call(schema, key)) return { ok: false, reason: `unexpected field "${key}"` };
  }
  for (const [key, check] of Object.entries(schema)) {
    if (!check(msg[key])) return { ok: false, reason: `invalid field "${key}"` };
  }
  return { ok: true, type: msg.type };
}

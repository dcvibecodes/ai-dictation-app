'use strict';

// Session tokens: timestamp:generation:hmac(timestamp:generation).
// The generation counter lets a password change invalidate every cookie ever
// issued without touching session.secret (the settings encryption key derives
// from that secret — rotating it would orphan every saved API key).
const crypto = require('crypto');

const DEFAULT_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000; // 180 days

function createSessionToken(secret, generation, now = Date.now()) {
  const timestamp = String(now);
  const gen = String(generation == null ? '1' : generation);
  const hmac = crypto.createHmac('sha256', secret)
    .update(`${timestamp}:${gen}`)
    .digest('hex');
  return `${timestamp}:${gen}:${hmac}`;
}

function verifySessionToken(token, opts = {}) {
  if (typeof token !== 'string' || !token) return false;
  const secret = opts.secret;
  if (!secret) return false;
  const now = typeof opts.now === 'number' ? opts.now : Date.now();
  const maxAgeMs = typeof opts.maxAgeMs === 'number' ? opts.maxAgeMs : DEFAULT_MAX_AGE_MS;
  const expectedGen = String(opts.generation == null ? '1' : opts.generation);

  const parts = token.split(':');
  // Old two-part cookies are rejected so every browser re-logs in exactly once
  // after this upgrade.
  if (parts.length !== 3) return false;
  const [timestamp, gen, hmac] = parts;

  const ts = parseInt(timestamp, 10);
  if (!Number.isFinite(ts)) return false;
  const age = now - ts;
  // Reject malformed timestamps and future ones (server clock moved).
  if (!Number.isFinite(age) || age < 0) return false;
  if (maxAgeMs > 0 && age > maxAgeMs) return false;
  if (gen !== expectedGen) return false;

  const expected = crypto.createHmac('sha256', secret)
    .update(`${timestamp}:${gen}`)
    .digest('hex');
  try {
    const hmacBuf = Buffer.from(hmac, 'hex');
    const expectedBuf = Buffer.from(expected, 'hex');
    if (hmacBuf.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(hmacBuf, expectedBuf);
  } catch {
    return false;
  }
}

module.exports = { DEFAULT_MAX_AGE_MS, createSessionToken, verifySessionToken };

'use strict';

// bcrypt only reads the first 72 bytes of its input. Silently truncating would
// mean two different long passwords could open the same account, so long
// passwords are rejected outright. Multi-byte characters are counted as bytes,
// not characters.
const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_BYTES = 72;

function passwordByteLength(value) {
  return Buffer.byteLength(String(value == null ? '' : value), 'utf8');
}

function validateNewPassword(password, confirm) {
  if (typeof password !== 'string' || !password) {
    return { ok: false, error: 'Password is required.' };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  if (passwordByteLength(password) > MAX_PASSWORD_BYTES) {
    return { ok: false, error: `Password must be at most ${MAX_PASSWORD_BYTES} bytes (UTF-8). Choose a shorter password.` };
  }
  if (confirm !== undefined && password !== confirm) {
    return { ok: false, error: 'Passwords do not match.' };
  }
  return { ok: true, error: '' };
}

function normalizeUsername(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function validateUsername(value) {
  const username = normalizeUsername(value);
  if (!username) return { ok: false, error: 'Username is required.', username };
  if (username.length > 50) return { ok: false, error: 'Username must be 50 characters or fewer.', username };
  return { ok: true, error: '', username };
}

module.exports = {
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_BYTES,
  passwordByteLength,
  validateNewPassword,
  normalizeUsername,
  validateUsername
};

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createSessionToken, verifySessionToken, DEFAULT_MAX_AGE_MS } = require('../lib/sessions');
const { isSameOriginRequest } = require('../lib/csrf');
const { validateNewPassword, validateUsername, passwordByteLength } = require('../lib/passwords');
const { migrateOwnerRecord, writeOwnerRecord } = require('../lib/owner');

const SECRET = 'test-secret';
const HASH = '$2b$12$abcdefghijklmnopqrstuv';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dictation-auth-'));
}

test('session token: round trip, generation change kills it', () => {
  const token = createSessionToken(SECRET, '1', 1000);
  assert.equal(verifySessionToken(token, { secret: SECRET, generation: '1', now: 1000 }), true);
  assert.equal(verifySessionToken(token, { secret: SECRET, generation: '2', now: 1000 }), false);
  assert.equal(verifySessionToken(token, { secret: 'other', generation: '1', now: 1000 }), false);
});

test('session token: old two-part cookies are rejected', () => {
  assert.equal(verifySessionToken('1000:deadbeef', { secret: SECRET, generation: '1', now: 1000 }), false);
});

test('session token: absolute expiry and future timestamps', () => {
  const token = createSessionToken(SECRET, '1', 0);
  assert.equal(verifySessionToken(token, {
    secret: SECRET, generation: '1', now: DEFAULT_MAX_AGE_MS - 1
  }), true);
  assert.equal(verifySessionToken(token, {
    secret: SECRET, generation: '1', now: DEFAULT_MAX_AGE_MS + 1
  }), false);
  const future = createSessionToken(SECRET, '1', 5000);
  assert.equal(verifySessionToken(future, { secret: SECRET, generation: '1', now: 1000 }), false);
});

test('session token: tampered generation or hmac is rejected', () => {
  const token = createSessionToken(SECRET, '1', 1000);
  const [, , hmac] = token.split(':');
  assert.equal(verifySessionToken(`1000:2:${hmac}`, { secret: SECRET, generation: '2', now: 1000 }), false);
  assert.equal(verifySessionToken(`1000:1:${'0'.repeat(hmac.length)}`, { secret: SECRET, generation: '1', now: 1000 }), false);
});

test('csrf: same host passes, foreign origin rejected, absent allowed', () => {
  assert.equal(isSameOriginRequest({ origin: 'https://dt.example.com', host: 'dt.example.com' }), true);
  assert.equal(isSameOriginRequest({ origin: 'https://evil.example', host: 'dt.example.com' }), false);
  assert.equal(isSameOriginRequest({ host: 'dt.example.com' }), true);
  assert.equal(isSameOriginRequest({
    origin: 'http://127.0.0.1:3003', host: 'dt.example.com',
    allowedOrigins: ['http://127.0.0.1:3003']
  }), true);
  assert.equal(isSameOriginRequest({ referer: 'https://evil.example/x', host: 'dt.example.com' }), false);
  // A reverse proxy that rewrites Host but preserves X-Forwarded-Host.
  assert.equal(isSameOriginRequest({
    origin: 'https://dt.example.com', host: '127.0.0.1:3003',
    forwardedHost: 'dt.example.com'
  }), true);
});

test('password policy: minimum length and 72-byte ceiling', () => {
  assert.equal(validateNewPassword('short').ok, false);
  assert.equal(validateNewPassword('12345678901').ok, false); // 11
  assert.equal(validateNewPassword('123456789012').ok, true); // 12
  const multibyte = 'é'.repeat(40); // 80 UTF-8 bytes, 40 characters
  assert.equal(passwordByteLength(multibyte), 80);
  assert.equal(validateNewPassword(multibyte).ok, false);
  assert.match(validateNewPassword(multibyte).error, /72 bytes/);
  assert.equal(validateNewPassword('123456789012', 'different').ok, false);
});

test('username: trimmed, 1-50 characters, spaces allowed', () => {
  assert.equal(validateUsername('  Alex Doe  ').username, 'Alex Doe');
  assert.equal(validateUsername('').ok, false);
  assert.equal(validateUsername('x'.repeat(51)).ok, false);
  assert.equal(validateUsername('x'.repeat(50)).ok, true);
});

test('owner migration: hash preserved byte-for-byte, backup protected, hash removed', () => {
  const dir = tmpDir();
  const ownerFile = path.join(dir, 'owner.json');
  const hashFile = path.join(dir, 'owner.hash');
  const backupFile = path.join(dir, 'owner.hash.backup');
  fs.writeFileSync(hashFile, HASH);
  fs.chmodSync(hashFile, 0o644);

  assert.equal(migrateOwnerRecord({ ownerFile, hashFile, backupFile }), 'migrated');
  const record = JSON.parse(fs.readFileSync(ownerFile, 'utf8'));
  assert.equal(record.passwordHash, HASH);
  assert.equal(record.username, null);
  assert.equal(fs.existsSync(hashFile), false);
  assert.equal(fs.readFileSync(backupFile, 'utf8'), HASH);
  assert.equal(fs.statSync(backupFile).mode & 0o777, 0o600);
  assert.equal(fs.statSync(ownerFile).mode & 0o777, 0o600);

  // Idempotent: running again changes nothing and keeps the record.
  assert.equal(migrateOwnerRecord({ ownerFile, hashFile, backupFile }), 'exists');
  assert.equal(JSON.parse(fs.readFileSync(ownerFile, 'utf8')).passwordHash, HASH);
});

test('owner migration: corrupt hash is skipped, nobody is locked out', () => {
  const dir = tmpDir();
  const ownerFile = path.join(dir, 'owner.json');
  const hashFile = path.join(dir, 'owner.hash');
  const backupFile = path.join(dir, 'owner.hash.backup');
  fs.writeFileSync(hashFile, 'not-a-bcrypt-hash');
  const logs = [];
  assert.equal(migrateOwnerRecord({ ownerFile, hashFile, backupFile, log: m => logs.push(m) }), 'skipped');
  assert.equal(fs.existsSync(ownerFile), false);
  assert.equal(fs.readFileSync(hashFile, 'utf8'), 'not-a-bcrypt-hash');
  assert.equal(logs.length, 1);
  assert.ok(!logs[0].includes('not-a-bcrypt-hash'));
});

test('owner migration: crash recovery restores from the backup', () => {
  const dir = tmpDir();
  const ownerFile = path.join(dir, 'owner.json');
  const hashFile = path.join(dir, 'owner.hash');
  const backupFile = path.join(dir, 'owner.hash.backup');
  fs.writeFileSync(backupFile, HASH);
  assert.equal(migrateOwnerRecord({ ownerFile, hashFile, backupFile }), 'restored');
  assert.equal(fs.readFileSync(hashFile, 'utf8'), HASH);
});

test('owner record writes are atomic and owner-only', () => {
  const dir = tmpDir();
  const ownerFile = path.join(dir, 'owner.json');
  writeOwnerRecord(ownerFile, { username: 'Dan Canvell', passwordHash: HASH });
  assert.equal(fs.statSync(ownerFile).mode & 0o777, 0o600);
  assert.equal(fs.existsSync(ownerFile + '.tmp'), false);
  const stored = JSON.parse(fs.readFileSync(ownerFile, 'utf8'));
  assert.equal(stored.username, 'Dan Canvell');
  assert.equal(stored.passwordHash, HASH);
});

'use strict';

// Owner account record. Before this change the bcrypt hash lived alone in
// data/owner.hash and there was no username. The record now lives in
// data/owner.json as { username, passwordHash }.
//
// The migration is atomic, verified, reversible and idempotent: a crash at any
// point leaves the app able to log in with the existing password.
const fs = require('fs');

const BCRYPT_HASH_RE = /^\$2[aby]\$\d{2}\$/;

function writeFileAtomic(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, data, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function isBcryptHash(value) {
  return typeof value === 'string' && BCRYPT_HASH_RE.test(value);
}

function readOwnerRecord(ownerFile) {
  try {
    const parsed = JSON.parse(fs.readFileSync(ownerFile, 'utf8'));
    if (!parsed || !isBcryptHash(parsed.passwordHash)) return null;
    return {
      username: typeof parsed.username === 'string' ? parsed.username : null,
      passwordHash: parsed.passwordHash
    };
  } catch {
    return null;
  }
}

function writeOwnerRecord(ownerFile, record) {
  const safe = {
    username: record.username == null ? null : String(record.username),
    passwordHash: record.passwordHash
  };
  writeFileAtomic(ownerFile, JSON.stringify(safe, null, 2));
}

/**
 * Convert data/owner.hash into data/owner.json.
 * @returns {'exists'|'migrated'|'restored'|'skipped'|'noop'}
 */
function migrateOwnerRecord({ ownerFile, hashFile, backupFile, log = console.error }) {
  // Idempotent: a valid record already exists.
  if (fs.existsSync(ownerFile)) {
    if (readOwnerRecord(ownerFile)) {
      // Finish an interrupted migration: the original only remains because a
      // crash happened after the atomic write. The backup stays for recovery.
      if (fs.existsSync(hashFile)) {
        try { fs.unlinkSync(hashFile); } catch {}
      }
      return 'exists';
    }
  }

  if (!fs.existsSync(hashFile)) {
    // Crash recovery: backup exists but the record does not — put the original
    // hash back so the legacy login path keeps working.
    if (fs.existsSync(backupFile) && !fs.existsSync(ownerFile)) {
      try {
        fs.copyFileSync(backupFile, hashFile);
        fs.chmodSync(hashFile, 0o600);
        return 'restored';
      } catch {
        return 'skipped';
      }
    }
    return 'noop';
  }

  let passwordHash;
  try {
    passwordHash = fs.readFileSync(hashFile, 'utf8').trim();
  } catch {
    log('owner.hash unreadable; owner-record migration skipped');
    return 'skipped';
  }
  if (!isBcryptHash(passwordHash)) {
    // Never log or expose the content — just skip and keep the legacy path.
    log('owner.hash unreadable; owner-record migration skipped');
    return 'skipped';
  }

  try {
    fs.copyFileSync(hashFile, backupFile);
    fs.chmodSync(backupFile, 0o600);
  } catch {
    // Without a backup the migration is not safe; try again next boot.
    log('Could not create owner backup; migration deferred');
    return 'skipped';
  }

  writeFileAtomic(ownerFile, JSON.stringify({ username: null, passwordHash }, null, 2));

  const stored = readOwnerRecord(ownerFile);
  if (!stored || stored.passwordHash !== passwordHash) {
    try { fs.unlinkSync(ownerFile); } catch {}
    log('owner.json verification failed; migration rolled back');
    return 'skipped';
  }

  try { fs.unlinkSync(hashFile); } catch {}
  return 'migrated';
}

module.exports = {
  BCRYPT_HASH_RE,
  writeFileAtomic,
  isBcryptHash,
  readOwnerRecord,
  writeOwnerRecord,
  migrateOwnerRecord
};

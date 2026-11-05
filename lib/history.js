'use strict';

// Server-side dictation history. Entries are kept in data/history.json so the
// same history appears in every browser signed in as the owner. Retention is
// the only cleanup rule: a session is removed once it is older than the chosen
// window, and one year is the hard ceiling.
const fs = require('fs');
const crypto = require('crypto');
const { writeFileAtomic } = require('./owner');

const RETENTION_OPTIONS = Object.freeze({
  '24h': { label: '24 hours', ms: 24 * 60 * 60 * 1000 },
  '30d': { label: '30 days', ms: 30 * 24 * 60 * 60 * 1000 },
  '1y':  { label: '1 year',  ms: 365 * 24 * 60 * 60 * 1000 }
});
const DEFAULT_RETENTION = '30d';
const MAX_RETENTION_MS = RETENTION_OPTIONS['1y'].ms;
const DEFAULT_MAX_CHARS = 50000;

function normalizeRetention(value) {
  return Object.prototype.hasOwnProperty.call(RETENTION_OPTIONS, value)
    ? value
    : DEFAULT_RETENTION;
}

function retentionWindowMs(retention) {
  return Math.min(RETENTION_OPTIONS[normalizeRetention(retention)].ms, MAX_RETENTION_MS);
}

function publicRetentionOptions() {
  return Object.keys(RETENTION_OPTIONS).map(value => ({
    value,
    label: RETENTION_OPTIONS[value].label
  }));
}

function emptyState() {
  return { retention: DEFAULT_RETENTION, entries: [] };
}

function normalizeStoredEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  if (typeof entry.raw !== 'string' || !entry.raw.trim()) return null;
  const createdAt = Number(entry.createdAt);
  if (!Number.isFinite(createdAt) || createdAt <= 0) return null;
  return {
    id: typeof entry.id === 'string' && entry.id ? entry.id : crypto.randomUUID(),
    createdAt,
    raw: entry.raw,
    cleaned: typeof entry.cleaned === 'string' ? entry.cleaned : '',
    originalRaw: typeof entry.originalRaw === 'string' ? entry.originalRaw : ''
  };
}

function readState(file) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return emptyState();
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return emptyState();
  const entries = Array.isArray(parsed.entries)
    ? parsed.entries.map(normalizeStoredEntry).filter(Boolean)
    : [];
  return {
    retention: normalizeRetention(parsed.retention),
    entries
  };
}

function writeState(file, state) {
  const safe = {
    retention: normalizeRetention(state.retention),
    entries: (state.entries || []).map(normalizeStoredEntry).filter(Boolean)
  };
  writeFileAtomic(file, JSON.stringify(safe, null, 2));
}

function createEntry(input, { now = Date.now(), maxChars = DEFAULT_MAX_CHARS, id } = {}) {
  const body = input || {};
  const raw = typeof body.raw === 'string' ? body.raw : '';
  if (!raw.trim()) throw new Error('No transcript to save.');
  for (const field of ['raw', 'cleaned', 'originalRaw']) {
    const value = body[field];
    if (typeof value === 'string' && value.length > maxChars) {
      throw new Error(`Transcript too long (max ${maxChars.toLocaleString()} characters).`);
    }
  }
  const requested = Number(body.createdAt);
  const createdAt = Number.isFinite(requested) && requested > 0
    ? Math.min(requested, now)
    : now;
  return {
    id: id || crypto.randomUUID(),
    createdAt,
    raw,
    cleaned: typeof body.cleaned === 'string' ? body.cleaned : '',
    originalRaw: typeof body.originalRaw === 'string' ? body.originalRaw : ''
  };
}

// A repeated POST is treated as the same session, so a failed migration can be
// retried without creating duplicate rows.
function findDuplicate(entries, entry) {
  return (entries || []).find(existing =>
    existing.createdAt === entry.createdAt &&
    existing.raw === entry.raw &&
    existing.cleaned === entry.cleaned
  ) || null;
}

function pruneEntries(entries, retention, now = Date.now()) {
  const cutoff = now - retentionWindowMs(retention);
  const kept = (entries || []).filter(entry =>
    Number.isFinite(entry.createdAt) && entry.createdAt >= cutoff
  );
  return { entries: kept, changed: kept.length !== (entries || []).length };
}

function readAndPrune(file, now = Date.now()) {
  const state = readState(file);
  const pruned = pruneEntries(state.entries, state.retention, now);
  state.entries = pruned.entries;
  if (pruned.changed) writeState(file, state);
  return state;
}

module.exports = {
  RETENTION_OPTIONS,
  DEFAULT_RETENTION,
  MAX_RETENTION_MS,
  DEFAULT_MAX_CHARS,
  normalizeRetention,
  retentionWindowMs,
  publicRetentionOptions,
  emptyState,
  readState,
  writeState,
  createEntry,
  findDuplicate,
  pruneEntries,
  readAndPrune
};

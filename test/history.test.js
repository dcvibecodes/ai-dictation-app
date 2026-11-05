'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const historyLib = require('../lib/history');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dictation-history-'));
  return path.join(dir, 'history.json');
}

function entry(id, createdAt, raw = 'hello') {
  return { id, createdAt, raw, cleaned: '', originalRaw: '' };
}

test('retention: only the three documented windows, default 30 days', () => {
  assert.deepEqual(historyLib.publicRetentionOptions().map(o => o.value), ['24h', '30d', '1y']);
  assert.equal(historyLib.normalizeRetention('24h'), '24h');
  assert.equal(historyLib.normalizeRetention('30d'), '30d');
  assert.equal(historyLib.normalizeRetention('1y'), '1y');
  assert.equal(historyLib.normalizeRetention('forever'), '30d');
  assert.equal(historyLib.retentionWindowMs('24h'), DAY);
  assert.equal(historyLib.retentionWindowMs('30d'), 30 * DAY);
  assert.equal(historyLib.retentionWindowMs('1y'), 365 * DAY);
  assert.equal(historyLib.retentionWindowMs('nonsense'), 30 * DAY);
});

test('createEntry: rejects empty text, clamps future timestamps, keeps both transcripts', () => {
  assert.throws(() => historyLib.createEntry({ raw: '   ' }), /No transcript/);
  assert.throws(() => historyLib.createEntry({}), /No transcript/);

  const created = historyLib.createEntry(
    { raw: 'original words', cleaned: 'cleaned words', originalRaw: 'provider words', createdAt: 5000 },
    { now: 1000, id: 'entry-1' }
  );
  assert.equal(created.id, 'entry-1');
  assert.equal(created.createdAt, 1000);
  assert.equal(created.raw, 'original words');
  assert.equal(created.cleaned, 'cleaned words');
  assert.equal(created.originalRaw, 'provider words');

  const tooLong = historyLib.createEntry({ raw: 'x'.repeat(10) }, { maxChars: 10 });
  assert.equal(tooLong.raw.length, 10);
  assert.throws(
    () => historyLib.createEntry({ raw: 'x'.repeat(11), cleaned: 'x'.repeat(11) }, { maxChars: 10 }),
    /too long/
  );
});

test('createEntry: defaults to now and empty optional fields', () => {
  const created = historyLib.createEntry({ raw: 'hello' }, { now: 1234, id: 'a' });
  assert.equal(created.createdAt, 1234);
  assert.equal(created.cleaned, '');
  assert.equal(created.originalRaw, '');
});

test('pruneEntries: removes sessions older than the chosen window', () => {
  const now = 100 * DAY;
  const entries = [
    entry('fresh', now - 1 * HOUR),
    entry('old', now - 25 * HOUR),
    entry('older', now - 400 * DAY)
  ];

  assert.deepEqual(
    historyLib.pruneEntries(entries, '24h', now).entries.map(e => e.id),
    ['fresh']
  );
  assert.deepEqual(
    historyLib.pruneEntries(entries, '30d', now).entries.map(e => e.id),
    ['fresh', 'old']
  );
  assert.deepEqual(
    historyLib.pruneEntries(entries, '1y', now).entries.map(e => e.id),
    ['fresh', 'old']
  );

  const boundary = historyLib.pruneEntries([entry('edge', now - DAY)], '24h', now);
  assert.equal(boundary.entries.length, 1);
  assert.equal(boundary.changed, false);
});

test('pruneEntries: one year is the hard ceiling', () => {
  const now = 500 * DAY;
  const entries = [entry('just-under', now - 364 * DAY), entry('past-year', now - 366 * DAY)];
  const result = historyLib.pruneEntries(entries, '1y', now);
  assert.deepEqual(result.entries.map(e => e.id), ['just-under']);
  assert.equal(result.changed, true);
});

test('readState: missing and corrupt files fall back to an empty state', () => {
  const file = tmpFile();
  assert.deepEqual(historyLib.readState(file), { retention: '30d', entries: [] });

  fs.writeFileSync(file, 'not json');
  assert.deepEqual(historyLib.readState(file), { retention: '30d', entries: [] });

  fs.writeFileSync(file, JSON.stringify(['wrong shape']));
  assert.deepEqual(historyLib.readState(file), { retention: '30d', entries: [] });
});

test('readState: keeps valid entries and drops malformed ones', () => {
  const file = tmpFile();
  fs.writeFileSync(file, JSON.stringify({
    retention: '24h',
    entries: [
      entry('ok', 1000, 'hello'),
      { id: 'blank', createdAt: 1000, raw: '   ' },
      { id: 'bad-time', createdAt: 'soon', raw: 'text' },
      null
    ]
  }));
  const state = historyLib.readState(file);
  assert.equal(state.retention, '24h');
  assert.deepEqual(state.entries.map(e => e.id), ['ok']);
});

test('writeState: round-trips and normalizes retention', () => {
  const file = tmpFile();
  historyLib.writeState(file, {
    retention: 'forever',
    entries: [{ id: 'one', createdAt: 1000, raw: 'hello', cleaned: 'Hello.' }]
  });
  const state = historyLib.readState(file);
  assert.equal(state.retention, '30d');
  assert.equal(state.entries.length, 1);
  assert.equal(state.entries[0].cleaned, 'Hello.');
});

test('readAndPrune: persists deletions so expired sessions are really removed', () => {
  const file = tmpFile();
  const now = 100 * DAY;
  historyLib.writeState(file, {
    retention: '24h',
    entries: [entry('fresh', now - HOUR), entry('expired', now - 2 * DAY)]
  });

  const state = historyLib.readAndPrune(file, now);
  assert.deepEqual(state.entries.map(e => e.id), ['fresh']);

  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(onDisk.entries.map(e => e.id), ['fresh']);
});

test('findDuplicate: matches the same session, not a different one', () => {
  const existing = entry('one', 1000, 'hello');
  existing.cleaned = 'Hello.';
  const entries = [existing];

  assert.equal(historyLib.findDuplicate(entries, { ...existing, id: 'other' }), existing);
  assert.equal(historyLib.findDuplicate(entries, { ...existing, createdAt: 2000 }), null);
  assert.equal(historyLib.findDuplicate(entries, { ...existing, raw: 'different' }), null);
});

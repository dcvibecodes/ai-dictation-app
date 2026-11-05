'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ProfilesUI = require('../public/lib/profiles-ui.js');

const labels = {
  'universal-streaming-english': {
    displayName: 'Universal-Streaming English',
    costLabel: '$0.15/hr of open-session time, incl idle',
    languageNote: 'English only. Cheapest live option.'
  },
  'universal-3-6-pro': {
    displayName: 'Universal-3.6 Pro Realtime',
    costLabel: '$0.45/hr of open-session time, incl idle',
    languageNote: '32 languages incl Hindi.'
  }
};

test('modelMeta: returns metadata only for known model IDs', () => {
  assert.equal(ProfilesUI.modelMeta(labels, 'universal-3-6-pro').displayName, 'Universal-3.6 Pro Realtime');
  assert.equal(ProfilesUI.modelMeta(labels, 'unknown-model'), null);
  assert.equal(ProfilesUI.modelMeta(null, 'universal-3-6-pro'), null);
  assert.equal(ProfilesUI.modelMeta(labels, ''), null);
});

test('modelLabel: always pairs the official name with the exact API ID', () => {
  assert.equal(
    ProfilesUI.modelLabel('universal-3-6-pro', ProfilesUI.modelMeta(labels, 'universal-3-6-pro')),
    'Universal-3.6 Pro Realtime (universal-3-6-pro)'
  );
  assert.equal(
    ProfilesUI.modelLabel('universal-streaming-english', ProfilesUI.modelMeta(labels, 'universal-streaming-english')),
    'Universal-Streaming English (universal-streaming-english)'
  );
  assert.equal(ProfilesUI.modelLabel('unknown-model', null), 'unknown-model');
  assert.equal(ProfilesUI.modelLabel('', null), '');
});

test('modelSubLabel: includes language note and cost basis', () => {
  assert.equal(
    ProfilesUI.modelSubLabel(labels['universal-streaming-english']),
    'English only. Cheapest live option. $0.15/hr of open-session time, incl idle'
  );
  assert.equal(
    ProfilesUI.modelSubLabel(labels['universal-3-6-pro']),
    '32 languages incl Hindi. $0.45/hr of open-session time, incl idle'
  );
  assert.equal(ProfilesUI.modelSubLabel(null), '');
});

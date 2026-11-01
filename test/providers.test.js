'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const providers = require('../lib/providers');

test('catalog: known providers, no dead Fireworks preset', () => {
  for (const id of ['openai', 'mistral', 'groq', 'gemini', 'elevenlabs', 'deepgram',
    'assemblyai', 'corti', 'cartesia', 'custom']) {
    assert.ok(providers.TRANSCRIPTION_PROVIDERS[id], `missing ${id}`);
  }
  assert.equal(providers.TRANSCRIPTION_PROVIDERS.fireworks, undefined);
});

test('migration maps saved base URLs back to presets', () => {
  assert.equal(providers.matchPreset('https://api.mistral.ai/v1/'), 'mistral');
  assert.equal(providers.matchPreset('https://api.groq.com/openai/v1'), 'groq');
  assert.equal(providers.matchPreset('http://localhost:8000/v1'), null);
});

test('migration converts legacy slots into profiles and removes them', () => {
  const raw = {
    TRANSCRIPTION_ENGINE: 'gemini',
    TRANSCRIPTION_API_KEY: 'sk-whisper',
    TRANSCRIPTION_BASE_URL: 'https://api.mistral.ai/v1',
    TRANSCRIPTION_MODEL: 'voxtral-mini-latest',
    GEMINI_TRANSCRIPTION_API_KEY: 'AIza-gemini',
    GEMINI_TRANSCRIPTION_MODEL: 'gemini-2.5-flash',
    CLEANUP_API_KEY: 'sk-clean',
    CLEANUP_BASE_URL: 'https://api.mistral.ai/v1',
    CLEANUP_MODEL: 'mistral-small-latest',
    TRANSCRIPTION_LANGUAGE: 'en',
    GLOSSARY: { keep: true }
  };
  const out = providers.migrateSettings(raw);

  assert.equal(out.TRANSCRIPTION_PROFILES.length, 2);
  const whisper = out.TRANSCRIPTION_PROFILES.find(p => p.id === 'prof_whisper');
  assert.equal(whisper.provider, 'mistral');
  assert.equal(whisper.baseUrl, '');
  assert.equal(whisper.apiKey, 'sk-whisper');
  assert.equal(out.ACTIVE_TRANSCRIPTION_PROFILE, 'prof_gemini');

  assert.equal(out.CLEANUP_PROFILES.length, 1);
  assert.equal(out.CLEANUP_PROFILES[0].provider, 'mistral');
  assert.equal(out.ACTIVE_CLEANUP_PROFILE, 'prof_cleanup');

  for (const key of ['TRANSCRIPTION_API_KEY', 'GEMINI_TRANSCRIPTION_API_KEY',
    'CLEANUP_API_KEY', 'TRANSCRIPTION_ENGINE', 'CLEANUP_BASE_URL']) {
    assert.equal(key in out, false, `${key} should be removed`);
  }
  // Global fields survive migration untouched.
  assert.equal(out.TRANSCRIPTION_LANGUAGE, 'en');
  assert.deepEqual(out.GLOSSARY, { keep: true });
});

test('migration is idempotent for already-migrated settings', () => {
  const already = {
    TRANSCRIPTION_PROFILES: [{ id: 'p1', provider: 'openai', apiKey: 'k', model: 'whisper-1' }],
    CLEANUP_PROFILES: []
  };
  const out = providers.migrateSettings(already);
  assert.deepEqual(out.TRANSCRIPTION_PROFILES, already.TRANSCRIPTION_PROFILES);
  assert.deepEqual(out.CLEANUP_PROFILES, []);
});

test('custom profiles keep their own URL; presets never use a stored one', () => {
  const custom = providers.resolveProfile({
    id: 'c', provider: 'custom', engine: 'whisper',
    baseUrl: 'http://my-server:8000/v1', model: 'whisper-1', apiKey: 'k'
  });
  assert.equal(custom.protocol, 'whisper');
  assert.equal(custom.baseUrl, 'http://my-server:8000/v1');

  const preset = providers.resolveProfile({
    id: 'p', provider: 'elevenlabs', baseUrl: 'http://evil.example', apiKey: 'k'
  });
  assert.equal(preset.protocol, 'elevenlabs');
  assert.equal(preset.baseUrl, 'https://api.elevenlabs.io');
});

test('public profile never exposes the API key', () => {
  const profile = { id: 'p', label: 'Mine', provider: 'openai', model: 'whisper-1', apiKey: 'sk-secret-1234' };
  const pub = providers.publicProfile(profile, 'transcription', 'p');
  assert.equal('apiKey' in pub, false);
  assert.equal(pub.maskedKey, '••••1234');
  assert.equal(pub.active, true);
  assert.ok(!JSON.stringify(pub).includes('sk-secret'));
});

test('active profile resolution requires a key and honours file over env', () => {
  const settings = {
    TRANSCRIPTION_PROFILES: [
      { id: 'a', provider: 'openai', model: 'whisper-1', apiKey: 'sk-a' },
      { id: 'b', provider: 'groq', model: 'whisper-large-v3', apiKey: '' }
    ],
    ACTIVE_TRANSCRIPTION_PROFILE: 'b'
  };
  assert.equal(providers.getActiveProfile(settings, 'transcription'), null);
  settings.ACTIVE_TRANSCRIPTION_PROFILE = 'a';
  assert.equal(providers.getActiveProfile(settings, 'transcription').provider, 'openai');
});

test('fallback only resolves when explicitly configured', () => {
  const settings = {
    TRANSCRIPTION_PROFILES: [
      { id: 'a', provider: 'openai', model: 'whisper-1', apiKey: 'sk-a' },
      { id: 'b', provider: 'groq', model: 'whisper-large-v3', apiKey: 'sk-b' }
    ],
    ACTIVE_TRANSCRIPTION_PROFILE: 'a'
  };
  assert.equal(providers.getFallbackProfile(settings), null);
  settings.FALLBACK_TRANSCRIPTION_PROFILE = 'b';
  assert.equal(providers.getFallbackProfile(settings).provider, 'groq');
});

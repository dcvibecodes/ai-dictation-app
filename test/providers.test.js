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

test('transcribe profiles are routed to the native Gemini provider', () => {
  const migrated = providers.migrateSettings({
    TRANSCRIPTION_PROFILES: [
      { id: 'a', provider: 'gemini', model: 'gemini-3.5-transcribe', apiKey: 'enc:v1:x' },
      { id: 'b', provider: 'gemini', model: 'gemini-2.5-flash', apiKey: 'enc:v1:y' }
    ],
    CLEANUP_PROFILES: []
  });
  assert.equal(migrated.TRANSCRIPTION_PROFILES[0].provider, 'gemini_transcribe');
  assert.equal(migrated.TRANSCRIPTION_PROFILES[1].provider, 'gemini');
  // Idempotent.
  const again = providers.migrateSettings(migrated);
  assert.equal(again.TRANSCRIPTION_PROFILES[0].provider, 'gemini_transcribe');
});

test('OpenCode Go is available as a cleanup-only preset', () => {
  const go = providers.CLEANUP_PROVIDERS.opencode_go;
  assert.ok(go);
  assert.equal(go.baseUrl, 'https://opencode.ai/inference/go/openai/v1');
  assert.equal(go.modelsUrl, 'https://opencode.ai/inference/go/v1/models');
  assert.ok(go.models.includes('glm-5.3-flash'));
  assert.equal(providers.TRANSCRIPTION_PROVIDERS.opencode_go, undefined);
});

test('model filtering removes noise and keeps the right family', () => {
  const raw = [
    'models/gemini-3.5-transcribe',
    'models/gemini-3.6-flash',
    'models/antigravity-preview-05-2026',
    'models/text-embedding-004',
    'models/imagen-4',
    'models/veo-3'
  ];
  assert.deepEqual(providers.filterModelIds('gemini', raw), ['gemini-3.6-flash']);
  assert.deepEqual(providers.filterModelIds('gemini_transcribe', raw), ['gemini-3.5-transcribe']);
  assert.deepEqual(providers.filterModelIds('openai', ['whisper-1', 'whisper-1', '']), ['whisper-1']);
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

test('live providers: one entry, a live flag switches protocol and keeps a batch fallback', () => {
  const cases = [
    ['assemblyai', 'assemblyai-stream', 'assemblyai'],
    ['elevenlabs', 'elevenlabs-stream', 'elevenlabs'],
    ['mistral', 'mistral-stream', 'whisper']
  ];
  for (const [provider, streamProtocol, batchProtocol] of cases) {
    const preset = providers.TRANSCRIPTION_PROVIDERS[provider];
    assert.ok(preset.stream, `missing stream config for ${provider}`);
    assert.equal(preset.stream.protocol, streamProtocol);
    assert.equal(preset.protocol, batchProtocol);

    const resolved = providers.resolveProfile({
      id: 'p', provider,
      model: preset.models[0],
      streamModel: preset.stream.models[0],
      live: true,
      apiKey: 'key'
    });
    assert.equal(resolved.protocol, streamProtocol);
    assert.equal(resolved.live, true);
    assert.equal(resolved.supportsStreaming, true);
    assert.notEqual(resolved.model, preset.models[0], 'live uses the stream model');

    const batch = providers.resolveBatchProfile(resolved);
    assert.equal(batch.protocol, batchProtocol);
    assert.equal(batch.model, preset.models[0]);
    assert.notEqual(batch.model, resolved.model);
  }
  const mistral = providers.resolveProfile({
    id: 'm', provider: 'mistral', model: 'voxtral-mini-latest',
    streamModel: 'voxtral-mini-transcribe-realtime-3', live: true, apiKey: 'key'
  }).batchFallback;
  assert.equal(mistral.baseUrl, 'https://api.mistral.ai/v1');
});

test('live off keeps the batch model and protocol', () => {
  const resolved = providers.resolveProfile({
    id: 'a', provider: 'assemblyai', model: 'universal-3-5-pro', live: false, apiKey: 'key'
  });
  assert.equal(resolved.protocol, 'assemblyai');
  assert.equal(resolved.supportsStreaming, false);
  assert.equal(resolved.batchFallback, null);
  assert.equal(resolved.modelMeta.displayName, 'Universal-3.5 Pro');
});

test('legacy __stream providers migrate into the parent entry with live on', () => {
  const settings = {
    TRANSCRIPTION_PROFILES: [
      { id: 'a', provider: 'assemblyai_stream', model: 'universal-streaming-english', apiKey: 'k' },
      { id: 'e', provider: 'elevenlabs_stream', model: 'scribe_v2_realtime', apiKey: 'k' },
      { id: 'm', provider: 'mistral_stream', model: 'voxtral-mini-transcribe-realtime-3', apiKey: 'k' }
    ],
    CLEANUP_PROFILES: []
  };
  const out = providers.migrateSettings(settings);
  const a = out.TRANSCRIPTION_PROFILES.find(p => p.id === 'a');
  assert.equal(a.provider, 'assemblyai');
  assert.equal(a.live, true);
  assert.equal(a.streamModel, 'universal-streaming-english');
  assert.ok(providers.TRANSCRIPTION_PROVIDERS.assemblyai.models.includes(a.model));

  const e = out.TRANSCRIPTION_PROFILES.find(p => p.id === 'e');
  assert.equal(e.provider, 'elevenlabs');
  assert.equal(e.live, true);
  assert.equal(e.streamModel, 'scribe_v2_realtime');

  const m = out.TRANSCRIPTION_PROFILES.find(p => p.id === 'm');
  assert.equal(m.provider, 'mistral');
  assert.equal(m.live, true);
  assert.equal(m.streamModel, 'voxtral-mini-transcribe-realtime-3');
  assert.equal(providers.TRANSCRIPTION_PROVIDERS.assemblyai_stream, undefined);
});

test('public profile exposes live, exact active model and both model labels', () => {
  const profile = {
    id: 'p', provider: 'assemblyai',
    model: 'universal-3-5-pro',
    streamModel: 'universal-streaming-english',
    live: true,
    apiKey: 'secret-key'
  };
  const pub = providers.publicProfile(profile, 'transcription', 'p');
  assert.equal(pub.live, true);
  assert.equal(pub.supportsLive, true);
  assert.equal(pub.model, 'universal-streaming-english');
  assert.equal(pub.batchModel, 'universal-3-5-pro');
  assert.equal(pub.streamModel, 'universal-streaming-english');
  assert.equal(pub.modelMeta.displayName, 'Universal-Streaming English');
  assert.equal(pub.batchModelMeta.displayName, 'Universal-3.5 Pro');
  assert.equal(pub.batchFallback.model, 'universal-3-5-pro');
  assert.equal(JSON.stringify(pub).includes('secret-key'), false);
});

test('AssemblyAI live models: official labels, exact IDs, no invented versions', () => {
  const preset = providers.TRANSCRIPTION_PROVIDERS.assemblyai;
  assert.deepEqual(preset.stream.models, [
    'universal-streaming-english',
    'universal-streaming-multilingual',
    'universal-3-6-pro'
  ]);
  assert.equal(preset.stream.models.includes('universal-3-5-pro'), false);
  assert.deepEqual(preset.stream.modelLabels['universal-streaming-english'], {
    displayName: 'Universal-Streaming English',
    costLabel: '$0.15/hr of open-session time, incl idle',
    languageNote: 'English only. Cheapest live option.'
  });
  assert.deepEqual(preset.stream.modelLabels['universal-3-6-pro'], {
    displayName: 'Universal-3.6 Pro Realtime',
    costLabel: '$0.45/hr of open-session time, incl idle',
    languageNote: '32 languages incl Hindi.'
  });
});

test('every curated model has a display name and a price/basis label', () => {
  for (const [id, preset] of Object.entries(providers.TRANSCRIPTION_PROVIDERS)) {
    if (id === 'custom' || id === 'openrouter') continue;
    for (const model of preset.models) {
      const meta = preset.modelLabels && preset.modelLabels[model];
      assert.ok(meta && meta.displayName, `${id}/${model} missing display name`);
      assert.ok(meta.costLabel, `${id}/${model} missing cost label`);
    }
    if (preset.stream) {
      for (const model of preset.stream.models) {
        const meta = preset.stream.modelLabels && preset.stream.modelLabels[model];
        assert.ok(meta && meta.displayName, `${id} live/${model} missing display name`);
        assert.ok(meta.costLabel, `${id} live/${model} missing cost label`);
      }
    }
  }
});

test('Cartesia is streaming-only: Live is on and locked', () => {
  const stored = { id: 'c', provider: 'cartesia', model: 'ink-2', apiKey: 'k' };
  const resolved = providers.resolveProfile(stored);
  assert.equal(resolved.protocol, 'cartesia');
  assert.equal(resolved.live, true);
  assert.equal(resolved.supportsStreaming, true);
  const pub = providers.publicProfile(stored, 'transcription', 'c');
  assert.equal(pub.live, true);
  assert.equal(pub.supportsLive, true);
  assert.equal(pub.liveLocked, true);
  assert.equal(pub.model, 'ink-2');
  assert.equal(pub.supportsStreaming, true);
});

'use strict';

// Voice-model metadata. Prices are public list rates checked on 5 Nov 2026
// (sources noted per provider) and are display-only. Keep the exact API IDs as
// object keys: those are the values sent to the provider.
const OPENAI_MODELS = {
  'gpt-transcribe': {
    displayName: 'GPT Transcribe',
    costLabel: '$0.0045/min ($0.27/hr)'
  },
  'gpt-4o-transcribe': {
    displayName: 'GPT-4o Transcribe',
    costLabel: '$0.006/min ($0.36/hr); removed Feb 2027'
  },
  'gpt-4o-mini-transcribe': {
    displayName: 'GPT-4o Mini Transcribe',
    costLabel: '$0.003/min ($0.18/hr); removed Feb 2027'
  },
  'gpt-4o-transcribe-diarize': {
    displayName: 'GPT-4o Transcribe Diarize',
    costLabel: '$0.006/min; speaker labels; removed Feb 2027'
  },
  'whisper-1': {
    displayName: 'Whisper',
    costLabel: '$0.006/min ($0.36/hr); removed Feb 2027'
  }
};

// https://docs.mistral.ai/inference/pricing (5 Nov 2026)
const MISTRAL_MODELS = {
  'voxtral-mini-transcribe-3-0': {
    displayName: 'Voxtral Mini Transcribe 3',
    costLabel: '$0.0035/min'
  },
  'voxtral-small-transcribe-3-0': {
    displayName: 'Voxtral Small Transcribe 3',
    costLabel: '$0.004/min'
  },
  'voxtral-mini-latest': {
    displayName: 'Voxtral Mini (legacy alias)',
    costLabel: '$0.003/min'
  },
  'voxtral-small-latest': {
    displayName: 'Voxtral Small (legacy alias)',
    costLabel: '$0.004/min'
  }
};
const MISTRAL_STREAM_MODELS = {
  'voxtral-mini-transcribe-realtime-3': {
    displayName: 'Voxtral Mini Transcribe Realtime 3',
    costLabel: '$0.008/min'
  },
  'voxtral-mini-transcribe-realtime-3-0': {
    displayName: 'Voxtral Mini Transcribe Realtime 3.0',
    costLabel: '$0.008/min'
  }
};

// https://console.groq.com/docs/speech-to-text (5 Nov 2026)
const GROQ_MODELS = {
  'whisper-large-v3-turbo': {
    displayName: 'Whisper Large v3 Turbo',
    costLabel: '$0.04/hr',
    languageNote: 'Fastest Groq option.'
  },
  'whisper-large-v3': {
    displayName: 'Whisper Large v3',
    costLabel: '$0.111/hr',
    languageNote: 'Higher accuracy; translation supported.'
  }
};

// https://ai.google.dev/gemini-api/docs/pricing (5 Nov 2026)
const GEMINI_MODELS = {
  'gemini-3.8-flash': {
    displayName: 'Gemini 3.8 Flash',
    costLabel: '$0.75/1M input tokens (intro through Dec 2026)'
  },
  'gemini-3.6-flash': {
    displayName: 'Gemini 3.6 Flash',
    costLabel: '$0.75/1M input tokens (intro through Dec 2026)'
  },
  'gemini-3.5-flash-lite': {
    displayName: 'Gemini 3.5 Flash-Lite',
    costLabel: '$0.30/1M input tokens'
  },
  'gemini-2.5-flash': {
    displayName: 'Gemini 2.5 Flash',
    costLabel: '$1.00/1M audio input tokens'
  },
  'gemini-2.5-flash-lite': {
    displayName: 'Gemini 2.5 Flash-Lite',
    costLabel: '$0.30/1M audio input tokens'
  }
};
const GEMINI_TRANSCRIBE_MODELS = {
  'gemini-3.5-transcribe': {
    displayName: 'Gemini 3.5 Transcribe',
    costLabel: '~$0.005/min blended ($0.003 audio + $0.002 text)'
  }
};

// https://elevenlabs.io/pricing/api (5 Nov 2026)
const ELEVENLABS_MODELS = {
  'scribe_v2': {
    displayName: 'Scribe v2',
    costLabel: '$0.22/hr'
  },
  'scribe_v2_medical': {
    displayName: 'Scribe v2 Medical',
    costLabel: '$0.22/hr; clinical audio'
  }
};
const ELEVENLABS_STREAM_MODELS = {
  'scribe_v2_realtime': {
    displayName: 'Scribe v2 Realtime',
    costLabel: '$0.39/hr'
  }
};

// https://deepgram.com/pricing (5 Nov 2026)
const DEEPGRAM_MODELS = {
  'nova-3': {
    displayName: 'Nova-3',
    costLabel: '$0.0043/min pre-recorded (Pay As You Go)'
  },
  'nova-3-medical': {
    displayName: 'Nova-3 Medical',
    costLabel: 'Medical model; see Deepgram pricing',
    languageNote: 'English medical audio.'
  },
  'nova-2': {
    displayName: 'Nova-2',
    costLabel: 'Legacy model; see Deepgram pricing'
  },
  'whisper-large': {
    displayName: 'Whisper Large (Deepgram Cloud)',
    costLabel: '$0.0048/min pre-recorded'
  }
};

// https://docs.cohere.com/docs/transcribe (5 Nov 2026)
const COHERE_MODELS = {
  'cohere-transcribe-03-2026': {
    displayName: 'Cohere Transcribe',
    costLabel: 'Free trial key; production via Model Vault (hourly instance)',
    languageNote: '14 languages.'
  },
  'cohere-transcribe-arabic-07-2026': {
    displayName: 'Cohere Transcribe Arabic',
    costLabel: 'Free trial key; production via Model Vault (hourly instance)',
    languageNote: 'Arabic + English.'
  }
};

// https://www.assemblyai.com/pricing (5 Nov 2026)
const ASSEMBLYAI_MODELS = {
  'universal-3-5-pro': {
    displayName: 'Universal-3.5 Pro',
    costLabel: '$0.21/hr pre-recorded'
  },
  'universal-2': {
    displayName: 'Universal-2',
    costLabel: '$0.15/hr pre-recorded'
  },
  'default': {
    displayName: 'Account default',
    costLabel: 'Model varies — pin one for a known price'
  }
};
const ASSEMBLYAI_STREAM_MODELS = {
  'universal-streaming-english': {
    displayName: 'Universal-Streaming English',
    costLabel: '$0.15/hr of open-session time, incl idle',
    languageNote: 'English only. Cheapest live option.'
  },
  'universal-streaming-multilingual': {
    displayName: 'Universal-Streaming Multilingual',
    costLabel: '$0.15/hr of open-session time, incl idle',
    languageNote: 'EN/ES/DE/FR/PT/IT only, no Hindi.'
  },
  'universal-3-6-pro': {
    displayName: 'Universal-3.6 Pro Realtime',
    costLabel: '$0.45/hr of open-session time, incl idle',
    languageNote: '32 languages incl Hindi.'
  }
};

// https://www.corti.ai/pricing (5 Nov 2026)
const CORTI_MODELS = {
  'base': {
    displayName: 'Base medical ASR',
    costLabel: '$0.0065/min'
  },
  'latest': {
    displayName: 'Latest medical ASR',
    costLabel: '$0.0065/min'
  }
};

// https://www.cartesia.ai/pricing and https://docs.cartesia.ai/pricing (5 Nov 2026)
const CARTESIA_MODELS = {
  'ink-2': {
    displayName: 'Ink-2',
    costLabel: '$0.39/hr on Scale (3 credits/sec)',
    languageNote: 'EN, ES, FR, HI, JA.'
  },
  'ink-whisper': {
    displayName: 'Ink-Whisper',
    costLabel: '~$0.13/hr on Scale (1 credit/sec)'
  }
};

// Provider catalog — the one place provider metadata lives. `protocol` selects
// the code path; `tier` communicates implementation order. Base URLs live here
// and nowhere else, so the UI never has to show one for a known provider.
// `stream` marks a provider that can run in Live mode from the same entry.
const TRANSCRIPTION_PROVIDERS = {
  // Tier 0: existing code paths; a preset is pure configuration.
  openai: {
    name: 'OpenAI', protocol: 'whisper', tier: 0,
    baseUrl: 'https://api.openai.com/v1',
    models: Object.keys(OPENAI_MODELS),
    modelLabels: OPENAI_MODELS,
    keyUrl: 'https://platform.openai.com/api-keys'
  },
  mistral: {
    name: 'Mistral AI', protocol: 'whisper', tier: 0,
    baseUrl: 'https://api.mistral.ai/v1',
    models: Object.keys(MISTRAL_MODELS),
    modelLabels: MISTRAL_MODELS,
    stream: {
      protocol: 'mistral-stream',
      models: Object.keys(MISTRAL_STREAM_MODELS),
      modelLabels: MISTRAL_STREAM_MODELS
    },
    keyUrl: 'https://console.mistral.ai/api-keys'
  },
  groq: {
    name: 'Groq', protocol: 'whisper', tier: 0,
    baseUrl: 'https://api.groq.com/openai/v1',
    models: Object.keys(GROQ_MODELS),
    modelLabels: GROQ_MODELS,
    keyUrl: 'https://console.groq.com/keys'
  },
  gemini: {
    name: 'Google Gemini', protocol: 'gemini', tier: 0,
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    models: Object.keys(GEMINI_MODELS),
    modelLabels: GEMINI_MODELS,
    keyUrl: 'https://aistudio.google.com/apikey'
  },
  gemini_transcribe: {
    name: 'Google Gemini Transcribe', protocol: 'gemini-transcribe', tier: 0,
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    models: Object.keys(GEMINI_TRANSCRIBE_MODELS),
    modelLabels: GEMINI_TRANSCRIBE_MODELS,
    keyUrl: 'https://aistudio.google.com/apikey'
  },
  openrouter: {
    name: 'OpenRouter', protocol: 'whisper', tier: 0,
    baseUrl: 'https://openrouter.ai/api/v1',
    models: [],
    keyUrl: 'https://openrouter.ai/keys'
  },

  // Tier 1: one-call native adapters.
  elevenlabs: {
    name: 'ElevenLabs', protocol: 'elevenlabs', tier: 1,
    baseUrl: 'https://api.elevenlabs.io',
    models: Object.keys(ELEVENLABS_MODELS),
    modelLabels: ELEVENLABS_MODELS,
    stream: {
      protocol: 'elevenlabs-stream',
      models: Object.keys(ELEVENLABS_STREAM_MODELS),
      modelLabels: ELEVENLABS_STREAM_MODELS
    },
    keyUrl: 'https://elevenlabs.io/app/settings/api-keys'
  },
  deepgram: {
    name: 'Deepgram', protocol: 'deepgram', tier: 1,
    baseUrl: 'https://api.deepgram.com',
    models: Object.keys(DEEPGRAM_MODELS),
    modelLabels: DEEPGRAM_MODELS,
    keyUrl: 'https://console.deepgram.com'
  },
  cohere: {
    name: 'Cohere', protocol: 'cohere', tier: 1,
    baseUrl: 'https://api.cohere.com',
    models: Object.keys(COHERE_MODELS),
    modelLabels: COHERE_MODELS,
    keyUrl: 'https://dashboard.cohere.com/api-keys'
  },

  // Tier 2: multi-step adapters (submit + poll).
  assemblyai: {
    name: 'AssemblyAI', protocol: 'assemblyai', tier: 2,
    baseUrl: 'https://api.assemblyai.com',
    models: Object.keys(ASSEMBLYAI_MODELS),
    modelLabels: ASSEMBLYAI_MODELS,
    stream: {
      protocol: 'assemblyai-stream',
      models: Object.keys(ASSEMBLYAI_STREAM_MODELS),
      modelLabels: ASSEMBLYAI_STREAM_MODELS
    },
    keyUrl: 'https://www.assemblyai.com/app'
  },
  corti: {
    name: 'Corti', protocol: 'corti', tier: 2,
    baseUrl: 'https://api.corti.ai',
    models: Object.keys(CORTI_MODELS),
    modelLabels: CORTI_MODELS,
    keyUrl: 'https://console.corti.app'
  },

  // Tier 3: WebSocket streaming.
  cartesia: {
    name: 'Cartesia', protocol: 'cartesia', tier: 3,
    baseUrl: 'wss://api.cartesia.ai',
    models: Object.keys(CARTESIA_MODELS),
    modelLabels: CARTESIA_MODELS,
    keyUrl: 'https://play.cartesia.ai/keys'
  },

  custom: {
    name: 'Custom (OpenAI-compatible)', protocol: 'whisper', tier: 0,
    models: []
  }
  // Fireworks AI is intentionally absent: its audio transcription API was
  // deprecated in June 2026, so a preset would be dead on arrival.
};

const STREAM_PROTOCOLS = new Set([
  'cartesia',
  'assemblyai-stream',
  'elevenlabs-stream',
  'mistral-stream'
]);

function isStreamingProtocol(protocol) {
  return STREAM_PROTOCOLS.has(protocol);
}

const CLEANUP_PROVIDERS = {
  openai: { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', models: ['gpt-4.1-mini', 'gpt-4o-mini'] },
  gemini: { name: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', models: ['gemini-2.5-flash', 'gemini-2.5-flash-lite'] },
  mistral: { name: 'Mistral AI', baseUrl: 'https://api.mistral.ai/v1', models: ['mistral-small-latest', 'mistral-large-latest'] },
  groq: { name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', models: ['llama-3.3-70b-versatile'] },
  openrouter: { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', models: [] },
  deepseek: { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', models: ['deepseek-chat'] },
  xai: { name: 'xAI (Grok)', baseUrl: 'https://api.x.ai/v1', models: ['grok-3-mini'] },
  opencode_go: {
    name: 'OpenCode Go',
    baseUrl: 'https://opencode.ai/inference/go/openai/v1',
    modelsUrl: 'https://opencode.ai/inference/go/v1/models',
    models: ['glm-5.3-flash', 'deepseek-v4.1-flash', 'longcat-2.0', 'mimo-v2.6-flash', 'minimax-m3.1-flash', 'kimi-k3']
  },
  custom: { name: 'Custom (OpenAI-compatible)', models: [] }
};

const TRANSCRIPTION_KEYS = ['TRANSCRIPTION_API_KEY', 'TRANSCRIPTION_BASE_URL', 'TRANSCRIPTION_MODEL'];
const GEMINI_KEYS = ['GEMINI_TRANSCRIPTION_API_KEY', 'GEMINI_TRANSCRIPTION_BASE_URL', 'GEMINI_TRANSCRIPTION_MODEL'];
const CLEANUP_KEYS = ['CLEANUP_API_KEY', 'CLEANUP_BASE_URL', 'CLEANUP_MODEL'];
const LEGACY_KEYS = [...TRANSCRIPTION_KEYS, ...GEMINI_KEYS, ...CLEANUP_KEYS, 'TRANSCRIPTION_ENGINE'];

function normalizeBaseUrl(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

function matchPreset(baseUrl, catalog = TRANSCRIPTION_PROVIDERS) {
  const target = normalizeBaseUrl(baseUrl);
  if (!target) return null;
  for (const [id, preset] of Object.entries(catalog)) {
    if (id === 'custom' || !preset.baseUrl) continue;
    if (normalizeBaseUrl(preset.baseUrl) === target) return id;
  }
  return null;
}

function maskKey(key) {
  if (!key) return '';
  return '••••' + String(key).slice(-4);
}

function makeId(prefix, existing) {
  let n = 1;
  let id = `${prefix}_${n}`;
  const taken = new Set(existing || []);
  while (taken.has(id)) { n++; id = `${prefix}_${n}`; }
  return id;
}

// Model lists returned by providers are noisy (internal previews, embeddings,
// image/video models). Keep only plausible transcription/chat models and let
// the curated catalog go first.
const MODEL_DENY = [
  /embedding/i, /\baqa\b/i, /imagen/i, /\bveo\b/i, /\btts\b/i,
  /robotics/i, /antigravity/i, /nano-banana/i, /learnlm/i
];

function filterModelIds(providerId, ids) {
  const out = [];
  for (const raw of ids || []) {
    if (!raw) continue;
    const id = String(raw).trim().replace(/^models\//, '');
    if (!id) continue;
    if (MODEL_DENY.some(re => re.test(id))) continue;
    if (providerId === 'gemini_transcribe' && !/transcribe/i.test(id)) continue;
    if (providerId === 'gemini' && /transcribe/i.test(id)) continue;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

// Existing installs may have created a profile on the chat Gemini provider with
// a transcribe model. Route those to the native transcribe protocol on every
// load (idempotent).
const LEGACY_STREAM_PROVIDERS = {
  assemblyai_stream: { provider: 'assemblyai', engine: 'assemblyai' },
  elevenlabs_stream: { provider: 'elevenlabs', engine: 'elevenlabs' },
  mistral_stream: { provider: 'mistral', engine: 'whisper' }
};

function normalizeProfileProviders(settings) {
  if (!settings || !Array.isArray(settings.TRANSCRIPTION_PROFILES)) return settings;
  for (const p of settings.TRANSCRIPTION_PROFILES) {
    if (p.provider === 'gemini' && /transcribe/i.test(p.model || '')) {
      p.provider = 'gemini_transcribe';
      p.baseUrl = '';
      p.engine = 'gemini-transcribe';
    }
    // 7.2.0 shipped separate "__stream" providers. Fold them into the parent
    // provider with Live enabled, keeping the old stream model and choosing a
    // valid batch model for recorded files.
    const legacy = LEGACY_STREAM_PROVIDERS[p.provider];
    if (legacy) {
      const preset = TRANSCRIPTION_PROVIDERS[legacy.provider];
      p.streamModel = p.streamModel || p.model || (preset.stream && preset.stream.models[0]) || '';
      p.provider = legacy.provider;
      p.baseUrl = '';
      p.engine = legacy.engine;
      p.live = true;
      if (!p.model || !preset.models.includes(p.model)) p.model = preset.models[0];
    }
    const preset = TRANSCRIPTION_PROVIDERS[p.provider];
    if (preset && preset.stream) {
      if (typeof p.live !== 'boolean') p.live = false;
      if (!p.streamModel || !preset.stream.models.includes(p.streamModel)) {
        p.streamModel = p.streamModel || preset.stream.models[0];
      }
    }
    if (preset && preset.protocol === 'cartesia') p.live = true;
  }
  return settings;
}

/**
 * Convert legacy single-slot settings into profile lists.
 * Mutates a copy, never the input.
 */
function migrateSettings(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const out = { ...raw };
  const already = Array.isArray(out.TRANSCRIPTION_PROFILES) && Array.isArray(out.CLEANUP_PROFILES);
  if (already) {
    for (const key of LEGACY_KEYS) delete out[key];
    return normalizeProfileProviders(out);
  }

  const profiles = [];
  if (Array.isArray(out.TRANSCRIPTION_PROFILES)) profiles.push(...out.TRANSCRIPTION_PROFILES);

  if (!Array.isArray(out.TRANSCRIPTION_PROFILES) && out.TRANSCRIPTION_API_KEY) {
    const preset = matchPreset(out.TRANSCRIPTION_BASE_URL);
    profiles.push({
      id: 'prof_whisper',
      label: out.TRANSCRIPTION_MODEL || (preset ? TRANSCRIPTION_PROVIDERS[preset].name : 'Whisper-compatible'),
      provider: preset || 'custom',
      engine: 'whisper',
      baseUrl: preset ? '' : (out.TRANSCRIPTION_BASE_URL || ''),
      model: out.TRANSCRIPTION_MODEL || '',
      apiKey: out.TRANSCRIPTION_API_KEY
    });
  }
  if (!Array.isArray(out.TRANSCRIPTION_PROFILES) && out.GEMINI_TRANSCRIPTION_API_KEY) {
    profiles.push({
      id: 'prof_gemini',
      label: out.GEMINI_TRANSCRIPTION_MODEL || 'Gemini',
      provider: 'gemini',
      model: out.GEMINI_TRANSCRIPTION_MODEL || 'gemini-2.5-flash',
      apiKey: out.GEMINI_TRANSCRIPTION_API_KEY
    });
  }

  const cleanupProfiles = Array.isArray(out.CLEANUP_PROFILES) ? [...out.CLEANUP_PROFILES] : [];
  if (!Array.isArray(out.CLEANUP_PROFILES) && out.CLEANUP_API_KEY) {
    const preset = matchPreset(out.CLEANUP_BASE_URL, CLEANUP_PROVIDERS);
    cleanupProfiles.push({
      id: 'prof_cleanup',
      label: out.CLEANUP_MODEL || (preset ? CLEANUP_PROVIDERS[preset].name : 'Cleanup'),
      provider: preset || 'custom',
      baseUrl: preset ? '' : (out.CLEANUP_BASE_URL || ''),
      model: out.CLEANUP_MODEL || '',
      apiKey: out.CLEANUP_API_KEY
    });
  }

  const idOf = (arr, predicate) => {
    const found = arr.find(predicate);
    return found ? found.id : (arr[0] ? arr[0].id : null);
  };

  out.TRANSCRIPTION_PROFILES = profiles;
  if (!out.ACTIVE_TRANSCRIPTION_PROFILE) {
    if (!profiles.length) out.ACTIVE_TRANSCRIPTION_PROFILE = null;
    else if (out.TRANSCRIPTION_ENGINE === 'gemini') {
      out.ACTIVE_TRANSCRIPTION_PROFILE = idOf(profiles, p => p.provider === 'gemini') || profiles[0].id;
    } else {
      out.ACTIVE_TRANSCRIPTION_PROFILE = idOf(profiles, p => p.provider !== 'gemini') || profiles[0].id;
    }
  }

  out.CLEANUP_PROFILES = cleanupProfiles;
  if (!out.ACTIVE_CLEANUP_PROFILE) {
    const existing = out.FALLBACK_ACTIVE_CLEANUP_PROFILE;
    out.ACTIVE_CLEANUP_PROFILE = existing && cleanupProfiles.some(p => p.id === existing)
      ? existing
      : (cleanupProfiles[0] ? cleanupProfiles[0].id : null);
  }

  for (const key of LEGACY_KEYS) delete out[key];
  return normalizeProfileProviders(out);
}

function profileCatalog(kind) {
  return kind === 'cleanup' ? CLEANUP_PROVIDERS : TRANSCRIPTION_PROVIDERS;
}

/**
 * Resolve a stored profile into everything dispatch needs: protocol, base URL
 * and key. Custom profiles carry their own endpoint; known providers never do.
 */
function resolveProfile(profile, kind = 'transcription') {
  if (!profile) return null;
  const catalog = profileCatalog(kind);
  const provider = profile.provider || 'custom';
  const preset = catalog[provider] || {};
  const isCustom = provider === 'custom' || (!preset.protocol && !preset.baseUrl);
  const baseUrl = isCustom
    ? normalizeBaseUrl(profile.baseUrl || '')
    : normalizeBaseUrl(preset.baseUrl || '');

  let protocol;
  let model = profile.model || '';
  let modelMeta = null;
  let live = false;
  let batchFallback = null;

  if (kind === 'cleanup') {
    protocol = 'chat';
  } else if (isCustom) {
    protocol = profile.engine || 'whisper';
  } else if (preset.stream && profile.live === true) {
    // Live mode from the same provider entry. Recorded files keep a valid batch
    // model, so switching Live off never leaves the profile unusable.
    live = true;
    protocol = preset.stream.protocol;
    model = profile.streamModel || preset.stream.models[0] || '';
    modelMeta = (preset.stream.modelLabels && preset.stream.modelLabels[model]) || null;
    batchFallback = {
      protocol: preset.protocol,
      model: profile.model || preset.models[0] || '',
      baseUrl: preset.baseUrl || '',
      providerName: preset.name
    };
  } else {
    protocol = preset.protocol || 'whisper';
    model = profile.model || preset.models[0] || '';
    modelMeta = (preset.modelLabels && preset.modelLabels[model]) || null;
    // Cartesia is streaming-only, so it is always "live".
    live = isStreamingProtocol(protocol);
  }

  const supportsStreaming = isStreamingProtocol(protocol) || !!batchFallback;
  return {
    ...profile,
    provider,
    protocol,
    model,
    baseUrl,
    providerName: preset.name || 'Custom',
    keyUrl: preset.keyUrl || '',
    supportsStreaming,
    live,
    batchFallback,
    modelMeta
  };
}

// A streaming profile still needs a valid batch model for recorded files. The
// stream model IDs are not accepted by the batch endpoints, so swap to the
// declared fallback before the batch dispatch.
function resolveBatchProfile(profile) {
  if (!profile) return null;
  if (!profile.batchFallback || !isStreamingProtocol(profile.protocol)) return profile;
  return {
    ...profile,
    protocol: profile.batchFallback.protocol,
    model: profile.batchFallback.model,
    baseUrl: profile.batchFallback.baseUrl || profile.baseUrl
  };
}

function findProfile(settings, kind, id) {
  const list = kind === 'cleanup' ? settings.CLEANUP_PROFILES : settings.TRANSCRIPTION_PROFILES;
  if (!Array.isArray(list)) return null;
  return list.find(p => p.id === id) || null;
}

function getActiveProfile(settings, kind = 'transcription') {
  if (!settings) return null;
  const id = kind === 'cleanup'
    ? settings.ACTIVE_CLEANUP_PROFILE
    : settings.ACTIVE_TRANSCRIPTION_PROFILE;
  const profile = id ? findProfile(settings, kind, id) : null;
  if (profile && profile.apiKey) return resolveProfile(profile, kind);
  return null;
}

function getFallbackProfile(settings) {
  if (!settings) return null;
  const id = settings.FALLBACK_TRANSCRIPTION_PROFILE;
  if (!id) return null;
  const profile = findProfile(settings, 'transcription', id);
  if (!profile || !profile.apiKey) return null;
  return resolveProfile(profile, 'transcription');
}

/** Public (browser-safe) view: never include apiKey. */
function publicProfile(profile, kind, activeId) {
  if (!profile) return null;
  const resolved = resolveProfile(profile, kind);
  const preset = profileCatalog(kind)[resolved.provider] || {};
  const batchModel = profile.model || (preset.models && preset.models[0]) || '';
  const streamModel = profile.streamModel || (preset.stream && preset.stream.models[0]) || '';
  const alwaysLive = !!(preset.protocol === 'cartesia' && !preset.stream);
  return {
    id: profile.id,
    label: profile.label || resolved.providerName,
    provider: resolved.provider,
    providerName: resolved.providerName,
    protocol: resolved.protocol,
    tier: preset.tier == null ? 0 : preset.tier,
    model: resolved.model || '',
    batchModel,
    streamModel,
    live: !!resolved.live,
    supportsLive: !!preset.stream || alwaysLive,
    liveLocked: alwaysLive,
    engine: resolved.protocol,
    baseUrl: resolved.provider === 'custom' ? (profile.baseUrl || '') : '',
    keyUrl: preset.keyUrl || '',
    maskedKey: maskKey(profile.apiKey),
    hasKey: !!profile.apiKey,
    supportsStreaming: !!resolved.supportsStreaming,
    modelMeta: resolved.modelMeta || null,
    batchModelMeta: (preset.modelLabels && preset.modelLabels[batchModel]) || null,
    streamModelMeta: (preset.stream && preset.stream.modelLabels && preset.stream.modelLabels[streamModel]) || null,
    batchFallback: resolved.batchFallback
      ? {
          protocol: resolved.batchFallback.protocol,
          model: resolved.batchFallback.model,
          providerName: resolved.batchFallback.providerName || resolved.providerName
        }
      : null,
    active: profile.id === activeId
  };
}

function publicSettings(settings) {
  const transcriptionActive = settings.ACTIVE_TRANSCRIPTION_PROFILE || null;
  const cleanupActive = settings.ACTIVE_CLEANUP_PROFILE || null;
  return {
    transcriptionProfiles: (settings.TRANSCRIPTION_PROFILES || [])
      .map(p => publicProfile(p, 'transcription', transcriptionActive)),
    cleanupProfiles: (settings.CLEANUP_PROFILES || [])
      .map(p => publicProfile(p, 'cleanup', cleanupActive)),
    activeTranscriptionProfile: transcriptionActive,
    activeCleanupProfile: cleanupActive,
    fallbackTranscriptionProfile: settings.FALLBACK_TRANSCRIPTION_PROFILE || null,
    transcriptionLanguage: settings.TRANSCRIPTION_LANGUAGE || '',
    transcriptionHint: settings.TRANSCRIPTION_PROMPT || '',
    transcriptionProviders: Object.fromEntries(Object.entries(TRANSCRIPTION_PROVIDERS).map(([id, p]) => [id, {
      id, name: p.name, protocol: p.protocol, tier: p.tier,
      models: p.models || [], keyUrl: p.keyUrl || '',
      hasBaseUrl: !!p.baseUrl,
      supportsStreaming: isStreamingProtocol(p.protocol) || !!p.stream,
      modelLabels: p.modelLabels || null,
      stream: p.stream
        ? {
            protocol: p.stream.protocol,
            models: p.stream.models || [],
            modelLabels: p.stream.modelLabels || null
          }
        : null
    }])),
    cleanupProviders: Object.fromEntries(Object.entries(CLEANUP_PROVIDERS).map(([id, p]) => [id, {
      id, name: p.name, models: p.models || []
    }]))
  };
}

module.exports = {
  TRANSCRIPTION_PROVIDERS,
  CLEANUP_PROVIDERS,
  profileCatalog,
  normalizeBaseUrl,
  matchPreset,
  maskKey,
  makeId,
  filterModelIds,
  normalizeProfileProviders,
  migrateSettings,
  resolveProfile,
  resolveBatchProfile,
  isStreamingProtocol,
  STREAM_PROTOCOLS,
  findProfile,
  getActiveProfile,
  getFallbackProfile,
  publicProfile,
  publicSettings
};

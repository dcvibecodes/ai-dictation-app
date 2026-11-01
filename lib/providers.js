'use strict';

// Provider catalog — the one place provider metadata lives. `protocol` selects
// the code path; `tier` communicates implementation order. Base URLs live here
// and nowhere else, so the UI never has to show one for a known provider.
const TRANSCRIPTION_PROVIDERS = {
  // Tier 0: existing code paths; a preset is pure configuration.
  openai: {
    name: 'OpenAI', protocol: 'whisper', tier: 0,
    baseUrl: 'https://api.openai.com/v1',
    models: ['whisper-1', 'gpt-4o-transcribe', 'gpt-4o-mini-transcribe'],
    keyUrl: 'https://platform.openai.com/api-keys'
  },
  mistral: {
    name: 'Mistral AI', protocol: 'whisper', tier: 0,
    baseUrl: 'https://api.mistral.ai/v1',
    models: ['voxtral-mini-latest', 'voxtral-small-latest'],
    keyUrl: 'https://console.mistral.ai/api-keys'
  },
  groq: {
    name: 'Groq', protocol: 'whisper', tier: 0,
    baseUrl: 'https://api.groq.com/openai/v1',
    models: ['whisper-large-v3-turbo', 'whisper-large-v3'],
    keyUrl: 'https://console.groq.com/keys'
  },
  gemini: {
    name: 'Google Gemini', protocol: 'gemini', tier: 0,
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    models: ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3.6-flash', 'gemini-3.8-flash'],
    keyUrl: 'https://aistudio.google.com/apikey'
  },
  gemini_transcribe: {
    name: 'Google Gemini Transcribe', protocol: 'gemini-transcribe', tier: 0,
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    models: ['gemini-3.5-transcribe'],
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
    models: ['scribe_v2'],
    keyUrl: 'https://elevenlabs.io/app/settings/api-keys'
  },
  deepgram: {
    name: 'Deepgram', protocol: 'deepgram', tier: 1,
    baseUrl: 'https://api.deepgram.com',
    models: ['nova-3', 'nova-2'],
    keyUrl: 'https://console.deepgram.com'
  },
  cohere: {
    name: 'Cohere', protocol: 'cohere', tier: 1,
    baseUrl: 'https://api.cohere.com',
    models: [],
    keyUrl: 'https://dashboard.cohere.com/api-keys'
  },

  // Tier 2: multi-step adapters (submit + poll).
  assemblyai: {
    name: 'AssemblyAI', protocol: 'assemblyai', tier: 2,
    baseUrl: 'https://api.assemblyai.com',
    models: ['default'],
    keyUrl: 'https://www.assemblyai.com/app'
  },
  corti: {
    name: 'Corti', protocol: 'corti', tier: 2,
    baseUrl: 'https://api.corti.ai',
    models: [],
    keyUrl: 'https://console.corti.app'
  },

  // Tier 3: WebSocket streaming.
  cartesia: {
    name: 'Cartesia', protocol: 'cartesia', tier: 3,
    baseUrl: 'wss://api.cartesia.ai',
    models: ['ink-2'],
    keyUrl: 'https://play.cartesia.ai/keys'
  },

  custom: {
    name: 'Custom (OpenAI-compatible)', protocol: 'whisper', tier: 0,
    models: []
  }
  // Fireworks AI is intentionally absent: its audio transcription API was
  // deprecated in June 2026, so a preset would be dead on arrival.
};

const CLEANUP_PROVIDERS = {
  openai: { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', models: ['gpt-4.1-mini', 'gpt-4o-mini'] },
  gemini: { name: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', models: ['gemini-2.5-flash', 'gemini-2.5-flash-lite'] },
  mistral: { name: 'Mistral AI', baseUrl: 'https://api.mistral.ai/v1', models: ['mistral-small-latest', 'mistral-large-latest'] },
  groq: { name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', models: ['llama-3.3-70b-versatile'] },
  openrouter: { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', models: [] },
  deepseek: { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', models: ['deepseek-chat'] },
  xai: { name: 'xAI (Grok)', baseUrl: 'https://api.x.ai/v1', models: ['grok-3-mini'] },
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
function normalizeProfileProviders(settings) {
  if (!settings || !Array.isArray(settings.TRANSCRIPTION_PROFILES)) return settings;
  for (const p of settings.TRANSCRIPTION_PROFILES) {
    if (p.provider === 'gemini' && /transcribe/i.test(p.model || '')) {
      p.provider = 'gemini_transcribe';
      p.baseUrl = '';
      p.engine = 'gemini-transcribe';
    }
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
  const protocol = kind === 'cleanup'
    ? 'chat'
    : (isCustom ? (profile.engine || 'whisper') : (preset.protocol || 'whisper'));
  const baseUrl = isCustom
    ? normalizeBaseUrl(profile.baseUrl || '')
    : normalizeBaseUrl(preset.baseUrl || '');
  return {
    ...profile,
    provider,
    protocol,
    baseUrl,
    providerName: preset.name || 'Custom',
    keyUrl: preset.keyUrl || ''
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
  return {
    id: profile.id,
    label: profile.label || resolved.providerName,
    provider: resolved.provider,
    providerName: resolved.providerName,
    protocol: resolved.protocol,
    tier: preset.tier == null ? 0 : preset.tier,
    model: profile.model || '',
    engine: resolved.protocol,
    baseUrl: resolved.provider === 'custom' ? (profile.baseUrl || '') : '',
    keyUrl: preset.keyUrl || '',
    maskedKey: maskKey(profile.apiKey),
    hasKey: !!profile.apiKey,
    supportsStreaming: resolved.protocol === 'cartesia',
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
      supportsStreaming: p.protocol === 'cartesia'
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
  findProfile,
  getActiveProfile,
  getFallbackProfile,
  publicProfile,
  publicSettings
};

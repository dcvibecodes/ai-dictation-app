# Dictation Tool

AI-powered voice-to-text for people who can't install software on their computer.

If your work machine blocks app installs, doesn't have a Copilot+ PC with fluid dictation, or you're stuck with the basic Windows speech-to-text that can't clean up filler words or fix grammar — this is for you. Host it on your own VPS, open it in your browser, and install it as a PWA. No admin rights, no IT approval, no app store. Just a URL.

Works anywhere your workplace allows internet access to your domain.

---

## What It Is

A password-protected web app that records your voice, transcribes it using any Whisper-compatible API, and cleans up the transcript with an LLM. The result is auto-copied to your clipboard — ready to paste into whatever app you're actually working in.

Self-hosted. Single-user. No data leaves your server except the API calls you configure.

---

## How It Works

1. **Transcription** — audio is sent to a speech-to-text model (Whisper, Voxtral, etc.)
2. **Cleanup** — raw text is processed by a language model with a configurable system prompt that fixes grammar, punctuation, filler words, and formats into paragraphs
3. **Streaming** — cleanup text appears progressively as it's generated (falls back to standard if unsupported)

The result is auto-copied to your clipboard.

---

## Getting Started

```bash
cd dictation-app
npm install
npm start
```

Open `http://localhost:3003`. First visit: set your owner password. Then go to Settings and enter your API keys.

No `.env` file needed. All configuration lives in the UI.

---

## Install as App (PWA)

Since this is a Progressive Web App, you can install it as a standalone window — no app store, no admin rights needed:

1. Open the app in Chrome/Edge
2. Click the install icon in the address bar (or three-dot menu → "Apps" → "Install this site as an app")
3. It appears in your taskbar/start menu and opens in its own window

Works on desktop and mobile. Ideal for work computers where you can't install software.

---

## Features

- **Installable PWA** — runs as a standalone app window, no browser chrome
- **Password-protected** — owner-only access, bcrypt hashed, 7-day session
- **Append mode** — accumulate multiple dictation segments into one growing transcript; only the new segment uses API credits; starts fresh each session
- **Live transcription** (optional, off by default) — designed for long dictation sessions: audio is sent in ~10-second chunks and transcribed as you go, so by the time you stop, most of the audio is already transcribed (much less waiting at the end). Longer chunks keep boundary errors low. Toggle it on, or press L.
- **Animation settings** — choose how the cleaned transcript appears after dictation: No animation, Shatter (raw breaks apart while the cleaned version fades in), or Word-by-word (cleaned text replaces the raw progressively).
- **Streaming cleanup** — progressive text rendering via Server-Sent Events; blinking cursor during streaming; automatic fallback to standard cleanup
- **Elapsed time display** — processing time shown in status during transcription and cleanup
- **Single transcript display** — one clean text area; shows cleaned or raw text depending on auto-clean toggle
- **Tap to copy** — click/tap the transcript to copy the entire text to clipboard
- **Show raw / Show cleaned toggle** — switch between raw and cleaned versions (shortcut: R)
- **Manual cleanup** — press K or click Clean up to (re-)process the transcript with the selected prompt at any time
- **Manual theme toggle** — sun/moon button in the header; defaults to system preference, manual override saved
- **Pause/resume recording** — pause mid-dictation (button or P); timer and waveform freeze; resume where you left off
- **Editable transcript** — click Edit (or press E) to fix words directly in the transcript before copying; plain-text paste, live word count, syncs with append mode
- **Language setting** — pin the transcription language (e.g. `en`) instead of auto-detect for better accuracy and speed
- **Vocabulary hint** — bias the transcription model toward your names, jargon, and uncommon words
- **Correct audio format handling** — recordings are labeled with their actual format (WebM on Chrome, M4A on Safari/iOS) so transcription APIs accept them
- **Pulsing recording indicator** — subtle red ring pulse animation on the mic button while recording
- **Haptic feedback** — short vibration on recording start/stop (Android)
- **Frequency bar waveform** — live audio visualization while recording
- **Auto-clean toggle** — skip cleanup when you just want raw text
- **Prompt dropdown** — select cleanup prompt from a dropdown; always visible on the Dictate tab
- **Multiple cleanup prompts** — up to 4 custom prompts + Default; switch via dropdown or keyboard (1–5); re-clean with a different prompt anytime
- **History tab** — persistent session history (localStorage, 20 entries) with card-style items
- **Settings tab** — API keys, models, base URLs, and prompt management in card-style sections
- **Locked settings** — API config is read-only by default, click Edit to modify
- **Extensive keyboard shortcuts** — Enter, Esc, P, C, E, Z, K, R, N, U, A, T, L, 1–5, M, D, H, S
- **Shortcuts popover** — click "Shortcuts" in the header for a quick reference (desktop only)
- **Auto-copy** — transcript copied to clipboard automatically
- **Local backup** — recording saved to IndexedDB on stop (with in-memory fallback); retry, download, or clear from the recovery strip if upload fails
- **Any provider** — works with Mistral, OpenAI, Grok, Gemini, or any compatible API
- **Upload audio files** — supports MP3, WAV, OGG, WebM, M4A, FLAC, AAC up to 50 MB (shortcut: U)
- **Comprehensive Settings help** — collapsible troubleshooting guide covering all features, error states, local storage, and offline usage
- **Change password on login** — reset your password from the login screen using your current password
- **Mobile-optimized recorder** — flat bottom bar, compact layout
- **Inline status display** — processing status shown in the transcript area, visible on both mobile and desktop

---

## Tabs

| Tab | Purpose |
|---|---|
| Dictate | Record, transcribe, clean up, copy |
| History | View/restore/copy past transcriptions |
| Settings | API config + cleanup prompt management + help |



---

## Authentication

- First visit → `/setup` to create a password (min 8 characters)
- Subsequent visits → `/login`
- 7-day session cookie
- All API routes protected
- To change password: click "Change password" on the login screen
- To reset if you've forgotten it: delete `data/owner.hash` and restart

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `Enter` | Start / Stop recording |
| `Escape` | Cancel recording / abort processing / clear text (also closes modals/popovers, exits transcript editing) |
| `P` | Pause / Resume recording |
| `C` | Copy transcript to clipboard |
| `E` | Edit transcript (fix words before copying) |
| `Ctrl/Cmd + Enter` | Finish editing transcript (same as Done) |
| `Z` | Undo clear (restore last cleared transcript) |
| `K` | Clean up (re-process transcript with selected prompt) |
| `R` | Toggle raw / cleaned view |
| `N` | New recording (clear + start) |
| `U` | Upload audio file |
| `A` | Toggle append mode |
| `T` | Toggle auto-clean |
| `1–5` | Switch cleanup prompt by position |
| `L` | Toggle live transcription |
| `M` | Toggle light/dark theme |
| `D` | Dictate tab |
| `H` | History tab |
| `S` | Settings tab |

Shortcuts are disabled when typing in input fields.

---

## Project Structure

```
dictation-app/
├── public/
│   ├── index.html         # Main app (3 tabs)
│   ├── login.html         # Login page
│   ├── setup.html         # First-time setup
│   ├── auth.css           # Auth page styles
│   ├── script.js          # Frontend logic
│   ├── styles.css         # Main styles
│   ├── sw.js              # Service worker (PWA)
│   ├── manifest.json      # PWA manifest
│   ├── favicon.svg        # App icon
│   ├── icon-192.png       # PWA icon
│   └── icon-512.png       # PWA icon
├── data/                  # Auto-created, gitignored
│   ├── owner.hash         # Password hash
│   ├── session.secret     # HMAC secret
│   ├── settings.json      # API keys & config
│   └── prompts.json       # Custom prompts
├── uploads/               # Temp audio (auto-deleted)
├── server.js              # Express backend
├── generate-icons.js      # Icon generator (run once)
├── package.json
└── .gitignore
```

---

## API Configuration

Configure from the Settings tab. Transcription supports **two engines**, chosen from the **Engine** dropdown. Each engine uses its own API key, so you can switch freely without losing your other configuration.

### Transcription engines

| Engine | What it is | Fields |
|---|---|---|
| **Whisper-compatible** | Any provider exposing the OpenAI-style `/audio/transcriptions` endpoint: Mistral Voxtral, OpenAI Whisper, Groq, etc. | API Key, Base URL, Model |
| **Gemini (Google)** | Google's native Gemini API. Gemini is a multimodal LLM — audio is sent inline and transcribed with a "transcribe verbatim" prompt. Often much cheaper than dedicated speech models. | API Key (separate from cleanup), Model |

**Key differences:**
- **Cost** — Gemini bills per token (audio tokenizes very efficiently), so it's typically far cheaper per minute than Whisper-compatible models that bill per minute of audio.
- **File size limit** — Gemini accepts inline audio up to ~20 MB (roughly 10–20 minutes of speech). Whisper-compatible engines accept up to the app's 50 MB cap. For typical dictation this won't matter, but very long single recordings may need the Whisper engine.
- **Language & vocabulary hint** — both engines respect the Language and Vocabulary hint fields.

### All settings fields

| Field | Example |
|---|---|
| Transcription Engine | `whisper` (default) or `gemini` |
| Transcription API Key | Mistral key, OpenAI key, etc. (Whisper engine) |
| Transcription Base URL | `https://api.mistral.ai/v1` (required for non-OpenAI) |
| Transcription Model | `whisper-1`, `voxtral-mini-latest` |
| Gemini Transcription API Key | Google AI Studio key (Gemini engine) — separate from cleanup, even if it's the same key |
| Gemini Transcription Model | `gemini-2.5-flash` |
| Transcription Language | Optional — e.g. `en`; blank = auto-detect |
| Vocabulary Hint | Optional — names/jargon to bias spelling, e.g. `Acme, Jira, WebM` |
| Cleanup API Key | Your provider's key |
| Cleanup Base URL | Provider URL (blank = OpenAI) |
| Cleanup Model | `gpt-4.1-mini`, `mistral-large-latest` |

The base URL must match the provider that issued the key.

---

## Streaming Cleanup

The server exposes `POST /cleanup-stream` which uses Server-Sent Events to forward chunked responses from the upstream cleanup API. The client renders text progressively as chunks arrive. If streaming fails or isn't supported by the provider, it falls back to the standard `POST /cleanup` endpoint automatically.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML/CSS/JS, Inter font, PWA |
| Backend | Node.js, Express |
| Auth | bcryptjs, cookie-parser, HMAC sessions |
| AI | Any compatible speech-to-text + chat API |
| Audio | Web Audio API, MediaRecorder |
| Streaming | Server-Sent Events |

---

## Notes

- No `.env` file required — all config via Settings tab
- Audio temp files deleted immediately after transcription; orphaned uploads older than 30 min are auto-swept every 15 min
- Session history is browser-side (localStorage)
- API keys are **encrypted at rest** (AES-256-GCM) in `data/settings.json` (gitignored). If the server's `data/session.secret` is ever recreated, stored keys can no longer be decrypted — re-enter them in Settings.
- `data/` directory auto-created on first run, fully gitignored
- PWA works offline for the UI shell; recording requires network for AI APIs
- Append mode starts fresh each page load — no stale text from previous sessions
- Only the latest segment is sent for cleanup — previous segments are never re-processed
- Transcription auto-retries twice (1s, then 2s backoff) on transient errors (5xx / 429 / network glitch) before showing the recovery bar
- A one-time status warning appears at 5 minutes of recording, reminding you that long recordings risk hitting the 50 MB upload limit — stop and append instead

### Configurable rate limits & transcript cap

The AI endpoints (`/upload`, `/cleanup`, `/cleanup-stream`) are rate-limited by default to protect your API credits from abuse. Defaults are generous for a single user:

| Setting (settings.json or .env) | Default | Meaning |
|---|---|---|
| `RATE_LIMIT_UPLOAD_MAX` | `40` | Max transcription uploads per window |
| `RATE_LIMIT_UPLOAD_WINDOW_MS` | `900000` (15 min) | Upload window length |
| `RATE_LIMIT_CLEANUP_MAX` | `60` | Max cleanup requests per window |
| `RATE_LIMIT_CLEANUP_WINDOW_MS` | `900000` (15 min) | Cleanup window length |
| `MAX_TRANSCRIPT_CHARS` | `50000` | Max transcript length sent to cleanup APIs |

Rate limiters are created at server startup, so **restart the server after changing these values**.

### Spoken formatting commands

The default cleanup prompt now recognizes **"new paragraph"**, **"new line"**, or **"newline"** as spoken commands that start a new paragraph at that point — useful for dictating structured documents like letters or multi-paragraph emails.

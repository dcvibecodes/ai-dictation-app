# Dictation Tool

A password-protected dictation PWA that records your voice, transcribes it, and cleans up the transcript using AI. No `.env` file required — configure everything from the UI. Installable as a standalone app on any device.

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
- **Append mode** — accumulate multiple dictation segments into one growing transcript; only the new segment uses API credits
- **Mini widget** — compact `/mini` route with just record, status, and copy; installable as a separate PWA for an always-visible dictation trigger
- **Streaming cleanup** — progressive text rendering via Server-Sent Events; blinking cursor during streaming; automatic fallback to standard cleanup
- **Elapsed time display** — processing time shown in status during transcription and cleanup
- **Single transcript display** — one clean text area; shows cleaned or raw text depending on auto-clean toggle
- **Tap to copy** — click/tap the transcript to copy the entire text to clipboard
- **Pop-in animation** — transcript appears with a smooth fade-in when it arrives
- **Show raw / Show cleaned toggle** — switch between raw and cleaned versions when both exist
- **Manual theme toggle** — sun/moon button in the header; defaults to system preference, manual override saved
- **Tab icons** — mic, clock, and gear icons next to tab labels
- **Pulsing recording indicator** — subtle red ring pulse animation on the mic button while recording
- **Haptic feedback** — short vibration on recording start/stop (Android)
- **Frequency bar waveform** — live audio visualization while recording
- **Auto-clean toggle** — skip cleanup when you just want raw text
- **Prompt dropdown** — select cleanup prompt from a dropdown; only visible when auto-clean is enabled
- **Multiple cleanup prompts** — up to 4 custom prompts, switch instantly via dropdown or keyboard (1–4)
- **History tab** — persistent session history (localStorage, 20 entries) with card-style items
- **Settings tab** — API keys, models, base URLs, and prompt management in card-style sections
- **Locked settings** — API config is read-only by default, click Edit to modify
- **Keyboard shortcuts** — S, Enter, C, P, N, A, T, 1–4, Esc (see full list below)
- **Shortcuts popover** — click "Shortcuts" in the header for a quick reference (desktop only)
- **Auto-copy** — transcript copied to clipboard automatically
- **Local backup** — recording saved to IndexedDB on stop (with in-memory fallback); retry, download, or clear from the recovery strip if upload fails
- **Any provider** — works with Mistral, OpenAI, Grok, Gemini, or any compatible API
- **Upload audio files** — supports MP3, WAV, OGG, WebM, M4A, FLAC, AAC up to 50 MB
- **Comprehensive Settings help** — collapsible troubleshooting guide covering all features, error states, local storage, and offline usage
- **Change password on login** — reset your password from the login screen using your current password
- **Smooth modal animations** — prompt editor opens with a scale + slide-up transition
- **Mobile-optimized recorder** — flat bottom bar (no floating card), status shown below record button, compact layout

---

## Tabs

| Tab | Purpose |
|---|---|
| Dictate | Record, transcribe, clean up, copy |
| History | View/restore/copy past transcriptions |
| Settings | API config + cleanup prompt management + help |

---

## Mini Widget

The `/mini` route provides a minimal dictation interface designed for a small always-visible window:

- Just the record button, status, and copy button
- Shares session and settings with the main app
- Respects append mode — segments accumulate across both views
- Installable as a separate PWA (has its own manifest)
- Open from the monitor icon in the header or navigate to `/mini` directly
- Keyboard shortcuts S, P, C work in the mini view

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
| `S` | Start/stop recording |
| `Enter` | Stop recording (while recording) |
| `C` | Cancel recording / abort processing / clear text |
| `P` | Copy transcript to clipboard |
| `N` | New recording (clear + start) |
| `A` | Toggle append mode |
| `T` | Toggle auto-clean |
| `1–4` | Switch cleanup prompt by position |
| `Escape` | Close modal or popover |

Shortcuts are disabled when typing in input fields.

---

## Project Structure

```
dictation-app/
├── public/
│   ├── index.html         # Main app (3 tabs)
│   ├── mini.html          # Mini widget view
│   ├── login.html         # Login page
│   ├── setup.html         # First-time setup
│   ├── auth.css           # Auth page styles
│   ├── script.js          # Frontend logic
│   ├── styles.css         # Main styles
│   ├── sw.js              # Service worker (PWA)
│   ├── manifest.json      # PWA manifest (main)
│   ├── manifest-mini.json # PWA manifest (mini widget)
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

Configure from the Settings tab. Works with any provider that uses the same API format:

| Field | Example |
|---|---|
| Transcription API Key | Mistral key, OpenAI key, etc. |
| Transcription Base URL | `https://api.mistral.ai/v1` (required for non-OpenAI) |
| Transcription Model | `whisper-1`, `voxtral-mini-latest` |
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
- Audio temp files deleted immediately after transcription
- Session history is browser-side (localStorage)
- API keys stored in `data/settings.json` (gitignored)
- `data/` directory auto-created on first run, fully gitignored
- PWA works offline for the UI shell; recording requires network for AI APIs
- Append mode accumulates text in localStorage, shared between main and mini views
- Only the latest segment is sent for cleanup — previous segments are never re-processed

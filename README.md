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
- **Streaming cleanup** — progressive text rendering via Server-Sent Events; blinking cursor during streaming; automatic fallback to standard cleanup
- **Elapsed time display** — processing time shown in status during transcription and cleanup
- **Single transcript display** — one clean text area; shows cleaned or raw text depending on auto-clean toggle
- **Tap to copy** — click/tap the transcript to copy the entire text to clipboard
- **Show raw / Show cleaned toggle** — switch between raw and cleaned versions (shortcut: R)
- **Manual cleanup** — when auto-clean is off, press K to clean up the raw transcript on demand
- **Manual theme toggle** — sun/moon button in the header; defaults to system preference, manual override saved
- **Pulsing recording indicator** — subtle red ring pulse animation on the mic button while recording
- **Haptic feedback** — short vibration on recording start/stop (Android)
- **Frequency bar waveform** — live audio visualization while recording
- **Auto-clean toggle** — skip cleanup when you just want raw text
- **Prompt dropdown** — select cleanup prompt from a dropdown; only visible when auto-clean is enabled
- **Multiple cleanup prompts** — up to 4 custom prompts + Default; switch via dropdown or keyboard (1–5)
- **History tab** — persistent session history (localStorage, 20 entries) with card-style items
- **Settings tab** — API keys, models, base URLs, and prompt management in card-style sections
- **Locked settings** — API config is read-only by default, click Edit to modify
- **Extensive keyboard shortcuts** — Enter, Esc, Z, C, K, R, N, U, A, T, L, 1–5, D, H, S
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
| `Esc` | Cancel recording / abort processing / clear text / close modal |
| `Z` | Undo clear (restore last cleared transcript) |
| `C` | Copy transcript to clipboard |
| `K` | Clean up (when auto-clean is off) |
| `R` | Toggle raw / cleaned view |
| `N` | New recording (clear + start) |
| `U` | Upload audio file |
| `A` | Toggle append mode |
| `T` | Toggle auto-clean |
| `1–5` | Switch cleanup prompt by position |
| `L` | Toggle light/dark theme |
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
│   ├── manifest.json      # PWA manifest (main)
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
- Append mode starts fresh each page load — no stale text from previous sessions
- Only the latest segment is sent for cleanup — previous segments are never re-processed

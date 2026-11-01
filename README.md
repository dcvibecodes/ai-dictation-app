# Dictation Tool

AI-powered voice-to-text for people who can't install software on their computer.

---

## What's New in v7.0.3 — simpler settings, OpenCode Go cleanup, inbuilt default prompt

- **OpenCode Go cleanup provider.** Settings → Cleanup model now offers **OpenCode Go** as a preset. Its OpenAI-compatible base URL (`https://opencode.ai/inference/go/openai/v1`), curated model list and live model browser are built in. Paste your Go API key, pick a model, Test & save. Transcription is unchanged — Go has no speech-to-text endpoint. Note: OpenCode documents Go for coding-agent traffic and monitors usage, so using it for dictation cleanup is at your discretion.
- **Cleanup animation removed.** There is no longer a Shatter / Word-by-word option; cleaned text always replaces the raw text instantly. The settings section, code path and animation CSS are gone.
- **The live default prompt is now built in.** The edited Default prompt that was running in production has been moved into the app code, and the stored override is dropped once on startup. The prompt list shows it as **Built-in**; Restore now returns to this version instead of the older original.

## What's New in v7.0.2 — model list, Gemini Transcribe and ElevenLabs fixes

- **Gemini Transcribe now returns text.** Recordings are converted to WAV before upload, the language code is mapped to the BCP-47 form the transcribe model expects (or omitted so it auto-detects), and the response parser reads both `parts[].text` and `parts[].audioTranscription.text`. Empty responses now log the provider's finish reason instead of silently succeeding.
- **An empty transcript is a failure.** If a provider returns no text, the app shows a clear error, keeps the recording for Retry/Download and never adds an empty history entry or says “copied” with nothing on screen.
- **Browse Models uses the right key and endpoint.** It passes the profile being edited (`profileId`) so its saved key is used, and the Gemini model list authenticates with `?key=`. A rejected key now says “Google rejected this API key” instead of dumping the raw OAuth error.
- **ElevenLabs fixed.** Language codes are mapped to ISO-639-3 (`en` → `eng`) and vocabulary hints are sent as separate `keyterms` fields. Provider errors include the response body, and Test & save now uses the same language/keyterms as real dictation, so a broken configuration cannot pass the test.
- **Profile cards only activate.** Clicking an already-active card no longer opens the editor — only the Edit button does.
- **Login username field** is just “Username”; the confusing migration hint is gone.

## What's New in v7.0.1 — bug fixes for models, keys and live streaming

- **Gemini 3.5 Transcribe works properly.** It is a dedicated speech model, not a chat model, so it now has its own provider (“Google Gemini Transcribe”) and uses Google's native `generateContent` API. Existing profiles whose Gemini model contains `transcribe` are moved to the new provider automatically on startup — the saved key is kept.
- **Browse models is a real picker.** Clicking it opens a searchable list under the model field. It no longer overwrites your model with the first result. Internal/unrelated IDs (`antigravity`, embeddings, image/video models) are filtered out, and the curated model list is shown first.
- **Test & save only saves on a successful test.** “Save anyway” is gone. A failed test leaves the sheet open and nothing is written.
- **Cartesia live streaming fixed.** The API version is now `2026-03-01` (the old value was rejected), turn events (`turn.start` / `turn.update` / `turn.end`) are parsed correctly, and Stop waits for the final turn instead of sending an unsupported `finalize` command. With Append off the preview no longer keeps the previous take on screen.
- **Provider failures no longer look like an expired login.** A bad provider key returns a provider error (400/5xx) instead of a 401 that the UI interpreted as “Session expired”.
- **No more Safari “Save Password?” popup for API keys.** The key field is no longer a password input; it is masked by CSS and has a Show/Hide toggle.
- **Sheets lock the page behind them.** Opening a provider or prompt sheet fixes the background scroll position and prevents scrolling until it closes.
- **Login/setup fields match.** The username input now uses the same height and padding as the password input.
- **Cartesia Test & save now checks the actual streaming connection**, not just the REST voices endpoint.

## What's New in v7.0.0 — provider profiles, stronger auth, new interface

- **Saved voice models (profiles).** Settings now holds a list of provider + model + key profiles — OpenAI, Mistral, Groq, Gemini, Gemini Transcribe, OpenRouter, ElevenLabs, Deepgram, Cohere, AssemblyAI, Corti and Cartesia, plus a Custom OpenAI-compatible endpoint. Tap a row to activate it; the base URL is built in for known providers, so you only paste a key and pick a model. Your existing single-slot setup is migrated automatically into profiles on first boot; nothing to re-enter.
- **Real provider adapters.** Non-OpenAI providers are not faked with a URL: each one has its own request shape, auth header and response parser. Google's dedicated `gemini-3.5-transcribe` model uses its native API and has its own provider. Failures keep the recording. A different provider is used only if you explicitly configure a fallback model.
- **Username + account settings.** New installs choose a username at `/setup`; existing installs get a one-time "Choose your username" screen after signing in (the existing password keeps working). You can change the username and the password from Settings → Account & security.
- **Stronger sessions.** Passwords are now 12+ characters and capped at 72 bytes (bcrypt's limit) with a clear error instead of silent truncation. Sessions expire after 180 days, and changing your password invalidates every other session — this browser stays signed in.
- **CSRF hardening.** Sensitive mutations validate the Origin/Referer host on top of the SameSite cookie.
- **Redesigned Settings tab.** A profile-driven page with card-based voice/cleanup model lists, provider sheets, account & security, recognition, prompts and corrections. The Dictate tab keeps its original layout with one improvement: Auto-clean / Live / Append are one segmented chip and the prompt selector is a rounded pill.
- **Live is now a model capability, not a toggle.** The old 3–60 s chunking mode is gone. A streaming model (Cartesia ink-2) transcribes continuously while you speak — no context lost at chunk boundaries. Every other model records once and transcribes at Stop. The Live chip is locked to show which behaviour the active model uses.
- **Cartesia true streaming.** The browser streams 16 kHz PCM through a same-origin WebSocket; the server proxies it to Cartesia with the API key kept server-side. Partial turns appear while speaking, the final text runs through the normal cleanup/copy pipeline, and a broken stream falls back to transcribing the saved recording.

---

## What's New in v6.25.0

### Live is off by default — final transcripts get more context

- **Live mode now starts OFF for anyone who has never chosen.** Live chunks carry less context than a full recording, so words at chunk edges can be dropped. With Live off, the whole take is transcribed in one request and the final text is usually more accurate — it just takes a bit longer at the end.
- **Your choice still sticks.** The Live toggle on the Dictate tab is the preference: turn it on and it stays on across sessions and app updates; turn it off and it stays off. Press `L` or use the toggle any time.
- **No server or database change.**

## What's New in v6.24.1

### Pill removed — failures stay in the red status line

- **The capture-state pill is gone.** It could get stuck showing "Transcribing" after a take ended (a late chunk reply re-showed it mid-stop with no code left to hide it), and it clashed with the app's aesthetic. Transcription failures are reported where they always were: the red status line (`Session expired — …`, `Chunk failed: … — audio saved locally`, `Transcription is falling behind — …`). Audio safety is unchanged — the ledger keeps every sample regardless.
- **Background login refresh stays.** The 45-second visible-and-idle session re-check is untouched.
- **No server or database change.**

## What's New in v6.24.0

### Login stays warm in the background

- **Record almost never waits on the login check anymore.** While the app is visible and idle, the session is re-confirmed every 45 seconds — tighter than the 60-second freshness window — so pressing Record nearly always finds a fresh OK and skips the network round trip. The mic still never opens before login is confirmed.
- **Checks pause at the right times.** No checks while recording, starting, draining, or processing (Live chunk uploads already detect an expired session mid-take, roughly every chunk interval), and none while the tab is hidden — a backgrounded phone PWA does not keep polling. Returning to the tab triggers one immediate check. If the last OK is stale (laptop slept, a check failed), Record runs the same login check first, exactly as before.
- **One shared request.** The Record button, the background timer, and the foreground refresh all join the same in-flight `/api/status` call, so the server is never double-hit.
- **Transcription failures surface in the red status line.** If a chunk fails, a request stalls past its timeout, or the session expires, the status line says so in red; audio keeps saving to the local ledger in every state.
- **Background expiry never redirects you.** If a background check finds the session gone while idle, you get a status warning and the next Record sends you to `/login` — an unsaved transcript on screen is never lost to a surprise redirect.
- **No server or database change.**

## What's New in v6.23.4

### Faster record start — same safety guarantees

- **Back-to-back takes skip the login wait** — the first take checks login before opening the mic (as before); takes within the next 60 seconds skip the network round trip. The mic still never opens before login is confirmed, so you can never speak in vain on an expired session.
- **Audio engine pre-warms while you read** — the page quietly prepares the audio engine and fetches the Live capture file in the background after load. The microphone is never touched (mic indicator stays off); if pre-warming fails, Record works exactly as before.
- **Standard mode confirms audio ~4x faster** — the first-recording proof chunk arrives in ~250 ms instead of ~1 s, with the same "Recording…" only-after-real-audio guarantee. Live mode's proof was already ~85 ms and is unchanged.
- **Honest stages** — "Starting mic…" now reads "Checking login…" → "Opening mic…", so a stall always names its stage.
- **No server or database change.**

## What's New in v6.23.3

### Self-Hosted Fonts — Same Typography on Web, Mobile, and Offline

- **Outfit + Fraunces are now served locally** from `public/fonts/` with `@font-face` in `styles.css` and `auth.css`; Google Fonts and its preconnects are gone. The app no longer depends on an external font CDN and renders the same display typography on desktop, mobile, and offline/PWA.
- **Login and setup match the app** — both auth pages use the same self-hosted Outfit/Fraunces pair.
- **Offline-safe** — both WOFF2 files are precached in `dictation-v31`; only ~100 KB total including license files.
- **No server or database change.**

## What's New in v6.23.2

### Mobile corrections stay on one row
- On phone-width screens, each correction now keeps **heard-as → replace-with → On → remove** in a single row instead of pushing the checkbox and remove button onto a second line. Spacing and input padding are tightened on mobile; the desktop layout is unchanged.

## What's New in v6.23.1

### Clearer distinction between corrections and recognition
- **Corrections now describe themselves accurately** — Settings → Corrections explains that rules run locally on the returned text, do not change recognition, and make no extra API calls.
- **The optional Vocabulary hint remains available** — it provides advisory recognition bias for names and jargon; use Corrections for spellings that must be exact. Both features are complementary, not replacements.

## What's New in v6.23.0

### Work glossary: exact corrections that stick
- **Correction dictionary** — Settings → Corrections replaces known mishearings **after** transcription, so the result is guaranteed rather than left to the model. Ships with **fun control → fund control** (case-insensitive, whole phrase). **fun controller** is left alone.
- **Rules survive cleanup** — the same exact rules are applied again to the cleaned text, because a cleanup model can reintroduce the original spelling. Rules are word-boundary aware across Unicode text, longest phrase first, and applied once per pass so replacements cannot cascade.
- **Original is never lost** — when a rule changed the text, a **Show original / Show corrected** button appears next to the raw/cleaned toggle. History and Undo remember the provider's original wording too.
- **Stored server-side** — the glossary lives in `data/settings.json` under `GLOSSARY` and is managed with `GET/POST /api/glossary`; the browser keeps a localStorage cache so a reload does not flash the defaults. Validation rejects duplicate aliases, rules whose canonical form would cascade, and over-limit rule sets (200 rules / 20 aliases per rule / 100 characters per phrase).
- **Recognition and correction are separate** — the optional Vocabulary hint biases recognition; correction rules are deterministic, run locally afterwards, and guarantee known spellings in both raw and cleaned output.
- **Tests** — `npm test` now covers normalization, boundary matching, longest-first replacement, idempotence, cascades, and Unicode aliases.

## What's New in v6.22.0

### Reliability pass: every sample accounted for, partial takes never lose audio
- **New independent audio ledger** (`public/lib/audio-ledger.js`) — Live mode now records every captured sample exactly once into immutable 250 ms PCM blocks. Persistence and transcription have separate cursors, so audio captured between sends is no longer skipped or duplicated, and the old 15-minute in-RAM cap is gone. Blocks are stored incrementally in IndexedDB; only the small session manifest is rewritten.
- **Partial is partial** — if any chunk fails and the whole-session recovery also fails, the transcript is clearly marked **Partial**, the full audio is kept, and nothing is auto-copied. Use **Retry / Download / Discard**; Discard asks first. Storage-quota failures are reported honestly, and the in-memory blocks stay available in the open tab.
- **Stop no longer loses the tail** — Stop drains the worklet's partial block, sends the final fragment, and merges short tails instead of consuming speech that was never sent. Pause flushes the last spoken fragment before discarding pause audio.
- **Stale sessions can't touch a new take** — capture mode and config are frozen at Start; every session has an ID; cancelled/old replies are ignored; requests are abortable. Live chunks use a bounded queue (**2 in flight, 6 queued**) with **2 browser attempts**; the server no longer retries chunks, so there is one retry owner.
- **Cleanup called once** — the word-by-word animation renders the result already received instead of issuing a second `/cleanup-stream` request.
- **Interrupted SSE never commits a half-rewrite** — cleanup requires the explicit `done` marker; the server aborts upstream generation when the browser disconnects.
- **Clipboard status is truthful** — "Copied" only appears when the copy actually succeeded; otherwise the app says the copy was blocked.
- **Faster, safer start** — record-start auth now hits the tiny authenticated `GET /api/status` with a 1.5 s client deadline instead of downloading all settings.
- **Truthful audio labels** — Whisper-compatible uploads now receive the real MIME type and filename instead of pretending every file is `audio/wav`.
- **Tests** — `npm test` runs Node tests for the resampler and ledger (coverage, gaps/overlaps, storage failure, recovery, discard).

## What's New in v6.21.0

### Configurable Live chunk interval + failure-proofing fixes
- **Live chunk interval is now a setting** — Settings → Live transcription lets you choose how often Live mode transcribes audio (**3–60 s, default 10 s**). Lower = text appears sooner but is **less accurate** (shorter chunks carry less context and split words at the edges), so the hint recommends **10 s or higher**. Saved in the browser and applied from the next recording.
- **Idle 401s redirect to login** — a session 401 when nothing is recording/processing now sends you to `/login` (previously it could loop silently). Mid-recording behavior is unchanged: audio + on-screen text are kept and you Retry.
- **Startup resilience** — a corrupted saved history can no longer stop the app from loading, and unexpected runtime errors now surface a status message instead of failing silently.
- **Live display can't freeze after a failed chunk** — a permanently failed chunk fills its slot so later chunks keep appearing; the stop-time full re-transcription still supplies the final text.
- **Rolling backup keeps the tail** — the incremental live backup no longer silently stops capturing after ~40 s, so a recovered recording is complete.

## What's New in v6.20.1

### No animation is now the default
- The cleanup animation default changed from Shatter to **No animation** — the cleaned transcript simply replaces the raw one. Less motion, faster to read.
- Your saved choice is untouched: it lives in browser localStorage and survives logout/login, so anyone who picked Shatter or Word-by-word keeps it.

## What's New in v6.20.0

### Live capture moved off the main thread (AudioWorklet)
- **Smoother UI on long Live recordings** — mic capture now runs in an `AudioWorklet` (`public/live-capture-worklet.js`) instead of the deprecated `ScriptProcessorNode`, which ran on the same thread as the waveform, timer, and buttons and could make them hitch. Same 4096-sample blocks, same ~10s chunks, same backup and pause behavior — just no UI jank.
- **No more speaker connection hack** — the old node only ran while connected to `audioContext.destination`; the worklet has zero outputs, so the mic no longer routes through the speaker path.
- **Automatic fallback** — browsers without AudioWorklet silently use the old ScriptProcessor path. A console warning tells you which path is active.
- Mic-start delay is unchanged: the red recording state still appears only after real audio is confirmed.

## What's New in v6.19.0

### No-expiry session + a dead session can never kill a recording
- **Session no longer expires** — the server accepts the signed cookie indefinitely (10-year cookie + sliding refresh on visits, so the browser cap never logs out an active user). One login lasts years instead of 7 days.
- **401s never navigate away mid-recording/transcribing** — all logout triggers go through a central handler: while recording or transcribing it keeps the audio (memory + IndexedDB backup) and on-screen text, shows the recovery strip, and says "Session expired — open /login in a new tab, then press Retry." Idle 401s (settings/prompts when not recording) still redirect to `/login`.
- **Live chunks survive expiry** — a 401 on `/upload-chunk` no longer redirects; it marks the chunk failed, keeps capturing locally, and the full session is retried on stop.
- **Fail-fast pre-record auth check** — starting a recording first pings `/api/settings`; if the session is dead you're sent to login *before* you speak, not after.

## What's New in v6.18.0

### Root cause of the recurring live-chunk failures: a non-replayable upload stream
The server log showed `Chunk upload error: Connection error.` — the OpenAI SDK's generic network error. The cause was the Whisper upload path:

```js
const params = { file: fs.createReadStream(audioPath), model };
```

A file read stream **cannot be replayed**. When the SDK retried a transient socket hiccup (its default is 2 retries), the second attempt tried to re-send an already-consumed stream and failed with `Connection error.` — losing that 10-second chunk, over and over.

Fixes:
- **Buffer the audio instead of streaming it** (`toFile(buffer, …)`) so retries are safe and the SDK can transparently recover from a dropped connection.
- **Explicit `maxRetries: 2`** on the transcription and cleanup clients.
- **Chunk-level retries on the client** — each ~10s chunk now retries up to 3 times with backoff before giving up, so one blip doesn't drop ten seconds of speech.
- **Full-session recovery on stop** — if any chunk failed, the complete audio (always retained in the local backup) is re-transcribed through the standard `/upload` path and used as the result. Failed chunks can no longer cost you those minutes.
- **Honest status messages** — a failed chunk now says "audio saved locally, will retry on stop" instead of implying the text is safe.



### Diagnosed from real server logs: provider failures no longer lose recordings
Server logs from a failed session showed the root cause: the **Gemini** transcription endpoint was rejecting audio with `"Invalid audio format \"aac\"... Valid formats are: [wav, mp3]"`, then returning `"Gemini returned an empty transcription."`, and finally `"Connection error."` — every chunk failed, so nothing was transcribed and, because the live backup was never finalized, there was nothing to recover.

- **Provider fallback (v7+)** — there is no silent switching between providers: a different provider means different cost, terms and privacy handling for your audio. Failures keep the recording, and a fallback model runs only if you explicitly choose one in Settings → Recognition.
- **Honest format handling** — Gemini is only ever sent genuine `wav`/`mp3`. WebM (Chrome) and MP4/AAC (Safari) audio goes straight to Whisper instead of being mislabeled and rejected.
- **Live backup is finalized on every exit path** — stop, error, "nothing transcribed", tab hidden, and page unload all write a complete, recoverable WAV, so the recovery strip always has real audio to offer.
- **Recovery on load is unconditional** — any backup with audio is surfaced, in-progress or finished.
- **Chunk pipeline is error-proof** — a UI-render error during chunk handling can no longer poison later chunks.

**Recommended setup:** use the **Whisper engine** for transcription (e.g. Mistral `voxtral-mini-latest`); keep Gemini for text cleanup only. That path already works reliably.



### Follow-up fixes
- **`N` (new recording) fixed with Live mode on** — pressing `N` now clears the document and then starts cleanly, instead of tangling the new live recording with the teardown of the old one (and potentially wiping the recovery strip).
- **Accurate recovered-recording duration** — the recovery strip now shows an estimated length derived from the audio itself (e.g. "Unfinished recording recovered · ~3:40"), instead of the elapsed counter from whenever it happened to be saved.

### v6.17.1
- **Fixed a false "No sound detected" warning** — the mic check now reads a wide time-domain window with a very low threshold and only warns after ~5 seconds of sustained silence, then stops for the session once any real audio is heard. (It previously sampled ~5 ms once a second, so normal speech gaps could trigger it even while the waveform moved.)

### v6.17.0

### Recording can no longer silently lose your audio
Long recordings used to live only in memory until you pressed stop — if the app was backgrounded, killed, reloaded, or crashed mid-recording, the whole recording (and the downloadable file) was gone with no warning. This release fixes that:

- **Chunked capture + rolling backup** — recordings are captured in 1-second slices and flushed to local storage every few seconds, so an interrupted session is recoverable. If the app closes mid-recording, the next time you open it the recovery strip appears with **Retry / Download / Discard**.
- **Live mode now keeps an audio backup too** — previously the "Download recording" option could never work in Live mode. It now backs up the full session as a WAV.
- **Live mode is ON by default** — long dictations are transcribed as you speak, so there's far less to lose if anything interrupts.
- **Never a false "recording"** — the red recording state, timer, and waveform only appear *after* the recorder has confirmed real audio is arriving. If it can't start, you get a clear error instead of a recording that never happened.
- **Silence warning** — if the mic produces no sound for the first couple of seconds (muted, in use by another app, wrong device), the status line warns you. Recording continues, since deliberate silence is allowed.
- **Mic-loss handling** — if the microphone disconnects mid-session, the recording stops cleanly, the audio is saved, and you're told what happened.
- **Clear now truly cancels** — clearing while recording discards the take instead of clearing and then pasting the transcript back in.
- **Auto-stop no longer masks failures** — if an auto-stopped recording fails to transcribe, you see the real error, not a green "auto-stopped" message.

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
- **Password-protected** — owner-only access with username + password, bcrypt hashed, session valid for 180 days with a sliding refresh; changing the password invalidates every other session
- **Append mode** — accumulate multiple dictation segments into one growing document on screen; only the new segment uses API credits
- **Append mode keeps the document on screen** — the text you see is the whole append document, so you can switch between raw and cleaned views while appending
- **Live streaming where the model supports it** — with a Cartesia ink-2 profile active, audio streams continuously through a WebSocket while you speak; partial text appears live and the final text is finalized once at Stop. With every other model, recording is transcribed once at Stop (more context, better accuracy). There is no chunking mode and no Live toggle; the Live chip is locked to the active model's capability.
- **Recording safety net** — the recorder only shows "recording" once real audio is confirmed; a silence watchdog warns if the mic is muted or in use; mic loss mid-session is caught and the audio is saved; and a rolling backup means an interrupted recording is recoverable on the next open.
- **Streaming cleanup** — progressive text rendering via Server-Sent Events; blinking cursor during streaming; automatic fallback to standard cleanup
- **Elapsed time display** — processing time shown in status during transcription and cleanup
- **Single transcript display** — one clean text area; shows cleaned or raw text depending on auto-clean toggle
- **Tap to copy** — click/tap the transcript to copy the entire text to clipboard (a "Copied ✓" confirmation appears; no fading animation)
- **First-run hint banner** — a one-time banner on first load points out how to record and how to tap-to-copy
- **Show raw / Show cleaned toggle** — switch between raw and cleaned versions (shortcut: R)
- **Show original / Show corrected** — when a correction rule changed the provider's text, compare it with the corrected result without losing either version (shortcut: O)
- **Manual cleanup** — press K or click Clean up to (re-)process the transcript with the selected prompt at any time
- **Manual theme toggle** — sun/moon button in the header; defaults to system preference, manual override saved
- **Pause/resume recording** — pause mid-dictation (button or P); timer and waveform freeze; resume where you left off
- **Editable transcript** — click Edit (or press E) to fix words directly in the transcript before copying; plain-text paste, live word count, syncs with append mode; on mobile the font bumps to 16px while editing to prevent iOS Safari auto-zoom
- **Language setting** — pin the transcription language (e.g. `en`) instead of auto-detect for better accuracy and speed
- **Vocabulary hint** — bias the transcription model toward your names, jargon, and uncommon words
- **Correction dictionary** — Settings → Corrections enforces exact, case-insensitive, whole-phrase replacements (for example **fun control** → **fund control**) after transcription and again after cleanup; the provider's original wording stays available via **Show original**. Stored server-side, with a localStorage cache.
- **Correct audio format handling** — recordings are labeled with their actual format (WebM on Chrome, M4A on Safari/iOS) so transcription APIs accept them
- **Pulsing recording indicator** — subtle red ring pulse animation on the mic button while recording
- **Haptic feedback** — short vibration on recording start/stop (Android)
- **Frequency bar waveform** — live audio visualization while recording
- **Auto-clean toggle** — skip cleanup when you just want raw text
- **Prompt dropdown** — select cleanup prompt from a dropdown; always visible on the Dictate tab
- **Multiple cleanup prompts** — up to 4 custom prompts + Default; switch via dropdown or keyboard (1–5); re-clean with a different prompt anytime
- **History tab** — persistent session history (localStorage, 20 entries) with card-style items
- **Settings tab** — profile-driven voice models and cleanup models, shared recognition fields, account & security, prompt management and corrections
- **Locked settings** — API config is read-only by default, click Edit to modify
- **Extensive keyboard shortcuts** — Enter, Esc, P, C, E, Z, K, R, O, N, U, A, T, L, 1–5, M, D, H, S
- **Mobile-friendly undo** — on touch devices, clearing the transcript shows a tappable **Undo** link (desktop uses the Z keyboard shortcut)
- **Shortcuts popover** — click "Shortcuts" in the header for a quick reference (desktop only)
- **Auto-copy** — transcript copied to clipboard automatically
- **Local backup** — recordings are flushed to IndexedDB while recording (rolling backup) and kept on failure, with an in-memory fallback; retry, download, or discard from the recovery strip. Works in both standard and live-streaming modes, and recovers interrupted recordings on the next open.
- **Any provider** — saved provider profiles for OpenAI, Mistral, Groq, Gemini, Gemini Transcribe, OpenRouter, ElevenLabs, Deepgram, Cohere, AssemblyAI, Corti, Cartesia, or any OpenAI-compatible endpoint
- **Upload audio files** — supports MP3, WAV, OGG, WebM, M4A, FLAC, AAC up to 50 MB (shortcut: U)
- **Comprehensive Settings help** — collapsible troubleshooting guide covering all features, error states, local storage, and offline usage
- **Account & security** — change your username or password from Settings (or from the login screen). Password changes sign out every other session; saved API keys are unaffected
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

- First visit → `/setup` to create a username and password (password: min 12 characters, max 72 UTF-8 bytes)
- Subsequent visits → `/login` (username + password once a username is set)
- Sessions are signed cookies valid for **180 days**, refreshed while you stay active. Changing the password bumps a session generation counter, so every other cookie dies; this browser gets a fresh one immediately.
- A dead session never interrupts recording/transcribing — re-login in a new tab, then Retry; idle pages still redirect to `/login`
- All API routes protected. Mutations also reject cross-origin Origin/Referer hosts.
- Change username/password: **Settings → Account & security** (both require the current password)
- To reset a forgotten password: stop the app and delete `data/owner.json` (existing installs may still have `data/owner.hash`), then restart. The migration backup at `data/owner.hash.backup` is a safety net only — it is never served.
- An existing `data/owner.hash` is migrated byte-for-byte into `data/owner.json` on boot, with a protected backup and readback verification. The existing password keeps working; the username is `null` until you set it once.

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
| `O` | Toggle original / corrected view (when a correction changed the text) |
| `N` | New recording (clear + start) |
| `U` | Upload audio file |
| `A` | Toggle append mode |
| `T` | Toggle auto-clean |
| `1–5` | Switch cleanup prompt by position |
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
│   ├── live-capture-worklet.js      # Streaming mic capture (AudioWorklet)
│   ├── lib/
│   │   ├── audio-ledger.js          # Streaming/live audio blocks
│   │   ├── profiles-ui.js           # Settings profile helpers
│   │   └── corrections.js           # Exact glossary/correction rules
│   ├── styles.css         # Main styles
│   ├── sw.js              # Service worker (PWA)
│   ├── manifest.json      # PWA manifest
│   ├── favicon.svg        # App icon
│   ├── icon-192.png       # PWA icon
│   └── icon-512.png       # PWA icon
├── lib/                   # Server modules (profiles, auth, adapters, streaming)
├── test/                  # node --test suites
├── data/                  # Auto-created, gitignored
│   ├── owner.json         # Account record: username + bcrypt hash
│   ├── owner.hash.backup  # One-time migration backup (mode 0600, never served)
│   ├── session.generation # Session invalidation counter
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
| **OpenAI-compatible (profiles)** | OpenAI, Mistral Voxtral, Groq, OpenRouter, or a Custom endpoint — sent to `/audio/transcriptions`. Known providers have their base URL built in. | API key + model (Custom also asks for a base URL) |
| **Gemini (Google)** | Google's OpenAI-compatible layer. Audio is sent as an OpenAI-style `input_audio` part to `/chat/completions` with a "transcribe verbatim" prompt. The browser converts recordings to 16 kHz WAV first, so Chrome/Safari recordings work without a format fallback. | API key + model |
| **Native adapters** | ElevenLabs, Deepgram, Cohere (one call); AssemblyAI, Corti (submit + poll); Cartesia ink-2 (WebSocket, recorded audio). Each has its own protocol, auth header and response parser. | API key + model (Custom also asks for a base URL) |

Each profile stores its own key, encrypted at rest. **Recognition** fields (Language, Vocabulary hint) are shared by every voice model. A **fallback** model is opt-in and runs only after the active model fails — never silently.

**Key differences:**
- **Cost** — Gemini bills per token (audio tokenizes very efficiently), so it's typically far cheaper per minute than Whisper-compatible models that bill per minute of audio.
- **File size limit** — Gemini accepts inline audio up to ~20 MB (roughly 10–20 minutes of speech). Whisper-compatible engines accept up to the app's 50 MB cap. For typical dictation this won't matter, but very long single recordings may need the Whisper engine.
- **Language & vocabulary hint** — both engines respect the Language and Vocabulary hint fields.

### All settings fields

| Field | Where | Example |
|---|---|---|
| Profile name | Voice / Cleanup profile form | `My OpenAI`, `Gemini cleanup` |
| Provider | Provider picker | OpenAI, Mistral, Groq, Gemini, OpenRouter, ElevenLabs, Deepgram, Cohere, AssemblyAI, Corti, Cartesia, Custom |
| API key | Profile form | Masked as `••••1234` in every response; never returned in plaintext |
| Model | Profile form (with **Browse models**) | `whisper-1`, `voxtral-mini-latest`, `scribe_v2`, `nova-3` |
| Base URL | **Custom** profiles only, under Advanced | `http://my-server:8000/v1` |
| Transcription Language | Settings → Recognition (shared) | Optional — e.g. `en`; blank = auto-detect |
| Vocabulary hint | Settings → Recognition (shared) | Optional — names/jargon, e.g. `Acme, Jira, WebM` |
| Fallback voice model | Settings → Recognition | Optional — only runs after the active model fails |
| Cleanup prompt | Settings → Cleanup prompts | Default or one of up to 4 custom prompts |

Every known provider has its base URL built in — you never see or edit one. Keys stay server-side and are encrypted at rest (AES-256-GCM, `enc:v1:`), and `GET /api/settings` only ever returns a bullet + last 4 mask.

### Profile API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/settings` | Provider catalog + profiles (masked) + active ids + recognition fields |
| POST | `/api/profiles/transcription` | Create a voice profile `{ label, provider, key, model, engine?, baseUrl? }` |
| PATCH | `/api/profiles/transcription/:id` | Update; omit `key` to keep the saved one |
| DELETE | `/api/profiles/transcription/:id` | Delete (the active profile is refused) |
| POST | `/api/profiles/transcription/:id/activate` | Make it the active voice model |
| POST | `/api/profiles/cleanup` (and `/:id`, DELETE, activate) | Same four for the cleanup model |
| POST | `/api/settings/recognition` | Save shared language + vocabulary hint |
| POST | `/api/settings/fallback` | Opt-in fallback voice model (or `null`) |
| GET | `/api/account` | `{ username, needsUsername }` — never the hash |
| POST | `/api/account/username` | Change username (requires `currentPassword`) |
| POST | `/api/account/password` | Change password (bumps the session generation) |
| POST | `/api/test-transcription` · `/api/test-cleanup` | Test form values or a saved `profileId`; returns measured latency |
| POST | `/api/models` | Browse models for an OpenAI-compatible provider |

### Test connection

Each profile form has **Test & save**. It verifies the credentials, endpoint and model, reports the measured latency, and only then saves. You can also save without testing. Nothing is promised about provider latency until it has actually been measured.

---

## Streaming Cleanup

The server exposes `POST /cleanup-stream` which uses Server-Sent Events to forward chunked responses from the upstream cleanup API. The client renders text progressively as chunks arrive. If streaming fails or isn't supported by the provider, it falls back to the standard `POST /cleanup` endpoint automatically.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML/CSS/JS, Outfit + Fraunces fonts, PWA |
| Backend | Node.js, Express |
| Auth | bcryptjs, cookie-parser, HMAC sessions |
| AI | Any compatible speech-to-text + chat API |
| Audio | Web Audio API (AudioWorklet live capture), MediaRecorder |
| Streaming | Server-Sent Events (cleanup) + WebSocket proxy (`ws`) to Cartesia ink-2 |

---

## Notes

- No `.env` file required — all config via Settings tab
- Audio temp files deleted immediately after transcription; orphaned uploads older than 30 min are auto-swept every 15 min
- Session history is browser-side (localStorage)
- API keys are **encrypted at rest** (AES-256-GCM) in `data/settings.json` (gitignored). If the server's `data/session.secret` is ever recreated, stored keys can no longer be decrypted — re-enter them in Settings.
- `data/` directory auto-created on first run, fully gitignored
- PWA works offline for the UI shell; recording requires network for AI APIs
- Append mode keeps the growing document as the text on screen — there is no hidden buffer
- Turning Append **off** stops appending but leaves the document on screen as a normal transcript
- **Clear always wipes the whole on-screen document in one click** — no two-stage, no hidden state. To start a new appended document, Clear then turn Append on
- In Append mode, a recording appended to an existing document shows **"Appended & copied"**; a fresh start (empty document) shows "Cleaned copied" / "Raw copied"
- Only the latest segment is sent for cleanup — previous segments are never re-processed
- Transcription auto-retries twice (1s, then 2s backoff) on transient errors (5xx / 429 / network glitch) before showing the recovery bar
- Recording auto-stops after 5 minutes to avoid accidentally running forever. One minute before the deadline a warning appears with an **Extend +5 min** button — each click adds 5 more minutes, usable as many times as needed. If not extended, the recording stops automatically and transcribes normally.
- **Live streaming is automatic** — when the active voice model is a streaming model (Cartesia ink-2), the transcript fills in as you speak over a continuous WebSocket; the full session is still backed up locally as a WAV. Every other model records first and transcribes once at Stop. The Live segment of the Auto-clean / Live / Append chip is locked to reflect the active model.
- **Interrupted recordings are recoverable** — recordings are backed up locally while in progress. If the app is closed or killed mid-recording, open it again and the recovery strip appears with **Retry / Download / Discard**.
- **Clear during recording cancels the take** (it does not get transcribed back into the document).
- **Corrections are exact, not fuzzy** — an alias matches the whole phrase, ignoring case, and is replaced with the canonical spelling. Add each mishearing as a separate alias; the vocabulary hint remains the tool for general recognition bias.

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


## Live streaming behind nginx

Cartesia streaming uses a same-origin WebSocket at `/stt-stream`. The reverse proxy must forward upgrades (and must not buffer the connection):

```nginx
location /stt-stream {
    proxy_pass http://127.0.0.1:3003;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_read_timeout 600s;
    proxy_buffering off;
}
```

`ws` is a normal npm dependency (`npm install` installs it). Without the upgrade headers the browser falls back to record-then-transcribe automatically, so dictation still works — you just lose the live preview.

## Security environment

- `COOKIE_SECURE=1` — mark the session cookie `secure` (HTTPS deployments behind nginx only; leave off on plain-HTTP LAN or the browser refuses the cookie and login loops).
- `ALLOWED_ORIGINS` — extra trusted hosts for the Origin/Referer check, comma-separated.
- `SESSION_MAX_AGE_MS` is fixed at 180 days in `lib/sessions.js`.

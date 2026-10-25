# Murmur
Website https://hbrimer.github.io/murmur/
**Private, offline transcription & summaries.** Transcribe audio/video files or live
mic recordings, get an auto-summary and a searchable local library, and export to
txt / md / srt — all on-device. Your audio never leaves your machine.

## Why this sells

Paid apps in this space (MacWhisper, Superwhisper) already prove people pay. Murmur's
opening wedge:

- **Windows is underserved** — the popular paid apps are Mac-first.
- **Privacy is the product** — therapists, lawyers, doctors, journalists, execs who
  can't send audio to a cloud service. "100% on-device" is a moat free web tools can't cross.
- **Own-it pricing** — one-time purchase in a market full of subscriptions.

### Suggested pricing
- **$39 one-time (Personal)** — core app, all export formats.
- **$79 one-time (Pro)** — batch processing, larger models, (future) speaker labels.
- Keep the offline core subscription-free.

### Go-to-market
Niche-first: pick one audience (e.g. private-practice therapists), speak to their
privacy/compliance need directly, sell through their communities, then expand.

## Features (all working)

- **Import** — drag-drop or pick audio/video (mp3, m4a, wav, mp4, mov, mkv, …)
- **Record** — capture straight from the microphone and transcribe
- **Batch** — queue many files or a whole folder
- **Summaries** — on-device extractive summarizer (TextRank, zero dependencies)
- **Library** — searchable, local, delete anytime
- **Export** — txt / md / srt
- **Settings** — model, language, translate-to-English, summary length
- **Licensing** — offline key verification with a trial mode
- **Setup** — detects the engine and can download a model on request

Transcription is real (no placeholder text). Until the engine and a model are
installed, the app sends the user to **Setup** with a clear message.

## Architecture

```
src/
  main.js        Electron main — all local I/O, IPC, job orchestration
  preload.js     Locked-down contextBridge (the only renderer surface)
  transcribe.js  ffmpeg -> whisper.cpp pipeline, cancel + progress, clear errors
  ffmpeg.js      Any media -> 16kHz mono WAV (bundled or system ffmpeg)
  engine.js      Finds binary/models; optional model download (see privacy note)
  summarize.js   On-device extractive summarizer, no deps
  settings.js    Persisted settings (userData/settings.json)
  license.js     Offline Ed25519 license verification
  renderer/      UI: New / Record / Batch / Setup / Settings / License
scripts/
  licensing.js   Seller-side keygen + key signing CLI
```

### Privacy posture (you can state this in marketing)

- The transcription pipeline makes **no network calls**. Audio stays on disk.
- The **only** code path that uses the network is the optional model download in
  Setup (contacts Hugging Face), which runs only when the user clicks Download.
- All data lives under the OS user-data folder; "Open local data folder" reveals it.

> Before launch, do a real audit: run the built app behind a network monitor and
> confirm zero outbound traffic during transcription, and have the privacy claim
> reviewed so marketing matches reality.

## Enable real offline transcription

Built around [whisper.cpp](https://github.com/ggerganov/whisper.cpp):

1. Download a whisper.cpp release and put `whisper-cli.exe` **plus its DLLs** in `bin/`
   (mac/Linux: `bin/whisper-cli`). Older names `whisper`/`main` are also detected.
2. In the app, open **Setup** and download a model. Downloads go to the user-data
   `models/` folder; bundled `ggml-*.bin` files in the app's `models/` also work.
3. (Recommended) put an **ffmpeg** binary in `bin/` or install it on PATH, so non-WAV
   files work.
4. Restart — the sidebar status turns green ("offline engine ready").

No code changes needed; everything is auto-detected.

## Licensing (seller workflow)

```bash
node scripts/licensing.js keygen          # make your keypair; paste the public key
                                           # into src/license.js PUBLIC_KEY_PEM
node scripts/licensing.js sign --name "Jane Doe" --email jane@x.com --tier pro --days 0
                                           # prints a license key to give the buyer
```

Wire `sign` into your storefront's post-purchase webhook (Gumroad / Lemon Squeezy /
Paddle) to auto-issue keys. Keep `secrets/` out of version control (already gitignored).

## Develop & build

```bash
npm install
npm start          # run the app
npm run dist       # build installers (NSIS / dmg / AppImage)
```

Ship the whisper + ffmpeg binaries and any default model via `extraResources`
(configured in package.json) or your release pipeline — they're gitignored by size.

## What's left before you sell it

- Decide model size(s) to ship (accuracy vs. size/speed).
- Code-sign the installers (Windows SmartScreen) — needs a cert.
- Stand up a storefront + wire the licensing webhook.
- Run the pre-launch network audit above.

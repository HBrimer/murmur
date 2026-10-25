# Murmur — launch plan (out of demo → sellable v0.1)

Split agreed in Tandem (plan p9ab6960a): HBrimer's Claude = engine pipeline + UI,
teammate's Claude = tests, licensing, packaging/network audit.

## Done in code (needs testing — see checklist below)

- **Demo mode removed.** No placeholder transcript; if the engine/model is missing,
  starting a job shows a clear message and opens Setup. Sidebar says "Setup needed".
- **Engine detection:** finds `whisper-cli` (current whisper.cpp name), `whisper`, or `main`
  in `bin/`. Dev vs packaged paths use `process.defaultApp` (old check depended on a
  `models/` folder existing in resources).
- **Models:** downloads go to `%APPDATA%/Murmur/models` (always writable); bundled
  models still detected. Truncated (<1 MB) files are ignored.
- **Download hardening:** relative redirects, partial-file cleanup, interrupted/incomplete
  download detection, readable errors.
- **ffmpeg:** cancel now works during conversion, explicit `pcm_s16le`, `-nostdin`,
  unique temp names, friendlier error.
- **whisper:** thread count set, progress read from stdout+stderr, real error text on
  failure, empty-transcript detection, one job at a time, missing-file check.
- **Drag-and-drop fixed:** Electron 33 removed `File.path`; now uses `webUtils.getPathForFile`.
- **Batch:** re-running no longer re-transcribes finished items; failure reason shown.

## Test checklist (could not run tests in this session)

1. `npm start` with empty `bin/` → sidebar "Setup needed"; dropping a file → alert + Setup opens.
2. Put whisper-cli.exe + DLLs in `bin/`, download `base.en` in Setup → progress bar fills,
   sidebar turns green.
3. Transcribe a .wav, an .mp3 and an .mp4 (needs ffmpeg in `bin/` or PATH). Check text + SRT export.
4. Drag-and-drop a file onto the drop zone (this was broken before).
5. Cancel during "preparing audio" and during "transcribing".
6. Pull the network cable mid-download → error shown, no `.part` left; Retry works.
7. Batch: add 3 files, run, run again → finished ones are skipped.
8. Build the installer (`npm run dist`) and repeat 2–3 from the installed app.

## Left for HBrimer (needs a human)

- **Pick the default model.** Suggestion: `base.en` (142 MB, good English accuracy);
  `small.en` (466 MB) if accuracy matters more than download size. It's in
  `engine.js` as `DEFAULT_MODEL` (not used anywhere yet).
- **Get the binaries:** download a whisper.cpp Windows release (whisper-cli.exe + DLLs) and a
  static ffmpeg build into `bin/`. Check both licenses (whisper.cpp MIT; ffmpeg LGPL/GPL,
  depending on the build, so use an LGPL build or comply with GPL).
- **Code-signing certificate** (Windows SmartScreen warns about unsigned installers) and an
  Apple Developer account if you ship for Mac.
- **Storefront** (Lemon Squeezy / Gumroad / Paddle), prices, and connecting the license
  webhook (teammate is documenting this in step 3).
- **Privacy claim review** before marketing "100% offline" (teammate's audit in step 5).
- Website/landing page, support email, refund policy, EULA.

## Teammate's steps (not touched here)

Tests (`test/`, `npm test`), licensing keypair + verification, installer build + network audit.

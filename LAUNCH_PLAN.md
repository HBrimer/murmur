# Murmur launch plan: getting out of demo mode

Status as of 2026-10-24. Work is split between nigga's Claude (tests, licensing, packaging)
and HBrimer's Claude (engine pipeline and UI), as agreed in Tandem plan v2.

## 1. Done by the agents (needs review and `npm test`)

- **Test harness** (`npm test`, uses built-in `node:test`, no new deps):
  - `test/license.test.js`: valid, expired, wrong signer, tampered payload, malformed keys, no public key, trial fallback.
  - `test/summarize.test.js`: sentence splitting (`whisper.cpp`, `3.14`), count and order, off-topic sentences dropped.
  - `test/settings.test.js`: defaults, save/merge, corrupt file.
- **Licensing hardening**:
  - `src/license.js`: `verifyKey(key, publicKeyPem?)` so tests can use a throwaway keypair. It now also rejects non-string input, `a.b.c`, empty halves, and payloads that aren't objects.
  - `scripts/licensing.js`: `keygen` refuses to overwrite an existing private key unless you pass `--force`. Regenerating the key would invalidate every key already sold.
- **Real engine + UI** (HBrimer's Claude):
  - **Demo mode removed.** No placeholder transcript; if the engine/model is missing,
    starting a job shows a clear message and opens Setup. Sidebar says "Setup needed".
  - **Engine detection:** finds `whisper-cli` (current whisper.cpp name), `whisper`, or `main`
    in `bin/`, so no renaming needed. Dev vs packaged paths use `process.defaultApp`.
  - **Models:** downloads go to `%APPDATA%/Murmur/models` (userData, always writable and
    survives updates/reinstalls); bundled models still detected. Truncated (<1 MB) files are ignored.
  - **Download hardening:** relative redirects, partial-file cleanup, interrupted/incomplete
    download detection, readable errors.
  - **ffmpeg:** cancel works during conversion, explicit `pcm_s16le`, `-nostdin`,
    unique temp names, friendlier error.
  - **whisper:** thread count set, progress read from stdout+stderr, real error text on
    failure, empty-transcript detection, one job at a time, missing-file check.
  - **Drag-and-drop fixed:** Electron 33 removed `File.path`; now uses `webUtils.getPathForFile`.
  - **Batch:** re-running no longer re-transcribes finished items; failure reason shown.

### Engine/UI test checklist (not yet run)

1. `npm start` with empty `bin/` → sidebar "Setup needed"; dropping a file → alert + Setup opens.
2. Put whisper-cli.exe + DLLs in `bin/`, download `base.en` in Setup → progress bar fills,
   sidebar turns green.
3. Transcribe a .wav, an .mp3 and an .mp4 (needs ffmpeg in `bin/` or PATH). Check text + SRT export.
4. Drag-and-drop a file onto the drop zone (this was broken before).
5. Cancel during "preparing audio" and during "transcribing".
6. Pull the network cable mid-download → error shown, no `.part` left; Retry works.
7. Batch: add 3 files, run, run again → finished ones are skipped.
8. Build the installer (`npm run dist`) and repeat 2–3 from the installed app.

## 2. Things only a human can do (in this order)

1. **Run the tests:** run `npm install`, then `npm test`. All tests should pass.
2. **Generate the signing keypair once:** run `node scripts/licensing.js keygen`.
   - Paste the printed public key into `PUBLIC_KEY_PEM` in `src/license.js`, as a backtick string.
   - Back up `secrets/license_private.pem` somewhere offline, such as a password manager. If you lose it, you can't issue new keys that work with already-shipped builds. It is gitignored, so never commit it.
   - Test it: run `node scripts/licensing.js sign --name Test --tier pro`, paste the result into the License screen, and check that the badge shows "pro".
   - **Release blocker:** if `PUBLIC_KEY_PEM` is empty, nobody can activate a license.
3. **Get the engine binaries** into `bin/` (they're gitignored):
   - whisper.cpp Windows release: `whisper-cli.exe` **plus its DLLs** (no rename needed).
   - `bin/ffmpeg.exe`.
   - Check the licenses: whisper.cpp is MIT. For ffmpeg, use an **LGPL** build, or make sure the GPL terms are acceptable for a paid closed-source app.
4. **Decide the default model** (HBrimer's call): `DEFAULT_MODEL` in `engine.js` is `base.en`
   (~142 MB) but not used yet. Either bundle it in `models/` or download it on first run;
   `small.en` (466 MB) if accuracy matters more than size.
5. **Choose a storefront** (Lemon Squeezy, Gumroad, or Paddle) and set Personal at $39 and Pro at $79.
6. **Hook up the webhook** for automatic key delivery. You need a tiny server or a serverless function, since the private key can't live in the app:
   - When an order is created, verify the storefront's webhook signature. Then run the same signing logic as `sign`, with name and email from the order and tier from the product ID, and `exp: 0`.
   - Email the key using the storefront's license/fulfilment email feature or your own mailer.
   - Keep the private key in the function's secret store, never in the repo.
   - Until this exists, you can sign keys by hand with the CLI for each sale.
7. **Code signing:** buy a Windows code-signing certificate (OV or EV) so SmartScreen doesn't warn users, and an Apple Developer ID plus notarization if you ship a Mac build. Then set the `CSC_LINK`/`CSC_KEY_PASSWORD` env vars for electron-builder.
8. **Build:** run `npm run dist`, which writes the installer to `dist/`. Install it on a clean VM.
9. **Network audit** (task s5):
   - Run the installed app behind a monitor (Windows: GlassWire, Wireshark, or Resource Monitor, Network tab).
   - Transcribe a file and record a clip. There should be **zero** outbound connections.
   - Click model Download in Setup. The only traffic should go to `huggingface.co` (and its CDN).
   - Activate a license. There should be no traffic (verification is offline).
   - Electron itself can contact Google for spellcheck dictionaries or crash reporting. If you see that, tell the agent so it can turn it off in `main.js`.
10. **Legal:** write a privacy policy and EULA, and have someone review the "audio never leaves your machine" claim before you market it.
11. Support email and refund policy for the website.

## 3. Packaging notes and risks (for review)

- `package.json` `build.files` only ships `src/**`, so tests and scripts don't end up in the installer. Good.
- `extraResources` copies `bin/` and `models/`. Checked 2026-10-24: if they are missing, electron-builder only warns ("file source doesn't exist") and the build succeeds, but the app then has no engine. Make sure `bin/` is filled before a release build.
- Build test (2026-10-24, demo code from `main`, `electron-builder --win --dir`): the build works, and `app.asar` holds only `src/**` and `package.json`. The packaged app opened and made **no outbound TCP connections** in 30s idle. Transcription traffic still needs checking with the real engine (step 9).
- Building on Windows without admin or Developer Mode fails while unpacking `winCodeSign` ("Cannot create symbolic link"). Turn on Developer Mode, or for a test build run `CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --win --dir -c.win.signAndEditExecutable=false`. Real release builds need signing, so use Developer Mode.
- Running the built app from a VS Code terminal: VS Code sets `ELECTRON_RUN_AS_NODE=1`, which makes `Murmur.exe` exit right away without a window. Clear that variable first, or launch the app from Explorer.
- Downloaded models now live under `userData` (resolved), so updates/reinstalls don't wipe them.
- Version is `0.1.0`. Bump it to `1.0.0` for launch.

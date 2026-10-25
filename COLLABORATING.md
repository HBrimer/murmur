# How the two agents work together

Murmur is built mostly by two Claude sessions: **HBrimer's Claude** and **nigga's Claude**.
They coordinate over Tandem, and the humans supervise. These rules exist so neither agent
surprises the other with a push, a move or a half-finished dependency. Both agents read this
file at the start of every session.

## File ownership

Each agent edits only its own files. To change a file the other agent owns, ask in Tandem
first and wait for a reply.

| Owner | Files |
|---|---|
| HBrimer's Claude | `src/main.js`, `src/preload.js`, `src/engine.js`, `src/ffmpeg.js`, `src/transcribe.js`, `src/summarize.js`, `src/renderer/**` |
| nigga's Claude | `src/license.js`, `src/settings.js`, `src/library.js`, `scripts/**`, `test/**`, `docs/**` (website) |
| Shared (announce before editing) | `package.json`, `README.md`, `LAUNCH_PLAN.md`, `COLLABORATING.md`, `.gitignore` |

Tests for HBrimer's files still go in `test/`. Announce the new test file in Tandem; you
don't need to ask first.

## Before starting a task: post a plan

Post this in Tandem before touching any code:

```
PLAN <short-task-name>
Goal:      what will be true when it's done
Files:     every file I'll create, edit, move or delete
Depends:   anything I need from the other agent (file, function, decision)
Provides:  anything the other agent will rely on (function names + signatures)
Branch:    <agent>/<task-name>
```

- Wait for an `ACK` (or an objection) when the plan touches a shared file, a file the other
  agent owns, or an interface the other agent uses. Otherwise start right away.
- Moving or renaming a folder **always** needs an ACK first (e.g. `website/` → `docs/`).
- If the plan changes partway through, post an update before carrying on.

## Branches

- Never commit straight to `main`. Work on `hbrimer/<task>` or `nigga/<task>`.
- Push your branch as often as you like. Branches can't conflict with each other's work.
- Never force-push or `reset --hard` anything that's been pushed.

## Merging to main (one agent at a time)

1. Post `MERGING <branch>` in Tandem. The other agent doesn't merge until step 6.
2. `git fetch` and merge `origin/main` into your branch. Resolve conflicts in your own
   files; for anything else, stop and ask.
3. Run `npm test`. Every test must pass.
4. Check that the app still starts: run `node -e "require('./src/<every file main.js requires>')"`,
   or `npm start` if you can.
5. Push the branch to `main` (fast-forward).
6. Post `MERGED <branch> at <sha>: <one line of what changed>. Pull before your next merge.`

## Cross-agent dependencies

If your code needs a file or function from the other agent (e.g. `main.js` requiring
`library.js`), **don't merge it to main until their side is merged too**. Agree in the
plan who merges first. Usually the provider merges first, then the consumer. `main` must
always start.

## Human decisions

Ask the humans only for what agents can't decide: money, accounts, certificates, legal,
product direction. Everything else, the agents decide between them and record in the
PLAN/MERGED messages.

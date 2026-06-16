# Practice Journal Plugin Constitution

The Practice Journal plugin (id: `practice_journal`) automatically tracks
practice sessions and exposes a dashboard summarizing time, top songs, and
recent activity.

## Core Principles

### I. Automatic, Never Manual
A session starts the moment a song plays and ends the moment the user
leaves the player or closes the tab. There is no user-facing
start/stop button. Sessions shorter than 5 seconds are dropped server-side
(`routes.py:57-58`).

### II. Idempotent Hooks
The plugin wraps four host globals: `playSong`, `showScreen`, `setSpeed`,
`loadSavedLoop`. Re-evaluating `screen.js` (loader cache miss, hot reload,
older core builds) MUST NOT grow the wrapper chain. The
`__slopsmithPracticeHooksInstalled` guard (`screen.js:20-22`) enforces
this — it is non-negotiable and applies as a single guard for ALL four
wrappers.

### III. Fire-and-Forget Telemetry
The `/session` POST is always fire-and-forget on the client
(`screen.js:79-92`). The user's practice flow is never blocked by a
network failure. Lost sessions are acceptable; corrupted sessions are
not.

### IV. Per-Plugin SQLite Database
State lives in `${config_dir}/practice_journal.db` (`routes.py:47`),
WAL-mode, behind a process-local `threading.Lock`. The schema is
created on first use and migrated forward only (no destructive
migrations).

### V. Profile Import is a Read-Side Concern
Other plugins (notably `profileimport`) MAY write synthetic
`practice_sessions` rows directly into our DB. The schema and indexes
documented here are the public contract. Breaking changes require
coordinating with profileimport.

## Inheritance from Slopsmith Core

Inherits the core plugin contract: `setup(app, context)` entry point,
`context["config_dir"]` for filesystem state, FastAPI routes mounted
under `/api/plugins/practice_journal/...`. The frontend assumes core
exposes `playSong`, `showScreen`, `setSpeed`, `loadSavedLoop`,
`hud-title`/`hud-artist`/`hud-arrangement` DOM ids, and a screen id
of `plugin-practice_journal`.

## Governance

Schema changes bump `plugin.json:version`. Wire-format changes to
the `/stats` or `/song/{filename}` endpoints require a new versioned
endpoint, not an in-place change.

**Version**: 1.0.0 | **Ratified**: 2026-05-09 | **Last Amended**: 2026-05-09

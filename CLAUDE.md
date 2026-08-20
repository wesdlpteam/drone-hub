# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Drone Hub: a hub laptop runs a tiny Python web server; classroom iPads open a web
page over Wi-Fi to fly CoDrone EDU drones plugged into the laptop by USB
(`iPad Safari -> Wi-Fi -> hub laptop :8600 -> USB serial -> drone`). Built for a
primary school; users are teachers and young kids, so safety caps and simplicity
are deliberate design decisions, not accidents.

## Running it

There is no build step, no linter, and no test suite.

```
python drone_hub/server.py               # auto-detects USB controllers, else Practice Mode
python drone_hub/server.py --practice    # force 6 virtual drones (no hardware)
python drone_hub/server.py --no-browser  # don't auto-open the Teacher Screen
python drone_hub/server.py --port 8601   # non-default port
```

- Student UI: `http://localhost:8600/` — Teacher Screen: `http://localhost:8600/teacher`
- `Start Drone Hub.bat` / `Start Practice Mode.bat` are the teacher-facing
  launchers; the first creates `drone_hub/.venv` and installs `codrone-edu` from a
  bundled `drone_hub/wheels` folder (offline first, online fallback).
- Verification = run in Practice Mode and drive the UI in a real browser
  (desktop + mobile viewport). Playwright screenshots go to `output/playwright/`
  (untracked). Real-drone behaviour can only be confirmed with hardware plugged in.

## Hard constraints

- **Server is Python standard library only.** The school network blocks pip, so
  never add a server dependency. `codrone-edu` is the single optional package,
  needed only for real drones and loaded lazily inside `RealDrone`.
- **Frontend is dependency-free vanilla JS** served as static files — no
  frameworks, no bundler, no npm. `qrcode.js` is vendored.
- **Safety caps are intentional classroom limits — do not raise them.** Moves
  20–150 cm, turns 45–180°, hover 1–5 s, slow speed, max 30 program steps, queue
  cap 10. They are enforced twice: `validate_step()` in `server.py` (first line)
  and clamps in `drone_backend.py` (last line of defence). Keep both.
- **No student data.** LAN only, no cloud, no accounts; pilot names live in
  memory only. FOR-IT.md promises this to school IT — don't break it.
- Target platform is Windows; `server.py` supports PyInstaller freezing
  (`_MEIPASS` static dir).

## Architecture

**`drone_hub/server.py`** — stdlib `ThreadingHTTPServer` on port 8600.
- One `DroneUnit` per drone: its own command `queue.Queue`, daemon worker thread,
  and shared `abort` Event. HTTP handlers only validate and enqueue; the worker
  executes serially. STOP works by setting `abort`, which drains the queue and
  lands.
- Pilot model: one pilot per drone. `/api/control` issues a random token;
  `/api/command` and `/api/run` require it. `/api/stop` and `/api/motors_off`
  deliberately need **no** token (any device can stop any drone). `/api/pause`
  only accepts requests from 127.0.0.1 so only the hub laptop (teacher) can
  pause/unpause.
- All shared state is guarded by the single `state_lock`.
- `validate_step()` is the allowlist for every block/command the UI can send;
  adding a new block means extending it plus `execute()` and `step_label()`.

**`drone_hub/drone_backend.py`** — two interchangeable backends with the same
interface: `PracticeDrone` (virtual, tracks x/y/altitude/heading pose for the
on-screen radar, moves in 0.1 s abortable slices) and `RealDrone` (wraps
Robolink's `codrone_edu`). `server.py` never knows which it has. New backend
methods must be added to both.

**`drone_hub/static/`** — `index.html` + `app.js` is the student app shell
(FLY tab, drone picker, radar canvas, PWA install flow). The CODE tab is a
Blockly editor with 2 levels: Level 1 picture blocks run through the flat
`/api/run` path; Level 2 is the full official CoDrone EDU block catalogue —
blocks compile to JavaScript (`program-runner.js`) and run in a sandboxed
JS-Interpreter, sending each drone action through `/api/command` and reading
sensors from `/api/sensors`. Block definitions/toolboxes live in
`blocks-data.js`; each block's server action must match the `validate_step()`
allowlist. Vendored: `blockly.min.js` (12.5.1, includes JS generator),
`blockly-python.min.js`, `js-interpreter.js`. `teacher.html` is the Teacher
Screen (QR code, pause, stop-all). `sw.js` caches the app shell — **bump
`SHELL_CACHE` version whenever you change app-shell files** (index.html,
style.css, any app .js, manifest, icons).

## Repo notes

- `drone_hub/.venv/` is gitignored but present on disk and floods glob/grep —
  always exclude it when searching.
- `docs/index.html` is the public download page (GitHub Pages,
  https://wesdlpteam.github.io/drone-hub/), serving `DroneHub.zip` from GitHub
  releases. `FOR-IT.md` is the deployment note for school IT.
- Original design spec: `docs/superpowers/specs/2026-08-10-ipad-drone-control-design.md`.
- README.md is written for teachers — keep it jargon-free if you edit it.

# iPad Control for CoDrone EDU — Design

Date: 2026-08-10
Status: built (v1)

## Problem

Primary school has iPads only. CoDrone EDU needs its controller plugged into a computer
by USB (Python lib `codrone-edu` talks serial to controller; controller radios to drone).
iPads have no USB serial and Safari has no Web Serial. Direct iPad-to-drone impossible.

## Approaches considered

1. **Drone Hub (CHOSEN)** — one laptop in room runs small Python web server with the
   controller plugged in. iPads join same Wi-Fi, open web page, fly from there.
   Pros: works today, no iPad install, kids never touch laptop. Cons: needs one laptop
   in the room (teacher station).
2. Remote desktop from iPad to laptop — clunky, not kid-friendly, still one-user.
3. Wait for official Robolink iPad app — none exists for CoDrone EDU; not in our control.

## Architecture

```
iPads (Safari) --Wi-Fi--> Flask server on hub laptop --USB--> controller --radio--> drone
```

- **server.py** — pure-stdlib HTTP server (http.server, no pip packages; school
  networks proved to break pip mid-download). Serves static UI + JSON API. Command
  queue + worker thread (drone commands block for seconds; HTTP must return fast).
- **drone_backend.py** — `PracticeDrone` (virtual: tracks x/y/alt/heading/battery) and
  `RealDrone` (wraps `codrone_edu.drone.Drone`). Same interface. Server auto-picks:
  real if library + controller present, else practice mode.
- **static/** — index.html + app.js + style.css. Vanilla JS, no CDN (works offline).
  Polls `/api/status` 1/sec. Big touch targets for primary kids.

## API

- `GET /api/status` — mode, flying, battery, pilot name, queue, running step, virtual pose
- `POST /api/control` `{name}` — take controls (returns token). Anyone can take over
  (teacher manages turns). Token required for commands.
- `POST /api/command` `{action, value, token}` — single move (takeoff, land, forward,
  back, left, right, up, down, turn_left, turn_right, hover, flip, led)
- `POST /api/run` `{steps:[...], token}` — run block program as queued sequence
- `POST /api/stop` — NO token needed, any device: clears queue + lands
- `POST /api/motors_off` — no token, double-confirm in UI: emergency_stop()

## Safety

- STOP & LAND button always visible on every screen, works from any iPad.
- Motors-off emergency behind a confirm tap.
- Distances clamped 20–150 cm, turns 45–180°, hover 1–5 s, speed fixed gentle.
- One pilot at a time (token lock); others watch live status.

## UI

Two tabs: **FLY** (big arrow buttons, take off / land, LED colours) and
**CODE** (tap-to-add block sequence: take off, moves, turns, hover, flip, LED, land;
reorder/delete; Run shows current step highlight). Practice mode shows top-down
virtual drone on canvas so it's testable/teachable with zero hardware.

## Ops

- `Start Drone Hub.bat` — best-effort venv + `codrone-edu` install (real mode only),
  starts server on port 8600, prints iPad URL. Practice mode = zero installs.
- README covers: setup, connecting iPads, AP-isolation fallback (Windows mobile hotspot).

## Testing

Run server in practice mode, exercise every endpoint, load UI in browser, run a block
program end-to-end against the virtual drone.

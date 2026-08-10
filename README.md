# Drone Pilot — fly CoDrone EDU from iPads

The CoDrone EDU drones normally need a laptop with the controller plugged in by USB,
which the primary school's iPads can't do. This app fixes that with a simple idea:

**One laptop in the room becomes the "Drone Hub". The iPads control the drone
through a web page — no cables, no app store, nothing installed on the iPads.**

```
iPad (Safari) --> Wi-Fi --> Hub laptop --> USB controller --> drone
```

## What the kids get

- **FLY tab** — big friendly buttons: take off, land, arrows to move, turn, flip,
  and colour the drone's lights.
- **CODE tab** — tap blocks to build a little program, press RUN, watch the drone
  do it. Five difficulty levels (like Ozobot): Level 1 is picture-only blocks for
  pre-readers; higher levels add more blocks, choosable numbers, repeat loops, and
  at Level 5 a live view of the real Python code their blocks create.
- **Practice Mode** — with no drones plugged in you get SIX virtual drones flying
  around on-screen maps, so a whole class can code and fly with zero hardware.

## More than one drone

Plug up to six controllers into the hub laptop (a USB hub is fine) **before**
starting. Each becomes a colour-named drone — "Red drone", "Blue drone", and so on —
and its lights glow that colour. Kids scan the QR and tap the drone they want.
Tip: put matching coloured tape on each drone and its controller.

## Safety built in

- A big red **STOP & LAND** button on every screen, and it works from *any* iPad,
  not just the pilot's.
- Only **one pilot at a time** (they tap "Take the controls" and type their name).
  Everyone else watches live. Taking over is one tap, so the teacher stays in charge.
- All moves are gentle and capped (20–150 cm, slow speed).
- A "motors off" emergency button exists too, tucked away with an "are you sure?" step.

## One-time setup (hub laptop)

1. Copy this whole folder onto the laptop that will be the hub.
2. Make sure Python is installed (python.org → Downloads → tick "Add Python to PATH").
3. Double-click **Start Drone Hub.bat**. The first run installs the real-drone
   library from the bundled `drone_hub\wheels` folder, so no internet is needed.
   (The bundled files suit Python 3.14 on 64-bit Windows; a different Python
   falls back to an online install. Practice Mode always works regardless.)

## Every lesson after that

1. Plug the drone's controller into the hub laptop with the USB cable and turn the
   drone on.
2. Double-click **Start Drone Hub.bat**.
3. The **Teacher Screen** opens in the laptop's browser by itself, showing a giant
   QR code. Kids point the iPad camera at it and tap — no typing needed.
   (The address is also shown in big text for anyone who prefers to type it.)
4. Fly! (No drone plugged in? It automatically runs Practice Mode instead.)

### The Teacher Screen

Opens automatically on the hub laptop. It shows the QR code, live status (battery,
who's flying, what the drone is doing), plus two teacher-only powers:

- **⏸️ PAUSE THE CLASS** — freezes all iPad commands while you're talking; press
  again to let them fly. Only works from the hub laptop, so kids can't unpause.
- **🛑 STOP & LAND NOW** — same as the red button on the iPads.

### Make it feel like a real app (one time per iPad)

Open the page in Safari → tap **Share** → **Add to Home Screen**. A Drone Pilot
icon appears and opens full screen like a proper app.

To practise without any drone at all, use **Start Practice Mode.bat**.

## If the iPads can't reach the page

Some school Wi-Fi blocks devices from talking to each other. Easy fix:

1. On the hub laptop: Settings → Network & internet → **Mobile hotspot** → turn it on.
2. Join the iPads to that hotspot instead of the school Wi-Fi.
3. Restart the hub (double-click the .bat again) and use the new address it shows.

## Troubleshooting

- **"No drone controller found" but it's plugged in** — check the controller is
  switched on and paired to the drone (its screen shows this), unplug/replug the USB,
  then restart the hub.
- **Page loads but buttons say someone else has the controls** — tap
  "TAKE THE CONTROLS" and type a name. Last person to take them is the pilot.
- **Battery low warning** — land and swap the drone battery like normal.
- **Windows firewall asks a question the first time** — choose **Allow** (it's the
  iPads talking to the laptop on the local network only).

## Notes for IT

- Pure Python 3 standard library (no packages needed for Practice Mode), runs
  entirely on the LAN, port 8600, no cloud services, no accounts, no student
  data stored or sent anywhere.
- Real-drone control uses Robolink's official `codrone-edu` Python library.
- Code lives in `drone_hub/` (server.py, drone_backend.py, static web UI).

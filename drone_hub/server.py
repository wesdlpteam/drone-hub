"""CoDrone EDU Hub server — multi-drone.

Runs on one laptop. Plug 1-6 CoDrone EDU controllers in by USB (a USB hub is
fine); each becomes a colour-named drone that iPads on the same Wi-Fi can fly
from http://<this-laptop>:8600. With no controllers plugged in it runs
Practice Mode with six virtual drones.

Uses only the Python standard library; the optional codrone-edu package is
needed only for real drones.

Start:  python server.py                (auto-detects controllers)
        python server.py --practice     (force virtual drones)
        python server.py --no-browser   (don't open the Teacher Screen)
"""

import json
import queue
import socket
import sys
import threading
import time
import uuid
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from drone_backend import PracticeDrone, RealDrone, clamp, detect_controller_ports

PORT = 8600
if "--port" in sys.argv:
    try:
        PORT = int(sys.argv[sys.argv.index("--port") + 1])
    except (IndexError, ValueError):
        pass
MAX_PROGRAM_STEPS = 30
PRACTICE_DRONE_COUNT = 6
# When frozen into DroneHub.exe, PyInstaller unpacks bundled files to _MEIPASS
STATIC_DIR = Path(getattr(sys, "_MEIPASS", Path(__file__).parent)) / "static"
STATIC_FILES = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/teacher": ("teacher.html", "text/html; charset=utf-8"),
    "/style.css": ("style.css", "text/css; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
    "/qrcode.js": ("qrcode.js", "text/javascript; charset=utf-8"),
    "/icon.png": ("icon.png", "image/png"),
}

COLOURS = [
    ("Red", [255, 70, 70]),
    ("Blue", [70, 130, 255]),
    ("Green", [40, 210, 130]),
    ("Yellow", [255, 200, 40]),
    ("Purple", [175, 95, 255]),
    ("Orange", [255, 140, 50]),
]

state_lock = threading.Lock()
paused = False
hub_url = ""
mode = "practice"
units = []  # list of DroneUnit


# ---------------------------------------------------------------- drone unit

class DroneUnit:
    """One drone: backend + its own queue, worker, pilot and status."""

    def __init__(self, uid, name, rgb, backend):
        self.id = uid
        self.name = name
        self.rgb = rgb
        self.backend = backend
        self.queue = queue.Queue()
        self.abort = backend.abort_event
        self.pilot = None      # {"name", "token"}
        self.battery = 100
        self.current = None    # {"label", "step", "total"}
        self.message = ""

    def start(self):
        threading.Thread(target=self._worker, daemon=True).start()

    def _worker(self):
        last_battery = 0.0
        while True:
            if self.abort.is_set():
                while not self.queue.empty():
                    try:
                        self.queue.get_nowait()
                    except queue.Empty:
                        break
                self.abort.clear()
                if self.backend.flying:
                    with state_lock:
                        self.current = {"label": "STOP - landing", "step": None, "total": None}
                    try:
                        self.backend.land()
                    except Exception:
                        pass
                with state_lock:
                    self.current = None
                continue

            try:
                item = self.queue.get(timeout=0.25)
            except queue.Empty:
                if time.time() - last_battery > 5:
                    with state_lock:
                        self.battery = self.backend.get_battery()
                    last_battery = time.time()
                continue

            with state_lock:
                self.current = {"label": item["label"],
                                "step": item.get("step"), "total": item.get("total")}
            try:
                execute(self.backend, item)
            except Exception as exc:
                with state_lock:
                    self.message = f"Command failed: {exc}"
            with state_lock:
                self.current = None
                self.battery = self.backend.get_battery()
            last_battery = time.time()

    def snapshot(self):
        with state_lock:
            return {
                "id": self.id,
                "name": self.name,
                "colour": self.rgb,
                "flying": self.backend.flying,
                "battery": self.battery,
                "pilot": self.pilot["name"] if self.pilot else None,
                "queue": self.queue.qsize(),
                "current": dict(self.current) if self.current else None,
                "pose": self.backend.pose(),
                "led": self.backend.led,
                "message": self.message,
            }


def get_unit(data):
    uid = data.get("drone_id")
    for u in units:
        if u.id == uid:
            return u
    return None


def pilot_ok(unit, token):
    with state_lock:
        return unit.pilot is not None and unit.pilot["token"] == token


# ---------------------------------------------------------------- commands

def step_label(action, value):
    names = {
        "takeoff": "Take off", "land": "Land", "forward": "Forward",
        "back": "Backward", "left": "Slide left", "right": "Slide right",
        "up": "Up", "down": "Down", "turn_left": "Turn left",
        "turn_right": "Turn right", "hover": "Wait", "flip": "Flip",
        "led": "Light colour",
    }
    label = names.get(action, action)
    if action in ("forward", "back", "left", "right", "up", "down"):
        label += f" {int(clamp(value, 20, 150))} cm"
    elif action in ("turn_left", "turn_right"):
        label += f" {int(clamp(value, 45, 180))} deg"
    elif action == "hover":
        label += f" {int(clamp(value, 1, 5))} s"
    return label


def validate_step(raw):
    """Return a safe queue item, or None if the step is not allowed."""
    if not isinstance(raw, dict):
        return None
    action = raw.get("action")
    value = raw.get("value")
    allowed = {"takeoff", "land", "forward", "back", "left", "right", "up",
               "down", "turn_left", "turn_right", "hover", "flip", "led"}
    if action not in allowed:
        return None
    if action in ("forward", "back", "left", "right", "up", "down"):
        value = clamp(value, 20, 150)
    elif action in ("turn_left", "turn_right"):
        value = clamp(value, 45, 180)
    elif action == "hover":
        value = clamp(value, 1, 5)
    elif action == "flip":
        value = value if value in ("front", "back", "left", "right") else "back"
    elif action == "led":
        if not (isinstance(value, (list, tuple)) and len(value) == 3):
            return None
        value = [int(clamp(v, 0, 255)) for v in value]
    else:
        value = None
    return {"action": action, "value": value, "label": step_label(action, value)}


def execute(backend, item):
    action, value = item["action"], item["value"]
    if action == "takeoff":
        backend.takeoff()
    elif action == "land":
        backend.land()
    elif action in ("forward", "back", "left", "right", "up", "down"):
        backend.move(action, value)
    elif action == "turn_left":
        backend.turn("left", value)
    elif action == "turn_right":
        backend.turn("right", value)
    elif action == "hover":
        backend.hover(value)
    elif action == "flip":
        backend.flip("forward" if value == "front" else value)
    elif action == "led":
        backend.set_led(*value)


# ---------------------------------------------------------------- API logic

def api_status():
    with state_lock:
        p = paused
    return 200, {
        "mode": mode,
        "paused": p,
        "url": hub_url,
        "drones": [u.snapshot() for u in units],
    }


def api_control(data):
    unit = get_unit(data)
    if unit is None:
        return 404, {"ok": False, "error": "no_such_drone"}
    if data.get("release"):
        if pilot_ok(unit, data.get("token")):
            with state_lock:
                unit.pilot = None
        return 200, {"ok": True}
    name = str(data.get("name", "")).strip()[:20] or "Pilot"
    token = uuid.uuid4().hex[:12]
    with state_lock:
        unit.pilot = {"name": name, "token": token}
    return 200, {"ok": True, "token": token, "name": name, "drone_id": unit.id}


def api_command(data):
    with state_lock:
        if paused:
            return 423, {"ok": False, "error": "paused"}
    unit = get_unit(data)
    if unit is None:
        return 404, {"ok": False, "error": "no_such_drone"}
    if not pilot_ok(unit, data.get("token")):
        return 403, {"ok": False, "error": "not_pilot"}
    if unit.queue.qsize() > 10:
        return 429, {"ok": False, "error": "busy"}
    item = validate_step(data)
    if item is None:
        return 400, {"ok": False, "error": "bad_command"}
    unit.queue.put(item)
    return 200, {"ok": True, "label": item["label"]}


def api_run(data):
    with state_lock:
        if paused:
            return 423, {"ok": False, "error": "paused"}
    unit = get_unit(data)
    if unit is None:
        return 404, {"ok": False, "error": "no_such_drone"}
    if not pilot_ok(unit, data.get("token")):
        return 403, {"ok": False, "error": "not_pilot"}
    steps = data.get("steps")
    if not isinstance(steps, list) or not steps or len(steps) > MAX_PROGRAM_STEPS:
        return 400, {"ok": False, "error": "bad_program"}
    items = []
    for raw in steps:
        item = validate_step(raw)
        if item is None:
            return 400, {"ok": False, "error": "bad_step"}
        items.append(item)
    for i, item in enumerate(items):
        item["step"] = i + 1
        item["total"] = len(items)
        unit.queue.put(item)
    return 200, {"ok": True, "steps": len(items)}


def api_stop(data):
    """STOP & LAND. Works from any device. drone_id optional: omit = ALL."""
    unit = get_unit(data)
    targets = [unit] if unit else units
    for u in targets:
        u.abort.set()
    return 200, {"ok": True, "stopped": len(targets)}


def api_motors_off(data):
    """True emergency. drone_id optional: omit = ALL. UI double-confirms."""
    unit = get_unit(data)
    targets = [unit] if unit else units
    for u in targets:
        u.abort.set()
        try:
            u.backend.emergency_stop()
        except Exception:
            pass
    return 200, {"ok": True}


def api_pause(data, client_ip):
    """Teacher freeze. Only accepted from the hub laptop itself."""
    global paused
    if client_ip != "127.0.0.1":
        return 403, {"ok": False, "error": "teacher_only"}
    with state_lock:
        paused = bool(data.get("paused"))
        p = paused
    return 200, {"ok": True, "paused": p}


POST_ROUTES = {
    "/api/control": api_control,
    "/api/command": api_command,
    "/api/run": api_run,
    "/api/stop": api_stop,
    "/api/motors_off": api_motors_off,
}


# ---------------------------------------------------------------- HTTP layer

class HubHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass  # keep the teacher-facing console clean

    def _send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/status":
            status, payload = api_status()
            self._send_json(status, payload)
            return
        if path in STATIC_FILES:
            filename, ctype = STATIC_FILES[path]
            body = (STATIC_DIR / filename).read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self._send_json(404, {"ok": False, "error": "not_found"})

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        try:
            length = int(self.headers.get("Content-Length") or 0)
            data = json.loads(self.rfile.read(length) or b"{}")
            if not isinstance(data, dict):
                data = {}
        except (ValueError, json.JSONDecodeError):
            data = {}
        if path == "/api/pause":
            status, payload = api_pause(data, self.client_address[0])
        else:
            handler = POST_ROUTES.get(path)
            if handler is None:
                self._send_json(404, {"ok": False, "error": "not_found"})
                return
            status, payload = handler(data)
        self._send_json(status, payload)


# ---------------------------------------------------------------- startup

def lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return "127.0.0.1"


def build_units():
    """Detect real controllers; fall back to virtual drones."""
    global mode
    force_practice = "--practice" in sys.argv

    if not force_practice:
        ports = detect_controller_ports()
        real_units = []
        for i, port in enumerate(ports[:len(COLOURS)]):
            name, rgb = COLOURS[i]
            abort = threading.Event()
            backend = RealDrone(abort, port=port)
            print(f"  Connecting {name} drone on {port}...")
            if backend.connect():
                try:
                    backend.set_led(*rgb)  # drone lights match its name
                except Exception:
                    pass
                real_units.append(DroneUnit(f"d{i}", f"{name} drone", rgb, backend))
            else:
                print(f"  Could not connect to controller on {port} - skipped.")
        if real_units:
            mode = "real"
            return real_units

    mode = "practice"
    out = []
    for i in range(PRACTICE_DRONE_COUNT):
        name, rgb = COLOURS[i]
        abort = threading.Event()
        backend = PracticeDrone(abort)
        backend.led = list(rgb)
        out.append(DroneUnit(f"d{i}", f"{name} drone", rgb, backend))
    return out


def main():
    global hub_url
    units.extend(build_units())
    for u in units:
        u.start()

    hub_url = f"http://{lan_ip()}:{PORT}"
    print()
    print("=" * 56)
    print("  CoDrone EDU Hub is running!")
    if mode == "real":
        print(f"  Mode: REAL DRONES ({len(units)} connected)")
        for u in units:
            print(f"    - {u.name}")
    else:
        print(f"  Mode: PRACTICE ({len(units)} virtual drones)")
    print()
    print("  On the iPads, open Safari and go to:")
    print(f"      {hub_url}")
    print()
    print("  The Teacher Screen opens in your browser now.")
    print("  Keep this window open while flying.")
    print("=" * 56)
    print()

    if "--no-browser" not in sys.argv:
        threading.Timer(1.0, lambda: webbrowser.open(f"http://127.0.0.1:{PORT}/teacher")).start()

    server = ThreadingHTTPServer(("0.0.0.0", PORT), HubHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        for u in units:
            u.backend.close()


if __name__ == "__main__":
    main()

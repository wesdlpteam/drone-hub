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
    "/blockly.min.js": ("blockly.min.js", "text/javascript; charset=utf-8"),
    "/blockly-python.min.js": ("blockly-python.min.js", "text/javascript; charset=utf-8"),
    "/js-interpreter.js": ("js-interpreter.js", "text/javascript; charset=utf-8"),
    "/blocks-data.js": ("blocks-data.js", "text/javascript; charset=utf-8"),
    "/program-runner.js": ("program-runner.js", "text/javascript; charset=utf-8"),
    "/editor.js": ("editor.js", "text/javascript; charset=utf-8"),
    "/icon.png": ("icon.png", "image/png"),
    "/pwa-icon.svg": ("pwa-icon.svg", "image/svg+xml; charset=utf-8"),
    "/manifest.webmanifest": ("manifest.webmanifest", "application/manifest+json; charset=utf-8"),
    "/sw.js": ("sw.js", "text/javascript; charset=utf-8"),
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
practice_reason = None  # why we are in practice: chosen/no_controller/library/connect_failed
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
        self.led_custom = False  # a block changed the LED; stop re-asserting

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
                    # Keep the drone's lights on its allocated colour so the
                    # "Red drone" really glows red, even when it was switched
                    # on after the Hub started. Skipped once a block set a
                    # custom light.
                    if not self.led_custom:
                        try:
                            self.backend.set_led(*self.rgb)
                        except Exception:
                            pass
                continue

            with state_lock:
                self.current = {"label": item["label"],
                                "step": item.get("step"), "total": item.get("total")}
            try:
                execute(self.backend, item)
            except Exception as exc:
                with state_lock:
                    self.message = f"Command failed: {exc}"
            if item["action"] in ("led", "led_off", "led_sequence"):
                self.led_custom = True
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
        "led": "Light colour", "led_off": "Light off", "ping": "Beep and blink",
        "buzzer": "Play note", "sound_sequence": "Play sound",
        "square": "Fly a square", "triangle": "Fly a triangle",
        "circle": "Fly a circle", "sway": "Sway side to side",
        "avoid_wall": "Fly until obstacle", "if_wall": "Check front sensor",
        "if_height": "Check height", "go_power": "Power move",
        "goto": "Fly to a point", "turn_power": "Timed turn",
        "turn_to": "Turn to heading", "set_rpyt": "Set control",
        "move_apply": "Move", "keep_distance": "Keep distance",
        "led_sequence": "Light pattern", "reset_gyro": "Reset gyro",
    }
    label = names.get(action, action)
    if action in ("forward", "back", "left", "right", "up", "down"):
        label += f" {int(clamp(value, 20, 150))} cm"
    elif action in ("turn_left", "turn_right"):
        label += f" {int(clamp(value, 45, 180))} deg"
    elif action == "hover":
        label += f" {int(clamp(value, 1, 5))} s"
    elif action == "buzzer":
        label += f" {value['frequency']} Hz"
    elif action == "sound_sequence":
        label += f": {value}"
    return label


def validate_reaction(action, value):
    """Return a small, safe action used by a sensor decision block."""
    if action in ("turn_left", "turn_right"):
        return {"action": action, "value": clamp(value, 45, 180)}
    if action == "hover":
        return {"action": action, "value": clamp(value, 1, 5)}
    if action in ("up", "down"):
        return {"action": action, "value": clamp(value, 20, 60)}
    if action == "land":
        return {"action": action, "value": None}
    return None


def validate_step(raw):
    """Return a safe queue item, or None if the step is not allowed."""
    if not isinstance(raw, dict):
        return None
    action = raw.get("action")
    value = raw.get("value")
    allowed = {"takeoff", "land", "forward", "back", "left", "right", "up",
               "down", "turn_left", "turn_right", "hover", "flip", "led",
               "led_off", "ping", "buzzer", "sound_sequence", "square",
               "triangle", "circle", "sway", "avoid_wall", "if_wall",
               "if_height", "go_power", "goto", "turn_power", "turn_to",
               "set_rpyt", "move_apply", "keep_distance", "led_sequence",
               "reset_gyro"}
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
        # old shape: [r, g, b]  /  new shape: {rgb, brightness, device}
        if isinstance(value, dict):
            rgb = value.get("rgb")
            if not (isinstance(rgb, (list, tuple)) and len(rgb) == 3):
                return None
            value = {"rgb": [int(clamp(v, 0, 255)) for v in rgb],
                     "brightness": int(clamp(value.get("brightness", 255), 0, 255)),
                     "device": "controller" if value.get("device") == "controller" else "drone"}
        elif isinstance(value, (list, tuple)) and len(value) == 3:
            value = {"rgb": [int(clamp(v, 0, 255)) for v in value],
                     "brightness": 255, "device": "drone"}
        else:
            return None
    elif action == "led_off":
        device = value.get("device") if isinstance(value, dict) else "drone"
        value = {"device": "controller" if device == "controller" else "drone"}
    elif action == "led_sequence":
        if not isinstance(value, dict):
            return None
        rgb = value.get("rgb")
        if not (isinstance(rgb, (list, tuple)) and len(rgb) == 3):
            return None
        mode = value.get("mode")
        value = {"device": "controller" if value.get("device") == "controller" else "drone",
                 "mode": mode if mode in ("dimming", "fade_in", "fade_out", "blink",
                                          "double_blink", "rainbow") else "blink",
                 "rgb": [int(clamp(v, 0, 255)) for v in rgb],
                 "speed": int(clamp(value.get("speed"), 1, 5))}
    elif action == "buzzer":
        if not isinstance(value, dict):
            return None
        value = {"frequency": int(clamp(value.get("frequency"), 100, 4000)),
                 "duration": int(clamp(value.get("duration"), 100, 3000)),
                 "device": "controller" if value.get("device") == "controller" else "drone"}
    elif action == "sound_sequence":
        if isinstance(value, dict):
            kind = value.get("kind")
            device = value.get("device")
        else:
            kind, device = value, "drone"
        value = {"kind": kind if kind in ("success", "warning", "error") else "success",
                 "device": "controller" if device == "controller" else "drone"}
    elif action == "goto":
        if not isinstance(value, dict):
            return None
        value = {"x": clamp(value.get("x"), -150, 150),
                 "y": clamp(value.get("y"), -150, 150),
                 "z": clamp(value.get("z"), 50, 150)}
    elif action == "turn_power":
        if not isinstance(value, dict):
            return None
        value = {"direction": "right" if value.get("direction") == "right" else "left",
                 "power": int(clamp(value.get("power"), 20, 70)),
                 "duration": clamp(value.get("duration"), 0.5, 3)}
    elif action == "turn_to":
        value = clamp(value, 0, 359)
    elif action == "set_rpyt":
        if not isinstance(value, dict):
            return None
        axis = value.get("axis")
        if axis not in ("roll", "pitch", "yaw", "throttle"):
            return None
        value = {"axis": axis, "power": int(clamp(value.get("power"), -30, 30))}
    elif action == "move_apply":
        value = clamp(value, 0.2, 3)
    elif action == "keep_distance":
        if not isinstance(value, dict):
            return None
        value = {"distance": int(clamp(value.get("distance"), 20, 100)),
                 "timeout": int(clamp(value.get("timeout"), 2, 10))}
    elif action == "reset_gyro":
        value = None
    elif action in ("square", "triangle", "circle", "sway"):
        if not isinstance(value, dict):
            return None
        value = {"direction": value.get("direction") if value.get("direction") in ("left", "right") else "right",
                 "speed": int(clamp(value.get("speed"), 25, 60)),
                 "duration": clamp(value.get("duration"), 0.5, 2)}
    elif action == "avoid_wall":
        if not isinstance(value, dict):
            return None
        value = {"distance": int(clamp(value.get("distance"), 20, 100)),
                 "timeout": int(clamp(value.get("timeout"), 2, 10))}
    elif action == "if_wall":
        if not isinstance(value, dict):
            return None
        reaction = validate_reaction(value.get("reaction"), value.get("reaction_value"))
        if reaction is None or reaction["action"] not in ("turn_left", "turn_right", "hover", "land"):
            return None
        value = {"distance": int(clamp(value.get("distance"), 20, 100)), "reaction": reaction}
    elif action == "if_height":
        if not isinstance(value, dict):
            return None
        reaction = validate_reaction(value.get("reaction"), value.get("reaction_value"))
        if reaction is None or reaction["action"] not in ("land", "hover", "up", "down"):
            return None
        value = {"comparison": value.get("comparison") if value.get("comparison") in ("above", "below") else "above",
                 "height": int(clamp(value.get("height"), 30, 150)), "reaction": reaction}
    elif action == "go_power":
        if not isinstance(value, dict):
            return None
        direction = value.get("direction")
        if direction not in ("forward", "backward", "left", "right", "up", "down"):
            return None
        value = {"direction": direction, "power": int(clamp(value.get("power"), 20, 70)),
                 "duration": clamp(value.get("duration"), 0.5, 3)}
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
        backend.set_led(*value["rgb"], brightness=value["brightness"], device=value["device"])
    elif action == "led_off":
        backend.led_off(device=value["device"] if isinstance(value, dict) else "drone")
    elif action == "led_sequence":
        backend.led_sequence(value["device"], value["mode"], value["rgb"], value["speed"])
    elif action == "ping":
        backend.ping()
    elif action == "buzzer":
        backend.buzzer(value["frequency"], value["duration"], device=value.get("device", "drone"))
    elif action == "sound_sequence":
        backend.sound_sequence(value["kind"], device=value.get("device", "drone"))
    elif action in ("square", "triangle", "circle", "sway"):
        backend.pattern(action, value["direction"], value["speed"], value["duration"])
    elif action == "avoid_wall":
        backend.avoid_wall(value["distance"], value["timeout"])
    elif action == "keep_distance":
        backend.keep_distance(value["distance"], value["timeout"])
    elif action == "goto":
        backend.goto_point(value["x"], value["y"], value["z"])
    elif action == "turn_power":
        backend.turn_power(value["direction"], value["power"], value["duration"])
    elif action == "turn_to":
        backend.turn_to(value)
    elif action == "set_rpyt":
        backend.set_rpyt(value["axis"], value["power"])
    elif action == "move_apply":
        backend.move_apply(value)
    elif action == "reset_gyro":
        backend.reset_gyro()
    elif action == "if_wall":
        if backend.detect_wall(value["distance"]):
            execute(backend, value["reaction"])
    elif action == "if_height":
        try:
            height = float(backend.get_height())
        except (TypeError, ValueError):
            return
        if not 0 <= height <= 200:  # ignore documented sensor error/out-of-range values
            return
        matches = height > value["height"] if value["comparison"] == "above" else height < value["height"]
        if matches:
            execute(backend, value["reaction"])
    elif action == "go_power":
        backend.go_power(value["direction"], value["power"], value["duration"])


# ---------------------------------------------------------------- API logic

def api_status():
    with state_lock:
        p = paused
    return 200, {
        "mode": mode,
        "paused": p,
        "url": hub_url,
        "practice_reason": practice_reason,
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
                unit.led_custom = False  # back to its allocated colour
        return 200, {"ok": True}
    name = str(data.get("name", "")).strip()[:20] or "Pilot"
    token = uuid.uuid4().hex[:12]
    with state_lock:
        unit.pilot = {"name": name, "token": token}
        unit.led_custom = False  # new pilot starts with the drone's own colour
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


def api_sensors(data):
    """Read-only sensor snapshot for CODE Level 2 sensor blocks."""
    unit = get_unit(data)
    if unit is None:
        return 404, {"ok": False, "error": "no_such_drone"}
    try:
        sensors = unit.backend.sensors()
    except Exception:
        sensors = {}
    return 200, {"ok": True, "sensors": sensors}


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
    "/api/sensors": api_sensors,
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
            # Let the service worker check for updates every time the Hub starts.
            # The worker itself keeps a safe local copy of the student app shell.
            self.send_header("Cache-Control", "no-cache")
            if path == "/sw.js":
                self.send_header("Service-Worker-Allowed", "/")
            self.send_header("X-Content-Type-Options", "nosniff")
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
    global mode, practice_reason
    force_practice = "--practice" in sys.argv

    if not force_practice:
        try:
            import serial.tools.list_ports  # noqa: F401  (part of pyserial)
            serial_ok = True
        except ImportError:
            serial_ok = False
        ports = detect_controller_ports() if serial_ok else []
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
        # Fell through to Practice Mode: say why, loudly.
        if not serial_ok:
            practice_reason = "library"
            print("  ! The real-drone library is not installed, so real drones")
            print("    are unavailable. Practice flying still works.")
        elif not ports:
            practice_reason = "no_controller"
            print("  ! No drone controller was found on USB.")
            print("    Plug each controller in with its USB cable (it should")
            print("    click in firmly), then close this window and run")
            print("    Start Drone Hub again.")
        else:
            practice_reason = "connect_failed"
            print("  ! A controller was found but would not connect.")
            print("    Unplug it, plug it back in, and run Start Drone Hub again.")
    else:
        practice_reason = "chosen"

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

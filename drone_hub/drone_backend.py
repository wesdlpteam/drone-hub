"""Drone backends for the CoDrone EDU Hub.

Two interchangeable backends:
  PracticeDrone - virtual drone, no hardware needed. Tracks pose so the UI
                  can draw it moving on screen.
  RealDrone     - wraps the official codrone_edu library (controller on USB).

Both expose the same methods so server.py never cares which one it has.
Distances are cm, turns are degrees, hover is seconds.
"""

import math
import threading
import time

# Gentle classroom limits (server also clamps, this is the last line of defence)
MIN_DIST_CM, MAX_DIST_CM = 20, 150
MIN_TURN_DEG, MAX_TURN_DEG = 45, 180
MIN_HOVER_S, MAX_HOVER_S = 1, 5
HORIZONTAL_SPEED_MS = 0.5   # slow speed for real drone moves
PRACTICE_SPEED_CMS = 50.0   # virtual drone speed, cm per second
PRACTICE_TURN_DPS = 90.0    # virtual turn rate, degrees per second


def clamp(value, lo, hi):
    try:
        value = float(value)
    except (TypeError, ValueError):
        return lo
    return max(lo, min(hi, value))


def detect_controller_ports():
    """Return serial port names of every plugged-in CoDrone EDU controller.
    The controller identifies itself with USB vendor id 1155 (or 6790 on
    some clones) - same check the official library and its swarm module use."""
    try:
        from serial.tools.list_ports import comports
    except ImportError:
        return []
    return [p.device for p in comports() if p.vid in (1155, 6790)]


class PracticeDrone:
    """Virtual drone. Moves in small time slices so the UI polls see smooth
    motion, and so an abort_event can cut a move short."""

    mode = "practice"

    def __init__(self, abort_event=None):
        self.abort_event = abort_event or threading.Event()
        self.lock = threading.Lock()
        self.x = 0.0          # cm, +x = right of start
        self.y = 0.0          # cm, +y = forward of start
        self.altitude = 0.0   # cm
        self.heading = 0.0    # degrees, 0 = facing forward (up on canvas)
        self.flying = False
        self.battery = 100.0
        self.led = [90, 200, 255]
        self.last_trick = None

    def connect(self):
        return True

    def close(self):
        pass

    def _tick_battery(self, seconds):
        if self.flying:
            self.battery = max(0.0, self.battery - seconds * 0.05)

    def _slices(self, total_seconds):
        """Yield small sleep slices until time is up or abort is set.
        The last slice is truncated so the total is exact (no overshoot)."""
        step = 0.1
        elapsed = 0.0
        while elapsed < total_seconds - 1e-9:
            if self.abort_event.is_set():
                return
            dt = min(step, total_seconds - elapsed)
            time.sleep(dt)
            self._tick_battery(dt)
            elapsed += dt
            yield dt

    def takeoff(self):
        if self.flying:
            return
        self.flying = True
        for _ in self._slices(2.0):
            with self.lock:
                self.altitude = min(80.0, self.altitude + 4.0)
        with self.lock:
            self.altitude = 80.0

    def land(self):
        if not self.flying:
            return
        for _ in self._slices(2.0):
            with self.lock:
                self.altitude = max(0.0, self.altitude - 4.0)
        with self.lock:
            self.altitude = 0.0
            self.flying = False

    def emergency_stop(self):
        with self.lock:
            self.altitude = 0.0
            self.flying = False

    def hover(self, seconds):
        seconds = clamp(seconds, MIN_HOVER_S, MAX_HOVER_S)
        for _ in self._slices(seconds):
            pass

    def move(self, direction, distance_cm):
        if not self.flying:
            return
        distance_cm = clamp(distance_cm, MIN_DIST_CM, MAX_DIST_CM)
        duration = distance_cm / PRACTICE_SPEED_CMS
        per_second = distance_cm / duration

        if direction in ("up", "down"):
            sign = 1 if direction == "up" else -1
            for dt in self._slices(duration):
                with self.lock:
                    self.altitude = clamp(self.altitude + sign * per_second * dt, 0, 250)
            return

        # Direction relative to where the drone is facing
        offsets = {"forward": 0, "right": 90, "back": 180, "left": 270}
        angle = math.radians(self.heading + offsets.get(direction, 0))
        for dt in self._slices(duration):
            with self.lock:
                self.x += math.sin(angle) * per_second * dt
                self.y += math.cos(angle) * per_second * dt

    def turn(self, direction, degrees):
        if not self.flying:
            return
        degrees = clamp(degrees, MIN_TURN_DEG, MAX_TURN_DEG)
        sign = 1 if direction == "right" else -1
        duration = degrees / PRACTICE_TURN_DPS
        per_second = degrees / duration
        for dt in self._slices(duration):
            with self.lock:
                self.heading = (self.heading + sign * per_second * dt) % 360

    def flip(self, direction="back"):
        if not self.flying or self.battery < 50:
            return
        self.last_trick = "flip_" + direction
        for _ in self._slices(1.0):
            pass
        self.last_trick = None

    def set_led(self, r, g, b):
        with self.lock:
            self.led = [int(clamp(r, 0, 255)), int(clamp(g, 0, 255)), int(clamp(b, 0, 255))]

    def led_off(self):
        self.set_led(0, 0, 0)

    def ping(self):
        self.last_trick = "ping"
        for _ in self._slices(0.35):
            pass
        self.last_trick = None

    def buzzer(self, frequency, duration_ms):
        self.last_trick = f"note_{int(frequency)}"
        for _ in self._slices(clamp(duration_ms, 100, 2000) / 1000.0):
            pass
        self.last_trick = None

    def sound_sequence(self, kind):
        self.last_trick = f"sound_{kind}"
        for _ in self._slices(1.0):
            pass
        self.last_trick = None

    def get_front_range(self):
        """Distance to the edge of the practice airspace along the heading.
        The real sensor reports 999 when nothing is within its 150 cm range."""
        with self.lock:
            x, y, heading = self.x, self.y, self.heading
        angle = math.radians(heading)
        dx, dy = math.sin(angle), math.cos(angle)
        boundary = 300.0
        distances = []
        if abs(dx) > 1e-9:
            distances.append(((boundary if dx > 0 else -boundary) - x) / dx)
        if abs(dy) > 1e-9:
            distances.append(((boundary if dy > 0 else -boundary) - y) / dy)
        positive = [distance for distance in distances if distance >= 0]
        distance = min(positive) if positive else 999
        return round(distance, 1) if distance <= 150 else 999

    def get_height(self):
        with self.lock:
            return round(self.altitude, 1)

    def detect_wall(self, distance=50):
        reading = self.get_front_range()
        return 0 < reading <= clamp(distance, 20, 100)

    def avoid_wall(self, distance=50, timeout=5):
        deadline = time.monotonic() + clamp(timeout, 2, 10)
        while self.flying and time.monotonic() < deadline and not self.detect_wall(distance):
            if self.abort_event.is_set():
                return
            self.go_power("forward", 30, 0.5)

    def go_power(self, direction, power=40, duration=1):
        direction = "back" if direction == "backward" else direction
        distance = clamp(clamp(power, 20, 70) * clamp(duration, 0.5, 3), MIN_DIST_CM, MAX_DIST_CM)
        self.move(direction, distance)

    def pattern(self, name, direction="right", speed=40, duration=1):
        turn_direction = "right" if direction == "right" else "left"
        distance = clamp(clamp(speed, 25, 60) * clamp(duration, 0.5, 2), 20, 60)
        if name == "square":
            for _ in range(4):
                self.move("forward", distance)
                self.turn(turn_direction, 90)
        elif name == "triangle":
            for _ in range(3):
                self.move("forward", distance)
                self.turn(turn_direction, 120)
        elif name == "circle":
            for _ in range(8):
                self.move("forward", 20)
                self.turn(turn_direction, 45)
        elif name == "sway":
            first, second = ("right", "left") if direction == "right" else ("left", "right")
            self.move(first, distance)
            self.move(second, distance * 2)
            self.move(first, distance)

    def get_battery(self):
        return round(self.battery)

    def pose(self):
        with self.lock:
            return {
                "x": round(self.x, 1),
                "y": round(self.y, 1),
                "altitude": round(self.altitude, 1),
                "heading": round(self.heading, 1),
                "trick": self.last_trick,
            }


class RealDrone:
    """Wraps the official codrone_edu library. Controller must be on USB."""

    mode = "real"

    def __init__(self, abort_event=None, port=None):
        self.abort_event = abort_event or threading.Event()
        self.port = port
        self.drone = None
        self.flying = False
        self.led = [90, 200, 255]

    def connect(self):
        try:
            from codrone_edu.drone import Drone
        except ImportError:
            return False
        try:
            self.drone = Drone()
            self.drone.pair(self.port) if self.port else self.drone.pair()
            return True
        except BaseException:
            # pair() can raise or sys.exit when no controller is plugged in
            self.drone = None
            return False

    def close(self):
        if self.drone:
            try:
                self.drone.close()
            except Exception:
                pass

    def takeoff(self):
        self.drone.takeoff()
        self.flying = True

    def land(self):
        self.drone.land()
        self.flying = False

    def emergency_stop(self):
        try:
            self.drone.emergency_stop()
        finally:
            self.flying = False

    def hover(self, seconds):
        self.drone.hover(clamp(seconds, MIN_HOVER_S, MAX_HOVER_S))

    def move(self, direction, distance_cm):
        distance_cm = clamp(distance_cm, MIN_DIST_CM, MAX_DIST_CM)
        moves = {
            "forward": self.drone.move_forward,
            "back": self.drone.move_backward,
            "left": self.drone.move_left,
            "right": self.drone.move_right,
        }
        if direction in moves:
            moves[direction](distance_cm, "cm", HORIZONTAL_SPEED_MS)
        elif direction in ("up", "down"):
            # No distance-based vertical move in the library; use timed gentle power.
            duration = clamp(distance_cm / 50.0, 0.5, 3.0)
            self.drone.go(direction, 40, duration)

    def turn(self, direction, degrees):
        degrees = clamp(degrees, MIN_TURN_DEG, MAX_TURN_DEG)
        if direction == "right":
            self.drone.turn_right(int(degrees))
        else:
            self.drone.turn_left(int(degrees))

    def flip(self, direction="back"):
        self.drone.flip(direction)

    def set_led(self, r, g, b):
        self.led = [int(clamp(r, 0, 255)), int(clamp(g, 0, 255)), int(clamp(b, 0, 255))]
        self.drone.set_drone_LED(self.led[0], self.led[1], self.led[2], 100)

    def led_off(self):
        self.led = [0, 0, 0]
        self.drone.drone_LED_off()

    def ping(self):
        self.drone.ping()

    def buzzer(self, frequency, duration_ms):
        self.drone.drone_buzzer(int(clamp(frequency, 200, 1200)), int(clamp(duration_ms, 100, 2000)))

    def sound_sequence(self, kind):
        self.drone.drone_buzzer_sequence(kind)

    def get_front_range(self):
        return self.drone.get_front_range("cm")

    def get_height(self):
        return self.drone.get_height("cm")

    def detect_wall(self, distance=50):
        return bool(self.drone.detect_wall(int(clamp(distance, 20, 100))))

    def avoid_wall(self, distance=50, timeout=5):
        self.drone.avoid_wall(timeout=int(clamp(timeout, 2, 10)), distance=int(clamp(distance, 20, 100)))

    def go_power(self, direction, power=40, duration=1):
        self.drone.go(direction, int(clamp(power, 20, 70)), clamp(duration, 0.5, 3))

    def pattern(self, name, direction="right", speed=40, duration=1):
        direction_value = 1 if direction == "right" else -1
        speed = int(clamp(speed, 25, 60))
        duration = clamp(duration, 0.5, 2)
        if name == "circle":
            self.drone.circle(speed, direction_value)
        elif name == "sway":
            self.drone.sway(speed, duration, direction_value)
        else:
            getattr(self.drone, name)(speed, duration, direction_value)

    def get_battery(self):
        try:
            return int(self.drone.get_battery())
        except Exception:
            return -1

    def pose(self):
        return None  # real drone has no tracked pose; UI hides the map

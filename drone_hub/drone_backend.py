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

    def set_led(self, r, g, b, brightness=255, device="drone"):
        scale = clamp(brightness, 0, 255) / 255.0
        with self.lock:
            self.led = [int(clamp(r, 0, 255) * scale), int(clamp(g, 0, 255) * scale),
                        int(clamp(b, 0, 255) * scale)]

    def led_off(self, device="drone"):
        self.set_led(0, 0, 0)

    def led_sequence(self, device, mode, rgb, speed=3):
        """Animate the virtual LED for ~2.5 s so the radar shows the pattern."""
        r, g, b = [clamp(v, 0, 255) for v in rgb]
        cycles = int(clamp(speed, 1, 5)) + 1
        steps = 24
        for i, _ in enumerate(self._slices(2.4)):
            t = (i % steps) / steps
            if mode in ("blink", "double_blink"):
                on = (int(t * cycles * 2) % 2) == 0
                self.set_led(r if on else 0, g if on else 0, b if on else 0)
            elif mode == "fade_in":
                self.set_led(r * t, g * t, b * t)
            elif mode == "fade_out":
                self.set_led(r * (1 - t), g * (1 - t), b * (1 - t))
            elif mode == "rainbow":
                phase = (t * 3) % 3
                self.set_led(255 * max(0, 1 - phase), 255 * max(0, 1 - abs(phase - 1)),
                             255 * max(0, 1 - abs(phase - 2)))
            else:  # dimming
                level = 0.5 + 0.5 * math.cos(t * 2 * math.pi)
                self.set_led(r * level, g * level, b * level)
            if i >= 23:
                break
        self.set_led(r, g, b)

    def ping(self):
        self.last_trick = "ping"
        for _ in self._slices(0.35):
            pass
        self.last_trick = None

    def buzzer(self, frequency, duration_ms, device="drone"):
        self.last_trick = f"note_{int(frequency)}"
        for _ in self._slices(clamp(duration_ms, 100, 3000) / 1000.0):
            pass
        self.last_trick = None

    def sound_sequence(self, kind, device="drone"):
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

    def goto_point(self, x_cm, y_cm, z_cm):
        """Fly straight to a point (cm, world frame) at practice speed."""
        if not self.flying:
            return
        with self.lock:
            sx, sy, sz = self.x, self.y, self.altitude
        tx = clamp(x_cm, -150, 150)
        ty = clamp(y_cm, -150, 150)
        tz = clamp(z_cm, 50, 150)
        dist = math.sqrt((tx - sx) ** 2 + (ty - sy) ** 2 + (tz - sz) ** 2)
        duration = max(0.3, dist / PRACTICE_SPEED_CMS)
        elapsed = 0.0
        for dt in self._slices(duration):
            elapsed += dt
            f = min(1.0, elapsed / duration)
            with self.lock:
                self.x = sx + (tx - sx) * f
                self.y = sy + (ty - sy) * f
                self.altitude = sz + (tz - sz) * f

    def turn_power(self, direction, power=50, duration=1):
        if not self.flying:
            return
        rate = PRACTICE_TURN_DPS * clamp(power, 20, 70) / 50.0
        sign = 1 if direction == "right" else -1
        for dt in self._slices(clamp(duration, 0.5, 3)):
            with self.lock:
                self.heading = (self.heading + sign * rate * dt) % 360

    def turn_to(self, heading):
        if not self.flying:
            return
        target = clamp(heading, 0, 359)
        with self.lock:
            delta = (target - self.heading + 540) % 360 - 180
        direction = "right" if delta >= 0 else "left"
        degrees = abs(delta)
        if degrees < 2:
            return
        duration = degrees / PRACTICE_TURN_DPS
        sign = 1 if direction == "right" else -1
        for dt in self._slices(duration):
            with self.lock:
                self.heading = (self.heading + sign * PRACTICE_TURN_DPS * dt) % 360
        with self.lock:
            self.heading = target

    def set_rpyt(self, axis, power):
        if not hasattr(self, "_rpyt"):
            self._rpyt = {"roll": 0, "pitch": 0, "yaw": 0, "throttle": 0}
        self._rpyt[axis] = clamp(power, -30, 30)

    def move_apply(self, duration):
        """Fly with the stored roll/pitch/yaw/throttle for a while."""
        if not self.flying:
            return
        rpyt = getattr(self, "_rpyt", None) or {"roll": 0, "pitch": 0, "yaw": 0, "throttle": 0}
        for dt in self._slices(clamp(duration, 0.2, 3)):
            with self.lock:
                angle = math.radians(self.heading)
                fwd = rpyt["pitch"] * dt          # cm/s per % power
                side = rpyt["roll"] * dt
                self.x += math.sin(angle) * fwd + math.cos(angle) * side
                self.y += math.cos(angle) * fwd - math.sin(angle) * side
                self.altitude = clamp(self.altitude + rpyt["throttle"] * dt, 0, 250)
                self.heading = (self.heading + rpyt["yaw"] * 1.5 * dt) % 360

    def keep_distance(self, distance=50, timeout=5):
        """Practice airspace has no moving walls, so hold position."""
        for _ in self._slices(clamp(timeout, 2, 10)):
            pass

    def reset_gyro(self):
        pass

    def get_battery(self):
        return round(self.battery)

    def sensors(self):
        with self.lock:
            x, y, altitude, heading = self.x, self.y, self.altitude, self.heading
            flying, battery = self.flying, round(self.battery)
        yaw = round(((heading + 180) % 360) - 180, 1)
        return {
            "angle_x": 0, "angle_y": 0, "angle_z": yaw,
            "angular_speed_x": 0, "angular_speed_y": 0, "angular_speed_z": 0,
            "accel_x": 0, "accel_y": 0, "accel_z": 98 if flying else 0,
            "front_range": self.get_front_range(),
            "bottom_range": round(altitude, 1),
            "height": round(altitude, 1),
            "pos_x": round(x, 1), "pos_y": round(y, 1), "pos_z": round(altitude, 1),
            "color_front": "white", "color_back": "white",
            "color_data_front": {"hue": 0, "saturation": 0, "value": 100, "lightness": 100,
                                 "red": 255, "green": 255, "blue": 255},
            "color_data_back": {"hue": 0, "saturation": 0, "value": 100, "lightness": 100,
                                "red": 255, "green": 255, "blue": 255},
            "pressure": round(101325 - altitude * 12, 1),
            "elevation": round(altitude / 100.0, 2),
            "temperature": 22.0,
            "battery": battery,
            "flight_state": "flight" if flying else "ready",
            "movement_state": "hovering" if flying else "ready",
        }

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

    def _call(self, names, *args, default=None):
        """Try library methods by name; the codrone_edu API shifts between
        versions, so missing ones degrade gracefully instead of crashing."""
        for name in names if isinstance(names, (list, tuple)) else [names]:
            fn = getattr(self.drone, name, None)
            if callable(fn):
                try:
                    return fn(*args)
                except Exception:
                    return default
        return default

    def set_led(self, r, g, b, brightness=255, device="drone"):
        r, g, b = int(clamp(r, 0, 255)), int(clamp(g, 0, 255)), int(clamp(b, 0, 255))
        brightness = int(clamp(brightness, 0, 255))
        if device == "controller":
            self._call("set_controller_LED", r, g, b, brightness)
        else:
            self.led = [r, g, b]
            self.drone.set_drone_LED(r, g, b, brightness)

    def led_off(self, device="drone"):
        if device == "controller":
            self._call("controller_LED_off")
        else:
            self.led = [0, 0, 0]
            self.drone.drone_LED_off()

    def led_sequence(self, device, mode, rgb, speed=3):
        """Animate the LED by hand for ~2.5 s; abortable, works on every
        library version because it only needs plain set-LED calls."""
        r, g, b = [int(clamp(v, 0, 255)) for v in rgb]
        cycles = int(clamp(speed, 1, 5)) + 1
        steps = 12
        for i in range(steps):
            if self.abort_event.is_set():
                break
            t = i / steps
            if mode in ("blink", "double_blink"):
                on = (int(t * cycles * 2) % 2) == 0
                self.set_led(r if on else 0, g if on else 0, b if on else 0, device=device)
            elif mode == "fade_in":
                self.set_led(r, g, b, brightness=int(255 * t), device=device)
            elif mode == "fade_out":
                self.set_led(r, g, b, brightness=int(255 * (1 - t)), device=device)
            elif mode == "rainbow":
                phase = (t * 3) % 3
                self.set_led(int(255 * max(0, 1 - phase)), int(255 * max(0, 1 - abs(phase - 1))),
                             int(255 * max(0, 1 - abs(phase - 2))), device=device)
            else:  # dimming
                level = 0.5 + 0.5 * math.cos(t * 2 * math.pi)
                self.set_led(r, g, b, brightness=int(255 * level), device=device)
            time.sleep(0.2)
        self.set_led(r, g, b, device=device)

    def ping(self):
        self.drone.ping()

    def buzzer(self, frequency, duration_ms, device="drone"):
        frequency = int(clamp(frequency, 100, 4000))
        duration_ms = int(clamp(duration_ms, 100, 3000))
        if device == "controller":
            self._call("controller_buzzer", frequency, duration_ms)
        else:
            self.drone.drone_buzzer(frequency, duration_ms)

    def sound_sequence(self, kind, device="drone"):
        if device == "controller":
            if self._call("controller_buzzer_sequence", kind) is not None:
                return
        self._call("drone_buzzer_sequence", kind)

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

    def goto_point(self, x_cm, y_cm, z_cm):
        self._call("send_absolute_position",
                   clamp(x_cm, -150, 150) / 100.0, clamp(y_cm, -150, 150) / 100.0,
                   clamp(z_cm, 50, 150) / 100.0, HORIZONTAL_SPEED_MS, 0, 30)

    def turn_power(self, direction, power=50, duration=1):
        power = int(clamp(power, 20, 70))
        duration = clamp(duration, 0.5, 3)
        self._call("set_yaw", power if direction == "left" else -power)
        self._call("move", duration)
        self._call("set_yaw", 0)

    def turn_to(self, heading):
        self._call("turn_degree", int(clamp(heading, 0, 359)))

    def set_rpyt(self, axis, power):
        power = int(clamp(power, -30, 30))
        self._call(f"set_{axis}", power)

    def move_apply(self, duration):
        self._call("move", clamp(duration, 0.2, 3))

    def keep_distance(self, distance=50, timeout=5):
        if self._call("keep_distance", int(clamp(timeout, 2, 10)),
                      int(clamp(distance, 20, 100))) is None:
            self.hover(2)

    def reset_gyro(self):
        self._call("reset_gyro")

    def get_battery(self):
        try:
            return int(self.drone.get_battery())
        except Exception:
            return -1

    def sensors(self):
        """Safe snapshot for the sensor blocks. Every read is defensive; the
        library's getters read cached telemetry, so this stays quick."""
        num = lambda names, *args: self._call(names, *args, default=0)
        colors = self._call(["get_colors"], default=None) or ["unknown", "unknown"]
        data = {
            "angle_x": num(["get_angle_x", "get_x_angle"]),
            "angle_y": num(["get_angle_y", "get_y_angle"]),
            "angle_z": num(["get_angle_z", "get_z_angle"]),
            "angular_speed_x": num(["get_angular_speed_x"]),
            "angular_speed_y": num(["get_angular_speed_y"]),
            "angular_speed_z": num(["get_angular_speed_z"]),
            "accel_x": num(["get_accel_x", "get_x_accel"]),
            "accel_y": num(["get_accel_y", "get_y_accel"]),
            "accel_z": num(["get_accel_z", "get_z_accel"]),
            "front_range": num(["get_front_range"], "cm"),
            "bottom_range": num(["get_bottom_range"], "cm"),
            "height": num(["get_height"], "cm"),
            "pos_x": num(["get_pos_x", "get_position_x"], "cm"),
            "pos_y": num(["get_pos_y", "get_position_y"], "cm"),
            "pos_z": num(["get_pos_z", "get_position_z"], "cm"),
            "color_front": str(colors[0]) if len(colors) > 0 else "unknown",
            "color_back": str(colors[1]) if len(colors) > 1 else "unknown",
            "pressure": num(["get_pressure"]),
            "elevation": num(["get_elevation"], "m"),
            "temperature": num(["get_drone_temperature", "get_temperature"], "C"),
            "battery": self.get_battery(),
            "flight_state": str(self._call(["get_flight_state"], default="unknown")),
            "movement_state": str(self._call(["get_movement_state"], default="unknown")),
        }
        raw = self._call(["get_color_data"], default=None)
        for side, offset in (("front", 0), ("back", 4)):
            values = {}
            if isinstance(raw, (list, tuple)) and len(raw) > offset + 3:
                for i, key in enumerate(("hue", "saturation", "value", "lightness")):
                    try:
                        values[key] = float(raw[offset + i])
                    except (TypeError, ValueError):
                        values[key] = 0
            data[f"color_data_{side}"] = values
        return data

    def pose(self):
        return None  # real drone has no tracked pose; UI hides the map

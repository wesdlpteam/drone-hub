# Drone Hub — deployment note for IT

**What it is:** a small local web server that lets classroom iPads fly CoDrone EDU
drones. One laptop runs `DroneHub.exe` with the drone controllers on USB; iPads on
the same network use a web page it serves. Built in-house by Digital Learning &
Practice (source: https://github.com/wesdlpteam/drone-hub).

## Requested deployment

1. **Push `DroneHub.exe` to primary-school staff laptops** (Intune Win32 app or a
   file copy), with a Start Menu / desktop shortcut named "Drone Hub", so teacher
   experience is one click.
2. **Whitelist the executable.** Managed devices currently block it (unsigned,
   low-prevalence binary — ASR/SmartScreen). Options: Defender exclusion by hash or
   path, or code-sign it if the College has a signing certificate.
3. **Firewall:** allow inbound TCP **8600** for DroneHub.exe on Private/Domain
   profiles (iPads connect to the laptop on the LAN).
4. If Wi-Fi client isolation prevents iPads reaching staff laptops, either exempt
   this traffic or teachers will use the laptop's mobile hotspot (documented for
   them as the fallback).

## Security profile

- Listens on TCP 8600 (LAN only). No internet services, no cloud, no accounts,
  no student data stored or transmitted. Kids type a first name that lives in
  memory only while the session runs.
- Pure Python standard library, packaged with PyInstaller; drone control uses
  Robolink's official `codrone-edu` library over USB serial.
- The "pause class" control only accepts requests from 127.0.0.1 (the hub laptop).

# Camera Turret Wiring Guide

This summarizes all pin assignments used in the firmware so you can wire the turret hardware without hunting through code. Ground everything to a common reference (ESP32 GND, driver GND, sensor GND, power supply GND).

## Motor Controller (ESP32 DevKit + DRV8825s)

| Function                        | ESP32 Pin | Notes |
|---------------------------------|-----------|-------|
| Yaw step                        | GPIO 26   | To DRV8825 STEP for yaw motor |
| Yaw direction                   | GPIO 25   | To DRV8825 DIR for yaw motor (flip if motion is reversed) |
| Yaw hall home                   | GPIO 32   | Active-LOW hall sensor, INPUT\_PULLUP. Wire sensor VCC→3V3, GND→GND, signal→GPIO32. |
| Tilt step                       | GPIO 14   | To DRV8825 STEP for tilt motor |
| Tilt direction                  | GPIO 12   | To DRV8825 DIR for tilt motor |
| Tilt upper limit switch         | GPIO 4    | Normally-open switch to GND, INPUT\_PULLUP |
| Tilt lower limit switch         | GPIO 5    | Normally-open switch to GND, INPUT\_PULLUP |
| Trigger servo signal            | GPIO 27   | To servo signal; servo power from 5V (or external BEC) and common ground |

DRV8825 basics (per motor):
- VMOT + GND: to motor supply (e.g., 12–24 V), add bulk cap near driver.
- A1/A2/B1/B2: to motor coils.
- STEP/DIR: from ESP32 pins above.
- ENABLE: tie LOW to enable, or route to a spare pin if you want software enable/disable (currently not driven).
- Microstep pins: set for **1/2-step** to match `microstepFactor = 2` (DRV8825: M0=HIGH, M1=LOW, M2=LOW). Adjust firmware if you pick a different microstep.

Sensors:
- Hall home (yaw): active LOW, pulled up internally. Use an open-collector/open-drain output or NPN hall module; add a series resistor if the module drives high strongly.
- Tilt limits: normally-open to ground; closed = LOW.

Power:
- ESP32 VIN/5V from a regulated 5 V source; do not power from the motor supply rail.
- Servo: power from 5 V rail with enough current; do not power from the ESP32 3.3 V pin.
- Share grounds between ESP32, drivers, sensors, servo supply.

## Camera (ESP32-CAM, AI Thinker pinout)

From `firmware/cam/src/main.cpp`:

| Signal      | Pin  |
|-------------|------|
| PWDN        | 32   |
| RESET       | -1   |
| XCLK        | 0    |
| SIOD (SDA)  | 26   |
| SIOC (SCL)  | 27   |
| Y9          | 35   |
| Y8          | 34   |
| Y7          | 39   |
| Y6          | 36   |
| Y5          | 21   |
| Y4          | 19   |
| Y3          | 18   |
| Y2          | 5    |
| VSYNC       | 25   |
| HREF        | 23   |
| PCLK        | 22   |

## Motion Range Note (Yaw)

With the slip ring installed, the firmware now treats yaw as continuous: the hall sensor marks 0°, and absolute yaw commands wrap to the shortest path (0–360° normalized internally). Without a slip ring, you’d clamp to ±180° to protect wiring; with a slip ring, there is no soft stop and wrap-around is handled in code.

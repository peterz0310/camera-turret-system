# Motors Firmware

This directory contains the PlatformIO project for the motors module of the turret system.

## Overview
- Responsible for controlling the turret's motors (e.g., pan, tilt).
- Receives commands from the main system and actuates the motors accordingly.
- Written in C++ for embedded microcontrollers (e.g., ESP32, Arduino).

## Structure
- `src/`: Main source code for the motors firmware.
- `platformio.ini`: PlatformIO project configuration.

## Getting Started

1. Install [PlatformIO](https://platformio.org/).
2. Open this folder in VS Code with the PlatformIO extension.
3. Connect your motor controller hardware.
4. Build and upload the firmware:
   ```bash
   pio run --target upload
   ```

## Customization
- Modify `src/main.cpp` to change motor control logic or add features.
- Update `platformio.ini` to change board or environment settings.

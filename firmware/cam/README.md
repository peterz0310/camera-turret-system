# Camera Firmware

This directory contains the PlatformIO project for the camera module of the turret system.

## Overview
- Responsible for interfacing with the camera hardware.
- Handles image capture and communication with the main system.
- Written in C++ for embedded microcontrollers (e.g., ESP32, Arduino).

## Structure
- `src/`: Main source code for the camera firmware.
- `platformio.ini`: PlatformIO project configuration.

## Getting Started

1. Install [PlatformIO](https://platformio.org/).
2. Open this folder in VS Code with the PlatformIO extension.
3. Connect your camera module hardware.
4. Build and upload the firmware:
   ```bash
   pio run --target upload
   ```

## Customization
- Modify `src/main.cpp` to change camera logic or add features.
- Update `platformio.ini` to change board or environment settings.
# Camera Turret System

This project is a modular camera turret system consisting of a web-based UI, a camera streaming backend, and firmware for controlling turret hardware. The system is containerized using Docker Compose for easy development and deployment.

## Project Structure

- **docker-compose.yml**: Orchestrates the services for development using Docker Compose.
- **ui/**: Next.js web application for controlling and viewing the camera turret.
- **camera-stream/**: Python backend for camera streaming and image processing.
- **firmware/**: Embedded code for controlling the turret hardware (motors and camera), organized for PlatformIO.

### Details

#### `ui/`
- Built with Next.js.
- Provides a user interface to control the turret and view the camera feed.
- Hot-reloads in development via Docker Compose.

#### `camera-stream/`
- Python application (see `app.py`).
- Handles camera input and streams video to the UI.
- Can serve a fallback image if the camera is unavailable.

#### `firmware/`
- Contains PlatformIO projects for both camera and motor control.
- Each subfolder (`cam/`, `motors/`) has its own source code and configuration for embedded development.

## Development

### Prerequisites
- [Docker](https://www.docker.com/) and [Docker Compose](https://docs.docker.com/compose/)
- PlatformIO (for firmware development, optional)

### Running the System

1. Clone the repository.
2. From the root directory, run:
   ```bash
   docker-compose up --build
   ```
3. Access the UI at [http://localhost:3000](http://localhost:3000).

### Firmware
- Firmware is managed separately using PlatformIO.
- See `firmware/cam/` and `firmware/motors/` for details.

### Parts List

| Part Description                        | Link                                                                 |
|-----------------------------------------|----------------------------------------------------------------------|
| Screw terminals (for electrical)        | [Amazon](https://www.amazon.com/dp/B0D7VRSH1G?ref=ppx_yo2ov_dt_b_fed_asin_title&th=1) |
| Cooling fans (for electronics box)      | [Amazon](https://www.amazon.com/dp/B07P7DQ3VG?ref=ppx_yo2ov_dt_b_fed_asin_title)       |
| Nema 17 motors 1.5a 42x42x38mm (x2)     | [Amazon](https://www.amazon.com/dp/B0B38GX54H?ref=ppx_yo2ov_dt_b_fed_asin_title)       |
| ESP32 Cam                               | [Amazon](https://www.amazon.com/dp/B0948ZFTQZ?ref=ppx_yo2ov_dt_b_fed_asin_title)       |
| 8mm flange coupling connectors          | [Amazon](https://www.amazon.com/dp/B0CSVZQHZY?ref=ppx_yo2ov_dt_b_fed_asin_title)       |
| 8x100mm shafts                          | [Amazon](https://www.amazon.com/dp/B01NCOMFLT?ref=ppx_yo2ov_dt_b_fed_asin_title)       |
| Assorted M3 screws                      | [Amazon](https://www.amazon.com/dp/B0D3X5CT2J?ref=ppx_yo2ov_dt_b_fed_asin_title)       |
| Closed loop rubber belts                | [Amazon](https://www.amazon.com/dp/B088M3V865?ref=ppx_yo2ov_dt_b_fed_asin_title)       |
| DRV8825 stepper motor driver            | [Amazon](https://www.amazon.com/dp/B0C2CHTLCG?ref=ppx_yo2ov_dt_b_fed_asin_title)       |
| Various Dupont jumper cables            | [Amazon](https://www.amazon.com/dp/B01EV70C78?ref=nb_sb_ss_w_as-reorder_k0_1_6&crid=1AK8URVEZEDLV&sprefix=dupont)           |

### 3D printed parts

Many parts of this project are 3D printed. I used a BambuLabs A1 and PETG filament, but any printer with a sufficiently large build area should be fine.

Files are available on MakerWorld.

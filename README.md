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
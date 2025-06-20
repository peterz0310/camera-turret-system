# Turret UI (Next.js)

This is the web-based user interface for the Camera Turret System, built with [Next.js](https://nextjs.org). It allows users to control the turret and view the live camera feed.

## Features

- Live video stream from the turret camera
- Controls for turret movement (pan/tilt)
- Responsive and modern UI
- Hot-reloading in development

## Project Structure

- `src/app/`: Main application code (pages, layout, styles)
- `public/`: Static assets (images, icons)
- `next.config.mjs`: Next.js configuration
- `Dockerfile`: Containerization for development/production

## Development with Docker Compose

The UI is set up to work seamlessly with the backend and camera stream services using Docker Compose. See the root-level `README.md` for instructions on running the full system.

## Customization

- Edit `src/app/page.js` to modify the main page.
- Update styles in `src/app/globals.css`.

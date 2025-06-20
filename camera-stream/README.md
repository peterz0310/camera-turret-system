# ESP32 Camera Stream Server

A Flask server that streams video from an ESP32 cam with automatic fallback handling.

## Configuration

Edit `.env` to configure your camera URL:

```env
ESP32_CAM_URL=http://192.168.4.62/stream
```

## Endpoints

- `/` - Simple web page to view the stream
- `/stream` - MJPEG video stream endpoint
- `/ping` - Health check

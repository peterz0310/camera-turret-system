# ESP32 Camera Stream Server with AI Detection

A Flask server that streams video from an ESP32 cam with automatic fallback handling and optional AI-powered person detection using YOLOv8.

## Features

- **Raw Video Stream**: Direct MJPEG stream from ESP32-CAM
- **AI-Enhanced Stream**: Real-time person detection with bounding boxes
- **Automatic Fallback**: Animated static when camera is unavailable
- **API Control**: RESTful endpoints for AI control and detection data

## Configuration

Edit `.env` to configure your camera URL:

```env
ESP32_CAM_URL=http://192.168.4.62/stream
```

## Endpoints

- `/` - Simple web page to view the stream
- `/stream` - MJPEG video stream endpoint
  - Add `?ai=true` for AI-annotated stream
  - Default: raw stream
- `/api/ai` - POST endpoint to enable/disable AI processing
- `/api/detections` - GET current detection results
- `/ping` - Health check

## AI Features

The AI detection uses YOLOv8n (nano) model for efficient person detection:
- **Detection Rate**: 5 FPS (configurable)
- **Stream Rate**: Full camera framerate (15-30 FPS)
- **Model**: YOLOv8n (downloads automatically on first run)
- **Classes**: Person detection only
- **Confidence**: 50% threshold

## Usage Examples

### Toggle AI Mode via API
```bash
# Enable AI
curl -X POST http://localhost:8081/api/ai -H "Content-Type: application/json" -d '{"enabled": true}'

# Disable AI
curl -X POST http://localhost:8081/api/ai -H "Content-Type: application/json" -d '{"enabled": false}'
```

### Get Detection Data
```bash
curl http://localhost:8081/api/detections
```

### Stream URLs
- Raw stream: `http://localhost:8081/stream`
- AI stream: `http://localhost:8081/stream?ai=true`

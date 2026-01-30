# ESP32 Camera Stream Server with AI Detection

A Flask server that proxies the ESP32-CAM MJPEG stream, adds optional AI person detection, and exposes a small REST API for AI control and telemetry.

## Features

- **Raw Video Stream**: Direct MJPEG stream from ESP32-CAM
- **AI-Enhanced Stream**: Server-side person detection with bounding boxes drawn into the stream
- **Automatic Fallback**: Animated static when camera is unavailable
- **API Control**: REST endpoints for AI enable/disable, model selection, and FPS tuning

## Configuration

Edit `.env` to configure your camera URL:

```env
ESP32_CAM_URL=http://192.168.4.62/stream
```

## Endpoints

- `/` - Simple web page to view the stream
- `/stream` - MJPEG video stream endpoint
  - When AI is enabled, the stream is annotated server-side.
  - When AI is disabled, the stream is raw.
- `/api/ai` - POST enable/disable AI and optionally switch model
- `/api/detections` - GET latest detection results (JSON)
- `/api/models` - GET available models + current model + FPS info
- `/api/fps` - GET or POST per-model detection FPS

## AI Features

The AI detection system supports multiple models with MobileNet-SSD as the default.
Detections are computed asynchronously at a configurable FPS and drawn into the outgoing stream.

### Default Model: MobileNet-SSD

- **Detection Rate**: 15 FPS default (configurable per model)
- **Stream Rate**: Full camera framerate; detections are overlaid as they arrive
- **Model**: MobileNet-SSD v2 via TensorFlow Hub (downloads on first run)
- **Classes**: Person detection only
- **Confidence**: 50% threshold
- **Description**: Fast inference, good balance of speed and accuracy

### Alternative Model: YOLOv8n

- **Detection Rate**: 4 FPS default (configurable per model)
- **Model**: YOLOv8n (nano) via ultralytics (weights download on first run)
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

- Stream (raw or annotated depending on AI state): `http://localhost:8081/stream`

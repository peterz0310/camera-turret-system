from flask import Flask, Response, request, jsonify
from flask_cors import CORS
import requests
import time
import os
from dotenv import load_dotenv
from PIL import Image, ImageDraw
import io
import random
import cv2
import numpy as np
import threading
from queue import Queue

# AI imports (will be conditionally loaded)
try:
    from ultralytics import YOLO
    import torch
    
    # Fix for PyTorch 2.6+ weights_only security change
    # Only apply if the method exists (PyTorch 2.6+)
    if hasattr(torch.serialization, 'add_safe_globals'):
        torch.serialization.add_safe_globals([
            'ultralytics.nn.tasks.DetectionModel',
            'ultralytics.nn.modules.block.C2f',
            'ultralytics.nn.modules.block.SPPF', 
            'ultralytics.nn.modules.conv.Conv',
            'ultralytics.nn.modules.head.Detect'
        ])
        print("✅ PyTorch safe globals configured")
    
    YOLO_AVAILABLE = True
    print("✅ YOLO imported successfully")
except ImportError as e:
    YOLO_AVAILABLE = False
    print(f"⚠️  YOLO not available: {e}")
    print("   Install with: pip install ultralytics")

# MobileNet imports
try:
    import tensorflow as tf
    import tensorflow_hub as hub
    MOBILENET_AVAILABLE = True
    print("✅ TensorFlow imported successfully")
except ImportError as e:
    MOBILENET_AVAILABLE = False
    print(f"⚠️  TensorFlow not available: {e}")
    print("   Install with: pip install tensorflow tensorflow-hub")

load_dotenv()

ESP32_CAM_URL = os.getenv("ESP32_CAM_URL", "http://192.168.4.62/stream")
REQUEST_TIMEOUT = 2.0
RECONNECT_DELAY = 1.0 # How long to show static before retrying connection
STATIC_FRAME_WIDTH = 640
STATIC_FRAME_HEIGHT = 480
STATIC_FRAME_COUNT = 10
STATIC_FPS = 10 # Target FPS for the fallback animation (lowered for consistency)
FRAME_STALL_TIMEOUT = 2.5  # Seconds without a decoded frame before falling back
MAX_STREAM_BUFFER = 1024 * 1024  # Cap buffer growth when parsing MJPEG

STREAM_ROTATE = int(os.getenv("STREAM_ROTATE", "0"))
STREAM_FORCE_LANDSCAPE = os.getenv("STREAM_FORCE_LANDSCAPE", "false").lower() in ("1", "true", "yes", "on")
STREAM_OUTPUT_WIDTH = int(os.getenv("STREAM_OUTPUT_WIDTH", "0"))
STREAM_OUTPUT_HEIGHT = int(os.getenv("STREAM_OUTPUT_HEIGHT", "0"))

_ROTATE_CODE_MAP = {
    0: None,
    90: cv2.ROTATE_90_CLOCKWISE,
    180: cv2.ROTATE_180,
    270: cv2.ROTATE_90_COUNTERCLOCKWISE,
}
if STREAM_ROTATE not in _ROTATE_CODE_MAP:
    print(f"⚠️ Invalid STREAM_ROTATE={STREAM_ROTATE}; defaulting to 0")
    STREAM_ROTATE = 0
STREAM_ROTATE_CODE = _ROTATE_CODE_MAP[STREAM_ROTATE]

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

STATIC_FRAME_BUFFER = []


class StreamUnavailable(Exception):
    """Raised when the camera stream is unavailable or stalled."""

def apply_stream_transform(img):
    """Apply optional rotation/crop/resize to keep output orientation predictable."""
    if STREAM_ROTATE_CODE is not None:
        img = cv2.rotate(img, STREAM_ROTATE_CODE)

    if STREAM_FORCE_LANDSCAPE and img.shape[0] > img.shape[1]:
        h, w = img.shape[:2]
        target_aspect = (
            (STREAM_OUTPUT_WIDTH / STREAM_OUTPUT_HEIGHT)
            if STREAM_OUTPUT_WIDTH > 0 and STREAM_OUTPUT_HEIGHT > 0
            else (16 / 9)
        )
        target_h = max(1, int(w / target_aspect))
        if target_h < h:
            y0 = (h - target_h) // 2
            img = img[y0:y0 + target_h, :]

    if STREAM_OUTPUT_WIDTH > 0 and STREAM_OUTPUT_HEIGHT > 0:
        img = cv2.resize(
            img,
            (STREAM_OUTPUT_WIDTH, STREAM_OUTPUT_HEIGHT),
            interpolation=cv2.INTER_AREA,
        )
    return img

# AI Processing Class
class AIStreamProcessor:
    def __init__(self):
        self.enabled = False
        self.current_model = "mobilenet"  # Default model
        self.models = {}
        self.detection_fps = 2  # Will be adjusted per model
        self.latest_detections = []
        self.latest_detection_ts = 0.0
        self.last_detection_time = 0
        
        # Threading for async AI processing
        self.frame_queue = Queue(maxsize=2)  # Small queue to prevent backlog
        self.processing_thread = None
        self.should_stop = False
        
        # Dynamic FPS control - stores current FPS for each model
        self.model_fps_overrides = {}
        
        # Model configurations with AI input sizes
        self.model_configs = {
            "yolo": {
                "name": "YOLO v8n",
                "default_fps": 4,  # Default FPS
                "min_fps": 0.5,    # Minimum allowed FPS
                "max_fps": 15,     # Maximum allowed FPS
                "ai_input_size": (416, 416),
                "available": YOLO_AVAILABLE,
                "description": "High accuracy, optimized input size"
            },
            "mobilenet": {
                "name": "MobileNet-SSD",
                "default_fps": 15,  # Default FPS
                "min_fps": 1,      # Minimum allowed FPS
                "max_fps": 20,     # Maximum allowed FPS
                "ai_input_size": (320, 320),
                "available": MOBILENET_AVAILABLE,
                "description": "Fast inference, good balance"
            }
        }
        
        # Initialize available models
        self._initialize_models()
    
    def _initialize_models(self):
        """Initialize all available models"""
        # Initialize YOLO
        if YOLO_AVAILABLE:
            try:
                print("🤖 Loading YOLO model...")
                self.models["yolo"] = YOLO('yolov8n.pt')
                print("✅ YOLO model loaded successfully")
            except Exception as e:
                print(f"❌ Failed to load YOLO model: {e}")
                self.model_configs["yolo"]["available"] = False
        
        # Initialize MobileNet
        if MOBILENET_AVAILABLE:
            try:
                print("🤖 Loading MobileNet-SSD model...")
                # Use TensorFlow Hub for easier model loading
                model_url = "https://tfhub.dev/tensorflow/ssd_mobilenet_v2/2"
                self.models["mobilenet"] = hub.load(model_url)
                print("✅ MobileNet-SSD model loaded successfully")
            except Exception as e:
                print(f"❌ Failed to load MobileNet model: {e}")
                self.model_configs["mobilenet"]["available"] = False
        
        # Set default model to mobilenet if available, otherwise first available
        available_models = [k for k, v in self.model_configs.items() if v["available"]]
        if available_models:
            # Prefer mobilenet as default, fall back to first available
            if "mobilenet" in available_models:
                self.current_model = "mobilenet"
            else:
                self.current_model = available_models[0]
            
            self.detection_fps = self.get_current_fps(self.current_model)
            print(f"🎯 Default model set to: {self.model_configs[self.current_model]['name']}")
            print(f"   Default FPS: {self.detection_fps}")
    
    def get_available_models(self):
        """Get list of available models with their info"""
        models = {}
        for k, v in self.model_configs.items():
            if v["available"]:
                models[k] = {
                    "name": v["name"],
                    "description": v["description"],
                    "current_fps": self.get_current_fps(k),
                    "default_fps": v["default_fps"],
                    "min_fps": v["min_fps"],
                    "max_fps": v["max_fps"]
                }
        return models
    
    def switch_model(self, model_name):
        """Switch to a different model"""
        if model_name not in self.model_configs:
            raise ValueError(f"Unknown model: {model_name}")
        
        if not self.model_configs[model_name]["available"]:
            raise ValueError(f"Model not available: {model_name}")
        
        old_model = self.current_model
        self.current_model = model_name
        self.detection_fps = self.get_current_fps(model_name)
        
        # Clear previous detections when switching models
        self.latest_detections = []
        self.latest_detection_ts = 0.0
        
        print(f"🔄 Switched from {self.model_configs[old_model]['name']} to {self.model_configs[model_name]['name']}")
        print(f"   FPS: {self.detection_fps}")
        
        return True
    
    def should_process_frame(self):
        current_time = time.time()
        if current_time - self.last_detection_time >= (1.0 / self.detection_fps):
            self.last_detection_time = current_time
            return True
        return False
    
    def start_processing_thread(self):
        """Start the async AI processing thread"""
        if self.processing_thread is None or not self.processing_thread.is_alive():
            self.should_stop = False
            self.processing_thread = threading.Thread(target=self._process_frames_async, daemon=True)
            self.processing_thread.start()
            print("🤖 AI processing thread started")
    
    def stop_processing_thread(self):
        """Stop the async AI processing thread"""
        self.should_stop = True
        if self.processing_thread and self.processing_thread.is_alive():
            self.processing_thread.join(timeout=1.0)
            print("🤖 AI processing thread stopped")
    
    def _process_frames_async(self):
        """Background thread that processes frames for AI detection"""
        while not self.should_stop:
            try:
                if not self.frame_queue.empty():
                    frame_data = self.frame_queue.get(timeout=0.1)
                    if frame_data is not None:
                        self._run_detection(frame_data)
                else:
                    time.sleep(0.01)  # Small sleep when no frames
            except Exception as e:
                print(f"AI processing thread error: {e}")
                time.sleep(0.1)
    
    def _run_detection(self, frame_data):
        """Run AI detection on a frame"""
        try:
            if self.should_process_frame() and self.current_model in self.models:
                ai_img = frame_data['ai_img']
                scale = frame_data['scale']
                offset = frame_data['offset']
                original_shape = frame_data['original_shape']
                ai_input_size = frame_data['ai_input_size']
                
                if self.current_model == "yolo":
                    raw_detections = self._run_yolo_detection(ai_img)
                elif self.current_model == "mobilenet":
                    raw_detections = self._run_mobilenet_detection(ai_img, original_shape)
                else:
                    raw_detections = []
                
                # Scale coordinates back to original image size
                scaled_detections = self._scale_coordinates_back(
                    raw_detections, original_shape, ai_input_size, scale, offset
                )
                
                self.latest_detections = scaled_detections
                self.latest_detection_ts = time.time()
                if len(scaled_detections) > 0:
                    print(f"🎯 {self.model_configs[self.current_model]['name']} detected {len(scaled_detections)} person(s)")
        except Exception as e:
            print(f"Detection error: {e}")
    
    def _run_yolo_detection(self, img):
        """Run YOLO detection"""
        try:
            results = self.models["yolo"](img, classes=[0], verbose=False)
            return self._extract_yolo_detections(results[0])
        except Exception as e:
            print(f"YOLO detection error: {e}")
            return []
    
    def _run_mobilenet_detection(self, img, original_shape):
        """Run MobileNet-SSD detection"""
        try:
            # Convert BGR to RGB and normalize
            img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
            input_tensor = tf.convert_to_tensor(img_rgb)
            input_tensor = tf.cast(input_tensor, tf.uint8)
            input_tensor = input_tensor[tf.newaxis, ...]
            
            # Run detection
            detections = self.models["mobilenet"](input_tensor)
            
            # Extract detections using AI input size, not original shape
            return self._extract_mobilenet_detections(detections, img.shape)
        except Exception as e:
            print(f"MobileNet detection error: {e}")
            return []
    
    def queue_frame_for_processing(self, img):
        """Queue a frame for async AI processing with optimized resizing"""
        if self.enabled and self.current_model in self.models:
            try:
                # Get AI input size for current model
                ai_input_size = self.model_configs[self.current_model]["ai_input_size"]
                original_shape = img.shape[:2]  # (height, width)
                
                # Resize image for AI processing (preserving aspect ratio with padding)
                ai_img, scale, offset = self._resize_with_padding(img, ai_input_size)
                
                # Store both images and scaling info
                frame_data = {
                    'ai_img': ai_img,
                    'original_shape': original_shape,
                    'ai_input_size': ai_input_size,
                    'scale': scale,
                    'offset': offset
                }
                
                # Drop frame if queue is full (prevent backlog)
                if not self.frame_queue.full():
                    self.frame_queue.put(frame_data, block=False)
            except:
                pass  # Queue full, drop frame
    
    def _extract_yolo_detections(self, results):
        """Extract detections from YOLO results"""
        detections = []
        if results.boxes is not None:
            for box in results.boxes:
                if int(box.cls[0]) == 0:  # Person class
                    x1, y1, x2, y2 = box.xyxy[0].tolist()
                    confidence = float(box.conf[0])
                    if confidence > 0.7:
                        detections.append({
                            'bbox': [int(x1), int(y1), int(x2), int(y2)],
                            'confidence': confidence,
                            'class': 'person'
                        })
        return detections
    
    def _extract_mobilenet_detections(self, detections, img_shape):
        """Extract detections from MobileNet results"""
        detection_list = []
        height, width = img_shape[:2]
        
        try:
            # MobileNet outputs from TensorFlow Hub
            detection_boxes = detections['detection_boxes'][0].numpy()
            detection_classes = detections['detection_classes'][0].numpy().astype(int)
            detection_scores = detections['detection_scores'][0].numpy()
            
            for i in range(len(detection_scores)):
                # Class 1 is person in COCO dataset
                if detection_classes[i] == 1 and detection_scores[i] > 0.7:
                    box = detection_boxes[i]
                    y1, x1, y2, x2 = box
                    
                    # Convert normalized coordinates to pixel coordinates
                    x1 = max(0, int(x1 * width))
                    y1 = max(0, int(y1 * height))
                    x2 = min(width, int(x2 * width))
                    y2 = min(height, int(y2 * height))
                    
                    # Only add valid detections
                    if x2 > x1 and y2 > y1:
                        detection_list.append({
                            'bbox': [x1, y1, x2, y2],
                            'confidence': float(detection_scores[i]),
                            'class': 'person'
                        })
        except Exception as e:
            print(f"Error extracting MobileNet detections: {e}")
        
        return detection_list
    
    def draw_detections(self, img, detections):
        """Draw detection boxes and labels on image"""
        for detection in detections:
            x1, y1, x2, y2 = detection['bbox']
            confidence = detection['confidence']
            
            # Different colors for different models
            if self.current_model == "yolo":
                color = (0, 255, 0)  # Green for YOLO
            elif self.current_model == "mobilenet":
                color = (255, 165, 0)  # Orange for MobileNet
            else:
                color = (0, 255, 255)  # Yellow for others
            
            cv2.rectangle(img, (x1, y1), (x2, y2), color, 2)
            label = f"{self.model_configs[self.current_model]['name']}: {confidence:.2f}"
            label_size = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 2)[0]
            cv2.rectangle(img, (x1, y1 - label_size[1] - 10), 
                          (x1 + label_size[0], y1), color, -1)
            cv2.putText(img, label, (x1, y1 - 5), 
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 2)
        return img
    
    def process_frame(self, frame_bytes):
        """Process frame in real-time (non-blocking)"""
        transform_enabled = (
            STREAM_ROTATE_CODE is not None
            or STREAM_FORCE_LANDSCAPE
            or (STREAM_OUTPUT_WIDTH > 0 and STREAM_OUTPUT_HEIGHT > 0)
        )
        ai_enabled = self.enabled and self.current_model in self.models

        if not transform_enabled and not ai_enabled:
            return frame_bytes
            
        try:
            # Decode frame
            nparr = np.frombuffer(frame_bytes, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if img is None:
                return frame_bytes

            img = apply_stream_transform(img)
            
            if ai_enabled:
                # Queue frame for async AI processing (non-blocking)
                self.queue_frame_for_processing(img.copy())
                
                # Always draw latest detections (even if from previous frames)
                img = self.draw_detections(img, self.latest_detections)
            
            # Encode and return immediately
            _, buffer = cv2.imencode('.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, 85])
            return buffer.tobytes()
            
        except Exception as e:
            print(f"Frame processing error: {e}")
            return frame_bytes

    def _resize_with_padding(self, img, target_size):
        """Resize image to target size while preserving aspect ratio using padding"""
        h, w = img.shape[:2]
        target_w, target_h = target_size
        
        # Calculate scaling factor (use minimum to ensure image fits)
        scale = min(target_w / w, target_h / h)
        
        # Calculate new dimensions
        new_w = int(w * scale)
        new_h = int(h * scale)
        
        # Resize image
        resized = cv2.resize(img, (new_w, new_h))
        
        # Create padded image (filled with black)
        padded = np.zeros((target_h, target_w, 3), dtype=np.uint8)
        
        # Calculate padding offsets to center the image
        y_offset = (target_h - new_h) // 2
        x_offset = (target_w - new_w) // 2
        
        # Place resized image in center of padded image
        padded[y_offset:y_offset + new_h, x_offset:x_offset + new_w] = resized
        
        return padded, scale, (x_offset, y_offset)
    
    def _scale_coordinates_back(self, detections, original_shape, ai_input_size, scale, offset):
        """Scale detection coordinates back to original image size"""
        scaled_detections = []
        x_offset, y_offset = offset
        
        for detection in detections:
            x1, y1, x2, y2 = detection['bbox']
            
            # Remove padding offset
            x1 = (x1 - x_offset) / scale
            y1 = (y1 - y_offset) / scale
            x2 = (x2 - x_offset) / scale
            y2 = (y2 - y_offset) / scale
            
            # Clamp to original image bounds
            x1 = max(0, min(original_shape[1], int(x1)))
            y1 = max(0, min(original_shape[0], int(y1)))
            x2 = max(0, min(original_shape[1], int(x2)))
            y2 = max(0, min(original_shape[0], int(y2)))
            
            # Only add valid detections
            if x2 > x1 and y2 > y1:
                scaled_detections.append({
                    'bbox': [x1, y1, x2, y2],
                    'confidence': detection['confidence'],
                    'class': detection['class']
                })
        
        return scaled_detections

    def get_current_fps(self, model_name=None):
        """Get the current FPS for a model (defaults to current model)"""
        if model_name is None:
            model_name = self.current_model
        
        # Return override if set, otherwise return default
        return self.model_fps_overrides.get(model_name, 
                                          self.model_configs[model_name]["default_fps"])
    
    def set_fps(self, model_name, fps):
        """Set FPS for a specific model with validation"""
        if model_name not in self.model_configs:
            raise ValueError(f"Model '{model_name}' not found")
        
        config = self.model_configs[model_name]
        min_fps = config["min_fps"]
        max_fps = config["max_fps"]
        
        # Clamp FPS to valid range
        fps = max(min_fps, min(max_fps, float(fps)))
        
        # Store the override
        self.model_fps_overrides[model_name] = fps
        
        # Update current detection_fps if this is the active model
        if model_name == self.current_model:
            self.detection_fps = fps
            print(f"🎯 {config['name']} FPS updated to {fps:.1f}")
        
        return fps
    
    def get_fps_info(self):
        """Get FPS information for all models"""
        fps_info = {}
        for model_name, config in self.model_configs.items():
            if config["available"]:
                fps_info[model_name] = {
                    "name": config["name"],
                    "current_fps": self.get_current_fps(model_name),
                    "default_fps": config["default_fps"],
                    "min_fps": config["min_fps"],
                    "max_fps": config["max_fps"],
                    "is_active": model_name == self.current_model
                }
        return fps_info

ai_processor = AIStreamProcessor()


def format_mjpeg_frame(frame_bytes):
    return (
        b"--frame\r\n"
        b"Content-Type: image/jpeg\r\n\r\n" + frame_bytes + b"\r\n"
    )

def generate_static_frame():
    img = Image.new('L', (STATIC_FRAME_WIDTH, STATIC_FRAME_HEIGHT))
    pixels = [random.randint(0, 255) for _ in range(STATIC_FRAME_WIDTH * STATIC_FRAME_HEIGHT)]
    img.putdata(pixels)
    byte_io = io.BytesIO()
    img.save(byte_io, 'JPEG')
    return byte_io.getvalue()

def pre_generate_static_frames():
    print(f"Pre-generating {STATIC_FRAME_COUNT} static frames for fallback buffer...")
    global STATIC_FRAME_BUFFER
    for _ in range(STATIC_FRAME_COUNT):
        STATIC_FRAME_BUFFER.append(generate_static_frame())
    print("✅ Static frame buffer created.")


def stream_generator():
    """
    A robust generator that attempts to stream the camera feed. On failure, it
    efficiently streams pre-generated animated static from memory with smooth timing.
    """
    frame_index = 0
    while True:
        try:
            print(f"Attempting to connect to camera at {ESP32_CAM_URL}...")
            r = requests.get(ESP32_CAM_URL, stream=True, timeout=REQUEST_TIMEOUT)
            r.raise_for_status()
            content_type = r.headers.get("Content-Type", "")
            if content_type and "multipart" not in content_type and "image/jpeg" not in content_type:
                raise StreamUnavailable(f"Unexpected Content-Type: {content_type}")
            print("✅ Camera stream connected.")
            
            byte_buffer = b""
            last_frame_time = time.time()

            for chunk in r.iter_content(chunk_size=4096):
                if not chunk:
                    if time.time() - last_frame_time > FRAME_STALL_TIMEOUT:
                        raise StreamUnavailable("Camera stream stalled")
                    continue

                byte_buffer += chunk
                while True:
                    jpg_start = byte_buffer.find(b"\xff\xd8")
                    if jpg_start == -1:
                        if len(byte_buffer) > MAX_STREAM_BUFFER:
                            byte_buffer = byte_buffer[-(MAX_STREAM_BUFFER // 2):]
                        break

                    jpg_end = byte_buffer.find(b"\xff\xd9", jpg_start + 2)
                    if jpg_end == -1:
                        if jpg_start > 0:
                            byte_buffer = byte_buffer[jpg_start:]
                        break

                    jpg_frame = byte_buffer[jpg_start:jpg_end + 2]
                    byte_buffer = byte_buffer[jpg_end + 2:]
                    processed_frame = ai_processor.process_frame(jpg_frame)
                    last_frame_time = time.time()
                    yield format_mjpeg_frame(processed_frame)

                if time.time() - last_frame_time > FRAME_STALL_TIMEOUT:
                    raise StreamUnavailable("Camera stream stalled")

        except (requests.exceptions.RequestException, requests.exceptions.HTTPError, StreamUnavailable) as e:
            print(f"🚨 Camera stream unavailable: {type(e).__name__}. Streaming from buffer.")
            
            # --- IMPROVED FALLBACK ANIMATION LOGIC ---
            # This loop provides a smooth, non-blocking fallback animation.
            
            reconnect_at = time.time() + RECONNECT_DELAY
            frame_duration = 1.0 / STATIC_FPS
            next_frame_time = time.time()

            while time.time() < reconnect_at:
                current_time = time.time()
                
                # Only send frame if we've reached the target time
                if current_time >= next_frame_time:
                    # Use the pre-generated buffer
                    frame_to_send = STATIC_FRAME_BUFFER[frame_index]
                    yield format_mjpeg_frame(frame_to_send)
                    
                    frame_index = (frame_index + 1) % len(STATIC_FRAME_BUFFER)
                    next_frame_time += frame_duration
                
                # Small sleep to prevent busy waiting
                time.sleep(0.01)

            print("Retrying camera connection...")
        except Exception as e:
            print(f"An unexpected error occurred in stream_generator: {e}. Retrying after delay.")
            time.sleep(RECONNECT_DELAY)


@app.route("/stream")
def stream():
    print("🔄 Client connected to stream.")
    return Response(
        stream_generator(),
        mimetype="multipart/x-mixed-replace; boundary=frame",
        headers={
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0"
        }
    )
    
@app.route("/")
def index():
    return f"""<html><head><title>Stream</title></head><body>
            <img src="/stream" width="{STATIC_FRAME_WIDTH}" height="{STATIC_FRAME_HEIGHT}" />
            </body></html>"""

@app.route("/api/ai", methods=['POST'])
def toggle_ai():
    try:
        data = request.get_json()
        if 'enabled' not in data:
            raise ValueError("'enabled' key missing from request")
            
        enabled = data.get('enabled', False)
        model_name = data.get('model', ai_processor.current_model)
        
        # Check if any models are available
        available_models = ai_processor.get_available_models()
        if not available_models and enabled:
             print("❌ Cannot enable AI: No models are available.")
             return jsonify({
                "success": False,
                "ai_enabled": False,
                "message": "AI processing is not available on the server."
            }), 503

        # Switch model if requested
        if model_name != ai_processor.current_model:
            try:
                ai_processor.switch_model(model_name)
            except ValueError as e:
                return jsonify({
                    "success": False,
                    "error": str(e),
                    "ai_enabled": ai_processor.enabled,
                    "current_model": ai_processor.current_model
                }, 400)

        ai_processor.enabled = bool(enabled)
        if not ai_processor.enabled:
            ai_processor.latest_detections = []
            ai_processor.latest_detection_ts = 0.0
        
        # Start or stop the processing thread based on state
        if ai_processor.enabled and ai_processor.current_model in ai_processor.models:
            ai_processor.start_processing_thread()
        else:
            ai_processor.stop_processing_thread()
            
        status = "enabled" if ai_processor.enabled else "disabled"
        print(f"🤖 AI processing has been {status} via API")
        
        return jsonify({
            "success": True,
            "ai_enabled": ai_processor.enabled,
            "current_model": ai_processor.current_model,
            "available_models": available_models,
            "message": f"AI processing {status} with {ai_processor.model_configs[ai_processor.current_model]['name']}"
        })
    except Exception as e:
        print(f"❌ Error in /api/ai: {e}")
        return jsonify({
            "success": False,
            "error": str(e),
            "ai_enabled": ai_processor.enabled,
            "current_model": ai_processor.current_model
        }, 400)

@app.route("/api/detections")
def get_detections():
    return jsonify({
        "detections": ai_processor.latest_detections,
        "ai_enabled": ai_processor.enabled,
        "current_model": ai_processor.current_model,
        "model_info": ai_processor.model_configs[ai_processor.current_model],
        "timestamp": ai_processor.latest_detection_ts
    })

@app.route("/api/models")
def get_models():
    return jsonify({
        "available_models": ai_processor.get_available_models(),
        "current_model": ai_processor.current_model,
        "ai_enabled": ai_processor.enabled,
        "fps_info": ai_processor.get_fps_info()
    })

@app.route("/api/fps", methods=['GET', 'POST'])
def fps_control():
    if request.method == 'GET':
        # Return current FPS information
        return jsonify({
            "success": True,
            "fps_info": ai_processor.get_fps_info(),
            "current_model": ai_processor.current_model
        })
    
    elif request.method == 'POST':
        try:
            data = request.get_json()
            if not data:
                return jsonify({"success": False, "error": "No JSON data provided"}), 400
            
            model_name = data.get('model')
            fps_value = data.get('fps')
            
            if not model_name or fps_value is None:
                return jsonify({
                    "success": False, 
                    "error": "Both 'model' and 'fps' parameters are required"
                }), 400
            
            # Set the FPS
            actual_fps = ai_processor.set_fps(model_name, fps_value)
            
            return jsonify({
                "success": True,
                "model": model_name,
                "fps": actual_fps,
                "fps_info": ai_processor.get_fps_info(),
                "message": f"FPS for {ai_processor.model_configs[model_name]['name']} set to {actual_fps:.1f}"
            })
            
        except ValueError as e:
            return jsonify({"success": False, "error": str(e)}), 400
        except Exception as e:
            print(f"❌ Error in /api/fps: {e}")
            return jsonify({"success": False, "error": str(e)}), 500

if __name__ == "__main__":
    pre_generate_static_frames()
    
    print("\nStarting camera stream proxy server with AI capabilities...")
    print(f"ESP32 Camera URL: {ESP32_CAM_URL}")
    print(
        "Stream transform: "
        f"rotate={STREAM_ROTATE}, "
        f"force_landscape={STREAM_FORCE_LANDSCAPE}, "
        f"output={STREAM_OUTPUT_WIDTH}x{STREAM_OUTPUT_HEIGHT}"
    )
    print(f"YOLO Available: {YOLO_AVAILABLE}")
    print(f"MobileNet Available: {MOBILENET_AVAILABLE}")
    
    available_models = ai_processor.get_available_models()
    if available_models:
        print("🤖 Available AI models:")
        for model_key, model_info in available_models.items():
            status = "✅" if model_key == ai_processor.current_model else "⏸️"
            current_fps = model_info['current_fps']
            default_fps = model_info['default_fps']
            fps_range = f"{model_info['min_fps']}-{model_info['max_fps']}"
            print(f"   {status} {model_info['name']}: {model_info['description']}")
            print(f"      FPS: {current_fps:.1f} (default: {default_fps}, range: {fps_range})")
        print(f"🎯 Default model: {ai_processor.model_configs[ai_processor.current_model]['name']}")
        print("🎚️  Real-time FPS control available via UI or /api/fps endpoint")
        print("🤖 AI detection ready - toggle via the UI or /api/ai endpoint")
        print("📡 Real-time streaming with async AI processing enabled")
    else:
        print("❌ No AI models available")
    
    print("📹 Server starting on http://0.0.0.0:8081")
    
    try:
        app.run(host="0.0.0.0", port=8081)
    finally:
        # Cleanup on shutdown
        print("🛑 Shutting down AI processing...")
        ai_processor.stop_processing_thread()

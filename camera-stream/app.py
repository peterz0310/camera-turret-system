from flask import Flask, Response, request, jsonify
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

load_dotenv()

ESP32_CAM_URL = os.getenv("ESP32_CAM_URL", "http://192.168.4.1/stream")
REQUEST_TIMEOUT = 2.0
RECONNECT_DELAY = 1.0 # How long to show static before retrying connection
STATIC_FRAME_WIDTH = 640
STATIC_FRAME_HEIGHT = 480
STATIC_FRAME_COUNT = 10
STATIC_FPS = 10 # Target FPS for the fallback animation (lowered for consistency)

app = Flask(__name__)

STATIC_FRAME_BUFFER = []

# AI Processing Class
class AIStreamProcessor:
    def __init__(self):
        self.enabled = False
        self.model = None
        self.detection_fps = 2  # Lowered for Pi 5 + YOLO performance
        self.latest_detections = []
        self.last_detection_time = 0
        
        # Threading for async AI processing
        self.frame_queue = Queue(maxsize=2)  # Small queue to prevent backlog
        self.processing_thread = None
        self.should_stop = False
        
        if YOLO_AVAILABLE:
            try:
                print("🤖 Loading YOLO model...")
                self.model = YOLO('yolov8n.pt')
                print("✅ YOLO model loaded successfully")
            except Exception as e:
                print(f"❌ Failed to load YOLO model: {e}")
                self.model = None
    
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
    
    def _run_detection(self, img):
        """Run AI detection on a frame"""
        try:
            if self.should_process_frame() and self.model:
                results = self.model(img, classes=[0], verbose=False)
                new_detections = self.extract_detections(results[0])
                self.latest_detections = new_detections
                if len(new_detections) > 0:
                    print(f"🎯 Detected {len(new_detections)} person(s)")
        except Exception as e:
            print(f"Detection error: {e}")
    
    def queue_frame_for_processing(self, img):
        """Queue a frame for async AI processing (non-blocking)"""
        if self.enabled and self.model:
            try:
                # Drop frame if queue is full (prevent backlog)
                if not self.frame_queue.full():
                    self.frame_queue.put(img, block=False)
            except:
                pass  # Queue full, drop frame
    
    def extract_detections(self, results):
        detections = []
        if results.boxes is not None:
            for box in results.boxes:
                if int(box.cls[0]) == 0:
                    x1, y1, x2, y2 = box.xyxy[0].tolist()
                    confidence = float(box.conf[0])
                    if confidence > 0.5:
                        detections.append({
                            'bbox': [int(x1), int(y1), int(x2), int(y2)],
                            'confidence': confidence,
                            'class': 'person'
                        })
        return detections
    
    def draw_detections(self, img, detections):
        for detection in detections:
            x1, y1, x2, y2 = detection['bbox']
            confidence = detection['confidence']
            cv2.rectangle(img, (x1, y1), (x2, y2), (0, 255, 0), 2)
            label = f"Person {confidence:.2f}"
            label_size = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 2)[0]
            cv2.rectangle(img, (x1, y1 - label_size[1] - 10), 
                          (x1 + label_size[0], y1), (0, 255, 0), -1)
            cv2.putText(img, label, (x1, y1 - 5), 
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 2)
        return img
    
    def process_frame(self, frame_bytes):
        """Process frame in real-time (non-blocking)"""
        if not self.enabled or not self.model:
            return frame_bytes
            
        try:
            # Decode frame
            nparr = np.frombuffer(frame_bytes, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if img is None:
                return frame_bytes
            
            # Queue frame for async AI processing (non-blocking)
            self.queue_frame_for_processing(img.copy())
            
            # Always draw latest detections (even if from previous frames)
            annotated_img = self.draw_detections(img, self.latest_detections)
            
            # Encode and return immediately
            _, buffer = cv2.imencode('.jpg', annotated_img, [cv2.IMWRITE_JPEG_QUALITY, 85])
            return buffer.tobytes()
            
        except Exception as e:
            print(f"Frame processing error: {e}")
            return frame_bytes

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
            print("✅ Camera stream connected.")
            
            byte_buffer = b''
            boundary = b'--frame' 

            for chunk in r.iter_content(chunk_size=4096):
                byte_buffer += chunk
                parts = byte_buffer.split(boundary)

                for part in parts[:-1]:
                    if not part.strip():
                        continue
                    
                    jpg_start = part.find(b'\xff\xd8')
                    if jpg_start != -1:
                        jpg_frame = part[jpg_start:]
                        processed_frame = ai_processor.process_frame(jpg_frame)
                        yield format_mjpeg_frame(processed_frame)

                byte_buffer = parts[-1]

        except (requests.exceptions.RequestException, requests.exceptions.HTTPError) as e:
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
        
        if not YOLO_AVAILABLE and enabled:
             print("❌ Cannot enable AI: YOLO libraries are not available.")
             return jsonify({
                "success": False,
                "ai_enabled": False,
                "message": "AI processing is not available on the server."
            }), 503

        ai_processor.enabled = bool(enabled)
        
        # Start or stop the processing thread based on state
        if ai_processor.enabled and ai_processor.model:
            ai_processor.start_processing_thread()
        else:
            ai_processor.stop_processing_thread()
            
        status = "enabled" if ai_processor.enabled else "disabled"
        print(f"🤖 AI processing has been {status} via API")
        
        return jsonify({
            "success": True,
            "ai_enabled": ai_processor.enabled,
            "message": f"AI processing {status}"
        })
    except Exception as e:
        print(f"❌ Error in /api/ai: {e}")
        return jsonify({
            "success": False,
            "error": str(e),
            "ai_enabled": ai_processor.enabled
        }), 400

@app.route("/api/detections")
def get_detections():
    return jsonify({
        "detections": ai_processor.latest_detections,
        "ai_enabled": ai_processor.enabled,
        "timestamp": time.time()
    })

if __name__ == "__main__":
    pre_generate_static_frames()
    
    print("\nStarting camera stream proxy server with AI capabilities...")
    print(f"ESP32 Camera URL: {ESP32_CAM_URL}")
    print(f"YOLO Available: {YOLO_AVAILABLE}")
    if YOLO_AVAILABLE:
        print("🤖 AI detection ready - toggle via the UI or /api/ai endpoint")
        print("� Real-time streaming with async AI processing enabled")
    print("�📹 Server starting on http://0.0.0.0:8081")
    
    try:
        app.run(host="0.0.0.0", port=8081)
    finally:
        # Cleanup on shutdown
        print("🛑 Shutting down AI processing...")
        ai_processor.stop_processing_thread()
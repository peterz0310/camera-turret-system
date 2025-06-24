from flask import Flask, Response
import requests
import time
import os
from dotenv import load_dotenv
from PIL import Image, ImageDraw
import io
import random

load_dotenv()

ESP32_CAM_URL = os.getenv("ESP32_CAM_URL", "http://192.168.4.1/stream")
REQUEST_TIMEOUT = 2.0
RECONNECT_DELAY = 1.0
STATIC_FRAME_WIDTH = 640
STATIC_FRAME_HEIGHT = 480
STATIC_FRAME_COUNT = 20

app = Flask(__name__)

STATIC_FRAME_BUFFER = []


def format_mjpeg_frame(frame_bytes):
    """Formats image bytes as an MJPEG frame."""
    return (
        b"--frame\r\n"
        b"Content-Type: image/jpeg\r\n\r\n" + frame_bytes + b"\r\n"
    )

def generate_static_frame():
    """Generates a single frame of random static noise."""
    img = Image.new('L', (STATIC_FRAME_WIDTH, STATIC_FRAME_HEIGHT))
    pixels = [random.randint(0, 255) for _ in range(STATIC_FRAME_WIDTH * STATIC_FRAME_HEIGHT)]
    img.putdata(pixels)
    
    byte_io = io.BytesIO()
    img.save(byte_io, 'JPEG')
    return byte_io.getvalue()

def pre_generate_static_frames():
    """
    Runs ONCE on startup. Fills the global buffer with static frames to eliminate
    CPU load during fallback operation.
    """
    print(f"Pre-generating {STATIC_FRAME_COUNT} static frames for fallback buffer...")
    global STATIC_FRAME_BUFFER
    for _ in range(STATIC_FRAME_COUNT):
        STATIC_FRAME_BUFFER.append(generate_static_frame())
    print("✅ Static frame buffer created.")


def stream_generator():
    """
    A robust generator that attempts to stream the camera feed. On failure, it
    efficiently streams pre-generated animated static from memory with very low CPU usage.
    """
    frame_index = 0
    while True:
        try:
            print(f"Attempting to connect to camera at {ESP32_CAM_URL}...")
            r = requests.get(ESP32_CAM_URL, stream=True, timeout=REQUEST_TIMEOUT)
            r.raise_for_status()
            print("✅ Camera stream connected.")
            
            byte_buffer = b''
            for chunk in r.iter_content(chunk_size=4096):
                byte_buffer += chunk
                start = byte_buffer.find(b'\xff\xd8')
                end = byte_buffer.find(b'\xff\xd9')
                if start != -1 and end != -1:
                    jpg_frame = byte_buffer[start:end+2]
                    byte_buffer = byte_buffer[end+2:]
                    yield format_mjpeg_frame(jpg_frame)
        
        except (requests.exceptions.RequestException, requests.exceptions.HTTPError) as e:
            print(f"🚨 Camera stream unavailable: {type(e).__name__}. Streaming from buffer.")
            
            start_time = time.time()
            while time.time() - start_time < RECONNECT_DELAY:
                # Cycle through the pre-generated frames from the buffer
                frame_to_send = STATIC_FRAME_BUFFER[frame_index]
                yield format_mjpeg_frame(frame_to_send)
                
                # Advance the frame index for the next iteration
                frame_index = (frame_index + 1) % len(STATIC_FRAME_BUFFER)
                time.sleep(0.05) # Controls static animation FPS
            print("Retrying camera connection...")
        except Exception as e:
            print(f"An unexpected error occurred: {e}. Retrying after delay.")
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

if __name__ == "__main__":
    pre_generate_static_frames()
    
    print("\nStarting camera stream proxy server...")
    print(f"ESP32 Camera URL: {ESP32_CAM_URL}")
    app.run(host="0.0.0.0", port=8081)
from flask import Flask, Response
import requests
import time
import os
from dotenv import load_dotenv

load_dotenv()

ESP32_CAM_URL = os.getenv("ESP32_CAM_URL", "http://192.168.4.1/stream")
FALLBACK_IMAGE_PATH = "fallback.jpg"
REQUEST_TIMEOUT = 2.0
RECONNECT_DELAY = 1.0

app = Flask(__name__)

def generate_mjpeg_frame(frame_bytes):
    """Helper function to format a byte buffer as an MJPEG frame."""
    return (
        b"--frame\r\n"
        b"Content-Type: image/jpeg\r\n\r\n" + frame_bytes + b"\r\n"
    )

def stream_generator():
    """
    A resilient generator that continuously tries to connect to the ESP32 camera stream.
    If the connection is lost or a frame isn't received, it yields a fallback image
    and then immediately tries to reconnect without dropping the client connection.
    """
    fallback_frame_bytes = None
    try:
        with open(FALLBACK_IMAGE_PATH, "rb") as f:
            fallback_frame_bytes = f.read()
        print("✅ Fallback image loaded successfully.")
    except FileNotFoundError:
        print(f"🚨 CRITICAL: Fallback image not found at {FALLBACK_IMAGE_PATH}")
        return

    fallback_mjpeg_frame = generate_mjpeg_frame(fallback_frame_bytes)

    while True:
        try:
            r = requests.get(ESP32_CAM_URL, stream=True, timeout=REQUEST_TIMEOUT)
            r.raise_for_status()

            # Read the stream chunk by chunk (each chunk is a frame)
            # The 'iter_content' will yield chunks of the response body.
            # For an MJPEG stream, the boundary is defined by the server, 
            # and requests will hand us data as it comes in. We need to find the JPEG data.
            # A common way ESP32 cameras send MJPEG is one JPEG per chunk.
            byte_buffer = b''
            for chunk in r.iter_content(chunk_size=4096):
                byte_buffer += chunk
                start = byte_buffer.find(b'\xff\xd8')
                end = byte_buffer.find(b'\xff\xd9')

                if start != -1 and end != -1:
                    jpg_frame = byte_buffer[start:end+2]
                    byte_buffer = byte_buffer[end+2:]
                    yield generate_mjpeg_frame(jpg_frame)
                    
        except (requests.exceptions.RequestException, requests.exceptions.HTTPError) as e:
            print(f"🚫 ESP32 stream unavailable: {type(e).__name__}. Streaming fallback.")
            yield fallback_mjpeg_frame
            time.sleep(RECONNECT_DELAY)
        except Exception as e:
            print(f"🚨 An unexpected error occurred: {e}")
            yield fallback_mjpeg_frame
            time.sleep(RECONNECT_DELAY)

@app.route("/stream")
def stream():
    """Endpoint to provide the live camera feed or a fallback."""
    print("🔄 Client connected to stream.")
    # The mimetype tells the browser this is a multipart stream, where each part replaces the last.
    # The boundary 'frame' is used to separate each image.
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

@app.route("/ping")
def ping():
    """A simple health check for the server itself."""
    return "OK", 200
    
@app.route("/")
def index():
    """A simple test page to view the stream directly."""
    return """
    <html>
        <head><title>ESP32 Camera Stream</title></head>
        <body>
            <h1>Live Stream</h1>
            <img src="/stream" width="640" height="480" />
        </body>
    </html>
    """

if __name__ == "__main__":
    print(f"Starting camera stream server...")
    print(f"ESP32 Camera URL: {ESP32_CAM_URL}")
    app.run(host="0.0.0.0", port=8081)
"use client";

import React, { useState, useEffect, useRef } from "react";
import { Joystick } from "react-joystick-component";

// --- Configuration ---
const WEBSOCKET_URL = "ws://192.168.4.29/ws";
const CAMERA_STREAM_URL = "http://192.168.4.57:8081/stream";
const MAX_RECONNECT_ATTEMPTS = 5;

function App() {
  // WebSocket state
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState(null);
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);

  // --- FIX: Stabilize the stream URL ---
  // We will only change this URL when we explicitly want to force a reload.
  const [streamUrl, setStreamUrl] = useState("");
  const [isStreamLoading, setIsStreamLoading] = useState(true);
  const [streamError, setStreamError] = useState(null);

  // UI State
  const [crosshairEnabled, setCrosshairEnabled] = useState(false);
  const [selectedCrosshair, setSelectedCrosshair] = useState("crosshair-1.png");
  const [crosshairPanelOpen, setCrosshairPanelOpen] = useState(false);

  // --- WebSocket Logic (unchanged) ---
  const connectWebSocket = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      return;
    }
    if (wsRef.current) {
      wsRef.current.close();
    }
    setConnecting(true);
    setConnectionError(null);
    const socket = new WebSocket(WEBSOCKET_URL);
    wsRef.current = socket;
    socket.onopen = () => {
      console.log("🔌 WebSocket connected");
      setConnected(true);
      setConnecting(false);
      reconnectAttemptsRef.current = 0;
    };
    socket.onclose = (event) => {
      console.log("❌ WebSocket disconnected", event.code, event.reason);
      setConnected(false);
      setConnecting(false);
      if (event.code !== 1000 && reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttemptsRef.current++;
        const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current - 1), 10000);
        reconnectTimeoutRef.current = setTimeout(connectWebSocket, delay);
      } else if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
        setConnectionError("Max reconnection attempts reached");
      }
    };
    socket.onerror = (err) => {
      console.error("WebSocket error:", err);
      setConnectionError("Connection failed");
      setConnecting(false);
    };
  };

  const disconnectWebSocket = () => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    reconnectAttemptsRef.current = MAX_RECONNECT_ATTEMPTS;
    if (wsRef.current) {
      wsRef.current.close(1000, "Manual disconnect");
    }
    setConnected(false);
    setConnecting(false);
  };

  // --- Component Lifecycle ---
  useEffect(() => {
    // On initial mount, set the stream URL once and connect WebSocket.
    setStreamUrl(`${CAMERA_STREAM_URL}?t=${Date.now()}`);
    connectWebSocket();

    return () => {
      disconnectWebSocket();
    };
  }, []); // Empty dependency array ensures this runs only ONCE.

  // --- Event Handlers for the image stream ---
  const handleStreamLoad = () => {
    console.log("✅ Camera stream image has loaded.");
    setIsStreamLoading(false);
    setStreamError(null);
  };

  const handleStreamError = () => {
    console.error("🚨 The camera stream proxy is down or unreachable.");
    setIsStreamLoading(false);
    setStreamError("The camera service is unavailable. The stream could not be loaded.");
  };
  
  // --- FIX: Retry function now generates a new URL to force reload ---
  const retryStream = () => {
    setIsStreamLoading(true);
    setStreamError(null);
    setStreamUrl(`${CAMERA_STREAM_URL}?t=${Date.now()}`);
  };

  // --- Event Handlers (unchanged) ---
  const handleMove = ({ x, y }) => {
    if (connected && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ x, y }));
    }
  };

  const handleStop = () => {
    if (connected && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ x: 0, y: 0 }));
    }
  };

  const handleCalibrate = () => {
    if (connected && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ calibrate: true }));
    }
  };

  // --- Render ---
  return (
    <div className="relative min-h-screen bg-slate-900 text-white overflow-hidden">
      {/* Header and Controls (unchanged) */}
      <div className="absolute top-2 left-1/2 transform -translate-x-1/2 z-20">
        <h1 className="text-3xl font-bold text-center">Turret Control</h1>
      </div>
      <div className="absolute top-4 right-4 z-20 flex flex-col gap-3 items-end">
        {/* ... connection status and buttons ... */}
      </div>

      {/* Camera Feed Display */}
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="relative h-[90vh] aspect-[4/3] border border-gray-600 rounded-lg overflow-hidden bg-gray-800 flex items-center justify-center">
            {streamError ? (
                <div className="text-center p-8">
                    <div className="text-6xl mb-4">📹</div>
                    <h3 className="text-xl font-bold mb-2">Camera Service Error</h3>
                    <p className="text-gray-400 mb-4">{streamError}</p>
                    <button
                        onClick={retryStream}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-white transition-colors"
                    >
                        Retry
                    </button>
                </div>
            ) : (
                <>
                    {/* --- FIX: Use the stable streamUrl from state --- */}
                    {streamUrl && (
                        <img
                            src={streamUrl}
                            alt="Camera Feed"
                            className={`w-full h-full object-cover ${isStreamLoading ? 'hidden' : 'block'}`}
                            onLoad={handleStreamLoad}
                            onError={handleStreamError}
                        />
                    )}

                    {isStreamLoading && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
                            <p className="mt-2 text-sm text-gray-400">Loading Stream...</p>
                        </div>
                    )}
                    
                    {crosshairEnabled && !isStreamLoading && (
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <img
                          src={`/${selectedCrosshair}`}
                          alt="Crosshair"
                          className="w-32 h-32 opacity-80"
                        />
                      </div>
                    )}
                </>
            )}
        </div>
      </div>

      {/* Joystick */}
      <div className="absolute right-8 top-1/2 transform -translate-y-1/2 z-10">
        <div className="relative">
          <Joystick
            size={250}
            stickSize={50}
            baseColor="rgba(102, 102, 102, 0.8)"
            stickColor="#0af"
            move={handleMove}
            stop={handleStop}
            disabled={!connected}
          />
          {!connected && (
            <div className="absolute inset-0 bg-black/50 rounded-full flex items-center justify-center">
              <span className="text-white text-sm font-medium">Disconnected</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
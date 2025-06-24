"use client";

import React, { useState, useEffect, useRef } from "react";
import { Joystick } from "react-joystick-component";

const WEBSOCKET_URL = "ws://192.168.4.29/ws";
const CAMERA_STREAM_URL = "http://192.168.4.57:8081/stream";
const MAX_RECONNECT_ATTEMPTS = 5;

function App() {
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState(null);
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const [streamUrl, setStreamUrl] = useState("");
  const [isStreamLoading, setIsStreamLoading] = useState(true);
  const [streamError, setStreamError] = useState(null);
  const [crosshairEnabled, setCrosshairEnabled] = useState(false);
  const [selectedCrosshair, setSelectedCrosshair] = useState("crosshair-1.png");
  const [crosshairPanelOpen, setCrosshairPanelOpen] = useState(false);
  const [crosshairSize, setCrosshairSize] = useState(128); // Default size in pixels

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

  // Close crosshair panel when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (crosshairPanelOpen && !event.target.closest('.crosshair-panel-container')) {
        setCrosshairPanelOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [crosshairPanelOpen]);

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

  // --- Crosshair Control Functions ---
  const handleCrosshairToggle = (option) => {
    if (option === "off") {
      setCrosshairEnabled(false);
    } else {
      setCrosshairEnabled(true);
      setSelectedCrosshair(option);
    }
    setCrosshairPanelOpen(false);
  };

  const handleCrosshairSizeChange = (e) => {
    setCrosshairSize(parseInt(e.target.value));
  };

  // --- Render ---
  return (
    <div className="relative min-h-screen bg-slate-900 text-white overflow-hidden">
      {/* Header and Controls */}
      <div className="absolute top-2 left-1/2 transform -translate-x-1/2 z-20">
        <h1 className="text-3xl font-bold text-center">Turret Control</h1>
      </div>
      
      {/* Crosshair Controls */}
      <div className="absolute top-4 left-4 z-20">
        <div className="relative crosshair-panel-container">
          <button
            onClick={() => setCrosshairPanelOpen(!crosshairPanelOpen)}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-white transition-colors flex items-center gap-2"
          >
            🎯 Crosshair
            <span className="text-xs">
              {crosshairEnabled ? selectedCrosshair.replace('.png', '').replace('-', ' ') : 'Off'}
            </span>
          </button>
          
          {crosshairPanelOpen && (
            <div className="absolute top-12 left-0 bg-gray-800 border border-gray-600 rounded-lg p-4 min-w-64 shadow-lg">
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-gray-300 mb-2">Crosshair Options</h3>
                
                {/* Crosshair Selection */}
                <div className="space-y-2">
                  <button
                    onClick={() => handleCrosshairToggle("off")}
                    className={`w-full px-3 py-2 rounded text-left transition-colors ${
                      !crosshairEnabled 
                        ? 'bg-blue-600 text-white' 
                        : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
                    }`}
                  >
                    Off
                  </button>
                  <button
                    onClick={() => handleCrosshairToggle("crosshair-1.png")}
                    className={`w-full px-3 py-2 rounded text-left transition-colors ${
                      crosshairEnabled && selectedCrosshair === "crosshair-1.png"
                        ? 'bg-blue-600 text-white' 
                        : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
                    }`}
                  >
                    Crosshair 1
                  </button>
                  <button
                    onClick={() => handleCrosshairToggle("crosshair-2.png")}
                    className={`w-full px-3 py-2 rounded text-left transition-colors ${
                      crosshairEnabled && selectedCrosshair === "crosshair-2.png"
                        ? 'bg-blue-600 text-white' 
                        : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
                    }`}
                  >
                    Crosshair 2
                  </button>
                </div>
                
                {/* Size Control */}
                {crosshairEnabled && (
                  <div className="border-t border-gray-600 pt-3 mt-3">
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Size: {crosshairSize}px
                    </label>
                    <input
                      type="range"
                      min="32"
                      max="256"
                      step="16"
                      value={crosshairSize}
                      onChange={handleCrosshairSizeChange}
                      className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer slider"
                    />
                    <div className="flex justify-between text-xs text-gray-400 mt-1">
                      <span>32px</span>
                      <span>256px</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      
      <div className="absolute top-4 right-4 z-20 flex flex-col gap-3 items-end">
        {/* Connection Status */}
        <div className="flex items-center gap-2">
          <div
            className={`w-3 h-3 rounded-full ${
              connected ? "bg-green-500" : connecting ? "bg-yellow-500" : "bg-red-500"
            }`}
          />
          <span className="text-sm">
            {connected ? "Connected" : connecting ? "Connecting..." : "Disconnected"}
          </span>
        </div>

        {/* Error Message */}
        {connectionError && (
          <div className="text-red-400 text-sm text-right">
            {connectionError}
          </div>
        )}

        {/* Control Buttons */}
        <div className="flex gap-2">
          <button
            onClick={connected ? disconnectWebSocket : connectWebSocket}
            disabled={connecting}
            className={`px-4 py-2 rounded text-sm transition-colors ${
              connected
                ? "bg-red-600 hover:bg-red-700 text-white"
                : "bg-green-600 hover:bg-green-700 text-white"
            } ${connecting ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            {connected ? "Disconnect" : "Connect"}
          </button>

          <button
            onClick={handleCalibrate}
            disabled={!connected}
            className={`px-4 py-2 rounded text-sm transition-colors ${
              connected
                ? "bg-blue-600 hover:bg-blue-700 text-white"
                : "bg-gray-600 text-gray-400 cursor-not-allowed"
            }`}
          >
            Calibrate
          </button>
        </div>
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
                          className="opacity-80"
                          style={{
                            width: `${crosshairSize}px`,
                            height: `${crosshairSize}px`
                          }}
                        />
                      </div>
                    )}
                </>
            )}
        </div>
      </div>

      {/* Joystick */}
      {connected && (
        <div className="absolute right-8 top-1/2 transform -translate-y-1/2 z-10">
          <div className="relative">
            <Joystick
              size={250}
              stickSize={50}
              baseColor="rgba(102, 102, 102, 0.8)"
              stickColor="#0af"
              move={handleMove}
              stop={handleStop}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
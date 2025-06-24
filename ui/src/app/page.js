"use client";

import React, { useState, useEffect, useRef } from "react";
import { Joystick } from "react-joystick-component";

const WEBSOCKET_URL = "ws://192.168.4.29/ws";
const CAMERA_STREAM_URL = "http://192.168.4.57:8081/stream";
const MAX_RECONNECT_ATTEMPTS = 5;

const PowerIcon = ({ className }) => (
  <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-12h2v8h-2z" />
  </svg>
);

const CalibrateIcon = ({ className }) => (
  <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm-7 7H3v4h4v-2H5v-2zm14-7h2v4h-2V8zm-2 11v2h4v-4h-2v2h-2zM5 5h2V3H3v4h2V5z" />
  </svg>
);

const CrosshairIcon = ({ className }) => (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v3h3v2h-3v3h-2v-3H8v-2h3V7z"/>
    </svg>
);

const TargetIcon = ({ className }) => (
  <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2V7zm0 8h2v2h-2v-2z"/>
  </svg>
);

const BurstFireIcon = ({ className }) => (
  <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
  </svg>
);


function App() {
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState(null);
  const [streamUrl, setStreamUrl] = useState("");
  const [isStreamLoading, setIsStreamLoading] = useState(true);
  const [streamError, setStreamError] = useState(null);
  const [crosshairEnabled, setCrosshairEnabled] = useState(true);
  const [selectedCrosshair, setSelectedCrosshair] = useState("crosshair-1.png");
  const [crosshairPanelOpen, setCrosshairPanelOpen] = useState(false);
  const [crosshairSize, setCrosshairSize] = useState(128);
  const [triggerActive, setTriggerActive] = useState(false);
  const [lastFireTime, setLastFireTime] = useState(0);

  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const crosshairPanelRef = useRef(null);
  const triggerPanelRef = useRef(null);

  // --- WEBSOCKET LOGIC ---
  const connectWebSocket = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;
    if (wsRef.current) wsRef.current.close();
    
    setConnecting(true);
    setConnectionError(null);
    
    const socket = new WebSocket(WEBSOCKET_URL);
    wsRef.current = socket;

    socket.onopen = () => {
      console.log("🔌 [SYS] WebSocket Link Established");
      setConnected(true);
      setConnecting(false);
      reconnectAttemptsRef.current = 0;
    };

    socket.onclose = (event) => {
      console.log(`❌ [SYS] WebSocket Link Severed (Code: ${event.code})`);
      setConnected(false);
      setConnecting(false);
      if (event.code !== 1000 && reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttemptsRef.current++;
        const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current - 1), 10000);
        console.log(`[SYS] Reconnection attempt ${reconnectAttemptsRef.current} in ${delay}ms`);
        reconnectTimeoutRef.current = setTimeout(connectWebSocket, delay);
      } else if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
        setConnectionError("MAX RECONNECT ATTEMPTS");
      }
    };

    socket.onerror = (err) => {
      console.error("[SYS] WebSocket Error:", err);
      setConnectionError("CONNECTION FAULT");
      setConnecting(false);
    };
  };

  const disconnectWebSocket = () => {
    if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    reconnectAttemptsRef.current = MAX_RECONNECT_ATTEMPTS; // Prevent reconnection
    if (wsRef.current) {
      wsRef.current.close(1000, "Manual Disconnect");
    }
  };

  // --- COMPONENT LIFECYCLE & EFFECTS ---
  useEffect(() => {
    setStreamUrl(`${CAMERA_STREAM_URL}?t=${Date.now()}`);
    connectWebSocket();
    return () => disconnectWebSocket();
  }, []);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (crosshairPanelRef.current && !crosshairPanelRef.current.contains(event.target)) {
        setCrosshairPanelOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Keyboard shortcuts for trigger controls
  useEffect(() => {
    const handleKeyPress = (event) => {
      if (!connected || triggerActive) return;
      
      switch (event.key.toLowerCase()) {
        case ' ':
        case 'f':
          event.preventDefault();
          handleFireSingle();
          break;
        case 'b':
        case 'v':
          event.preventDefault();
          handleFireBurst();
          break;
        case 'c':
          event.preventDefault();
          handleCalibrate();
          break;
      }
    };

    document.addEventListener('keydown', handleKeyPress);
    return () => document.removeEventListener('keydown', handleKeyPress);
  }, [connected, triggerActive]);

  // --- EVENT HANDLERS ---
  const handleStreamLoad = () => {
    console.log("✅ [CAM] Video Feed Synchronized");
    setIsStreamLoading(false);
    setStreamError(null);
  };

  const handleStreamError = () => {
    console.error("🚨 [CAM] Video Feed Service Unreachable");
    setIsStreamLoading(false);
    setStreamError("Primary video feed is offline. Check camera service integrity.");
  };

  const retryStream = () => {
    setIsStreamLoading(true);
    setStreamError(null);
    setStreamUrl(`${CAMERA_STREAM_URL}?t=${Date.now()}`);
  };

  const handleMove = ({ x, y }) => {
    if (connected) wsRef.current?.send(JSON.stringify({ x, y }));
  };

  const handleStop = () => {
    if (connected) wsRef.current?.send(JSON.stringify({ x: 0, y: 0 }));
  };

  const handleCalibrate = () => {
    if (connected) wsRef.current?.send(JSON.stringify({ calibrate: true }));
  };
  
  const handleFireSingle = () => {
    if (connected && !triggerActive) {
      setTriggerActive(true);
      setLastFireTime(Date.now());
      wsRef.current?.send(JSON.stringify({ fire: "single" }));
      console.log("🎯 [FIRE] Single shot command sent");
      // Reset trigger active state after a reasonable delay
      setTimeout(() => setTriggerActive(false), 1000);
    }
  };

  const handleFireBurst = () => {
    if (connected && !triggerActive) {
      setTriggerActive(true);
      setLastFireTime(Date.now());
      wsRef.current?.send(JSON.stringify({ fire: "burst" }));
      console.log("🎯 [FIRE] Burst fire command sent (3 rounds)");
      // Reset trigger active state after burst duration (1.5s + buffer)
      setTimeout(() => setTriggerActive(false), 2000);
    }
  };
  
  const handleCrosshairToggle = (option) => {
    if (option === "off") {
      setCrosshairEnabled(false);
    } else {
      setCrosshairEnabled(true);
      setSelectedCrosshair(option);
    }
    setCrosshairPanelOpen(false);
  };

  const handleCrosshairSizeChange = (e) => setCrosshairSize(parseInt(e.target.value));

  const handleTriggerControl = () => {
    setTriggerActive((prev) => !prev);
    if (connected) wsRef.current?.send(JSON.stringify({ trigger: !triggerActive }));
  };

  // --- STYLING & CLASSES ---
  const controlButtonClass = "flex items-center gap-2 px-3 py-1.5 border border-cyan-400/30 bg-black/30 text-cyan-400 rounded-sm hover:bg-cyan-400/20 hover:text-cyan-300 transition-all duration-300 backdrop-blur-sm text-xs uppercase font-mono tracking-wider disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-black/30 disabled:hover:text-cyan-400";
  const crosshairOptionClass = (isActive) =>
    `w-full px-3 py-2 text-left transition-colors duration-200 text-sm font-mono ${
      isActive
        ? 'bg-cyan-600 text-white'
        : 'bg-gray-700/50 hover:bg-gray-600/70 text-gray-300'
    }`;

  // Calculate time since last fire for visual feedback
  const timeSinceLastFire = Date.now() - lastFireTime;
  const recentlyFired = timeSinceLastFire < 3000; // Show feedback for 3 seconds


  return (
    <div className="relative min-h-screen bg-[#0A192F] text-cyan-300 font-mono overflow-hidden">
        {/* Decorative Grid Background */}
        <div className="absolute inset-0 z-0 opacity-10 bg-[linear-gradient(to_right,theme(colors.cyan.700)_1px,transparent_1px),linear-gradient(to_bottom,theme(colors.cyan.700)_1px,transparent_1px)] bg-[size:2rem_2rem]"></div>
        <div className="absolute inset-0 z-0 bg-gradient-to-t from-black/50 to-transparent"></div>

      {/* --- HEADER --- */}
      <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-30 bg-black/40 border border-cyan-500/30 px-6 py-2 rounded-sm shadow-lg backdrop-blur-sm">
        <h1 className="text-2xl font-bold text-center uppercase tracking-widest text-cyan-400">Sentry Turret Control</h1>
      </div>

      {/* --- UI OVERLAY --- */}
      <div className="absolute inset-0 z-20 pointer-events-none">
        {/* Corner Brackets */}
        <div className="absolute top-4 left-4 w-16 h-16 border-t-2 border-l-2 border-cyan-400/50 rounded-tl-md"></div>
        <div className="absolute top-4 right-4 w-16 h-16 border-t-2 border-r-2 border-cyan-400/50 rounded-tr-md"></div>
        <div className="absolute bottom-4 left-4 w-16 h-16 border-b-2 border-l-2 border-cyan-400/50 rounded-bl-md"></div>
        <div className="absolute bottom-4 right-4 w-16 h-16 border-b-2 border-r-2 border-cyan-400/50 rounded-br-md"></div>
      </div>

      {/* --- LEFT CONTROL PANEL --- */}
      <div className="absolute top-1/2 -translate-y-1/2 left-8 z-30 flex flex-col gap-4">
         {/* Crosshair Controls */}
         <div ref={crosshairPanelRef} className="relative crosshair-panel-container pointer-events-auto">
            <button
                onClick={() => setCrosshairPanelOpen(!crosshairPanelOpen)}
                className={controlButtonClass}
            >
                <CrosshairIcon className="w-5 h-5"/>
                <span>Targeting</span>
            </button>
            
            {crosshairPanelOpen && (
                <div className="absolute bottom-full left-0 mb-3 bg-black/70 border border-cyan-500/30 rounded-md p-4 w-64 shadow-2xl backdrop-blur-md animate-fadeIn">
                    <div className="space-y-3">
                        <h3 className="text-sm font-bold text-cyan-400 mb-2 uppercase tracking-wider">Reticule Options</h3>
                        
                        <div className="space-y-1">
                            <button onClick={() => handleCrosshairToggle("off")} className={crosshairOptionClass(!crosshairEnabled)}>SYSTEM OFF</button>
                            <button onClick={() => handleCrosshairToggle("crosshair-1.png")} className={crosshairOptionClass(crosshairEnabled && selectedCrosshair === "crosshair-1.png")}>Standard Cross</button>
                            <button onClick={() => handleCrosshairToggle("crosshair-2.png")} className={crosshairOptionClass(crosshairEnabled && selectedCrosshair === "crosshair-2.png")}>Circular Dot</button>
                        </div>
                        
                        {crosshairEnabled && (
                        <div className="border-t border-cyan-500/30 pt-3 mt-3">
                            <label className="block text-sm font-medium text-cyan-400 mb-2">
                                SIZE: {crosshairSize}PX
                            </label>
                            <input
                            type="range"
                            min="32" max="256" step="16"
                            value={crosshairSize}
                            onChange={handleCrosshairSizeChange}
                            className="w-full h-2 bg-cyan-900/50 rounded-lg appearance-none cursor-pointer range-slider"
                            />
                        </div>
                        )}
                    </div>
                </div>
            )}
        </div>
        
        {/* Calibration Button */}
        <button
          onClick={handleCalibrate}
          disabled={!connected}
          className={controlButtonClass}
        >
          <CalibrateIcon className="w-5 h-5" />
          <span>Calibrate</span>
        </button>

        {/* Fire Control Panel */}
        <div className="flex flex-col gap-2 pointer-events-auto">
          <button
            onClick={handleFireSingle}
            disabled={!connected || triggerActive}
            className={`${controlButtonClass} ${triggerActive ? 'opacity-50 cursor-not-allowed' : 'hover:border-orange-400/50 hover:text-orange-300'}`}
          >
            <TargetIcon className="w-5 h-5" />
            <span>Single Shot</span>
          </button>
          
          <button
            onClick={handleFireBurst}
            disabled={!connected || triggerActive}
            className={`${controlButtonClass} ${triggerActive ? 'opacity-50 cursor-not-allowed' : 'hover:border-red-400/50 hover:text-red-300'}`}
          >
            <BurstFireIcon className="w-5 h-5" />
            <span>Burst Fire</span>
          </button>
        </div>

        {/* Trigger Status */}
        {triggerActive && (
          <div className="bg-red-900/50 border border-red-500/50 px-3 py-1.5 rounded-sm text-xs uppercase font-mono tracking-wider backdrop-blur-sm animate-pulse pointer-events-auto">
            <span className="text-red-400">⚡ FIRING</span>
          </div>
        )}
      </div>


      {/* --- RIGHT STATUS & CONTROL PANEL --- */}
      <div className="absolute top-4 right-8 z-30 flex flex-col gap-3 items-end pointer-events-auto">
        {/* Connection Status */}
        <div className="flex items-center gap-2 bg-black/40 border border-cyan-500/30 px-3 py-1.5 rounded-sm text-xs uppercase font-mono tracking-wider backdrop-blur-sm mt-3">
          <span>SYS-LINK:</span>
          <div className={`w-3 h-3 rounded-full ${connected ? "bg-cyan-400 animate-pulse" : connecting ? "bg-yellow-400" : "bg-red-500"}`} />
          <span className={`${connected ? "text-cyan-400" : connecting ? "text-yellow-400" : "text-red-500"}`}>
            {connected ? "ACTIVE" : connecting ? "LINKING..." : "SEVERED"}
          </span>
        </div>

        {/* Keyboard Shortcuts */}
        {connected && (
          <div className="bg-black/40 border border-cyan-500/30 px-3 py-2 rounded-sm backdrop-blur-sm">
            <h4 className="text-xs uppercase font-mono tracking-wider text-cyan-400 mb-1">Hotkeys</h4>
            <div className="text-xs font-mono text-gray-400 space-y-0.5">
              <div><span className="text-cyan-300">F/SPACE:</span> Single Fire</div>
              <div><span className="text-cyan-300">B/V:</span> Burst Fire</div>
              <div><span className="text-cyan-300">C:</span> Calibrate</div>
            </div>
          </div>
        )}

        {/* Error Message */}
        {connectionError && (
          <div className="text-red-400 text-sm text-right bg-red-900/50 border border-red-500/50 px-3 py-1 animate-pulse">
            CRITICAL: {connectionError}
          </div>
        )}

        {/* Connect/Disconnect */}
        <button
            onClick={connected ? disconnectWebSocket : connectWebSocket}
            disabled={connecting}
            className={`${controlButtonClass} ${connected ? 'text-red-400 border-red-400/30 hover:bg-red-400/20' : ''}`}
        >
            <PowerIcon className="w-5 h-5" />
            <span>{connected ? "Terminate Link" : "Establish Link"}</span>
        </button>
      </div>

      {/* --- CAMERA FEED --- */}
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="relative h-[calc(100vh-8rem)] aspect-[4/3] border-2 border-cyan-500/30 bg-black shadow-[0_0_20px_theme(colors.cyan.500/20)]">
            {streamError ? (
                <div className="w-full h-full flex items-center justify-center text-center p-8 bg-black/80">
                    <div>
                        <div className="text-6xl mb-4 text-red-500">⚠</div>
                        <h3 className="text-xl font-bold mb-2 text-red-400 uppercase tracking-widest">Video Feed Failure</h3>
                        <p className="text-gray-400 mb-6 max-w-sm">{streamError}</p>
                        <button
                            onClick={retryStream}
                            className="px-6 py-2 bg-cyan-600 hover:bg-cyan-700 rounded-sm text-white transition-colors duration-300 uppercase tracking-wider text-sm"
                        >
                            Attempt Resync
                        </button>
                    </div>
                </div>
            ) : (
                <>
                    {streamUrl && (
                        <img
                            src={streamUrl}
                            alt="Sentry Camera Feed"
                            className={`w-full h-full object-cover transition-opacity duration-500 ${isStreamLoading ? 'opacity-0' : 'opacity-100'}`}
                            onLoad={handleStreamLoad}
                            onError={handleStreamError}
                        />
                    )}

                    {isStreamLoading && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50">
                            <div className="w-16 h-16 border-4 border-dashed border-cyan-500 rounded-full animate-spin"></div>
                            <p className="mt-4 text-lg text-cyan-400 tracking-widest">SYNCHRONIZING FEED...</p>
                        </div>
                    )}
                    
                    {crosshairEnabled && !isStreamLoading && (
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <img
                          src={`/${selectedCrosshair}`}
                          alt="Targeting Reticule"
                          className="opacity-80 transition-all duration-300"
                          style={{
                            width: `${crosshairSize}px`,
                            height: `${crosshairSize}px`
                          }}
                        />
                      </div>
                    )}

                    {/* Muzzle Flash Effect */}
                    {triggerActive && (
                      <div className="absolute inset-0 bg-orange-300/20 animate-muzzleFlash pointer-events-none" />
                    )}

                    {/* Recent Fire Indicator */}
                    {recentlyFired && !triggerActive && (
                      <div className="absolute top-4 left-4 bg-orange-900/70 border border-orange-500/50 px-2 py-1 rounded-sm text-xs font-mono text-orange-300 animate-fadeIn">
                        ROUND FIRED: {Math.floor((3000 - timeSinceLastFire) / 1000) + 1}s
                      </div>
                    )}
                </>
            )}
             {/* Scanlines Effect */}
            <div className="absolute inset-0 z-10 pointer-events-none opacity-10 bg-[linear-gradient(to_bottom,transparent_50%,black_50%)] bg-[size:100%_4px]"></div>
        </div>
      </div>

      {/* --- JOYSTICK --- */}
      {connected && (
        <div className="absolute right-16 top-1/2 transform -translate-y-1/2 z-30 pointer-events-auto">
          <Joystick
            size={200}
            stickSize={60}
            baseColor="rgba(0, 0, 0, 0.4)"
            stickColor="rgba(0, 255, 255, 0.6)"
            move={handleMove}
            stop={handleStop}
            baseClassName="border-2 border-cyan-400/50 rounded-full backdrop-blur-sm"
            stickClassName="transition-colors"
          />
        </div>
      )}
    </div>
  );
}

export default App;
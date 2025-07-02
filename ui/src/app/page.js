"use client";

import React, { useState, useEffect, useRef } from "react";
import { Joystick } from "react-joystick-component";
import { 
  Power, 
  Crosshair, 
  Target, 
  Zap, 
  Brain, 
  Cpu, 
  ChevronDown, 
  Timer, 
  RotateCcw, 
  Settings, 
  ArrowUp, 
  ArrowDown, 
  ArrowLeft, 
  ArrowRight
} from "lucide-react";

const WEBSOCKET_URL = "ws://192.168.4.29/ws";
const CAMERA_STREAM_BASE_URL = "http://192.168.4.57:8081";
const CAMERA_STREAM_URL = `${CAMERA_STREAM_BASE_URL}/stream`;
const API_URL = `${CAMERA_STREAM_BASE_URL}/api`;
const MAX_RECONNECT_ATTEMPTS = 5;


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
  const [aiMode, setAiMode] = useState(false);
  const [availableModels, setAvailableModels] = useState({});
  const [currentModel, setCurrentModel] = useState('mobilenet');
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [fpsInfo, setFpsInfo] = useState({});
  const [fpsSliderOpen, setFpsSliderOpen] = useState(false);
  const [currentAngles, setCurrentAngles] = useState(null);
  
  // Angular motion state
  const [angularPanelOpen, setAngularPanelOpen] = useState(false);
  const [angularStepSize, setAngularStepSize] = useState(10);
  const [isMoving, setIsMoving] = useState(false);
  const [settingsPanelOpen, setSettingsPanelOpen] = useState(false);
  const [motorSettings, setMotorSettings] = useState({
    horizontalGearRatio: 8.0,
    verticalGearRatio: 3.0,
    stepsPerRevolution: 200.0,
    microstepFactor: 2
  });

  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const crosshairPanelRef = useRef(null);
  const triggerPanelRef = useRef(null);
  const aiPanelRef = useRef(null);
  const fpsSliderRef = useRef(null);
  const angularPanelRef = useRef(null);
  const settingsPanelRef = useRef(null);

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
    // Set the stream URL once on initial load. It won't be changed again unless retried.
    setStreamUrl(`${CAMERA_STREAM_URL}?t=${Date.now()}`);
    connectWebSocket();
    fetchAvailableModels();
    return () => disconnectWebSocket();
  }, []);

  // Fetch available AI models on load
  const fetchAvailableModels = async () => {
    try {
      const response = await fetch(`${API_URL}/models`);
      const data = await response.json();
      if (response.ok) {
        setAvailableModels(data.available_models);
        setCurrentModel(data.current_model);
        setAiMode(data.ai_enabled);
        setFpsInfo(data.fps_info || {});
        setModelsLoaded(true);
        console.log('📋 [AI] Available models loaded:', data.available_models);
        console.log('🎯 [AI] FPS info loaded:', data.fps_info);
      }
    } catch (error) {
      console.error('❌ [AI] Failed to fetch models:', error);
    }
  };

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (crosshairPanelRef.current && !crosshairPanelRef.current.contains(event.target)) {
        setCrosshairPanelOpen(false);
      }
      if (aiPanelRef.current && !aiPanelRef.current.contains(event.target)) {
        setAiPanelOpen(false);
      }
      if (fpsSliderRef.current && !fpsSliderRef.current.contains(event.target)) {
        setFpsSliderOpen(false);
      }
      if (angularPanelRef.current && !angularPanelRef.current.contains(event.target)) {
        setAngularPanelOpen(false);
      }
      if (settingsPanelRef.current && !settingsPanelRef.current.contains(event.target)) {
        setSettingsPanelOpen(false);
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
        case 'a':
          event.preventDefault();
          handleAIToggle();
          break;
        case '1':
        case '2':
          event.preventDefault();
          const modelKeys = Object.keys(availableModels);
          const modelIndex = parseInt(event.key) - 1;
          if (modelKeys[modelIndex]) {
            handleModelSwitch(modelKeys[modelIndex]);
          }
          break;
        // Angular movement hotkeys
        case 'arrowup':
        case 'w':
          event.preventDefault();
          handleAngularMove(0, angularStepSize);
          break;
        case 'arrowdown':
        case 's':
          event.preventDefault();
          handleAngularMove(0, -angularStepSize);
          break;
        case 'arrowleft':
        case 'a':
          event.preventDefault();
          handleAngularMove(-angularStepSize, 0);
          break;
        case 'arrowright':
        case 'd':
          event.preventDefault();
          handleAngularMove(angularStepSize, 0);
          break;
        case 'home':
        case 'h':
          event.preventDefault();
          handleMoveToCenter();
          break;
      }
    };

    document.addEventListener('keydown', handleKeyPress);
    return () => document.removeEventListener('keydown', handleKeyPress);
  }, [connected, triggerActive, aiMode, angularStepSize]); // Added angularStepSize dependency

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

  // NEW: Handles AI toggle by calling API without reloading the stream
  const handleAIToggle = async () => {
    const newAiMode = !aiMode;
    console.log(`🤖 [AI] Attempting to set mode to: ${newAiMode ? 'ENABLED' : 'DISABLED'}`);
    try {
      const response = await fetch(`${API_URL}/ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: newAiMode, model: currentModel })
      });
      
      const data = await response.json();

      if (response.ok && data.success) {
        // Set state from the authoritative server response
        setAiMode(data.ai_enabled);
        setCurrentModel(data.current_model);
        console.log(`✅ [AI] Mode successfully set to: ${data.ai_enabled ? 'ENABLED' : 'DISABLED'} with model: ${data.current_model}`);
      } else {
        console.error('❌ [AI] Failed to toggle AI mode:', data.message || response.status);
        // Optional: Add UI feedback for the user that the toggle failed.
      }
    } catch (error) {
      console.error('❌ [AI] Network error while toggling AI mode:', error);
       // Optional: Add UI feedback for the user that the toggle failed.
    }
  };

  // Handle model switching
  const handleModelSwitch = async (modelName) => {
    if (modelName === currentModel) return;
    
    console.log(`🔄 [AI] Switching to model: ${modelName}`);
    try {
      const response = await fetch(`${API_URL}/ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: aiMode, model: modelName })
      });
      
      const data = await response.json();

      if (response.ok && data.success) {
        setCurrentModel(data.current_model);
        setAiMode(data.ai_enabled);
        setAiPanelOpen(false);
        console.log(`✅ [AI] Successfully switched to: ${data.current_model}`);
      } else {
        console.error('❌ [AI] Failed to switch model:', data.message || response.status);
      }
    } catch (error) {
      console.error('❌ [AI] Network error while switching model:', error);
    }
  };

  // Handle FPS changes
  const handleFpsChange = async (modelName, newFps) => {
    try {
      const response = await fetch(`${API_URL}/fps`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelName, fps: parseFloat(newFps) })
      });
      
      const data = await response.json();
      
      if (response.ok && data.success) {
        setFpsInfo(data.fps_info);
        console.log(`🎯 [AI] FPS updated for ${modelName}: ${data.fps}`);
      } else {
        console.error('❌ [AI] Failed to update FPS:', data.error);
      }
    } catch (error) {
      console.error('❌ [AI] Network error updating FPS:', error);
    }
  };

  // Reset FPS to default for a model
  const handleResetFps = async (modelName) => {
    const modelInfo = availableModels[modelName];
    if (modelInfo) {
      await handleFpsChange(modelName, modelInfo.default_fps);
    }
  };

  // --- ANGULAR MOTION HELPERS ---
  function sendMoveByAngle(h, v) {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      setIsMoving(true);
      wsRef.current.send(JSON.stringify({ moveByAngle: { horizontal: h, vertical: v } }));
      console.log(`🎯 [ANGULAR] Moving by H:${h}°, V:${v}°`);
      // Reset moving state after a reasonable delay
      setTimeout(() => setIsMoving(false), 1000);
    }
  }
  
  function sendMoveToCenter() {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      setIsMoving(true);
      wsRef.current.send(JSON.stringify({ moveToCenter: true }));
      console.log('🎯 [ANGULAR] Moving to center position');
      setTimeout(() => setIsMoving(false), 2000); // Center moves might take longer
    }
  }
  
  function requestCurrentAngles() {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ getCurrentAngles: true }));
    }
  }

  // Enhanced angular movement handlers
  const handleAngularMove = (h, v) => {
    if (!connected || isMoving) return;
    sendMoveByAngle(h, v);
  };

  const handleMoveToCenter = () => {
    if (!connected || isMoving) return;
    sendMoveToCenter();
  };

  const handleStepSizeChange = (newSize) => {
    setAngularStepSize(newSize);
    console.log(`🎯 [ANGULAR] Step size changed to ${newSize}°`);
  };

  const handleMotorSettingsUpdate = async (newSettings) => {
    try {
      // Send settings to firmware if there's an API endpoint for it
      const response = await fetch(`${API_URL}/motor-settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSettings)
      });
      
      if (response.ok) {
        setMotorSettings(newSettings);
        console.log('🔧 [SETTINGS] Motor settings updated:', newSettings);
      } else {
        console.error('❌ [SETTINGS] Failed to update motor settings');
      }
    } catch (error) {
      console.error('❌ [SETTINGS] Error updating motor settings:', error);
      // Update local state anyway for testing
      setMotorSettings(newSettings);
    }
  };

  // Listen for current angle responses and other feedback
  useEffect(() => {
    if (!wsRef.current) return;
    const socket = wsRef.current;
    function handleMessage(event) {
      try {
        const data = JSON.parse(event.data);
        if (data.currentAngles) {
          setCurrentAngles(data.currentAngles);
          console.log('📐 [ANGULAR] Current angles received:', data.currentAngles);
        }
        if (data.movementComplete) {
          setIsMoving(false);
          console.log('✅ [ANGULAR] Movement completed');
        }
        if (data.calibrationComplete) {
          console.log('✅ [CALIBRATION] Calibration completed');
          requestCurrentAngles(); // Update angles after calibration
        }
      } catch (e) {
        console.error('❌ [WS] Error parsing message:', e);
      }
    }
    socket.addEventListener('message', handleMessage);
    return () => socket.removeEventListener('message', handleMessage);
  }, [connected]);

  // --- STYLING & CLASSES ---
  const controlButtonClass = "flex items-center gap-2 px-3 py-1.5 border border-cyan-400/30 bg-black/30 text-cyan-400 rounded-sm hover:bg-cyan-400/20 hover:text-cyan-300 transition-all duration-300 backdrop-blur-sm text-xs uppercase font-mono tracking-wider cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-black/30 disabled:hover:text-cyan-400";
  const crosshairOptionClass = (isActive) =>
    `w-full px-3 py-2 text-left transition-colors duration-200 text-sm font-mono cursor-pointer ${
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
              <Crosshair className="w-5 h-5"/>
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
          <RotateCcw className="w-5 h-5" />
          <span>Calibrate</span>
        </button>

        {/* Angular Motion Controls */}
        <div ref={angularPanelRef} className="relative pointer-events-auto">
          <button
            onClick={() => setAngularPanelOpen(!angularPanelOpen)}
            className={`${controlButtonClass} ${isMoving ? 'border-yellow-400/50 text-yellow-400' : ''}`}
          >
            <RotateCcw className="w-5 h-5" />
            <span>{isMoving ? 'MOVING...' : 'Angular'}</span>
          </button>
          
          {angularPanelOpen && (
            <div className="absolute bottom-full left-0 mb-3 bg-black/70 border border-cyan-500/30 rounded-md p-4 w-80 shadow-2xl backdrop-blur-md animate-fadeIn">
              <div className="space-y-4">
                <h3 className="text-sm font-bold text-cyan-400 mb-2 uppercase tracking-wider">Angular Positioning</h3>
                
                {/* Current Position Display */}
                {currentAngles && (
                  <div className="bg-gray-800/50 p-3 rounded border border-gray-600">
                    <div className="text-xs text-gray-400 mb-1">CURRENT POSITION</div>
                    <div className="flex justify-between text-sm">
                      <span>H: {currentAngles.horizontal.toFixed(2)}°</span>
                      <span>V: {currentAngles.vertical.toFixed(2)}°</span>
                    </div>
                  </div>
                )}
                
                {/* Step Size Control */}
                <div className="space-y-2">
                  <label className="block text-xs text-cyan-400 uppercase tracking-wider">
                    Step Size: {angularStepSize}°
                  </label>
                  <div className="flex gap-2">
                    {[1, 5, 10, 15, 30, 45].map((size) => (
                      <button
                        key={size}
                        onClick={() => handleStepSizeChange(size)}
                        className={`px-2 py-1 text-xs rounded transition-colors ${
                          angularStepSize === size
                            ? 'bg-cyan-600 text-white'
                            : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
                        }`}
                      >
                        {size}°
                      </button>
                    ))}
                  </div>
                </div>
                
                {/* Direction Controls */}
                <div className="space-y-3">
                  <div className="text-xs text-cyan-400 uppercase tracking-wider">Direction Controls</div>
                  
                  {/* Vertical Controls */}
                  <div className="flex justify-center">
                    <button
                      onClick={() => handleAngularMove(0, angularStepSize)}
                      disabled={!connected || isMoving}
                      className="p-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded transition-colors"
                    >
                      <ArrowUp className="w-4 h-4" />
                    </button>
                  </div>
                  
                  {/* Horizontal Controls */}
                  <div className="flex justify-center gap-4">
                    <button
                      onClick={() => handleAngularMove(-angularStepSize, 0)}
                      disabled={!connected || isMoving}
                      className="p-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded transition-colors"
                    >
                      <ArrowLeft className="w-4 h-4" />
                    </button>
                    
                    <button
                      onClick={handleMoveToCenter}
                      disabled={!connected || isMoving}
                      className="px-3 py-2 bg-cyan-700 hover:bg-cyan-600 disabled:opacity-50 rounded text-xs font-mono transition-colors"
                    >
                      CENTER
                    </button>
                    
                    <button
                      onClick={() => handleAngularMove(angularStepSize, 0)}
                      disabled={!connected || isMoving}
                      className="p-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded transition-colors"
                    >
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                  
                  {/* Down Button */}
                  <div className="flex justify-center">
                    <button
                      onClick={() => handleAngularMove(0, -angularStepSize)}
                      disabled={!connected || isMoving}
                      className="p-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded transition-colors"
                    >
                      <ArrowDown className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                
                {/* Quick Actions */}
                <div className="border-t border-gray-600 pt-3 space-y-2">
                  <button
                    onClick={requestCurrentAngles}
                    disabled={!connected}
                    className="w-full px-3 py-1.5 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 rounded text-xs font-mono transition-colors"
                  >
                    REFRESH POSITION
                  </button>
                </div>
                
                {/* Hotkey Help */}
                <div className="border-t border-gray-600 pt-2">
                  <div className="text-xs text-gray-500">
                    <div className="font-mono">WASD/Arrow Keys: Move</div>
                    <div className="font-mono">H/Home: Center</div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* AI Detection Controls - Combined Menu */}
        <div className="relative pointer-events-auto" ref={aiPanelRef}>
          <button
            onClick={() => setAiPanelOpen(!aiPanelOpen)}
            className={`${controlButtonClass} justify-between w-full ${aiMode ? 'border-green-400/50 text-green-400 hover:bg-green-400/20 hover:text-green-300' : 'hover:border-purple-400/50 hover:text-purple-300'}`}
          >
            <div className="flex items-center gap-2">
              <Brain className="w-5 h-5" />
              <span>{aiMode ? 'AI ACTIVE' : 'AI STANDBY'}</span>
            </div>
            <ChevronDown className={`w-4 h-4 transition-transform ${aiPanelOpen ? 'rotate-180' : ''}`} />
          </button>

          {aiPanelOpen && (
            <div className="absolute bottom-full left-0 mb-3 bg-black/70 border border-cyan-500/30 rounded-md p-4 w-80 shadow-2xl backdrop-blur-md animate-fadeIn">
              <div className="space-y-4">
                <h3 className="text-sm font-bold text-cyan-400 mb-2 uppercase tracking-wider">AI Detection System</h3>
                
                {/* AI Toggle */}
                <div className="flex items-center justify-between p-3 bg-gray-800/50 rounded border border-gray-600">
                  <span className="text-sm font-mono">AI Detection</span>
                  <button
                    onClick={handleAIToggle}
                    className={`px-3 py-1 rounded text-xs font-mono transition-colors ${
                      aiMode 
                        ? 'bg-green-600 text-white hover:bg-green-700' 
                        : 'bg-gray-600 text-gray-300 hover:bg-gray-500'
                    }`}
                  >
                    {aiMode ? 'ENABLED' : 'DISABLED'}
                  </button>
                </div>

                {/* Model Selection */}
                {modelsLoaded && Object.keys(availableModels).length > 0 && (
                  <div className="space-y-2">
                    <label className="block text-xs text-cyan-400 uppercase tracking-wider">Detection Model</label>
                    <div className="space-y-1">
                      {Object.entries(availableModels).map(([modelKey, modelInfo]) => (
                        <button
                          key={modelKey}
                          onClick={() => handleModelSwitch(modelKey)}
                          className={`w-full px-3 py-2 text-left transition-colors duration-200 text-xs font-mono cursor-pointer rounded ${
                            modelKey === currentModel
                              ? 'bg-cyan-600 text-white'
                              : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
                          }`}
                        >
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center justify-between">
                              <span className="font-semibold uppercase tracking-wider">{modelInfo.name}</span>
                              <span className="text-xs opacity-70">
                                {fpsInfo[modelKey]?.current_fps?.toFixed(1) || modelInfo.current_fps?.toFixed(1) || modelInfo.default_fps} FPS
                              </span>
                            </div>
                            <span className="text-xs opacity-80">{modelInfo.description}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* FPS Controls */}
                {modelsLoaded && Object.keys(availableModels).length > 0 && (
                  <div className="border-t border-gray-600 pt-3 space-y-3">
                    <label className="block text-xs text-cyan-400 uppercase tracking-wider">Frame Rate Control</label>
                    {Object.entries(availableModels).map(([modelKey, modelInfo]) => {
                      const currentFps = fpsInfo[modelKey]?.current_fps || modelInfo.current_fps || modelInfo.default_fps;
                      const isActive = modelKey === currentModel;
                      
                      return (
                        <div key={modelKey} className={`space-y-2 p-2 rounded ${isActive ? 'bg-cyan-900/30 border border-cyan-600/30' : 'bg-gray-800/30'}`}>
                          <div className="flex items-center justify-between">
                            <span className={`text-xs font-mono uppercase tracking-wider ${isActive ? 'text-cyan-400' : 'text-gray-400'}`}>
                              {modelInfo.name}
                            </span>
                            <div className="flex items-center gap-2">
                              <span className={`text-xs font-mono ${isActive ? 'text-cyan-400' : 'text-gray-400'}`}>
                                {typeof currentFps === 'number' ? currentFps.toFixed(1) : currentFps} FPS
                              </span>
                              <button
                                onClick={() => handleResetFps(modelKey)}
                                className="text-xs px-2 py-1 border border-gray-600 hover:border-cyan-400 text-gray-400 hover:text-cyan-400 rounded transition-colors"
                                title="Reset to default"
                              >
                                RESET
                              </button>
                            </div>
                          </div>
                          
                          <div className="space-y-1">
                            <input
                              type="range"
                              min={modelInfo.min_fps}
                              max={modelInfo.max_fps}
                              step="0.1"
                              value={currentFps}
                              onChange={(e) => handleFpsChange(modelKey, e.target.value)}
                              className={`w-full h-2 rounded-lg appearance-none cursor-pointer ${
                                isActive ? 'accent-cyan-400' : 'accent-gray-500'
                              }`}
                            />
                            <div className="flex justify-between text-xs text-gray-500 font-mono">
                              <span>{modelInfo.min_fps}</span>
                              <span>DEFAULT: {modelInfo.default_fps}</span>
                              <span>{modelInfo.max_fps}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Fire Control Panel */}
        <div className="flex flex-col gap-2 pointer-events-auto">
          <button
            onClick={handleFireSingle}
            disabled={!connected || triggerActive}
            className={`${controlButtonClass} ${triggerActive ? 'opacity-50 cursor-not-allowed' : 'hover:border-orange-400/50 hover:text-orange-300'}`}
          >
            <Target className="w-5 h-5" />
            <span>Single Shot</span>
          </button>
          
          <button
            onClick={handleFireBurst}
            disabled={!connected || triggerActive}
            className={`${controlButtonClass} ${triggerActive ? 'opacity-50 cursor-not-allowed' : 'hover:border-red-400/50 hover:text-red-300'}`}
          >
            <Zap className="w-5 h-5" />
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
              <div><span className="text-cyan-300">A:</span> Toggle AI</div>
              <div><span className="text-cyan-300">WASD/Arrows:</span> Angular Move</div>
              <div><span className="text-cyan-300">H/Home:</span> Center Position</div>
              {Object.keys(availableModels).length > 0 && (
                <>
                  <div><span className="text-cyan-300">1:</span> MobileNet Model</div>
                  <div><span className="text-cyan-300">2:</span> YOLO Model</div>
                </>
              )}
            </div>
          </div>
        )}

        {/* AI Status Panel */}
        {aiMode && modelsLoaded && (
          <div className="bg-black/40 border border-green-500/30 px-3 py-2 rounded-sm backdrop-blur-sm">
            <h4 className="text-xs uppercase font-mono tracking-wider text-green-400 mb-1">AI Detection</h4>
            <div className="text-xs font-mono text-gray-400 space-y-0.5">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                <span className="text-green-300">{availableModels[currentModel]?.name || currentModel} Active</span>
              </div>
              <div><span className="text-green-300">Target FPS:</span> {availableModels[currentModel]?.fps || 'N/A'}</div>
              <div className="text-xs opacity-70">{availableModels[currentModel]?.description || 'Person Detection'}</div>
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
            <Power className="w-5 h-5" />
            <span>{connected ? "Terminate Link" : "Establish Link"}</span>
        </button>
      </div>

      {/* --- MOTOR SETTINGS PANEL (Bottom Right) --- */}
      <div className="absolute bottom-8 right-8 z-30 pointer-events-auto">
        <div className="relative" ref={settingsPanelRef}>
          <button
            onClick={() => setSettingsPanelOpen(!settingsPanelOpen)}
            className={controlButtonClass}
          >
            <Settings className="w-4 h-4" />
            <span>Motor Config</span>
          </button>

          {settingsPanelOpen && (
            <div className="absolute bottom-full right-0 mb-3 w-72 bg-gray-800/95 backdrop-blur-sm border border-cyan-400/30 rounded-sm shadow-lg z-50">
              <div className="p-3 space-y-4">
                <h4 className="text-sm uppercase font-mono tracking-wider text-cyan-400">Motor Configuration</h4>
                
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Horizontal Gear Ratio</label>
                    <input
                      type="number"
                      step="0.1"
                      value={motorSettings.horizontalGearRatio}
                      onChange={(e) => setMotorSettings({
                        ...motorSettings,
                        horizontalGearRatio: parseFloat(e.target.value)
                      })}
                      className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Vertical Gear Ratio</label>
                    <input
                      type="number"
                      step="0.1"
                      value={motorSettings.verticalGearRatio}
                      onChange={(e) => setMotorSettings({
                        ...motorSettings,
                        verticalGearRatio: parseFloat(e.target.value)
                      })}
                      className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Steps Per Revolution</label>
                    <input
                      type="number"
                      value={motorSettings.stepsPerRevolution}
                      onChange={(e) => setMotorSettings({
                        ...motorSettings,
                        stepsPerRevolution: parseInt(e.target.value)
                      })}
                      className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Microstep Factor</label>
                    <select
                      value={motorSettings.microstepFactor}
                      onChange={(e) => setMotorSettings({
                        ...motorSettings,
                        microstepFactor: parseInt(e.target.value)
                      })}
                      className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                    >
                      <option value={1}>1 (Full Step)</option>
                      <option value={2}>2 (Half Step)</option>
                      <option value={4}>4 (Quarter Step)</option>
                      <option value={8}>8 (Eighth Step)</option>
                      <option value={16}>16 (Sixteenth Step)</option>
                    </select>
                  </div>
                </div>
                
                <div className="border-t border-gray-600 pt-3">
                  <button
                    onClick={() => handleMotorSettingsUpdate(motorSettings)}
                    className="w-full px-3 py-2 bg-cyan-700 hover:bg-cyan-600 text-white rounded text-sm font-mono transition-colors"
                  >
                    UPDATE SETTINGS
                  </button>
                </div>
                
                <div className="text-xs text-gray-500 font-mono">
                  <div>Current H Steps/°: {((motorSettings.stepsPerRevolution * motorSettings.microstepFactor * motorSettings.horizontalGearRatio) / 360).toFixed(2)}</div>
                  <div>Current V Steps/°: {((motorSettings.stepsPerRevolution * motorSettings.microstepFactor * motorSettings.verticalGearRatio) / 360).toFixed(2)}</div>
                </div>
              </div>
            </div>
          )}
        </div>
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
                            className="px-6 py-2 bg-cyan-600 hover:bg-cyan-700 rounded-sm text-white transition-colors duration-300 uppercase tracking-wider text-sm cursor-pointer"
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

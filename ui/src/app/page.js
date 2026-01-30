"use client";

import React, { useState, useEffect, useRef } from "react";
import { Joystick } from "react-joystick-component";
import {
  Power,
  Crosshair,
  Target,
  Zap,
  Brain,
  ChevronDown,
  Home
} from "lucide-react";
import { useTurretWebSocket } from "../hooks/useTurretWebSocket";
import { AngleGauges } from "../components/AngleGauges";
import { AngularPanel } from "../components/AngularPanel";

// Allow runtime configuration while keeping current values as defaults.
const WEBSOCKET_URL =
  process.env.NEXT_PUBLIC_WEBSOCKET_URL || "ws://192.168.4.29/ws";
const CAMERA_STREAM_BASE_URL =
  process.env.NEXT_PUBLIC_CAMERA_STREAM_BASE_URL || "http://192.168.4.57:8081";
const CAMERA_STREAM_URL = `${CAMERA_STREAM_BASE_URL}/stream`;
const API_URL = `${CAMERA_STREAM_BASE_URL}/api`;
const ANGULAR_STEP_OPTIONS = [1, 5, 10, 15, 30, 45];
const AUTO_AIM_HFOV_DEG = 65;
const AUTO_AIM_DEADZONE_DEG = 0.8;
const AUTO_AIM_MAX_STEP_DEG = 2.0;
const AUTO_AIM_MIN_STEP_DEG = 0.2;
const AUTO_AIM_MIN_COMMAND_INTERVAL_MS = 160;
const AUTO_AIM_DETECTION_STALE_MS = 700;
const AUTO_AIM_KP = 0.45;
const AUTO_AIM_ERROR_ALPHA = 0.35;
const AUTO_AIM_USE_ABSOLUTE = true;
const AUTO_AIM_REPLAN_ERROR_DEG = 4.0;
const AUTO_AIM_SNAP_GAIN = 1.0;
const AUTO_AIM_SNAP_MAX_DEG = 25.0;
const AUTO_AIM_YAW_SIGN = 1;
const AUTO_AIM_PITCH_SIGN = -1;


function App() {
  const {
    connected,
    connecting,
    connectionError,
    status,
    currentAngles,
    isMoving,
    messages,
    sendCommand,
    connect: connectWebSocket,
    disconnect: disconnectWebSocket,
    markMoving
  } = useTurretWebSocket(WEBSOCKET_URL);
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
  const [logsOpen, setLogsOpen] = useState(false);
  const [autoAimEnabled, setAutoAimEnabled] = useState(false);
  const [autoAimPanelOpen, setAutoAimPanelOpen] = useState(false);
  const [autoAimSettings, setAutoAimSettings] = useState({
    kp: AUTO_AIM_KP,
    maxStep: AUTO_AIM_MAX_STEP_DEG,
    minStep: AUTO_AIM_MIN_STEP_DEG,
    deadzone: AUTO_AIM_DEADZONE_DEG,
    intervalMs: AUTO_AIM_MIN_COMMAND_INTERVAL_MS,
    smoothing: AUTO_AIM_ERROR_ALPHA,
    useAbsolute: AUTO_AIM_USE_ABSOLUTE,
    replanErrorDeg: AUTO_AIM_REPLAN_ERROR_DEG,
    snapGain: AUTO_AIM_SNAP_GAIN,
    snapMaxDeg: AUTO_AIM_SNAP_MAX_DEG
  });
  
  // Angular motion state
  const [angularStepSize, setAngularStepSize] = useState(10);

  const crosshairPanelRef = useRef(null);
  const aiPanelRef = useRef(null);
  const fpsSliderRef = useRef(null);
  const logPanelRef = useRef(null);
  const streamImgRef = useRef(null);
  const autoAimInFlightRef = useRef(false);
  const autoAimLastCommandRef = useRef(0);
  const autoAimEnabledRef = useRef(false);
  const autoAimYawErrorRef = useRef(0);
  const autoAimPitchErrorRef = useRef(0);
  const autoAimHasErrorRef = useRef(false);
  const autoAimLastDetectionRef = useRef(0);
  const autoAimSettingsRef = useRef({
    kp: AUTO_AIM_KP,
    maxStep: AUTO_AIM_MAX_STEP_DEG,
    minStep: AUTO_AIM_MIN_STEP_DEG,
    deadzone: AUTO_AIM_DEADZONE_DEG,
    intervalMs: AUTO_AIM_MIN_COMMAND_INTERVAL_MS,
    smoothing: AUTO_AIM_ERROR_ALPHA,
    useAbsolute: AUTO_AIM_USE_ABSOLUTE,
    replanErrorDeg: AUTO_AIM_REPLAN_ERROR_DEG,
    snapGain: AUTO_AIM_SNAP_GAIN,
    snapMaxDeg: AUTO_AIM_SNAP_MAX_DEG
  });
  const aiModeRef = useRef(false);
  const currentModelRef = useRef('mobilenet');
  const statusRef = useRef(null);
  const connectedRef = useRef(false);

  // --- COMPONENT LIFECYCLE & EFFECTS ---
  useEffect(() => {
    // Set the stream URL once on initial load. It won't be changed again unless retried.
    setStreamUrl(`${CAMERA_STREAM_URL}?t=${Date.now()}`);
    fetchAvailableModels();
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
      if (logPanelRef.current && !logPanelRef.current.contains(event.target)) {
        setLogsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    autoAimEnabledRef.current = autoAimEnabled;
  }, [autoAimEnabled]);

  useEffect(() => {
    aiModeRef.current = aiMode;
  }, [aiMode]);

  useEffect(() => {
    currentModelRef.current = currentModel;
  }, [currentModel]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    connectedRef.current = connected;
  }, [connected]);

  useEffect(() => {
    autoAimSettingsRef.current = autoAimSettings;
  }, [autoAimSettings]);

  // Keyboard shortcuts for trigger controls
  useEffect(() => {
    const handleKeyPress = (event) => {
      if (!connected || triggerActive) return;
      const target = event.target;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      const key = event.key.toLowerCase();
      const code = event.code;

      if (event.shiftKey && (code === 'Digit1' || code === 'Digit2' || key === '1' || key === '2')) {
        event.preventDefault();
        const modelKeys = Object.keys(availableModels);
        const modelIndex = code === 'Digit2' || key === '2' ? 1 : 0;
        if (modelKeys[modelIndex]) {
          handleModelSwitch(modelKeys[modelIndex]);
        }
        return;
      }

      const stepMatch = code ? code.match(/^(Digit|Numpad)([1-6])$/) : null;
      if (!event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
        const stepIndex = stepMatch ? parseInt(stepMatch[2], 10) - 1 : null;
        const stepSize =
          stepIndex !== null
            ? ANGULAR_STEP_OPTIONS[stepIndex]
            : key >= '1' && key <= '6'
              ? ANGULAR_STEP_OPTIONS[parseInt(key, 10) - 1]
              : null;
        if (stepSize) {
          event.preventDefault();
          handleStepSizeChange(stepSize);
          return;
        }
      }

      if (key === ' ' || code === 'Space' || key === 'f') {
        event.preventDefault();
        handleFireSingle();
        return;
      }
      if (key === 'b' || key === 'v') {
        event.preventDefault();
        handleFireBurst();
        return;
      }
      if (key === 'arrowup' || code === 'ArrowUp' || key === 'w' || code === 'KeyW') {
        event.preventDefault();
        handleAngularMove(0, angularStepSize);
        return;
      }
      if (key === 'arrowdown' || code === 'ArrowDown' || key === 's' || code === 'KeyS') {
        event.preventDefault();
        handleAngularMove(0, -angularStepSize);
        return;
      }
      if (key === 'arrowleft' || code === 'ArrowLeft' || key === 'a' || code === 'KeyA') {
        event.preventDefault();
        handleAngularMove(-angularStepSize, 0);
        return;
      }
      if (key === 'arrowright' || code === 'ArrowRight' || key === 'd' || code === 'KeyD') {
        event.preventDefault();
        handleAngularMove(angularStepSize, 0);
        return;
      }
      if (key === 'home' || code === 'Home' || key === 'h' || code === 'KeyH') {
        event.preventDefault();
        handleMoveToCenter();
        return;
      }
      if (key === 'r' || code === 'KeyR') {
        event.preventDefault();
        handleHome();
      }
    };

    document.addEventListener('keydown', handleKeyPress);
    return () => document.removeEventListener('keydown', handleKeyPress);
  }, [connected, triggerActive, angularStepSize, availableModels, isMoving, aiMode, currentModel]); // Added angularStepSize dependency

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

  const disableAutoAim = (reason) => {
    if (!autoAimEnabledRef.current) return;
    autoAimEnabledRef.current = false;
    autoAimInFlightRef.current = false;
    autoAimLastCommandRef.current = 0;
    autoAimYawErrorRef.current = 0;
    autoAimPitchErrorRef.current = 0;
    autoAimHasErrorRef.current = false;
    autoAimLastDetectionRef.current = 0;
    setAutoAimEnabled(false);
    if (reason) {
      console.log(`🎯 [AUTO-AIM] Disabled due to ${reason}`);
    } else {
      console.log("🎯 [AUTO-AIM] Disabled");
    }
  };

  const retryStream = () => {
    setIsStreamLoading(true);
    setStreamError(null);
    setStreamUrl(`${CAMERA_STREAM_URL}?t=${Date.now()}`);
  };

  const handleMove = ({ x, y }) => {
    disableAutoAim("manual joystick input");
    if (connected) sendCommand({ x, y });
  };

  const handleStop = () => {
    disableAutoAim("manual stop");
    if (connected) sendCommand({ x: 0, y: 0 });
  };

  const handleHome = () => {
    disableAutoAim("manual home request");
    if (connected) {
      sendCommand({ home: true });
      console.log("🏠 [SYS] Home command sent");
    }
  };
  
  const handleFireSingle = () => {
    if (connected && !triggerActive) {
      setTriggerActive(true);
      setLastFireTime(Date.now());
      sendCommand({ fire: "single" });
      console.log("🎯 [FIRE] Single shot command sent");
      // Reset trigger active state after a reasonable delay
      setTimeout(() => setTriggerActive(false), 1000);
    }
  };

  const handleFireBurst = () => {
    if (connected && !triggerActive) {
      setTriggerActive(true);
      setLastFireTime(Date.now());
      sendCommand({ fire: "burst" });
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
    disableAutoAim("manual trigger control");
    setTriggerActive((prev) => !prev);
    if (connected) sendCommand({ trigger: !triggerActive });
  };

  // NEW: Handles AI toggle by calling API without reloading the stream
  const handleAIToggle = async () => {
    disableAutoAim("manual AI toggle");
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
        if (!data.ai_enabled && autoAimEnabledRef.current) {
          setAutoAimEnabled(false);
          console.log("🎯 [AUTO-AIM] Disabled because AI mode was turned off");
        }
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
    disableAutoAim("manual model switch");
    
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
        if (autoAimEnabledRef.current && data.current_model !== 'mobilenet') {
          setAutoAimEnabled(false);
          console.log("🎯 [AUTO-AIM] Disabled because model switched away from MobileNet");
        }
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
    disableAutoAim("manual FPS change");
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
    disableAutoAim("manual FPS reset");
    const modelInfo = availableModels[modelName];
    if (modelInfo) {
      await handleFpsChange(modelName, modelInfo.default_fps);
    }
  };

  const handleAutoAimToggle = () => {
    if (!connectedRef.current) {
      console.error('❌ [AUTO-AIM] Cannot enable: WebSocket not connected');
      return;
    }

    const nextState = !autoAimEnabledRef.current;
    if (!nextState) {
      disableAutoAim("manual toggle");
      return;
    }

    if (!aiModeRef.current) {
      console.warn("⚠️ [AUTO-AIM] AI detection is disabled. Enable AI Detection first.");
      return;
    }

    if (currentModelRef.current !== 'mobilenet') {
      console.warn("⚠️ [AUTO-AIM] MobileNet model required for auto-aim.");
      return;
    }

    autoAimEnabledRef.current = true;
    setAutoAimEnabled(true);
    console.log("🎯 [AUTO-AIM] Enabled");
  };

  useEffect(() => {
    if (autoAimEnabled && (!aiMode || currentModel !== 'mobilenet')) {
      disableAutoAim("AI/model change");
    }
  }, [autoAimEnabled, aiMode, currentModel]);

  useEffect(() => {
    if (autoAimEnabled && (!connected || status?.calibrating || (status && !status.calibrated))) {
      disableAutoAim("missing connection or calibration");
    }
  }, [autoAimEnabled, connected, status]);

  useEffect(() => {
    if (!autoAimEnabled) return;

    let isCancelled = false;
    const scheduleNext = (delayMs) => {
      if (isCancelled || !autoAimEnabledRef.current) return;
      setTimeout(loop, delayMs);
    };

    const getIntervalMs = () => {
      const activeModel = currentModelRef.current;
      const modelFps = fpsInfo?.[activeModel]?.current_fps || availableModels?.[activeModel]?.current_fps || 10;
      return Math.min(300, Math.max(80, Math.round(1000 / modelFps)));
    };

    const loop = async () => {
      if (isCancelled || !autoAimEnabledRef.current) return;

      if (!connectedRef.current) {
        scheduleNext(300);
        return;
      }

      const currentStatus = statusRef.current;
      if (!currentStatus?.calibrated || currentStatus?.calibrating) {
        scheduleNext(300);
        return;
      }

      if (autoAimInFlightRef.current) {
        scheduleNext(50);
        return;
      }

      autoAimInFlightRef.current = true;
      try {
        const response = await fetch(`${API_URL}/detections`);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        const detections = Array.isArray(data?.detections) ? data.detections : [];
        if (!data?.ai_enabled || data?.current_model !== 'mobilenet') {
          disableAutoAim("AI unavailable");
          scheduleNext(300);
          return;
        }
        const nowMs = Date.now();
        const detectionTimestampSec = Number.isFinite(data?.timestamp) ? data.timestamp : 0;
        const detectionTimestampMs = detectionTimestampSec > 0 ? detectionTimestampSec * 1000 : 0;

        const imgEl = streamImgRef.current;
        const frameW = imgEl?.naturalWidth || imgEl?.width;
        const frameH = imgEl?.naturalHeight || imgEl?.height;

        const hasFreshDetections =
          detections.length > 0 &&
          detectionTimestampMs > 0 &&
          (nowMs - detectionTimestampMs) <= AUTO_AIM_DETECTION_STALE_MS;
        const hasFrame = !!frameW && !!frameH;

        if (hasFreshDetections && hasFrame) {
          const target = detections.reduce((best, current) => {
            if (!current?.bbox || current.bbox.length !== 4) return best;
            const [x1, y1, x2, y2] = current.bbox;
            const area = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
            if (!best) return { detection: current, area };
            return area > best.area ? { detection: current, area } : best;
          }, null);

          if (target?.detection) {
            const [x1, y1, x2, y2] = target.detection.bbox;
            const targetX = (x1 + x2) / 2;
            const targetY = (y1 + y2) / 2;

            const dx = targetX - frameW / 2;
            const dy = targetY - frameH / 2;

            const hfovRad = (AUTO_AIM_HFOV_DEG * Math.PI) / 180;
            const vfovRad = 2 * Math.atan(Math.tan(hfovRad / 2) * (frameH / frameW));
            const fx = frameW / (2 * Math.tan(hfovRad / 2));
            const fy = frameH / (2 * Math.tan(vfovRad / 2));
            const yawErrorDeg = (Math.atan(dx / fx) * 180) / Math.PI;
            const pitchErrorDeg = (Math.atan(dy / fy) * 180) / Math.PI;
            const {
              kp,
              maxStep,
              minStep,
              deadzone,
              intervalMs,
              smoothing,
              useAbsolute,
              replanErrorDeg,
              snapGain,
              snapMaxDeg
            } = autoAimSettingsRef.current;

            const filterReset =
              !autoAimHasErrorRef.current ||
              (nowMs - autoAimLastDetectionRef.current) > AUTO_AIM_DETECTION_STALE_MS;
            if (filterReset) {
              autoAimYawErrorRef.current = yawErrorDeg;
              autoAimPitchErrorRef.current = pitchErrorDeg;
            } else {
              autoAimYawErrorRef.current =
                autoAimYawErrorRef.current + (yawErrorDeg - autoAimYawErrorRef.current) * smoothing;
              autoAimPitchErrorRef.current =
                autoAimPitchErrorRef.current + (pitchErrorDeg - autoAimPitchErrorRef.current) * smoothing;
            }
            autoAimHasErrorRef.current = true;
            autoAimLastDetectionRef.current = nowMs;

            const filteredYawError = autoAimYawErrorRef.current;
            const filteredPitchError = autoAimPitchErrorRef.current;

            if (Math.abs(filteredYawError) >= deadzone || Math.abs(filteredPitchError) >= deadzone) {
              const nowCommandMs = Date.now();
              if (nowCommandMs - autoAimLastCommandRef.current >= intervalMs) {
                const yawStep = Math.max(
                  -maxStep,
                  Math.min(maxStep, filteredYawError * kp)
                );
                const pitchStep = Math.max(
                  -maxStep,
                  Math.min(maxStep, filteredPitchError * kp)
                );

                const clampMinStep = (value) => (Math.abs(value) < minStep ? 0 : value);
                let yawCommand = clampMinStep(yawStep) * AUTO_AIM_YAW_SIGN;
                let pitchCommand = clampMinStep(pitchStep) * AUTO_AIM_PITCH_SIGN;

                // Respect tilt limit switches to avoid blocking yaw when pitch is at a stop.
                const tiltUp = statusRef.current?.sensors?.tiltUp;
                const tiltDown = statusRef.current?.sensors?.tiltDown;
                if (pitchCommand > 0 && tiltUp) pitchCommand = 0;
                if (pitchCommand < 0 && tiltDown) pitchCommand = 0;

                const hasCommand = Math.abs(yawCommand) >= minStep || Math.abs(pitchCommand) >= minStep;
                if (!hasCommand || !autoAimEnabledRef.current) {
                  return;
                }

                const angularInProgress = statusRef.current?.movement?.angularInProgress;
                if (useAbsolute) {
                  const maxError = Math.max(Math.abs(filteredYawError), Math.abs(filteredPitchError));
                  if (angularInProgress && maxError < replanErrorDeg) {
                    return;
                  }

                  const currentAngles = statusRef.current?.angles;
                  const currentYaw = currentAngles?.horizontal ?? 0;
                  const currentPitch = currentAngles?.vertical ?? 0;
                  let snapYaw = filteredYawError * snapGain;
                  let snapPitch = filteredPitchError * snapGain;
                  snapYaw = Math.max(-snapMaxDeg, Math.min(snapMaxDeg, snapYaw));
                  snapPitch = Math.max(-snapMaxDeg, Math.min(snapMaxDeg, snapPitch));

                  const snapYawCommand = clampMinStep(snapYaw) * AUTO_AIM_YAW_SIGN;
                  const snapPitchCommand = clampMinStep(snapPitch) * AUTO_AIM_PITCH_SIGN;

                  let targetYaw = currentYaw + snapYawCommand;
                  let targetPitch = currentPitch + snapPitchCommand;

                  if (tiltUp && targetPitch > currentPitch) targetPitch = currentPitch;
                  if (tiltDown && targetPitch < currentPitch) targetPitch = currentPitch;

                  autoAimLastCommandRef.current = nowCommandMs;
                  sendCommand({
                    moveToAngle: {
                      horizontal: targetYaw,
                      vertical: targetPitch
                    }
                  });
                  return;
                }

                autoAimLastCommandRef.current = nowCommandMs;
                sendCommand({
                  moveByAngle: {
                    horizontal: yawCommand,
                    vertical: pitchCommand
                  }
                });
              }
            }
          }
        }
      } catch (error) {
        console.error("❌ [AUTO-AIM] Detection loop error:", error);
      } finally {
        autoAimInFlightRef.current = false;
      }

      scheduleNext(getIntervalMs());
    };

    loop();
    return () => {
      isCancelled = true;
    };
  }, [autoAimEnabled, availableModels, fpsInfo, sendCommand]);

  // --- ANGULAR MOTION HELPERS ---
  function sendMoveByAngle(h, v) {
    if (connected) {
      disableAutoAim("manual angular move");
      markMoving();
      sendCommand({ moveByAngle: { horizontal: h, vertical: v } });
      console.log(`🎯 [ANGULAR] Moving by H:${h}°, V:${v}°`);
    }
  }
  
  function sendMoveToCenter() {
    if (connected) {
      disableAutoAim("manual move-to-center");
      markMoving();
      sendCommand({ moveToCenter: true });
      console.log('🎯 [ANGULAR] Moving to center position');
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
    disableAutoAim("manual step size change");
    setAngularStepSize(newSize);
    console.log(`🎯 [ANGULAR] Step size changed to ${newSize}°`);
  };

  const handleConnectionToggle = () => {
    if (connected) {
      disableAutoAim("manual disconnect");
      disconnectWebSocket();
    } else {
      disableAutoAim("manual connect");
      connectWebSocket();
    }
  };

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
  const autoAimBlockedReason = !connected
    ? 'Link required'
    : !aiMode
      ? 'Enable AI detection'
      : currentModel !== 'mobilenet'
        ? 'MobileNet only'
        : null;
  const autoAimButtonDisabled = !connected || (!autoAimEnabled && !!autoAimBlockedReason);


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
        
        {/* Home Button */}
        <button
          onClick={handleHome}
          disabled={!connected}
          className={controlButtonClass}
        >
          <Home className="w-5 h-5" />
          <span>Home</span>
        </button>

        {/* Angular Motion Controls */}
        <AngularPanel
          connected={connected}
          isMoving={isMoving}
          onMove={handleAngularMove}
          onCenter={handleMoveToCenter}
          stepSize={angularStepSize}
          onStepSizeChange={handleStepSizeChange}
        />

        {/* Auto Aim Controls */}
        <div className="relative pointer-events-auto">
          <button
            onClick={handleAutoAimToggle}
            disabled={autoAimButtonDisabled}
            className={`${controlButtonClass} justify-between w-full ${
              autoAimEnabled
                ? 'border-cyan-400/60 text-cyan-300 hover:bg-cyan-400/20 hover:text-cyan-200'
                : 'hover:border-cyan-400/40 hover:text-cyan-200'
            }`}
          >
            <div className="flex items-center gap-2">
              <Target className="w-5 h-5" />
              <span>Auto Aim</span>
            </div>
            <span className="text-[10px] uppercase tracking-wider">
              {autoAimEnabled ? 'Engaged' : 'Standby'}
            </span>
          </button>
          {!autoAimEnabled && autoAimBlockedReason && (
            <div className="mt-1 text-[10px] uppercase tracking-wider text-gray-400">
              {autoAimBlockedReason}
            </div>
          )}
        </div>

        <div className="relative pointer-events-auto">
          <button
            onClick={() => setAutoAimPanelOpen(!autoAimPanelOpen)}
            className={`${controlButtonClass} justify-between w-full`}
          >
            <div className="flex items-center gap-2">
              <Crosshair className="w-5 h-5" />
              <span>Auto Aim Tuning</span>
            </div>
            <ChevronDown className={`w-4 h-4 transition-transform ${autoAimPanelOpen ? 'rotate-180' : ''}`} />
          </button>
          {autoAimPanelOpen && (
            <div className="absolute bottom-full left-0 mb-3 bg-black/70 border border-cyan-500/30 rounded-md p-4 w-80 shadow-2xl backdrop-blur-md animate-fadeIn">
              <div className="space-y-3 text-xs font-mono">
                <div className="flex items-center justify-between">
                  <span className="uppercase tracking-wider text-cyan-400">Auto Aim Tuning</span>
                  <button
                    onClick={() =>
                      setAutoAimSettings({
                        kp: AUTO_AIM_KP,
                        maxStep: AUTO_AIM_MAX_STEP_DEG,
                        minStep: AUTO_AIM_MIN_STEP_DEG,
                        deadzone: AUTO_AIM_DEADZONE_DEG,
                        intervalMs: AUTO_AIM_MIN_COMMAND_INTERVAL_MS,
                        smoothing: AUTO_AIM_ERROR_ALPHA,
                        useAbsolute: AUTO_AIM_USE_ABSOLUTE,
                        replanErrorDeg: AUTO_AIM_REPLAN_ERROR_DEG,
                        snapGain: AUTO_AIM_SNAP_GAIN,
                        snapMaxDeg: AUTO_AIM_SNAP_MAX_DEG
                      })
                    }
                    className="px-2 py-1 border border-gray-600 hover:border-cyan-400 text-gray-300 hover:text-cyan-300 rounded transition-colors text-[10px]"
                  >
                    RESET
                  </button>
                </div>

                <div className="flex items-center justify-between p-2 bg-gray-800/50 rounded border border-gray-600">
                  <span className="text-[10px] uppercase tracking-wider text-gray-300">Control Mode</span>
                  <button
                    onClick={() => setAutoAimSettings((prev) => ({ ...prev, useAbsolute: !prev.useAbsolute }))}
                    className={`px-3 py-1 rounded text-[10px] font-mono transition-colors ${
                      autoAimSettings.useAbsolute
                        ? 'bg-cyan-600 text-white hover:bg-cyan-700'
                        : 'bg-gray-600 text-gray-200 hover:bg-gray-500'
                    }`}
                  >
                    {autoAimSettings.useAbsolute ? 'SNAP' : 'STEP'}
                  </button>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-wider text-gray-400">Response (Kp): {autoAimSettings.kp.toFixed(2)}</label>
                  <input
                    type="range"
                    min="0.1"
                    max="1.2"
                    step="0.05"
                    value={autoAimSettings.kp}
                    onChange={(e) => setAutoAimSettings((prev) => ({ ...prev, kp: parseFloat(e.target.value) }))}
                    className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-wider text-gray-400">Max Step (°): {autoAimSettings.maxStep.toFixed(2)}</label>
                  <input
                    type="range"
                    min="0.5"
                    max="6"
                    step="0.1"
                    value={autoAimSettings.maxStep}
                    onChange={(e) => setAutoAimSettings((prev) => ({ ...prev, maxStep: parseFloat(e.target.value) }))}
                    className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-wider text-gray-400">Min Step (°): {autoAimSettings.minStep.toFixed(2)}</label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={autoAimSettings.minStep}
                    onChange={(e) => setAutoAimSettings((prev) => ({ ...prev, minStep: parseFloat(e.target.value) }))}
                    className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                  />
                </div>

                {autoAimSettings.useAbsolute && (
                  <>
                    <div className="space-y-2">
                      <label className="text-[10px] uppercase tracking-wider text-gray-400">Snap Gain: {autoAimSettings.snapGain.toFixed(2)}</label>
                      <input
                        type="range"
                        min="0.5"
                        max="1.5"
                        step="0.05"
                        value={autoAimSettings.snapGain}
                        onChange={(e) => setAutoAimSettings((prev) => ({ ...prev, snapGain: parseFloat(e.target.value) }))}
                        className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] uppercase tracking-wider text-gray-400">Snap Max (°): {autoAimSettings.snapMaxDeg.toFixed(1)}</label>
                      <input
                        type="range"
                        min="5"
                        max="60"
                        step="1"
                        value={autoAimSettings.snapMaxDeg}
                        onChange={(e) => setAutoAimSettings((prev) => ({ ...prev, snapMaxDeg: parseFloat(e.target.value) }))}
                        className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                      />
                    </div>
                  </>
                )}

                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-wider text-gray-400">Replan Threshold (°): {autoAimSettings.replanErrorDeg.toFixed(1)}</label>
                  <input
                    type="range"
                    min="0"
                    max="10"
                    step="0.5"
                    value={autoAimSettings.replanErrorDeg}
                    onChange={(e) => setAutoAimSettings((prev) => ({ ...prev, replanErrorDeg: parseFloat(e.target.value) }))}
                    className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-wider text-gray-400">Deadzone (°): {autoAimSettings.deadzone.toFixed(2)}</label>
                  <input
                    type="range"
                    min="0.1"
                    max="2.0"
                    step="0.1"
                    value={autoAimSettings.deadzone}
                    onChange={(e) => setAutoAimSettings((prev) => ({ ...prev, deadzone: parseFloat(e.target.value) }))}
                    className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-wider text-gray-400">Command Interval (ms): {autoAimSettings.intervalMs}</label>
                  <input
                    type="range"
                    min="50"
                    max="400"
                    step="10"
                    value={autoAimSettings.intervalMs}
                    onChange={(e) => setAutoAimSettings((prev) => ({ ...prev, intervalMs: parseInt(e.target.value, 10) }))}
                    className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-wider text-gray-400">Smoothing (higher = snappier): {autoAimSettings.smoothing.toFixed(2)}</label>
                  <input
                    type="range"
                    min="0.05"
                    max="0.9"
                    step="0.05"
                    value={autoAimSettings.smoothing}
                    onChange={(e) => setAutoAimSettings((prev) => ({ ...prev, smoothing: parseFloat(e.target.value) }))}
                    className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                  />
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

        {/* Debug / Error Log */}
        <div className="relative pointer-events-auto" ref={logPanelRef}>
          <button
            onClick={() => setLogsOpen(!logsOpen)}
            className={`${controlButtonClass} justify-between w-full ${messages?.length ? 'border-orange-400/50 text-orange-300 hover:text-orange-200' : ''}`}
          >
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5" />
              <span>Debug Log</span>
            </div>
            <span className="text-xs opacity-80">{messages?.length || 0}</span>
          </button>

          {logsOpen && (
            <div className="absolute bottom-full left-0 mb-3 bg-black/70 border border-cyan-500/30 rounded-md p-4 w-80 shadow-2xl backdrop-blur-md animate-fadeIn max-h-64 overflow-y-auto">
              <h3 className="text-sm font-bold text-cyan-400 mb-3 uppercase tracking-wider">Recent messages</h3>
              {messages && messages.length ? (
                <ul className="space-y-2 text-xs text-gray-200">
                  {messages.map((msg, idx) => (
                    <li key={`${idx}-${msg}`} className="p-2 bg-gray-800/60 rounded border border-gray-700/70">
                      {msg}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-gray-400 text-xs">No messages yet.</div>
              )}
            </div>
          )}
        </div>

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
              <div><span className="text-cyan-300">R:</span> Home</div>
              <div><span className="text-cyan-300">WASD/Arrows:</span> Angular Move</div>
              <div><span className="text-cyan-300">H/Home:</span> Center Position</div>
              <div><span className="text-cyan-300">1-6:</span> Step Size</div>
              {Object.keys(availableModels).length > 0 && (
                <>
                  <div><span className="text-cyan-300">Shift+1:</span> MobileNet Model</div>
                  <div><span className="text-cyan-300">Shift+2:</span> YOLO Model</div>
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
              {autoAimEnabled && (
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse"></div>
                  <span className="text-cyan-300">Auto Aim Engaged</span>
                </div>
              )}
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
            onClick={handleConnectionToggle}
            disabled={connecting}
            className={`${controlButtonClass} ${connected ? 'text-red-400 border-red-400/30 hover:bg-red-400/20' : ''}`}
        >
            <Power className="w-5 h-5" />
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
                          ref={streamImgRef}
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

      {/* --- ANGLE GAUGES --- */}
      <div className="absolute bottom-6 left-6 z-30 pointer-events-auto">
        <AngleGauges angles={currentAngles} status={status} />
      </div>

      {/* --- JOYSTICK + FIRE CONTROLS --- */}
      {connected && (
        <div className="absolute right-16 top-1/2 transform -translate-y-1/2 z-30 pointer-events-auto flex flex-col items-center gap-3">
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
          <div className="flex gap-2">
            <button
              onClick={handleFireSingle}
              disabled={triggerActive}
              className={`${controlButtonClass} ${triggerActive ? 'opacity-50 cursor-not-allowed' : 'hover:border-orange-400/50 hover:text-orange-300'}`}
            >
              <Target className="w-5 h-5" />
              <span>Single Shot</span>
            </button>
            <button
              onClick={handleFireBurst}
              disabled={triggerActive}
              className={`${controlButtonClass} ${triggerActive ? 'opacity-50 cursor-not-allowed' : 'hover:border-red-400/50 hover:text-red-300'}`}
            >
              <Zap className="w-5 h-5" />
              <span>Burst Fire</span>
            </button>
          </div>
          {triggerActive && (
            <div className="bg-red-900/50 border border-red-500/50 px-3 py-1.5 rounded-sm text-xs uppercase font-mono tracking-wider backdrop-blur-sm animate-pulse">
              <span className="text-red-400">⚡ FIRING</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default App;

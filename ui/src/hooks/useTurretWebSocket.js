"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const MAX_RECONNECT_ATTEMPTS = Infinity;
const RECONNECT_BASE_DELAY_MS = 300;
const RECONNECT_MAX_DELAY_MS = 3000;

export function useTurretWebSocket(url) {
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState(null);
  const [status, setStatus] = useState(null);
  const [currentAngles, setCurrentAngles] = useState(null);
  const [isMoving, setIsMoving] = useState(false);

  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);

  const cleanupSocket = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close(1000, "Cleanup");
      wsRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;
    if (wsRef.current) wsRef.current.close();

    setConnecting(true);
    setConnectionError(null);

    const socket = new WebSocket(url);
    wsRef.current = socket;

    socket.onopen = () => {
      setConnected(true);
      setConnecting(false);
      reconnectAttemptsRef.current = 0;
    };

    socket.onclose = (event) => {
      setConnected(false);
      setConnecting(false);
      if (event.code === 1000) return; // Clean close (manual disconnect/cleanup)

      if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttemptsRef.current++;
        const delay = Math.min(
          RECONNECT_BASE_DELAY_MS * Math.pow(2, reconnectAttemptsRef.current - 1),
          RECONNECT_MAX_DELAY_MS
        );
        reconnectTimeoutRef.current = setTimeout(connect, delay);
      } else {
        setConnectionError("MAX RECONNECT ATTEMPTS");
      }
    };

    socket.onerror = () => {
      setConnectionError("CONNECTION FAULT");
      setConnecting(false);
      socket.close(4001, "error");
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.status) {
          setStatus(data.status);
          if (data.status.angles) setCurrentAngles(data.status.angles);
          if (data.status.movement) {
            setIsMoving(!!data.status.movement.angularInProgress || !!data.status.movement.isMoving);
          }
        }
        if (data.currentAngles) {
          setCurrentAngles(data.currentAngles);
        }
        if (data.movementComplete) {
          setIsMoving(false);
        }
      } catch (err) {
        console.error("[WS] Parse error:", err);
      }
    };
  }, [url, cleanupSocket]);

  const disconnect = useCallback(() => {
    reconnectAttemptsRef.current = MAX_RECONNECT_ATTEMPTS;
    cleanupSocket();
  }, [cleanupSocket]);

  const sendCommand = useCallback(
    (payload) => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify(payload));
      }
    },
    []
  );

  // Auto-connect on mount and cleanup on unmount
  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  return {
    connected,
    connecting,
    connectionError,
    status,
    currentAngles,
    isMoving,
    sendCommand,
    connect,
    disconnect,
    markMoving: () => setIsMoving(true),
  };
}

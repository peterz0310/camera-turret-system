"use client";

import React, { useState, useRef, useEffect } from "react";
import { RotateCcw, ArrowUp, ArrowDown, ArrowLeft, ArrowRight } from "lucide-react";

export function AngularPanel({
  connected,
  isMoving,
  onMove,
  onCenter,
  stepSize,
  onStepSizeChange
}) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={panelRef} className="relative pointer-events-auto">
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-2 px-3 py-1.5 border border-cyan-400/30 bg-black/30 text-cyan-400 rounded-sm hover:bg-cyan-400/20 hover:text-cyan-300 transition-all duration-300 backdrop-blur-sm text-xs uppercase font-mono tracking-wider cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-black/30 disabled:hover:text-cyan-400 ${isMoving ? 'border-yellow-400/50 text-yellow-400' : ''}`}
      >
        <RotateCcw className="w-5 h-5" />
        <span>{isMoving ? 'MOVING...' : 'Angular'}</span>
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-3 bg-black/70 border border-cyan-500/30 rounded-md p-4 w-80 shadow-2xl backdrop-blur-md animate-fadeIn">
          <div className="space-y-4">
            <h3 className="text-sm font-bold text-cyan-400 mb-2 uppercase tracking-wider">Angular Positioning</h3>

            {/* Step Size Control */}
            <div className="space-y-2">
              <label className="block text-xs text-cyan-400 uppercase tracking-wider">
                Step Size: {stepSize}°
              </label>
              <div className="flex gap-2">
                {[1, 5, 10, 15, 30, 45].map((size) => (
                  <button
                    key={size}
                    onClick={() => onStepSizeChange(size)}
                    className={`px-2 py-1 text-xs rounded transition-colors ${
                      stepSize === size
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

              <div className="flex justify-center">
                <button
                  onClick={() => onMove(0, stepSize)}
                  disabled={!connected || isMoving}
                  className="p-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded transition-colors"
                >
                  <ArrowUp className="w-4 h-4" />
                </button>
              </div>

              <div className="flex justify-center gap-4">
                <button
                  onClick={() => onMove(-stepSize, 0)}
                  disabled={!connected || isMoving}
                  className="p-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>

                <button
                  onClick={onCenter}
                  disabled={!connected || isMoving}
                  className="px-3 py-2 bg-cyan-700 hover:bg-cyan-600 disabled:opacity-50 rounded text-xs font-mono transition-colors"
                >
                  CENTER
                </button>

                <button
                  onClick={() => onMove(stepSize, 0)}
                  disabled={!connected || isMoving}
                  className="p-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded transition-colors"
                >
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>

              <div className="flex justify-center">
                <button
                  onClick={() => onMove(0, -stepSize)}
                  disabled={!connected || isMoving}
                  className="p-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded transition-colors"
                >
                  <ArrowDown className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="border-t border-gray-600 pt-2">
              <div className="text-xs text-gray-500">
                <div className="font-mono">WASD/Arrow Keys: Move</div>
                <div className="font-mono">H/Home: Center</div>
                <div className="font-mono">1-6: Step Size</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import React from "react";

export function AngleGauges({ angles, status }) {
  const yawAngleDeg = angles ? ((angles.horizontal % 360) + 360) % 360 : 0;
  const tiltAngleDeg = angles ? Math.max(-90, Math.min(90, angles.vertical)) : 0;
  const calibrated = status?.calibrated;
  const calibrating = status?.calibrating;
  const yawHome = status?.sensors?.yawHome;
  const tiltUp = status?.sensors?.tiltUp;
  const tiltDown = status?.sensors?.tiltDown;

  const YawGauge = () => {
    const size = 180;
    const center = size / 2;
    const radius = size / 2 - 12;
    const rad = ((yawAngleDeg - 90) * Math.PI) / 180;
    const x = center + radius * Math.cos(rad);
    const y = center + radius * Math.sin(rad);

    return (
      <div className="flex flex-col items-center gap-2">
        <div className="text-xs text-cyan-300 uppercase tracking-wider">Yaw</div>
        <svg width={size} height={size} className="text-cyan-400">
          <circle cx={center} cy={center} r={radius} className="stroke-cyan-700/60" strokeWidth="2" fill="none" />
          <line x1={center} y1={center} x2={x} y2={y} stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          <circle cx={center} cy={center} r="4" fill="currentColor" />
          <text x={center} y={center + 6} textAnchor="middle" className="fill-cyan-300 text-sm font-mono">
            {yawAngleDeg.toFixed(1)}°
          </text>
        </svg>
      </div>
    );
  };

  const TiltGauge = () => {
    const width = 200;
    const height = 110;
    const centerX = width / 2;
    const centerY = height - 10;
    const radius = width / 2 - 12;
    const rad = ((tiltAngleDeg + 90) * Math.PI) / 180;
    const x = centerX + radius * Math.cos(rad);
    const y = centerY - radius * Math.sin(rad);

    return (
      <div className="flex flex-col items-center gap-2">
        <div className="text-xs text-cyan-300 uppercase tracking-wider">Tilt</div>
        <svg width={width} height={height} className="text-cyan-400">
          <path
            d={`M ${centerX - radius} ${centerY} A ${radius} ${radius} 0 0 1 ${centerX + radius} ${centerY}`}
            className="stroke-cyan-700/60"
            strokeWidth="2"
            fill="none"
          />
          <line x1={centerX} y1={centerY} x2={x} y2={y} stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          <circle cx={centerX} cy={centerY} r="4" fill="currentColor" />
          <text x={centerX} y={centerY - radius - 6} textAnchor="middle" className="fill-cyan-300 text-sm font-mono">
            {tiltAngleDeg.toFixed(1)}°
          </text>
        </svg>
      </div>
    );
  };

  return (
    <div className="bg-black/50 border border-cyan-500/30 rounded-sm px-4 py-3 shadow-lg backdrop-blur-sm flex gap-8">
      <YawGauge />
      <TiltGauge />
      <div className="flex flex-col justify-center text-xs text-gray-300 gap-1 min-w-[120px]">
        <div className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: calibrating ? '#fbbf24' : calibrated ? '#34d399' : '#f87171' }}></span>
          <span>{calibrating ? "Calibrating" : calibrated ? "Calibrated" : "Not Calibrated"}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: yawHome ? '#34d399' : '#6b7280' }}></span>
          <span>Yaw Home</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: tiltUp ? '#f87171' : '#6b7280' }}></span>
          <span>Tilt Up Limit</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: tiltDown ? '#f87171' : '#6b7280' }}></span>
          <span>Tilt Down Limit</span>
        </div>
      </div>
    </div>
  );
}

import React from 'react';
import type { UiLanguage } from '../types/ecg';

interface HexaxialAxisCompassProps {
  qrsAxisRaw: string;
  pAxisRaw?: string;
  tAxisRaw?: string;
  uiLang: UiLanguage;
}

function parseDegreeValue(raw?: string): number | null {
  if (!raw || typeof raw !== 'string') return null;
  const cleaned = raw
    .replace(/[\u2212\u2013\u2014]/g, '-')
    .replace(/^(approx\.?|approximately|sekitar|~|≈)\s*/i, '')
    .replace(/°/g, '')
    .trim();
  const match = cleaned.match(/^[+-]?\d+(\.\d+)?/);
  if (!match) return null;
  const num = parseFloat(match[0]);
  if (Number.isNaN(num) || num < -180 || num > 360) return null;
  // Normalize 181..360 to -179..0
  return num > 180 ? num - 360 : num;
}

function classifyAxisQuadrant(deg: number | null, lang: UiLanguage): {
  label: string;
  badgeClass: string;
  strokeColor: string;
} {
  if (deg === null) {
    return {
      label: lang === 'id' ? 'Aksis Tidak Terukur' : 'Indeterminate Axis',
      badgeClass: 'bg-slate-100 text-slate-700 border-slate-200',
      strokeColor: '#64748B',
    };
  }
  if (deg >= -30 && deg <= 90) {
    return {
      label: lang === 'id' ? 'Aksis Normal (-30° s/d +90°)' : 'Normal Axis (-30° to +90°)',
      badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200',
      strokeColor: '#059669',
    };
  }
  if (deg < -30 && deg >= -90) {
    return {
      label: lang === 'id' ? 'Deviasi Aksis Kiri / LAD (-30° s/d -90°)' : 'Left Axis Deviation / LAD (-30° to -90°)',
      badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
      strokeColor: '#D97706',
    };
  }
  if (deg > 90 && deg <= 180) {
    return {
      label: lang === 'id' ? 'Deviasi Aksis Kanan / RAD (+90° s/d +180°)' : 'Right Axis Deviation / RAD (+90° to +180°)',
      badgeClass: 'bg-orange-50 text-orange-800 border-orange-200',
      strokeColor: '#EA580C',
    };
  }
  return {
    label: lang === 'id' ? 'Aksis Ekstrem / Northwest (-90° s/d -180°)' : 'Extreme / Northwest Axis (-90° to -180°)',
    badgeClass: 'bg-rose-50 text-rose-800 border-rose-200',
    strokeColor: '#E11D48',
  };
}

function polarToCartesian(cx: number, cy: number, r: number, ecgDeg: number) {
  // In standard ECG hexaxial system: 0° is right (3 o'clock), +90° is straight down (6 o'clock), -90° is straight up (12 o'clock)
  // Which matches standard SVG screen coordinates (x = cx + r*cos(rad), y = cy + r*sin(rad))!
  const rad = (ecgDeg * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  };
}

function describeSectorPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const start = polarToCartesian(cx, cy, r, startDeg);
  const end = polarToCartesian(cx, cy, r, endDeg);
  const largeArc = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
  const sweepFlag = endDeg > startDeg ? 1 : 0;
  return `M ${cx} ${cy} L ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r} ${r} 0 ${largeArc} ${sweepFlag} ${end.x.toFixed(2)} ${end.y.toFixed(2)} Z`;
}

export const HexaxialAxisCompass: React.FC<HexaxialAxisCompassProps> = ({
  qrsAxisRaw,
  pAxisRaw,
  tAxisRaw,
  uiLang,
}) => {
  const qrsDeg = parseDegreeValue(qrsAxisRaw);
  const pDeg = parseDegreeValue(pAxisRaw);
  const tDeg = parseDegreeValue(tAxisRaw);
  const qrsStatus = classifyAxisQuadrant(qrsDeg, uiLang);

  const cx = 120;
  const cy = 120;
  const radius = 84;

  const limbLeads = [
    { name: 'I (0°)', deg: 0 },
    { name: 'II (+60°)', deg: 60 },
    { name: 'aVF (+90°)', deg: 90 },
    { name: 'III (+120°)', deg: 120 },
    { name: '±180°', deg: 180 },
    { name: 'aVR (-150°)', deg: -150 },
    { name: '-90°', deg: -90 },
    { name: 'aVL (-30°)', deg: -30 },
  ];

  const qrsTip = qrsDeg !== null ? polarToCartesian(cx, cy, radius - 8, qrsDeg) : null;
  const pTip = pDeg !== null ? polarToCartesian(cx, cy, radius - 22, pDeg) : null;
  const tTip = tDeg !== null ? polarToCartesian(cx, cy, radius - 16, tDeg) : null;

  return (
    <div className="bg-slate-50/80 border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row items-center gap-5">
      <div className="shrink-0">
        <svg
          width="240"
          height="240"
          viewBox="0 0 240 240"
          role="img"
          aria-label="Hexaxial QRS Electrical Axis Reference Diagram"
          className="overflow-visible select-none"
        >
          {/* Normal Axis Sector (-30 to +90) */}
          <path
            d={describeSectorPath(cx, cy, radius, -30, 90)}
            fill="#10B981"
            fillOpacity="0.13"
          />
          {/* Left Axis Deviation Sector (-90 to -30) */}
          <path
            d={describeSectorPath(cx, cy, radius, -90, -30)}
            fill="#F59E0B"
            fillOpacity="0.11"
          />
          {/* Right Axis Deviation Sector (+90 to +180) */}
          <path
            d={describeSectorPath(cx, cy, radius, 90, 180)}
            fill="#F97316"
            fillOpacity="0.11"
          />
          {/* Extreme Axis Sector (-180 to -90) */}
          <path
            d={describeSectorPath(cx, cy, radius, -180, -90)}
            fill="#F43F5E"
            fillOpacity="0.10"
          />

          {/* Outer reference circles */}
          <circle cx={cx} cy={cy} r={radius} fill="none" stroke="#CBD5E1" strokeWidth="1.5" />
          <circle
            cx={cx}
            cy={cy}
            r={radius * 0.55}
            fill="none"
            stroke="#E2E8F0"
            strokeWidth="1"
            strokeDasharray="3 3"
          />

          {/* Hexaxial reference lines */}
          {[0, 60, 90, 120, -30, -150].map((deg) => {
            const p1 = polarToCartesian(cx, cy, radius, deg);
            const p2 = polarToCartesian(cx, cy, radius, deg + 180);
            return (
              <line
                key={deg}
                x1={p1.x}
                y1={p1.y}
                x2={p2.x}
                y2={p2.y}
                stroke="#CBD5E1"
                strokeWidth="0.9"
                strokeDasharray="2 2"
              />
            );
          })}

          {/* Lead angle labels */}
          {limbLeads.map((lead) => {
            const pos = polarToCartesian(cx, cy, radius + 19, lead.deg);
            return (
              <text
                key={lead.name}
                x={pos.x}
                y={pos.y}
                textAnchor="middle"
                dominantBaseline="central"
                className="fill-slate-500 font-mono text-[9px] font-medium"
              >
                {lead.name}
              </text>
            );
          })}

          {/* Optional P-wave axis vector */}
          {pTip && (
            <g>
              <line
                x1={cx}
                y1={cy}
                x2={pTip.x}
                y2={pTip.y}
                stroke="#3B82F6"
                strokeWidth="1.6"
                strokeDasharray="3 2"
              />
              <circle cx={pTip.x} cy={pTip.y} r="3" fill="#3B82F6" />
            </g>
          )}

          {/* Optional T-wave axis vector */}
          {tTip && (
            <g>
              <line
                x1={cx}
                y1={cy}
                x2={tTip.x}
                y2={tTip.y}
                stroke="#8B5CF6"
                strokeWidth="1.6"
                strokeDasharray="3 2"
              />
              <circle cx={tTip.x} cy={tTip.y} r="3" fill="#8B5CF6" />
            </g>
          )}

          {/* Primary QRS Axis Vector Arrow */}
          {qrsTip && (
            <g>
              <line
                x1={cx}
                y1={cy}
                x2={qrsTip.x}
                y2={qrsTip.y}
                stroke={qrsStatus.strokeColor}
                strokeWidth="3"
                strokeLinecap="round"
              />
              <circle
                cx={qrsTip.x}
                cy={qrsTip.y}
                r="4.5"
                fill={qrsStatus.strokeColor}
                stroke="#FFFFFF"
                strokeWidth="1.5"
              />
            </g>
          )}

          {/* Center Pivot */}
          <circle cx={cx} cy={cy} r="4" fill="#0F172A" />
        </svg>
      </div>

      <div className="flex-1 space-y-3 text-xs w-full">
        <div>
          <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500">
            {uiLang === 'id' ? 'Sistem Referensi Hexaxial Cabrera' : 'Hexaxial Reference Compass'}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="text-lg font-mono font-bold text-slate-900">
              QRS: {qrsDeg !== null ? `${qrsDeg > 0 ? `+${qrsDeg}` : qrsDeg}°` : qrsAxisRaw}
            </span>
            <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${qrsStatus.badgeClass}`}>
              {qrsStatus.label}
            </span>
          </div>
        </div>

        {/* Vector Legend */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
          <div className="p-2 bg-white border border-slate-200 rounded-lg flex items-center gap-2">
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: qrsStatus.strokeColor }}
            />
            <div>
              <div className="text-[10px] text-slate-500 font-mono">QRS AXIS</div>
              <div className="font-mono font-bold text-slate-900">
                {qrsDeg !== null ? `${qrsDeg}°` : 'N/A'}
              </div>
            </div>
          </div>
          <div className="p-2 bg-white border border-slate-200 rounded-lg flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-500 shrink-0" />
            <div>
              <div className="text-[10px] text-slate-500 font-mono">P-WAVE AXIS</div>
              <div className="font-mono font-bold text-slate-900">
                {pDeg !== null ? `${pDeg}°` : pAxisRaw || 'N/A'}
              </div>
            </div>
          </div>
          <div className="p-2 bg-white border border-slate-200 rounded-lg flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-violet-500 shrink-0" />
            <div>
              <div className="text-[10px] text-slate-500 font-mono">T-WAVE AXIS</div>
              <div className="font-mono font-bold text-slate-900">
                {tDeg !== null ? `${tDeg}°` : tAxisRaw || 'N/A'}
              </div>
            </div>
          </div>
        </div>

        {/* Quadrant Guide */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500 pt-1">
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-xs bg-emerald-500/40 border border-emerald-600/40" />
            Normal (-30°..+90°)
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-xs bg-amber-500/40 border border-amber-600/40" />
            LAD (-30°..-90°)
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-xs bg-orange-500/40 border border-orange-600/40" />
            RAD (+90°..+180°)
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-xs bg-rose-500/40 border border-rose-600/40" />
            Extreme (-90°..-180°)
          </span>
        </div>
      </div>
    </div>
  );
};


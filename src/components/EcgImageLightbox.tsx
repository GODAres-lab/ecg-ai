import React, { useState, useRef, useEffect } from 'react';
import {
  ZoomIn,
  ZoomOut,
  RotateCw,
  RotateCcw,
  Contrast,
  SunMoon,
  RefreshCw,
  X,
  Move,
} from 'lucide-react';
import type { UiLanguage } from '../types/ecg';

interface EcgImageLightboxProps {
  isOpen: boolean;
  onClose: () => void;
  imageUrl: string;
  title?: string;
  dimensionsText?: string;
  uiLang: UiLanguage;
}

export const EcgImageLightbox: React.FC<EcgImageLightboxProps> = ({
  isOpen,
  onClose,
  imageUrl,
  title,
  dimensionsText,
  uiLang,
}) => {
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [highContrast, setHighContrast] = useState(false);
  const [inverted, setInverted] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === '+' || e.key === '=') setZoom((z) => Math.min(4, +(z + 0.25).toFixed(2)));
      if (e.key === '-') setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)));
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleReset = () => {
    setZoom(1);
    setRotation(0);
    setHighContrast(false);
    setInverted(false);
    setOffset({ x: 0, y: 0 });
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.2 : -0.2;
    setZoom((prev) => Math.min(4, Math.max(0.5, +(prev + delta).toFixed(2))));
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX - offset.x, y: e.clientY - offset.y };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setOffset({
      x: e.clientX - dragStartRef.current.x,
      y: e.clientY - dragStartRef.current.y,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const filterParts: string[] = [];
  if (highContrast) filterParts.push('contrast(1.65) saturate(1.25)');
  if (inverted) filterParts.push('invert(1) hue-rotate(180deg)');
  const cssFilter = filterParts.length > 0 ? filterParts.join(' ') : 'none';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Interactive ECG Tracing Inspector"
      className="no-print fixed inset-0 z-[60] bg-slate-950/95 backdrop-blur-sm flex flex-col select-none"
    >
      {/* Top Clinical Inspector Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-3 bg-slate-900 border-b border-slate-800 text-white">
        <div className="flex items-center gap-3 min-w-0">
          <div>
            <h3 className="text-xs sm:text-sm font-bold truncate">
              {title || (uiLang === 'id' ? 'Inspeksi Resolusi Penuh Rekaman EKG' : 'Full-Resolution ECG Tracing Inspector')}
            </h3>
            <p className="text-[11px] font-mono text-slate-400 flex items-center gap-2">
              {dimensionsText && <span>{dimensionsText}</span>}
              <span>•</span>
              <span className="inline-flex items-center gap-1">
                <Move className="w-3 h-3" />
                {uiLang === 'id' ? 'Geser untuk pan, scroll untuk zoom' : 'Drag to pan, scroll to zoom'}
              </span>
            </p>
          </div>
        </div>

        {/* Interactive Controls */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))}
            className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-200 transition-colors cursor-pointer"
            title="Zoom Out (-)"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-lg font-mono text-xs font-semibold min-w-[58px] text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(4, +(z + 0.25).toFixed(2)))}
            className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-200 transition-colors cursor-pointer"
            title="Zoom In (+)"
          >
            <ZoomIn className="w-4 h-4" />
          </button>

          <div className="h-5 w-px bg-slate-700 mx-1" />

          <button
            type="button"
            onClick={() => setRotation((r) => (r - 90) % 360)}
            className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-200 transition-colors cursor-pointer"
            title={uiLang === 'id' ? 'Putar Kiri 90°' : 'Rotate Left 90°'}
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setRotation((r) => (r + 90) % 360)}
            className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-200 transition-colors cursor-pointer"
            title={uiLang === 'id' ? 'Putar Kanan 90°' : 'Rotate Right 90°'}
          >
            <RotateCw className="w-4 h-4" />
          </button>

          <div className="h-5 w-px bg-slate-700 mx-1" />

          <button
            type="button"
            onClick={() => setHighContrast((c) => !c)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
              highContrast
                ? 'bg-sky-600 text-white'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
            }`}
            title={uiLang === 'id' ? 'Perjelas kontras garis kertas termal' : 'Boost thermal paper contrast'}
          >
            <Contrast className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{uiLang === 'id' ? 'Kontras Tinggi' : 'High Contrast'}</span>
          </button>

          <button
            type="button"
            onClick={() => setInverted((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
              inverted
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
            }`}
            title={uiLang === 'id' ? 'Mode inversi gelap' : 'Invert colors'}
          >
            <SunMoon className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{uiLang === 'id' ? 'Inversi' : 'Invert'}</span>
          </button>

          <button
            type="button"
            onClick={handleReset}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs font-medium text-slate-300 transition-colors cursor-pointer"
            title="Reset View"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Reset</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close Full Resolution Viewer"
            className="ml-1 p-2 bg-rose-600/90 hover:bg-rose-600 rounded-lg text-white transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Interactive Pan/Zoom Canvas */}
      <div
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        className={`flex-1 overflow-hidden flex items-center justify-center ecg-dark-grid ${
          isDragging ? 'cursor-grabbing' : 'cursor-grab'
        }`}
      >
        <img
          src={imageUrl}
          alt="Full resolution ECG tracing"
          referrerPolicy="no-referrer"
          draggable={false}
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom}) rotate(${rotation}deg)`,
            filter: cssFilter,
            transition: isDragging ? 'none' : 'transform 120ms ease-out',
          }}
          className="max-h-[85vh] max-w-[92vw] object-contain shadow-2xl rounded-xs"
        />
      </div>
    </div>
  );
};


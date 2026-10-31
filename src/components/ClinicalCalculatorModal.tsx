import React, { useState, useEffect } from 'react';
import { Calculator, X, Activity, Grid, Info } from 'lucide-react';
import type { UiLanguage } from '../types/ecg';

interface ClinicalCalculatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialHrBpm?: string;
  initialQtMs?: string;
  uiLang: UiLanguage;
}

function extractNumeric(val?: string): string {
  if (!val) return '';
  const m = val.match(/\d+(\.\d+)?/);
  return m ? m[0] : '';
}

export const ClinicalCalculatorModal: React.FC<ClinicalCalculatorModalProps> = ({
  isOpen,
  onClose,
  initialHrBpm,
  initialQtMs,
  uiLang,
}) => {
  const [hrInput, setHrInput] = useState<string>('75');
  const [qtInput, setQtInput] = useState<string>('380');
  const [sexRef, setSexRef] = useState<'male' | 'female'>('male');
  const [paperSpeed, setPaperSpeed] = useState<25 | 50>(25);
  const [smallBoxesRr, setSmallBoxesRr] = useState<string>('20');
  const [smallBoxesInterval, setSmallBoxesInterval] = useState<string>('4');

  useEffect(() => {
    if (!isOpen) return;
    const parsedHr = extractNumeric(initialHrBpm);
    const parsedQt = extractNumeric(initialQtMs);
    if (parsedHr) setHrInput(parsedHr);
    if (parsedQt) setQtInput(parsedQt);
  }, [isOpen, initialHrBpm, initialQtMs]);

  if (!isOpen) return null;

  const hr = parseFloat(hrInput);
  const qt = parseFloat(qtInput);
  const validQtcInputs = !Number.isNaN(hr) && !Number.isNaN(qt) && hr >= 20 && hr <= 300 && qt >= 150 && qt <= 800;

  const rrSec = validQtcInputs ? 60 / hr : 0;
  const qtcBazett = validQtcInputs ? Math.round(qt / Math.sqrt(rrSec)) : null;
  const qtcFridericia = validQtcInputs ? Math.round(qt / Math.cbrt(rrSec)) : null;
  const qtcFramingham = validQtcInputs ? Math.round(qt + 154 * (1 - rrSec)) : null;
  const qtcHodges = validQtcInputs ? Math.round(qt + 1.75 * (hr - 60)) : null;

  const prolongThreshold = sexRef === 'male' ? 450 : 460;

  const classifyQtc = (val: number | null) => {
    if (val === null) return { label: '-', color: 'text-slate-500 bg-slate-100' };
    if (val >= 500) {
      return {
        label: uiLang === 'id' ? 'Sangat Memanjang (≥500 ms • Risiko TdP)' : 'Markedly Prolonged (≥500 ms • TdP Risk)',
        color: 'text-rose-800 bg-rose-100 border-rose-200',
      };
    }
    if (val > prolongThreshold) {
      return {
        label: uiLang === 'id' ? `Memanjang (>${prolongThreshold} ms)` : `Prolonged (>${prolongThreshold} ms)`,
        color: 'text-amber-800 bg-amber-100 border-amber-200',
      };
    }
    if (val < 340) {
      return {
        label: uiLang === 'id' ? 'QTc Pendek (<340 ms)' : 'Short QTc (<340 ms)',
        color: 'text-amber-800 bg-amber-100 border-amber-200',
      };
    }
    return {
      label: uiLang === 'id' ? 'Dalam Batas Normal' : 'Within Normal Limits',
      color: 'text-emerald-800 bg-emerald-100 border-emerald-200',
    };
  };

  // Grid box conversions:
  // At 25 mm/s: 1 small box (1mm) = 40 ms (0.04s), 1500 small boxes = 1 min
  // At 50 mm/s: 1 small box (1mm) = 20 ms (0.02s), 3000 small boxes = 1 min
  const msPerSmallBox = paperSpeed === 25 ? 40 : 20;
  const boxesPerMinute = paperSpeed === 25 ? 1500 : 3000;

  const rrBoxesNum = parseFloat(smallBoxesRr);
  const gridHr =
    !Number.isNaN(rrBoxesNum) && rrBoxesNum > 0
      ? Math.round(boxesPerMinute / rrBoxesNum)
      : null;

  const intBoxesNum = parseFloat(smallBoxesInterval);
  const gridDurationMs =
    !Number.isNaN(intBoxesNum) && intBoxesNum >= 0
      ? Math.round(intBoxesNum * msPerSmallBox)
      : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="calc-modal-title"
      className="no-print fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto"
    >
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-8">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-slate-900 text-white">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-500/20 border border-blue-400/30 flex items-center justify-center text-blue-400">
              <Calculator className="w-4 h-4" />
            </div>
            <div>
              <h2 id="calc-modal-title" className="text-sm sm:text-base font-bold">
                {uiLang === 'id'
                  ? 'Kalkulator Referensi Klinis QTc & Kertas EKG'
                  : 'Clinical QTc & ECG Grid Reference Calculator'}
              </h2>
              <p className="text-[11px] text-slate-400">
                {uiLang === 'id'
                  ? 'Alat bantu verifikasi edukasi multi-rumus (Bazett, Fridericia, Framingham, Hodges)'
                  : 'Multi-formula educational verification tool (Bazett, Fridericia, Framingham, Hodges)'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
            aria-label="Close calculator"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Part 1: Multi-formula QTc Calculator */}
          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                <Activity className="w-4 h-4 text-blue-600" />
                <span>
                  {uiLang === 'id'
                    ? '1. Kalkulator Interval QTc (Corrected QT)'
                    : '1. Corrected QT (QTc) Multi-Formula Calculator'}
                </span>
              </h3>

              <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setSexRef('male')}
                  className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                    sexRef === 'male' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600'
                  }`}
                >
                  {uiLang === 'id' ? 'Pria (<450 ms)' : 'Male (<450 ms)'}
                </button>
                <button
                  type="button"
                  onClick={() => setSexRef('female')}
                  className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                    sexRef === 'female' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600'
                  }`}
                >
                  {uiLang === 'id' ? 'Wanita (<460 ms)' : 'Female (<460 ms)'}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {uiLang === 'id' ? 'Laju Jantung / Heart Rate (bpm)' : 'Heart Rate (bpm)'}
                </label>
                <input
                  type="number"
                  min={20}
                  max={300}
                  value={hrInput}
                  onChange={(e) => setHrInput(e.target.value)}
                  className="w-full px-3.5 py-2 text-sm font-mono bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {uiLang === 'id' ? 'Interval QT Terukur (ms)' : 'Measured QT Interval (ms)'}
                </label>
                <input
                  type="number"
                  min={150}
                  max={800}
                  value={qtInput}
                  onChange={(e) => setQtInput(e.target.value)}
                  className="w-full px-3.5 py-2 text-sm font-mono bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
            </div>

            {validQtcInputs ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  {
                    name: 'Bazett (QT / √RR)',
                    val: qtcBazett,
                    note:
                      uiLang === 'id'
                        ? 'Standar mesin EKG; cenderung over-koreksi saat takikardia (>100 bpm)'
                        : 'Standard machine default; over-corrects at high HR (>100 bpm)',
                  },
                  {
                    name: 'Fridericia (QT / ∛RR)',
                    val: qtcFridericia,
                    note:
                      uiLang === 'id'
                        ? 'Lebih akurat pada bradikardia (<60 bpm) maupun takikardia (>100 bpm)'
                        : 'Preferred at extremes of heart rate (<60 or >100 bpm)',
                  },
                  {
                    name: 'Framingham (QT + 0.154×(1−RR))',
                    val: qtcFramingham,
                    note:
                      uiLang === 'id'
                        ? 'Koreksi regresi linier berbasis populasi'
                        : 'Linear regression population-derived correction',
                  },
                  {
                    name: 'Hodges (QT + 1.75×(HR−60))',
                    val: qtcHodges,
                    note:
                      uiLang === 'id'
                        ? 'Koreksi linier berbasis Heart Rate'
                        : 'Heart-rate linear correction formula',
                  },
                ].map((item) => {
                  const status = classifyQtc(item.val);
                  return (
                    <div
                      key={item.name}
                      className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-slate-800">{item.name}</span>
                        <span className="text-base font-mono font-extrabold text-slate-900">
                          {item.val} <span className="text-xs font-normal text-slate-500">ms</span>
                        </span>
                      </div>
                      <div>
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold border ${status.color}`}
                        >
                          {status.label}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 leading-snug">{item.note}</p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900">
                {uiLang === 'id'
                  ? 'Masukkan nilai HR (20–300 bpm) dan QT (150–800 ms) yang valid untuk melihat perbandingan rumus QTc.'
                  : 'Enter valid HR (20–300 bpm) and QT (150–800 ms) values to compute multi-formula QTc.'}
              </div>
            )}
          </div>

          {/* Part 2: Millimeter Grid Box Converter */}
          <div className="pt-5 border-t border-slate-200 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                <Grid className="w-4 h-4 text-blue-600" />
                <span>
                  {uiLang === 'id'
                    ? '2. Konversi Kotak Kecil Kertas EKG (1 mm)'
                    : '2. ECG Paper Millimeter Box Converter (1 mm)'}
                </span>
              </h3>

              <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setPaperSpeed(25)}
                  className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                    paperSpeed === 25 ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600'
                  }`}
                >
                  25 mm/s (1 mm = 40 ms)
                </button>
                <button
                  type="button"
                  onClick={() => setPaperSpeed(50)}
                  className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                    paperSpeed === 50 ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600'
                  }`}
                >
                  50 mm/s (1 mm = 20 ms)
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                <label className="block text-xs font-semibold text-slate-700">
                  {uiLang === 'id'
                    ? 'Jarak R–R dalam Kotak Kecil (1 mm)'
                    : 'R–R Distance in Small Boxes (1 mm)'}
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min={1}
                    max={150}
                    step="0.5"
                    value={smallBoxesRr}
                    onChange={(e) => setSmallBoxesRr(e.target.value)}
                    className="w-28 px-3 py-1.5 text-sm font-mono bg-white border border-slate-300 rounded-lg"
                  />
                  <div className="text-xs">
                    <span className="text-slate-500">≈ </span>
                    <strong className="text-base font-mono text-blue-700">
                      {gridHr !== null ? `${gridHr} bpm` : '-'}
                    </strong>
                    <div className="text-[10px] font-mono text-slate-500">
                      ({(parseFloat(smallBoxesRr || '0') / 5).toFixed(1)}{' '}
                      {uiLang === 'id' ? 'kotak besar' : 'large boxes'})
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                <label className="block text-xs font-semibold text-slate-700">
                  {uiLang === 'id'
                    ? 'Lebar Gelombang / Interval (Kotak Kecil 1 mm)'
                    : 'Waveform / Interval Width (Small Boxes 1 mm)'}
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min={0.5}
                    max={50}
                    step="0.5"
                    value={smallBoxesInterval}
                    onChange={(e) => setSmallBoxesInterval(e.target.value)}
                    className="w-28 px-3 py-1.5 text-sm font-mono bg-white border border-slate-300 rounded-lg"
                  />
                  <div className="text-xs">
                    <span className="text-slate-500">= </span>
                    <strong className="text-base font-mono text-blue-700">
                      {gridDurationMs !== null ? `${gridDurationMs} ms` : '-'}
                    </strong>
                    <div className="text-[10px] font-mono text-slate-500">
                      ({gridDurationMs !== null ? (gridDurationMs / 1000).toFixed(2) : '0.00'} s)
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-start gap-2 text-[11px] text-slate-500 bg-slate-50 p-3 rounded-xl border border-slate-200/70">
              <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
              <p>
                {uiLang === 'id'
                  ? 'Catatan Edukasi: Rumus Fridericia umumnya direkomendasikan ketika laju jantung berada di luar rentang 60–100 bpm. Pada fibrilasi atrium atau irama ireguler, rata-ratakan interval QT/RR dari 3–5 siklus berturut-turut.'
                  : 'Educational Note: Fridericia correction is generally preferred when heart rate falls outside 60–100 bpm. In atrial fibrillation or irregular rhythms, average QT/RR across 3–5 consecutive beats.'}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};


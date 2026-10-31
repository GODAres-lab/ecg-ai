import React, { useState, useMemo } from 'react';
import {
  Copy,
  Check,
  Printer,
  FileDown,
  FileText,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  ShieldAlert,
  Maximize2,
  Calculator,
  Stethoscope,
} from 'lucide-react';
import type {
  ClinicalContextInput,
  EcgAnalysisReport,
  MeasuredValue,
  UiLanguage,
} from '../types/ecg';
import type { ProcessedEcgImage } from '../utils/imageProcessor';
import {
  classifyUrgencyBanner,
  formatReportAsPlainText,
} from '../utils/ecgValidation';
import { DISCLAIMER_TRANSLATION } from '../utils/i18n';
import { exportEcgReportToPdf } from '../utils/pdfExporter';
import { HexaxialAxisCompass } from './HexaxialAxisCompass';
import { EcgImageLightbox } from './EcgImageLightbox';

interface EcgReportViewProps {
  report: EcgAnalysisReport;
  image: ProcessedEcgImage | null;
  fallbackImageUrl?: string;
  clinicalContext?: ClinicalContextInput;
  modelUsed: string;
  analyzedAt: string;
  onAnalyzeAnother: () => void;
  onOpenCalculator: () => void;
  onNotify?: (type: 'success' | 'info' | 'error', message: string) => void;
  uiLang?: UiLanguage;
}

const ALL_SECTION_IDS = [
  's1',
  's2',
  's3',
  's4',
  's5',
  's6',
  's7',
  's8',
  's9',
  's10',
  's11',
  's12',
  's13',
  's14',
] as const;

type LeadTerritoryFilter = 'all' | 'inferior' | 'lateral' | 'anterior' | 'other';

function categorizeLeadTerritory(leadName: string): LeadTerritoryFilter {
  const norm = leadName.toUpperCase().replace(/^LEAD\s+/i, '').trim();
  if (norm === 'II' || norm === 'III' || norm === 'AVF' || norm.startsWith('II ')) {
    return 'inferior';
  }
  if (norm === 'I' || norm === 'AVL' || norm === 'V5' || norm === 'V6') {
    return 'lateral';
  }
  if (norm === 'V1' || norm === 'V2' || norm === 'V3' || norm === 'V4') {
    return 'anterior';
  }
  return 'other';
}

export const EcgReportView: React.FC<EcgReportViewProps> = ({
  report,
  image,
  fallbackImageUrl,
  clinicalContext,
  modelUsed,
  analyzedAt,
  onAnalyzeAnother,
  onOpenCalculator,
  onNotify,
  uiLang = 'id',
}) => {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const id of ALL_SECTION_IDS) {
      initial[id] = true;
    }
    return initial;
  });

  const [copied, setCopied] = useState(false);
  const [includeImageInExport, setIncludeImageInExport] = useState(true);
  const [isImageModalOpen, setIsImageModalOpen] = useState(false);
  const [leadFilter, setLeadFilter] = useState<LeadTerritoryFilter>('all');

  const displayImageUrl = image?.previewDataUrl || fallbackImageUrl;
  const urgencyDescriptor = classifyUrgencyBanner(report.urgency_level);

  const filteredLeads = useMemo(() => {
    if (leadFilter === 'all') return report.lead_analysis;
    return report.lead_analysis.filter(
      (lead) => categorizeLeadTerritory(lead.leadName) === leadFilter
    );
  }, [report.lead_analysis, leadFilter]);

  const toggleSection = (id: string) => {
    setExpandedSections((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const jumpToSection = (id: string) => {
    setExpandedSections((prev) => ({ ...prev, [id]: true }));
    setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 30);
  };

  const setAllExpanded = (expanded: boolean) => {
    const next: Record<string, boolean> = {};
    for (const id of ALL_SECTION_IDS) {
      next[id] = expanded;
    }
    setExpandedSections(next);
  };

  const handleCopyReport = async () => {
    const text = formatReportAsPlainText(report);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      onNotify?.(
        'success',
        uiLang === 'id'
          ? 'Teks laporan klinis lengkap berhasil disalin ke clipboard.'
          : 'Complete clinical report copied to clipboard.'
      );
      setTimeout(() => setCopied(false), 2500);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const handleDownloadTxt = () => {
    const text = formatReportAsPlainText(report);
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ECG-Report-${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    onNotify?.(
      'info',
      uiLang === 'id' ? 'Berkas teks laporan (.txt) telah diunduh.' : 'Text report (.txt) downloaded.'
    );
  };

  const handlePrint = () => {
    window.print();
  };

  const handleExportPdf = async () => {
    await exportEcgReportToPdf(report, {
      includeOriginalImage: includeImageInExport,
      imagePreviewDataUrl: displayImageUrl,
      imageWidth: image?.width,
      imageHeight: image?.height,
    });
    onNotify?.(
      'success',
      uiLang === 'id'
        ? 'Laporan PDF standar A4 berhasil dibuat dan diunduh.'
        : 'A4 clinical PDF report generated and downloaded.'
    );
  };

  const getUrgencyBoxClasses = () => {
    switch (urgencyDescriptor.tone) {
      case 'rose':
        return 'bg-rose-50 border-rose-300 text-rose-950';
      case 'orange':
        return 'bg-amber-50 border-amber-300 text-amber-950';
      case 'amber':
        return 'bg-amber-50/70 border-amber-200 text-slate-900';
      case 'emerald':
        return 'bg-emerald-50/70 border-emerald-200 text-slate-900';
      case 'slate':
      default:
        return 'bg-slate-100 border-slate-300 text-slate-900';
    }
  };

  const getProvenanceBadge = (source: MeasuredValue['source']) => {
    switch (source) {
      case 'Printed on ECG':
        return 'bg-emerald-50 text-emerald-800 border-emerald-200';
      case 'AI Calculated':
        return 'bg-blue-50 text-blue-800 border-blue-200';
      case 'Visually Estimated':
        return 'bg-amber-50 text-amber-800 border-amber-200';
      default:
        return 'bg-slate-100 text-slate-600 border-slate-200';
    }
  };

  const renderMeasurementRow = (label: string, m: MeasuredValue) => (
    <tr key={label} className="border-b border-slate-200 hover:bg-slate-50/70">
      <td className="py-2.5 px-3 font-semibold text-slate-900 text-xs">{label}</td>
      <td className="py-2.5 px-3 font-mono tabular-nums font-bold text-slate-900 text-sm whitespace-nowrap">
        {m.value}{' '}
        <span className="text-xs font-normal text-slate-500">{m.unit}</span>
      </td>
      <td className="py-2.5 px-3 whitespace-nowrap">
        <span
          className={`inline-block px-2 py-0.5 rounded text-[10px] font-mono font-semibold border ${getProvenanceBadge(
            m.source
          )}`}
        >
          {m.source}
        </span>
      </td>
      <td className="py-2.5 px-3 font-mono tabular-nums text-xs text-slate-600 whitespace-nowrap">
        {m.normalRange}
      </td>
      <td className="py-2.5 px-3 text-xs text-slate-800 font-medium">{m.assessment}</td>
      <td className="py-2.5 px-3 text-xs text-slate-500">{m.reliabilityNote}</td>
    </tr>
  );

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-5">
      {/* Mandatory Medical Safety Disclaimer Header */}
      <div className="p-4 bg-white border border-slate-200 rounded-2xl flex items-start gap-3 shadow-2xs">
        <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
        <div className="text-xs text-slate-700 space-y-1">
          <div className="font-bold text-slate-900 uppercase tracking-wide">
            {uiLang === 'id'
              ? 'Pernyataan Dukungan Keputusan Klinis & Edukasi'
              : 'Clinical Decision Support & Educational Disclaimer'}
          </div>
          <p className="leading-relaxed">{DISCLAIMER_TRANSLATION[uiLang]}</p>
        </div>
      </div>

      {/* Immediate Time-Critical Emergency Alert Banner */}
      {(urgencyDescriptor.requiresEmergencyBanner || report.time_critical_warning) && (
        <div
          role="alert"
          className="p-5 bg-rose-50 border-2 border-rose-600 rounded-2xl space-y-2 shadow-sm"
        >
          <div className="flex items-center gap-2.5 text-rose-900 font-bold text-sm uppercase tracking-wide">
            <AlertTriangle className="w-5 h-5 text-rose-700 shrink-0" />
            <span>
              {urgencyDescriptor.glyph}{' '}
              {uiLang === 'id'
                ? 'PERINGATAN KLINIS MENDESAK — EVALUASI MEDIS SEGERA DIREKOMENDASIKAN'
                : 'URGENT CLINICAL WARNING — IMMEDIATE EVALUATION RECOMMENDED'}
            </span>
          </div>
          <p className="text-sm font-semibold text-rose-950">
            {report.time_critical_warning ||
              (uiLang === 'id'
                ? 'Teridentifikasi pola EKG berisiko tinggi atau peka waktu. Segera lakukan korelasi klinis langsung dan penanganan medis gawat darurat.'
                : 'A potentially time-critical or high-risk ECG pattern was identified. Seek immediate clinical correlation and emergency medical evaluation.')}
          </p>
          <p className="text-xs text-rose-900">
            {uiLang === 'id'
              ? 'Jangan menunda penilaian klinis darurat selama meninjau rincian edukatif pada laporan otomatis ini.'
              : 'Do not delay emergency clinical assessment while reviewing secondary sections of this automated educational report.'}
          </p>
        </div>
      )}

      {/* Top Report Action Toolbar */}
      <div className="no-print bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 flex flex-col xl:flex-row xl:items-center justify-between gap-4 shadow-2xs">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-[11px] font-mono text-slate-500 flex-wrap">
            <span className="px-2 py-0.5 bg-slate-100 rounded font-semibold text-slate-700">
              MODEL: {modelUsed.replace(/gemini/gi, 'AI')}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {uiLang === 'id' ? 'DIANALISIS:' : 'ANALYZED:'}{' '}
              {analyzedAt ? new Date(analyzedAt).toLocaleString(uiLang === 'id' ? 'id-ID' : 'en-US') : '-'}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {uiLang === 'id' ? 'KETERBACAAN:' : 'READABILITY:'}{' '}
              <strong>{report.image_quality.overall_readability.toUpperCase()}</strong>
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900">
            {uiLang === 'id'
              ? 'Laporan Interpretasi EKG Komprehensif (14 Seksi)'
              : 'Comprehensive 14-Section ECG Interpretation Report'}
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {displayImageUrl && (
            <label className="flex items-center gap-2 text-xs text-slate-700 mr-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeImageInExport}
                onChange={(e) => setIncludeImageInExport(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600"
              />
              <span>{uiLang === 'id' ? 'Sertakan gambar di PDF' : 'Include image in PDF'}</span>
            </label>
          )}

          <button
            type="button"
            onClick={handleCopyReport}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-white border border-slate-300 text-slate-800 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-600" />
                <span>{uiLang === 'id' ? 'Tersalin' : 'Copied'}</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>{uiLang === 'id' ? 'Salin' : 'Copy'}</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleDownloadTxt}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-white border border-slate-300 text-slate-800 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer"
            title="Download .txt"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>TXT</span>
          </button>

          <button
            type="button"
            onClick={handlePrint}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-white border border-slate-300 text-slate-800 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>{uiLang === 'id' ? 'Cetak' : 'Print'}</span>
          </button>

          <button
            type="button"
            onClick={handleExportPdf}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold bg-slate-900 text-white rounded-xl hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <FileDown className="w-3.5 h-3.5" />
            <span>{uiLang === 'id' ? 'Unduh PDF' : 'Export PDF'}</span>
          </button>

          <button
            type="button"
            onClick={onAnalyzeAnother}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>{uiLang === 'id' ? 'Analisis EKG Lain' : 'Analyze Another'}</span>
          </button>
        </div>
      </div>

      {/* Optional Clinical Context Callout (if provided during analysis) */}
      {clinicalContext &&
        (clinicalContext.patientAgeSex ||
          clinicalContext.symptoms ||
          clinicalContext.clinicalHistory) && (
          <div className="p-3.5 bg-blue-50/70 border border-blue-200 rounded-2xl flex flex-wrap items-center gap-x-6 gap-y-1.5 text-xs text-slate-800">
            <span className="inline-flex items-center gap-1.5 font-bold text-blue-900">
              <Stethoscope className="w-4 h-4 text-blue-600" />
              {uiLang === 'id' ? 'Konteks Klinis Pasien:' : 'Submitted Clinical Context:'}
            </span>
            {clinicalContext.patientAgeSex && (
              <span>
                <strong>{uiLang === 'id' ? 'Usia/JK:' : 'Age/Sex:'}</strong>{' '}
                {clinicalContext.patientAgeSex}
              </span>
            )}
            {clinicalContext.symptoms && (
              <span>
                <strong>{uiLang === 'id' ? 'Keluhan:' : 'Symptoms:'}</strong>{' '}
                {clinicalContext.symptoms}
              </span>
            )}
            {clinicalContext.clinicalHistory && (
              <span>
                <strong>{uiLang === 'id' ? 'Riwayat/Obat:' : 'History/Meds:'}</strong>{' '}
                {clinicalContext.clinicalHistory}
              </span>
            )}
          </div>
        )}

      {/* Top Overview Grid: Original ECG Tracing + Patient/Recording Metadata + Key KPIs */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {displayImageUrl && includeImageInExport && (
          <div className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-4 flex flex-col justify-between space-y-3 shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-600">
                {uiLang === 'id' ? 'Rekaman Gambar EKG' : 'Preserved ECG Tracing'}
              </span>
              <button
                type="button"
                onClick={() => setIsImageModalOpen(true)}
                className="no-print inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-800 cursor-pointer"
              >
                <Maximize2 className="w-3.5 h-3.5" />
                <span>
                  {uiLang === 'id' ? 'Zoom & Kontras Termal' : 'Zoom & Contrast Inspector'}
                </span>
              </button>
            </div>
            <div className="ecg-dark-grid rounded-xl border border-slate-800 overflow-hidden flex items-center justify-center max-h-60 min-h-[180px]">
              <img
                src={displayImageUrl}
                alt="Analyzed ECG Strip"
                referrerPolicy="no-referrer"
                className="max-h-56 w-auto object-contain cursor-zoom-in"
                onClick={() => setIsImageModalOpen(true)}
              />
            </div>
            <div className="text-[11px] font-mono text-slate-500 flex items-center justify-between">
              <span>{image?.orientationDescription || report.image_quality.orientation_handled}</span>
              {image && (
                <span>
                  {image.width}×{image.height} px
                </span>
              )}
            </div>
          </div>
        )}

        {/* Recording Information & Key Vital Summary */}
        <div
          className={`${
            displayImageUrl && includeImageInExport ? 'lg:col-span-7' : 'lg:col-span-12'
          } bg-white border border-slate-200 rounded-2xl p-5 flex flex-col justify-between space-y-4 shadow-2xs`}
        >
          <div className="flex items-center justify-between border-b border-slate-200 pb-2.5 flex-wrap gap-2">
            <h2 className="text-sm font-bold text-slate-900">
              {uiLang === 'id'
                ? 'A. Parameter Vital Utama & Metadata Kalibrasi Rekaman'
                : 'A. Key Vital Metrics & Recording Calibration Metadata'}
            </h2>
            <button
              type="button"
              onClick={onOpenCalculator}
              className="no-print inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-800 cursor-pointer"
            >
              <Calculator className="w-3.5 h-3.5" />
              <span>{uiLang === 'id' ? 'Verifikasi di Kalkulator QTc' : 'Verify in QTc Calculator'}</span>
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
              <div className="text-slate-500 font-mono text-[10px] uppercase">Ventricular Rate</div>
              <div className="text-lg font-mono tabular-nums font-extrabold text-slate-900 mt-0.5">
                {report.heart_rate.ventricular_rate_bpm.value}{' '}
                <span className="text-xs font-normal text-slate-500">
                  {report.heart_rate.ventricular_rate_bpm.unit}
                </span>
              </div>
              <div className="text-[10px] font-mono text-slate-500 truncate mt-0.5">
                {report.heart_rate.ventricular_rate_bpm.source}
              </div>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
              <div className="text-slate-500 font-mono text-[10px] uppercase">PR / QRS</div>
              <div className="text-lg font-mono tabular-nums font-extrabold text-slate-900 mt-0.5">
                {report.intervals.pr_interval_ms.value} / {report.intervals.qrs_duration_ms.value}{' '}
                <span className="text-xs font-normal text-slate-500">ms</span>
              </div>
              <div className="text-[10px] font-mono text-slate-500 truncate mt-0.5">
                {report.intervals.qrs_duration_ms.source}
              </div>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
              <div className="text-slate-500 font-mono text-[10px] uppercase">QT / QTc</div>
              <div className="text-lg font-mono tabular-nums font-extrabold text-slate-900 mt-0.5">
                {report.intervals.qt_interval_ms.value} / {report.intervals.qtc_interval_ms.value}{' '}
                <span className="text-xs font-normal text-slate-500">ms</span>
              </div>
              <div className="text-[10px] font-mono text-slate-500 truncate mt-0.5">
                {report.intervals.qtc_formula_used}
              </div>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
              <div className="text-slate-500 font-mono text-[10px] uppercase">QRS Axis</div>
              <div className="text-lg font-mono tabular-nums font-extrabold text-slate-900 mt-0.5">
                {report.electrical_axis.qrs_axis.value}
                <span className="text-xs font-normal text-slate-500">
                  {report.electrical_axis.qrs_axis.unit}
                </span>
              </div>
              <div className="text-[10px] font-mono text-slate-500 truncate mt-0.5">
                {report.electrical_axis.qrs_axis.source}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-2 text-xs pt-1">
            <div>
              <span className="text-slate-500">Patient ID: </span>
              <span className="font-mono font-medium text-slate-900">
                {report.recording_information.patient_identifier}
              </span>
            </div>
            <div>
              <span className="text-slate-500">Age / Sex: </span>
              <span className="font-mono font-medium text-slate-900">
                {report.recording_information.age_and_sex}
              </span>
            </div>
            <div>
              <span className="text-slate-500">Date / Time: </span>
              <span className="font-mono font-medium text-slate-900">
                {report.recording_information.recording_date_time}
              </span>
            </div>
            <div>
              <span className="text-slate-500">Paper Speed: </span>
              <span className="font-mono font-medium text-slate-900">
                {report.recording_information.paper_speed}
              </span>
            </div>
            <div>
              <span className="text-slate-500">Gain Calibration: </span>
              <span className="font-mono font-medium text-slate-900">
                {report.recording_information.gain_calibration}
              </span>
            </div>
            <div>
              <span className="text-slate-500">Visible Leads: </span>
              <span className="font-mono font-medium text-slate-900">
                {report.recording_information.visible_leads_count}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Quick-Jump Section Navigation Bar + Expand/Collapse All */}
      <div className="no-print bg-white border border-slate-200 rounded-2xl p-3 flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-2xs">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0 text-xs font-semibold">
          {[
            { id: 's1', labelId: '01 Ringkasan', labelEn: '01 Summary' },
            { id: 's3', labelId: '03 Irama & HR', labelEn: '03 Rate & Rhythm' },
            { id: 's4', labelId: '04 Interval QTc', labelEn: '04 Intervals' },
            { id: 's5', labelId: '05 Aksis Kompas', labelEn: '05 Axis Compass' },
            { id: 's6', labelId: '06 Peta 12-Lead', labelEn: '06 12-Lead Map' },
            { id: 's8', labelId: '08 Iskemia/STEMI', labelEn: '08 Ischemia' },
            { id: 's9', labelId: '09 Aritmia', labelEn: '09 Conduction' },
            { id: 's11', labelId: '11 Mesin vs AI', labelEn: '11 Machine vs AI' },
            { id: 's12', labelId: '12 Kesimpulan', labelEn: '12 Impression' },
          ].map((nav) => (
            <button
              key={nav.id}
              type="button"
              onClick={() => jumpToSection(nav.id)}
              className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-blue-50 hover:text-blue-700 text-slate-700 whitespace-nowrap transition-colors cursor-pointer"
            >
              {uiLang === 'id' ? nav.labelId : nav.labelEn}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3 text-xs font-semibold shrink-0 self-end md:self-center">
          <button
            type="button"
            onClick={() => setAllExpanded(true)}
            className="text-blue-600 hover:text-blue-800 underline cursor-pointer"
          >
            {uiLang === 'id' ? 'Buka Semua (14)' : 'Expand All (14)'}
          </button>
          <span className="text-slate-300">|</span>
          <button
            type="button"
            onClick={() => setAllExpanded(false)}
            className="text-slate-600 hover:text-slate-900 underline cursor-pointer"
          >
            {uiLang === 'id' ? 'Tutup Semua' : 'Collapse All'}
          </button>
        </div>
      </div>

      {/* SECTION 1: Executive Summary */}
      <ReportSection
        id="s1"
        title={uiLang === 'id' ? '01. Ringkasan Eksekutif (Executive Summary)' : '01. Executive Summary'}
        expanded={expandedSections.s1}
        onToggle={() => toggleSection('s1')}
      >
        <div className="space-y-2.5">
          <div className="p-3.5 bg-blue-50/60 border border-blue-200/80 rounded-xl">
            <span className="text-[11px] font-mono uppercase text-blue-700 font-semibold block">
              {uiLang === 'id' ? 'Interpretasi Utama AI' : 'Primary AI Interpretation'}
            </span>
            <p className="text-sm sm:text-base font-bold text-slate-900 mt-0.5">
              {report.ai_interpretation.primary_interpretation}
            </p>
          </div>
          <p className="text-sm text-slate-700 leading-relaxed">{report.executive_summary}</p>
        </div>
      </ReportSection>

      {/* SECTION 2: Urgency Assessment */}
      <ReportSection
        id="s2"
        title={uiLang === 'id' ? '02. Klasifikasi Urgensi Klinis' : '02. Urgency Assessment'}
        expanded={expandedSections.s2}
        onToggle={() => toggleSection('s2')}
      >
        <div className={`p-4 border rounded-xl space-y-2 ${getUrgencyBoxClasses()}`}>
          <div className="font-mono text-xs font-bold tracking-wide">
            {urgencyDescriptor.glyph} CLASSIFICATION: {urgencyDescriptor.shortLabel}
          </div>
          <p className="text-xs leading-relaxed">{report.urgency_explanation}</p>
          {report.time_critical_warning && (
            <p className="text-xs font-semibold pt-1">
              Time-Critical Note: {report.time_critical_warning}
            </p>
          )}
        </div>
      </ReportSection>

      {/* SECTION 3: Heart Rate and Rhythm */}
      <ReportSection
        id="s3"
        title={uiLang === 'id' ? '03. Laju Jantung & Analisis Irama (Heart Rate & Rhythm)' : '03. Heart Rate and Rhythm'}
        expanded={expandedSections.s3}
        onToggle={() => toggleSection('s3')}
      >
        <div className="space-y-4">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-mono uppercase text-slate-500">
                  <th className="py-2 px-3">Parameter</th>
                  <th className="py-2 px-3">Measured Value</th>
                  <th className="py-2 px-3">Provenance</th>
                  <th className="py-2 px-3">Reference Range</th>
                  <th className="py-2 px-3">Assessment</th>
                  <th className="py-2 px-3">Reliability Note</th>
                </tr>
              </thead>
              <tbody>
                {renderMeasurementRow('Ventricular Rate', report.heart_rate.ventricular_rate_bpm)}
                {renderMeasurementRow('Atrial Rate', report.heart_rate.atrial_rate_bpm)}
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <DetailRow label="Underlying Rhythm" value={report.rhythm.underlying_rhythm} />
            <DetailRow label="Regularity" value={report.rhythm.regularity} />
            <DetailRow
              label="P-Wave Presence & Morphology"
              value={report.rhythm.p_wave_presence_and_morphology}
            />
            <DetailRow label="P–QRS Relationship" value={report.rhythm.p_qrs_relationship} />
            <DetailRow
              label="Sinus vs. Alternative Rhythm Evidence"
              value={report.rhythm.sinus_vs_alternative_evidence}
            />
            <DetailRow
              label="Premature Beats / Pauses / Disturbances"
              value={report.rhythm.premature_beats_pauses_disturbances}
            />
            <DetailRow label="AV Block Evidence" value={report.rhythm.av_block_evidence} />
            <DetailRow
              label="AFib / Flutter / Arrhythmia Evidence"
              value={report.rhythm.afib_flutter_arrhythmia_evidence}
            />
          </div>

          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 leading-relaxed">
            <strong className="text-slate-900">Rhythm Reasoning: </strong>
            {report.rhythm.rhythm_reasoning}
          </div>
        </div>
      </ReportSection>

      {/* SECTION 4: ECG Measurements (Intervals) */}
      <ReportSection
        id="s4"
        title={uiLang === 'id' ? '04. Pengukuran Interval EKG & QTc' : '04. ECG Measurements (Intervals & QTc)'}
        expanded={expandedSections.s4}
        onToggle={() => toggleSection('s4')}
      >
        <div className="space-y-3">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-mono uppercase text-slate-500">
                  <th className="py-2 px-3">Interval</th>
                  <th className="py-2 px-3">Measured Value</th>
                  <th className="py-2 px-3">Provenance</th>
                  <th className="py-2 px-3">Reference Range</th>
                  <th className="py-2 px-3">Assessment</th>
                  <th className="py-2 px-3">Reliability Note</th>
                </tr>
              </thead>
              <tbody>
                {renderMeasurementRow('PR Interval', report.intervals.pr_interval_ms)}
                {renderMeasurementRow('QRS Duration', report.intervals.qrs_duration_ms)}
                {renderMeasurementRow('QT Interval', report.intervals.qt_interval_ms)}
                {renderMeasurementRow('Corrected QT (QTc)', report.intervals.qtc_interval_ms)}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="text-xs text-slate-600 font-mono">
              QTc Calculation Method / Formula:{' '}
              <strong className="text-slate-900">{report.intervals.qtc_formula_used}</strong>
            </div>
            <button
              type="button"
              onClick={onOpenCalculator}
              className="no-print inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
            >
              <Calculator className="w-3.5 h-3.5" />
              <span>
                {uiLang === 'id'
                  ? 'Bandingkan Bazett / Fridericia / Framingham'
                  : 'Compare Bazett / Fridericia / Framingham'}
              </span>
            </button>
          </div>
        </div>
      </ReportSection>

      {/* SECTION 5: Electrical Axis + Visual Hexaxial Compass */}
      <ReportSection
        id="s5"
        title={uiLang === 'id' ? '05. Aksis Listrik Jantung & Kompas Hexaxial' : '05. Electrical Axis & Hexaxial Compass'}
        expanded={expandedSections.s5}
        onToggle={() => toggleSection('s5')}
      >
        <div className="space-y-4">
          <HexaxialAxisCompass
            qrsAxisRaw={report.electrical_axis.qrs_axis.value}
            pAxisRaw={report.electrical_axis.p_wave_axis.value}
            tAxisRaw={report.electrical_axis.t_wave_axis.value}
            uiLang={uiLang}
          />

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-mono uppercase text-slate-500">
                  <th className="py-2 px-3">Axis Vector</th>
                  <th className="py-2 px-3">Degrees</th>
                  <th className="py-2 px-3">Provenance</th>
                  <th className="py-2 px-3">Reference Range</th>
                  <th className="py-2 px-3">Assessment</th>
                  <th className="py-2 px-3">Reliability Note</th>
                </tr>
              </thead>
              <tbody>
                {renderMeasurementRow('P-Wave Axis', report.electrical_axis.p_wave_axis)}
                {renderMeasurementRow('QRS Electrical Axis', report.electrical_axis.qrs_axis)}
                {renderMeasurementRow('T-Wave Axis', report.electrical_axis.t_wave_axis)}
              </tbody>
            </table>
          </div>
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 leading-relaxed">
            <strong className="text-slate-900">Axis Summary: </strong>
            {report.electrical_axis.axis_deviation_summary}
          </div>
        </div>
      </ReportSection>

      {/* SECTION 6: Lead-by-Lead Analysis with Anatomical Territory Filter */}
      <ReportSection
        id="s6"
        title={uiLang === 'id' ? '06. Interpretasi Per-Sadapan (Lead-by-Lead Analysis)' : '06. Lead-by-Lead Interpretation'}
        expanded={expandedSections.s6}
        onToggle={() => toggleSection('s6')}
      >
        <div className="space-y-3">
          {/* Anatomical Territory Filter Pills */}
          <div className="no-print flex flex-wrap items-center gap-1.5 pb-1">
            {(
              [
                { id: 'all', labelId: `Semua Sadapan (${report.lead_analysis.length})`, labelEn: `All Leads (${report.lead_analysis.length})` },
                { id: 'inferior', labelId: 'Inferior (II, III, aVF)', labelEn: 'Inferior (II, III, aVF)' },
                { id: 'anterior', labelId: 'Septal / Anterior (V1–V4)', labelEn: 'Septal / Anterior (V1–V4)' },
                { id: 'lateral', labelId: 'Lateral (I, aVL, V5–V6)', labelEn: 'Lateral (I, aVL, V5–V6)' },
                { id: 'other', labelId: 'aVR / Strip Irama', labelEn: 'aVR / Rhythm Strip' },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setLeadFilter(f.id)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  leadFilter === f.id
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {uiLang === 'id' ? f.labelId : f.labelEn}
              </button>
            ))}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-mono uppercase text-slate-500">
                  <th className="py-2.5 px-3">Lead</th>
                  <th className="py-2.5 px-3">ID Source</th>
                  <th className="py-2.5 px-3">P Wave</th>
                  <th className="py-2.5 px-3">QRS Complex</th>
                  <th className="py-2.5 px-3">ST Segment</th>
                  <th className="py-2.5 px-3">T Wave</th>
                  <th className="py-2.5 px-3">Abnormalities & Limitations</th>
                </tr>
              </thead>
              <tbody>
                {(filteredLeads.length > 0 ? filteredLeads : report.lead_analysis).map((lead, idx) => (
                  <tr
                    key={`${lead.leadName}-${idx}`}
                    className="border-b border-slate-200 hover:bg-slate-50/70 align-top"
                  >
                    <td className="py-2.5 px-3 font-mono font-bold text-slate-900 whitespace-nowrap">
                      {lead.leadName}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[11px] text-slate-600 whitespace-nowrap">
                      {lead.identifiedFromLabel ? 'Printed Label' : 'Unlabeled / Inferred'}
                    </td>
                    <td className="py-2.5 px-3 text-slate-700">{lead.pWave}</td>
                    <td className="py-2.5 px-3 text-slate-700">{lead.qrsMorphology}</td>
                    <td className="py-2.5 px-3 text-slate-700">{lead.stSegment}</td>
                    <td className="py-2.5 px-3 text-slate-700">{lead.tWave}</td>
                    <td className="py-2.5 px-3 text-slate-800 space-y-1">
                      <div>{lead.abnormalities}</div>
                      <div className="text-[11px] text-slate-500">
                        Confidence: {lead.confidenceAndLimitations}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </ReportSection>

      {/* SECTION 7: Waveform Morphology */}
      <ReportSection
        id="s7"
        title={uiLang === 'id' ? '07. Morfologi Gelombang (P, QRS, Gelombang Q, ST-T, Hipertrofi)' : '07. Waveform Morphology'}
        expanded={expandedSections.s7}
        onToggle={() => toggleSection('s7')}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <DetailRow
            label="P-Wave Morphology & Abnormalities"
            value={report.waveform_morphology.p_wave_abnormalities}
          />
          <DetailRow
            label="QRS Morphology Summary"
            value={report.waveform_morphology.qrs_morphology_summary}
          />
          <DetailRow
            label="Q Waves & Pathological Q Waves"
            value={report.waveform_morphology.pathological_q_waves}
          />
          <DetailRow
            label="Precordial R-Wave Progression"
            value={report.waveform_morphology.r_wave_progression}
          />
          <DetailRow
            label="ST-Segment Elevation or Depression"
            value={report.waveform_morphology.st_segment_changes}
          />
          <DetailRow
            label="T-Wave Inversion, Flattening, or Abnormalities"
            value={report.waveform_morphology.t_wave_abnormalities}
          />
          <DetailRow
            label="Bundle Branch Block Evidence"
            value={report.waveform_morphology.bundle_branch_block_evidence}
          />
          <DetailRow
            label="Ventricular Hypertrophy & Chamber Enlargement"
            value={report.waveform_morphology.ventricular_hypertrophy_chamber_enlargement}
          />
          <DetailRow
            label="Pre-Excitation Patterns"
            value={report.waveform_morphology.pre_excitation_evidence}
          />
          <DetailRow
            label="Ectopic Beats & Other Abnormalities"
            value={report.waveform_morphology.ectopic_beats_and_other}
          />
        </div>
      </ReportSection>

      {/* SECTION 8: Ischemia and Infarction Assessment */}
      <ReportSection
        id="s8"
        title={uiLang === 'id' ? '08. Evaluasi Iskemia, STEMI/NSTEMI & Infark Miokard' : '08. Ischemia and Infarction Assessment'}
        expanded={expandedSections.s8}
        onToggle={() => toggleSection('s8')}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <DetailRow
              label="Acute Myocardial Ischemia Patterns"
              value={report.ischemia_and_infarction.acute_ischemia_patterns}
            />
            <DetailRow
              label="STEMI Patterns"
              value={report.ischemia_and_infarction.stemi_patterns}
            />
            <DetailRow
              label="Non-ST-Elevation ACS Patterns"
              value={report.ischemia_and_infarction.nstemi_acs_patterns}
            />
            <DetailRow
              label="Previous Myocardial Infarction"
              value={report.ischemia_and_infarction.prior_infarction_evidence}
            />
            <DetailRow
              label="Reciprocal ST-Segment Changes"
              value={report.ischemia_and_infarction.reciprocal_changes}
            />
            <DetailRow
              label="Posterior / Right Ventricular Patterns"
              value={report.ischemia_and_infarction.posterior_or_rv_infarction_patterns}
            />
            <DetailRow
              label="Pericarditis-Like Patterns"
              value={report.ischemia_and_infarction.pericarditis_like_patterns}
            />
            <DetailRow
              label="Affected Leads"
              value={report.ischemia_and_infarction.affected_leads}
            />
          </div>
          <div className="p-3.5 bg-amber-50/70 border border-amber-200 rounded-xl text-xs text-slate-800 leading-relaxed">
            <strong>Pattern vs. Clinical Diagnosis Notice: </strong>
            {report.ischemia_and_infarction.pattern_vs_diagnosis_distinction}
          </div>
        </div>
      </ReportSection>

      {/* SECTION 9: Arrhythmias and Conduction Abnormalities */}
      <ReportSection
        id="s9"
        title={uiLang === 'id' ? '09. Aritmia & Gangguan Konduksi' : '09. Arrhythmias and Conduction Abnormalities'}
        expanded={expandedSections.s9}
        onToggle={() => toggleSection('s9')}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <DetailRow
            label="Atrioventricular (AV) Block Assessment"
            value={report.arrhythmias_and_conduction.av_block_assessment}
          />
          <DetailRow
            label="Bundle Branch & Fascicular Blocks"
            value={report.arrhythmias_and_conduction.bundle_branch_and_fascicular_blocks}
          />
          <DetailRow
            label="Supraventricular Arrhythmias (AFib, Flutter, SVT)"
            value={report.arrhythmias_and_conduction.supraventricular_arrhythmias}
          />
          <DetailRow
            label="Ventricular Arrhythmias (VT, VF, PVCs)"
            value={report.arrhythmias_and_conduction.ventricular_arrhythmias}
          />
          <DetailRow
            label="Bradyarrhythmias & Sinus Pauses"
            value={report.arrhythmias_and_conduction.bradyarrhythmias_and_pauses}
          />
          <DetailRow
            label="Premature Atrial / Ventricular Complexes"
            value={report.arrhythmias_and_conduction.premature_complexes}
          />
          <DetailRow
            label="Pacemaker Rhythm & Pacing Activity"
            value={report.arrhythmias_and_conduction.pacemaker_activity}
          />
          <DetailRow
            label="Tracing Sufficiency Note"
            value={report.arrhythmias_and_conduction.sufficiency_of_tracing_note}
          />
        </div>
      </ReportSection>

      {/* SECTION 10: Other Findings */}
      <ReportSection
        id="s10"
        title={
          uiLang === 'id'
            ? '10. Temuan Tambahan (Voltase, Repolarisasi, Pola Elektrolit)'
            : '10. Other Findings (Voltage, Repolarization, Electrolyte Patterns)'
        }
        expanded={expandedSections.s10}
        onToggle={() => toggleSection('s10')}
      >
        <div className="space-y-4 text-xs">
          {report.additional_findings.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-mono uppercase text-slate-500">
                    <th className="py-2 px-3">Category</th>
                    <th className="py-2 px-3">Observation</th>
                    <th className="py-2 px-3">Affected Leads</th>
                    <th className="py-2 px-3">Clinical Significance</th>
                  </tr>
                </thead>
                <tbody>
                  {report.additional_findings.map((item, idx) => (
                    <tr key={idx} className="border-b border-slate-200">
                      <td className="py-2.5 px-3 font-semibold text-slate-900">{item.category}</td>
                      <td className="py-2.5 px-3 text-slate-700">{item.observation}</td>
                      <td className="py-2.5 px-3 font-mono text-slate-600">{item.affectedLeads}</td>
                      <td className="py-2.5 px-3 text-slate-700">{item.clinicalSignificance}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-slate-600">
              {uiLang === 'id'
                ? 'Tidak ada pola voltase rendah, electrical alternans, sindrom Brugada, atau gangguan repolarisasi tambahan yang ditandai secara spesifik pada sadapan yang terbaca.'
                : 'No additional low-voltage, electrical alternans, Brugada-like, or repolarization syndromes were specifically flagged on the readable leads.'}
            </p>
          )}
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-700 leading-relaxed">
            <strong className="text-slate-900">Electrolyte Assessment Notice: </strong>
            {report.electrolyte_disclaimer_note}
          </div>
        </div>
      </ReportSection>

      {/* SECTION 11: Printed Machine Interpretation */}
      <ReportSection
        id="s11"
        title={
          uiLang === 'id'
            ? '11. Perbandingan Teks Header Mesin EKG vs. Penilaian Independen AI'
            : '11. Printed Machine Interpretation vs. Independent AI Assessment'
        }
        expanded={expandedSections.s11}
        onToggle={() => toggleSection('s11')}
      >
        <div className="space-y-4 text-xs">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
              <div className="font-mono text-[11px] uppercase text-slate-500">
                Printed ECG Machine Header Text (
                {report.printed_machine_interpretation.is_present ? 'Detected' : 'Not Detected'})
              </div>
              <div className="font-mono text-slate-900 font-medium leading-relaxed">
                {report.printed_machine_interpretation.extracted_text}
              </div>
            </div>
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
              <div className="font-mono text-[11px] uppercase text-slate-500">
                AI Independent Waveform Comparison
              </div>
              <div className="text-slate-800 leading-relaxed">
                {report.printed_machine_interpretation.comparison_with_ai}
              </div>
            </div>
          </div>

          {(report.printed_machine_interpretation.agreements.length > 0 ||
            report.printed_machine_interpretation.discrepancies.length > 0) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <div className="font-semibold text-emerald-800 mb-1">Agreements:</div>
                <ul className="list-disc pl-4 space-y-1 text-slate-700">
                  {report.printed_machine_interpretation.agreements.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="font-semibold text-amber-800 mb-1">Discrepancies / Cautions:</div>
                <ul className="list-disc pl-4 space-y-1 text-slate-700">
                  {report.printed_machine_interpretation.discrepancies.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      </ReportSection>

      {/* SECTION 12: Final Clinical Impression */}
      <ReportSection
        id="s12"
        title={uiLang === 'id' ? '12. Kesimpulan Klinis Akhir (Final Clinical Impression)' : '12. Final Clinical Impression'}
        expanded={expandedSections.s12}
        onToggle={() => toggleSection('s12')}
      >
        <div className="space-y-3 text-xs">
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl">
            <div className="font-mono text-[11px] uppercase text-slate-500">
              Primary ECG Conclusion
            </div>
            <div className="text-sm font-bold text-slate-900 mt-0.5">
              {report.ai_interpretation.primary_interpretation}
            </div>
          </div>
          <ol className="list-decimal pl-5 space-y-1.5 text-slate-800 leading-relaxed">
            {report.clinical_impression.map((point, idx) => (
              <li key={idx}>{point}</li>
            ))}
          </ol>
          <p className="text-slate-600 italic pt-1">
            {uiLang === 'id'
              ? 'Catatan: Tampilan EKG normal tidak menyingkirkan kemungkinan penyakit jantung koroner, iskemia miokard akut, atau aritmia paroksismal.'
              : 'Note: A normal-appearing ECG does not exclude serious cardiac disease, myocardial ischemia, or paroxysmal arrhythmias.'}
          </p>
        </div>
      </ReportSection>

      {/* SECTION 13: Limitations and Confidence */}
      <ReportSection
        id="s13"
        title={
          uiLang === 'id'
            ? '13. Batasan Teknis & Tingkat Kepercayaan Optik'
            : '13. Technical Limitations and Optical Confidence'
        }
        expanded={expandedSections.s13}
        onToggle={() => toggleSection('s13')}
      >
        <div className="space-y-3 text-xs">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <DetailRow
              label="Optical Readability Level"
              value={report.image_quality.overall_readability}
            />
            <DetailRow
              label="AI Assessment Confidence"
              value={report.confidence.overall_level}
            />
            <DetailRow
              label="Calibration Grid Visibility"
              value={report.image_quality.grid_visibility}
            />
          </div>
          <p className="text-slate-700 leading-relaxed">
            <strong>Confidence Rationale: </strong>
            {report.confidence.rationale}
          </p>
          <div>
            <div className="font-semibold text-slate-900 mb-1">
              Identified Technical & Clinical Limitations:
            </div>
            <ul className="list-disc pl-5 space-y-1 text-slate-700">
              {report.limitations.map((lim, i) => (
                <li key={i}>{lim}</li>
              ))}
            </ul>
          </div>
        </div>
      </ReportSection>

      {/* SECTION 14: Recommended Next Steps */}
      <ReportSection
        id="s14"
        title={
          uiLang === 'id'
            ? '14. Rekomendasi Tindak Lanjut (Edukasi & Dukungan Klinis)'
            : '14. Recommended Next Steps (Educational & Clinical Support)'
        }
        expanded={expandedSections.s14}
        onToggle={() => toggleSection('s14')}
      >
        <ul className="list-disc pl-5 space-y-1.5 text-xs text-slate-800 leading-relaxed">
          {report.recommended_next_steps.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ul>
      </ReportSection>

      {/* Interactive Full-Resolution ECG Image Inspector */}
      {displayImageUrl && (
        <EcgImageLightbox
          isOpen={isImageModalOpen}
          onClose={() => setIsImageModalOpen(false)}
          imageUrl={displayImageUrl}
          title={image?.file.name}
          dimensionsText={image ? `${image.width}×${image.height} px` : undefined}
          uiLang={uiLang}
        />
      )}
    </div>
  );
};

interface ReportSectionProps {
  id: string;
  title: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

const ReportSection: React.FC<ReportSectionProps> = ({
  id,
  title,
  expanded,
  onToggle,
  children,
}) => (
  <section
    id={id}
    className="print-break-inside-avoid bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-2xs scroll-mt-20"
  >
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      className="w-full flex items-center justify-between px-5 py-3.5 bg-slate-50/80 hover:bg-slate-100/80 border-b border-slate-200/80 text-left transition-colors cursor-pointer"
    >
      <h2 className="text-sm font-bold text-slate-900">{title}</h2>
      <span className="no-print text-slate-500">
        {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </span>
    </button>
    <div className={expanded ? 'p-5' : 'hidden print-only-expand p-5'}>{children}</div>
  </section>
);

const DetailRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="p-3 bg-slate-50/70 border border-slate-200/90 rounded-xl">
    <div className="text-[11px] font-mono uppercase text-slate-500 mb-1">{label}</div>
    <div className="text-xs text-slate-900 leading-relaxed">{value}</div>
  </div>
);

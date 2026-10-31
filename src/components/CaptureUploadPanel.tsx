import React, { useRef, useState, useEffect } from 'react';
import {
  Camera,
  Upload,
  Activity,
  XCircle,
  AlertCircle,
  RefreshCw,
  FileImage,
  CheckCircle2,
  ShieldAlert,
  ClipboardPaste,
  Stethoscope,
  Maximize2,
  RotateCw,
  Languages,
  ChevronDown,
  ChevronUp,
  Calculator,
} from 'lucide-react';
import type { ProcessedEcgImage, SampleEcgScenario } from '../utils/imageProcessor';
import { DISCLAIMER_TRANSLATION } from '../utils/i18n';
import { QuotaBanner } from './QuotaBanner';
import { EcgImageLightbox } from './EcgImageLightbox';
import type { QuotaInfo } from '../types/auth';
import type { ClinicalContextInput, UiLanguage } from '../types/ecg';

interface CaptureUploadPanelProps {
  selectedImage: ProcessedEcgImage | null;
  isAnalyzing: boolean;
  analysisStageText: string;
  autoAnalyzeOnSelect: boolean;
  onToggleAutoAnalyze: (enabled: boolean) => void;
  errorMessage: string | null;
  onFileSelected: (file: File) => void;
  onOpenCameraModal: () => void;
  onTriggerAnalyze: () => void;
  onCancelAnalysis: () => void;
  onClearImage: () => void;
  onLoadSampleEcg: (scenario: SampleEcgScenario) => void;
  onOpenDisclosureTab: () => void;
  onOpenCalculator: () => void;
  quotaInfo: QuotaInfo | null;
  onOpenAuth: () => void;
  onOpenSubscribe: () => void;
  clinicalContext: ClinicalContextInput;
  onChangeClinicalContext: (ctx: ClinicalContextInput) => void;
  reportLanguage: UiLanguage;
  onChangeReportLanguage: (lang: UiLanguage) => void;
  uiLang: UiLanguage;
  onPasteSuccess?: () => void;
}

const SYMPTOM_CHIPS = {
  id: [
    'Nyeri Dada Akut',
    'Sesak Napas',
    'Palpitasi / Berdebar',
    'Sinkop / Pusing',
    'Asimtomatik / MCU',
    'Evaluasi Pra-Operasi',
  ],
  en: [
    'Acute Chest Pain',
    'Shortness of Breath',
    'Palpitations',
    'Syncope / Dizziness',
    'Asymptomatic / Screening',
    'Pre-Operative Eval',
  ],
};

export const CaptureUploadPanel: React.FC<CaptureUploadPanelProps> = ({
  selectedImage,
  isAnalyzing,
  analysisStageText,
  autoAnalyzeOnSelect,
  onToggleAutoAnalyze,
  errorMessage,
  onFileSelected,
  onOpenCameraModal,
  onTriggerAnalyze,
  onCancelAnalysis,
  onClearImage,
  onLoadSampleEcg,
  onOpenDisclosureTab,
  onOpenCalculator,
  quotaInfo,
  onOpenAuth,
  onOpenSubscribe,
  clinicalContext,
  onChangeClinicalContext,
  reportLanguage,
  onChangeReportLanguage,
  uiLang,
  onPasteSuccess,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mobileCameraInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showContextForm, setShowContextForm] = useState(false);
  const [previewRotation, setPreviewRotation] = useState(0);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Reset preview rotation whenever a new image is loaded
  useEffect(() => {
    setPreviewRotation(0);
  }, [selectedImage?.previewDataUrl]);

  // Live elapsed timer during AI analysis
  useEffect(() => {
    if (!isAnalyzing) {
      setElapsedSeconds(0);
      return;
    }
    const timer = setInterval(() => {
      setElapsedSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [isAnalyzing]);

  // Global Ctrl+V / Cmd+V Clipboard Image Paste listener
  useEffect(() => {
    const handleWindowPaste = (e: ClipboardEvent) => {
      if (isAnalyzing) return;
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith('image/')) {
          const blob = item.getAsFile();
          if (blob) {
            e.preventDefault();
            const ext = blob.type.split('/')[1] || 'png';
            const pastedFile = new File([blob], `ecg_clipboard_${Date.now()}.${ext}`, {
              type: blob.type,
            });
            onPasteSuccess?.();
            onFileSelected(pastedFile);
            break;
          }
        }
      }
    };

    window.addEventListener('paste', handleWindowPaste);
    return () => window.removeEventListener('paste', handleWindowPaste);
  }, [isAnalyzing, onFileSelected, onPasteSuccess]);

  const handleManualClipboardRead = async () => {
    if (isAnalyzing) return;
    try {
      if (!navigator.clipboard || !navigator.clipboard.read) {
        alert(
          uiLang === 'id'
            ? 'Tekan Ctrl+V (atau Cmd+V) langsung pada halaman ini untuk menempelkan tangkapan layar EKG.'
            : 'Press Ctrl+V (or Cmd+V) anywhere on this page to paste an ECG screenshot.'
        );
        return;
      }
      const clipboardItems = await navigator.clipboard.read();
      for (const item of clipboardItems) {
        const imageType = item.types.find((t) => t.startsWith('image/'));
        if (imageType) {
          const blob = await item.getType(imageType);
          const ext = imageType.split('/')[1] || 'png';
          const file = new File([blob], `ecg_clipboard_${Date.now()}.${ext}`, {
            type: imageType,
          });
          onPasteSuccess?.();
          onFileSelected(file);
          return;
        }
      }
      alert(
        uiLang === 'id'
          ? 'Tidak ditemukan gambar di clipboard Anda. Salin (Copy) gambar EKG terlebih dahulu lalu tekan Ctrl+V.'
          : 'No image found in your clipboard. Copy an ECG image or screenshot first, then press Ctrl+V.'
      );
    } catch {
      alert(
        uiLang === 'id'
          ? 'Untuk menempel dari clipboard, cukup tekan Ctrl+V (atau Cmd+V) langsung di keyboard Anda.'
          : 'To paste from clipboard, simply press Ctrl+V (or Cmd+V) directly on your keyboard.'
      );
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onFileSelected(file);
    }
    e.target.value = '';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isAnalyzing) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (isAnalyzing) return;
    const file = e.dataTransfer.files?.[0];
    if (file) {
      onFileSelected(file);
    }
  };

  const toggleSymptomChip = (chip: string) => {
    const current = clinicalContext.symptoms || '';
    const parts = current
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const exists = parts.includes(chip);
    const next = exists ? parts.filter((p) => p !== chip) : [...parts, chip];
    onChangeClinicalContext({
      ...clinicalContext,
      symptoms: next.join(', '),
    });
  };

  const hasActiveContext = Boolean(
    clinicalContext.patientAgeSex?.trim() ||
      clinicalContext.symptoms?.trim() ||
      clinicalContext.clinicalHistory?.trim()
  );

  const activeStageIndex = elapsedSeconds < 3 ? 0 : elapsedSeconds < 7 ? 1 : elapsedSeconds < 12 ? 2 : 3;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-5">
      {/* Persistent Educational Disclaimer Banner */}
      <div className="p-3.5 bg-white border border-slate-200 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
        <div className="flex items-start gap-2.5 text-xs text-slate-700">
          <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="leading-relaxed">
            <strong className="text-slate-900">
              {uiLang === 'id'
                ? 'Pernyataan Dukungan Klinis & Edukasi:'
                : 'Educational & Clinical Support Disclosure:'}
            </strong>{' '}
            {DISCLAIMER_TRANSLATION[uiLang]}
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenDisclosureTab}
          className="text-xs font-semibold text-blue-600 hover:text-blue-800 underline whitespace-nowrap shrink-0 self-start sm:self-center cursor-pointer"
        >
          {uiLang === 'id' ? 'Kebijakan & Persetujuan' : 'Consent & Safety Policy'}
        </button>
      </div>

      {/* Usage Quota & Subscription Status Banner */}
      <QuotaBanner
        quotaInfo={quotaInfo}
        onOpenAuth={onOpenAuth}
        onOpenSubscribe={onOpenSubscribe}
        uiLang={uiLang}
      />

      {/* Hero Title Bar with ECG Grid Subtle Accent */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 ecg-grid-subtle flex flex-col lg:flex-row lg:items-end justify-between gap-4 shadow-2xs">
        <div className="space-y-1.5 max-w-3xl">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-mono font-semibold text-blue-700">
            <span className="px-2 py-0.5 rounded bg-blue-50 border border-blue-200/80">
              MULTIMODAL 12-LEAD VISION
            </span>
            <span aria-hidden="true">·</span>
            <span>ZERO-PREPROCESSING</span>
            <span aria-hidden="true">·</span>
            <span>EXIF AUTO-ORIENTATION</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
            {uiLang === 'id'
              ? 'Interpretasi EKG 12-Lead Berbasis AI'
              : 'AI 12-Lead ECG Interpretation Workspace'}
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
            {uiLang === 'id'
              ? 'Foto kertas rekaman EKG, unggah berkas gambar (JPEG, PNG, WebP), atau tekan Ctrl+V dari clipboard. Sistem otomatis membaca orientasi potret/lanskap, rotasi 90°/180°/270°, kemiringan kamera, dan tata letak multi-sadapan tanpa perlu pemotongan manual.'
              : 'Photograph a printed ECG, upload an image (JPEG, PNG, WebP), or press Ctrl+V to paste from clipboard. Orientation, 90°/180°/270° rotation, tilt, and multi-lead layouts are handled automatically without manual cropping.'}
          </p>
        </div>

        {/* Preferences Row: Report Language & Auto-Analyze */}
        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {/* AI Report Output Language Pill */}
          <div className="flex items-center gap-2 bg-white px-3 py-1.5 border border-slate-200 rounded-xl shadow-2xs text-xs">
            <Languages className="w-3.5 h-3.5 text-blue-600 shrink-0" />
            <span className="text-slate-500 font-medium">
              {uiLang === 'id' ? 'Bahasa Laporan:' : 'Report Lang:'}
            </span>
            <div className="inline-flex bg-slate-100 p-0.5 rounded-lg font-bold text-[11px]">
              <button
                type="button"
                onClick={() => onChangeReportLanguage('id')}
                className={`px-2 py-0.5 rounded-md transition-colors cursor-pointer ${
                  reportLanguage === 'id' ? 'bg-blue-600 text-white' : 'text-slate-600'
                }`}
              >
                Indonesia
              </button>
              <button
                type="button"
                onClick={() => onChangeReportLanguage('en')}
                className={`px-2 py-0.5 rounded-md transition-colors cursor-pointer ${
                  reportLanguage === 'en' ? 'bg-blue-600 text-white' : 'text-slate-600'
                }`}
              >
                English
              </button>
            </div>
          </div>

          {/* Auto-Analysis Preference Toggle */}
          <label className="flex items-center gap-2 text-xs font-medium text-slate-700 bg-white px-3 py-2 border border-slate-200 rounded-xl shadow-2xs cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoAnalyzeOnSelect}
              onChange={(e) => onToggleAutoAnalyze(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
            />
            <span>
              {uiLang === 'id' ? 'Analisis otomatis saat dipilih' : 'Auto-analyze on upload'}
            </span>
          </label>
        </div>
      </div>

      {/* Error Alert Banner with One-Click Retry */}
      {errorMessage && (
        <div
          role="alert"
          className="p-4 bg-rose-50 border border-rose-200 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4"
        >
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div className="space-y-1 text-xs text-rose-950">
              <p className="font-bold text-sm text-rose-900">
                {uiLang === 'id' ? 'Kendala Analisis atau Input Gambar' : 'Analysis or Input Error'}
              </p>
              <p>{errorMessage}</p>
            </div>
          </div>
          {selectedImage && !isAnalyzing && (
            <button
              type="button"
              onClick={onTriggerAnalyze}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-rose-700 text-white text-xs font-semibold rounded-xl hover:bg-rose-800 transition-colors whitespace-nowrap shrink-0 self-start sm:self-center cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>{uiLang === 'id' ? 'Coba Analisis Ulang' : 'Retry Analysis'}</span>
            </button>
          )}
        </div>
      )}

      {/* Split Workspace: Left Acquisition & Context Controls + Right Image Preview & Execution */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Left Column: Image Input Controls + Clinical Context */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 flex flex-col justify-between space-y-5 shadow-2xs">
          <div className="space-y-5">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                {uiLang === 'id'
                  ? '1. Akuisisi Gambar Rekaman EKG'
                  : '1. Capture or Upload ECG Tracing'}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {uiLang === 'id'
                  ? 'Pilih kamera, unggah file, atau tempel tangkapan layar (Ctrl+V).'
                  : 'Choose camera, file upload, or clipboard screenshot paste (Ctrl+V).'}
              </p>
            </div>

            {/* Hidden File Inputs */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/jpg,image/png,image/webp"
              onChange={handleFileChange}
              className="hidden"
              aria-label="Upload ECG Image File"
            />
            <input
              ref={mobileCameraInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              onChange={handleFileChange}
              className="hidden"
              aria-label="Capture Photo with Device Camera"
            />

            {/* Primary Acquisition Action Buttons (3-way) */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <button
                type="button"
                disabled={isAnalyzing}
                onClick={onOpenCameraModal}
                className="flex items-center justify-center gap-2 px-3 py-2.5 bg-slate-900 text-white text-xs font-semibold rounded-xl hover:bg-slate-800 disabled:opacity-50 transition-colors cursor-pointer"
              >
                <Camera className="w-4 h-4 shrink-0 text-sky-400" />
                <span>{uiLang === 'id' ? 'Ambil Foto' : 'Take Photo'}</span>
              </button>

              <button
                type="button"
                disabled={isAnalyzing}
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center justify-center gap-2 px-3 py-2.5 bg-white border border-slate-300 text-slate-900 text-xs font-semibold rounded-xl hover:bg-slate-50 disabled:opacity-50 transition-colors cursor-pointer"
              >
                <Upload className="w-4 h-4 shrink-0 text-blue-600" />
                <span>{uiLang === 'id' ? 'Unggah File' : 'Upload File'}</span>
              </button>

              <button
                type="button"
                disabled={isAnalyzing}
                onClick={handleManualClipboardRead}
                className="flex items-center justify-center gap-2 px-3 py-2.5 bg-white border border-slate-300 text-slate-900 text-xs font-semibold rounded-xl hover:bg-slate-50 disabled:opacity-50 transition-colors cursor-pointer"
                title="Ctrl+V / Cmd+V"
              >
                <ClipboardPaste className="w-4 h-4 shrink-0 text-emerald-600" />
                <span>{uiLang === 'id' ? 'Tempel (Ctrl+V)' : 'Paste (Ctrl+V)'}</span>
              </button>
            </div>

            {/* Drag and Drop Area */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => !isAnalyzing && fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-5 text-center transition-all cursor-pointer ${
                isDragging
                  ? 'border-blue-600 bg-blue-50/60 scale-[1.01]'
                  : 'border-slate-300 bg-slate-50/70 hover:border-blue-400 hover:bg-slate-50'
              }`}
            >
              <FileImage className="w-7 h-7 text-slate-400 mx-auto mb-1.5" />
              <p className="text-xs font-bold text-slate-800">
                {uiLang === 'id'
                  ? 'Seret & lepas gambar EKG ke sini atau klik untuk memilih'
                  : 'Drag & drop an ECG image here or click to browse'}
              </p>
              <p className="text-[11px] text-slate-500 mt-1">
                {uiLang === 'id'
                  ? 'JPEG, JPG, PNG, WebP maks. 20 MB • 12-Lead & Strip Irama • Ctrl+V didukung'
                  : 'JPEG, JPG, PNG, WebP up to 20 MB • 12-Lead & Rhythm Strips • Ctrl+V supported'}
              </p>
            </div>

            {/* Optional Clinical Context Accordion */}
            <div className="border border-slate-200 rounded-2xl overflow-hidden bg-slate-50/60">
              <button
                type="button"
                onClick={() => setShowContextForm((v) => !v)}
                className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-slate-100/70 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <Stethoscope className="w-4 h-4 text-blue-600 shrink-0" />
                  <span className="text-xs font-bold text-slate-800">
                    {uiLang === 'id'
                      ? 'Konteks Klinis Pasien (Opsional)'
                      : 'Patient Clinical Context (Optional)'}
                  </span>
                  {hasActiveContext && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800">
                      {uiLang === 'id' ? 'Terisi' : 'Active'}
                    </span>
                  )}
                </div>
                {showContextForm ? (
                  <ChevronUp className="w-4 h-4 text-slate-500" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-slate-500" />
                )}
              </button>

              {showContextForm && (
                <div className="px-4 pb-4 pt-1 space-y-3 border-t border-slate-200/80 bg-white">
                  <p className="text-[11px] text-slate-500 leading-relaxed pt-2">
                    {uiLang === 'id'
                      ? 'Bantu AI mengkorelasikan morfologi gelombang EKG dengan keluhan klinis pasien (jangan masukkan NIK atau identitas rahasia pasien).'
                      : 'Help AI correlate ECG waveform morphology with clinical presentation (avoid entering patient names or protected identifiers).'}
                  </p>

                  {/* Quick Symptom Chips */}
                  <div className="flex flex-wrap gap-1.5">
                    {SYMPTOM_CHIPS[uiLang].map((chip) => {
                      const selected = (clinicalContext.symptoms || '').includes(chip);
                      return (
                        <button
                          key={chip}
                          type="button"
                          onClick={() => toggleSymptomChip(chip)}
                          className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors cursor-pointer ${
                            selected
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                          }`}
                        >
                          {chip}
                        </button>
                      );
                    })}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                        {uiLang === 'id' ? 'Usia & Jenis Kelamin' : 'Age & Sex'}
                      </label>
                      <input
                        type="text"
                        maxLength={60}
                        value={clinicalContext.patientAgeSex || ''}
                        onChange={(e) =>
                          onChangeClinicalContext({
                            ...clinicalContext,
                            patientAgeSex: e.target.value,
                          })
                        }
                        placeholder={uiLang === 'id' ? 'Misal: 58 th, Laki-laki' : 'e.g., 58yo Male'}
                        className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                        {uiLang === 'id' ? 'Riwayat / Obat Aktif' : 'History / Active Meds'}
                      </label>
                      <input
                        type="text"
                        maxLength={140}
                        value={clinicalContext.clinicalHistory || ''}
                        onChange={(e) =>
                          onChangeClinicalContext({
                            ...clinicalContext,
                            clinicalHistory: e.target.value,
                          })
                        }
                        placeholder={uiLang === 'id' ? 'Misal: HT, DM, Bisoprolol' : 'e.g., HTN, Beta-blocker'}
                        className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      {uiLang === 'id' ? 'Keluhan Utama / Gejala Klinis' : 'Chief Complaint / Symptoms'}
                    </label>
                    <input
                      type="text"
                      maxLength={180}
                      value={clinicalContext.symptoms || ''}
                      onChange={(e) =>
                        onChangeClinicalContext({
                          ...clinicalContext,
                          symptoms: e.target.value,
                        })
                      }
                      placeholder={
                        uiLang === 'id'
                          ? 'Misal: Nyeri dada kiri menjalar sejak 2 jam lalu, diaphoresis'
                          : 'e.g., Substernal chest pressure for 2 hours, diaphoresis'
                      }
                      className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Clinical Reference Test Strips for Immediate Verification */}
            <div className="pt-3 border-t border-slate-200 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-800">
                  {uiLang === 'id'
                    ? 'Simulasi Strip EKG 12-Lead Terkalibrasi'
                    : 'Calibrated 12-Lead Reference Test Strips'}
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-100 text-slate-600">
                  Live AI Vision
                </span>
              </div>
              <div className="grid grid-cols-1 gap-2">
                <button
                  type="button"
                  disabled={isAnalyzing}
                  onClick={() => onLoadSampleEcg('normal_sinus')}
                  className="text-left px-3 py-2 text-xs bg-slate-50 hover:bg-blue-50/50 border border-slate-200 hover:border-blue-300 rounded-xl flex items-center justify-between gap-2 transition-all disabled:opacity-50 cursor-pointer group"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                    <span className="font-semibold text-slate-800 truncate">
                      Normal Sinus Rhythm (74 bpm, 12-Lead)
                    </span>
                  </div>
                  <span className="font-mono text-[11px] text-blue-600 font-semibold group-hover:translate-x-0.5 transition-transform shrink-0">
                    {uiLang === 'id' ? 'Uji AI →' : 'Analyze →'}
                  </span>
                </button>

                <button
                  type="button"
                  disabled={isAnalyzing}
                  onClick={() => onLoadSampleEcg('inferior_stemi')}
                  className="text-left px-3 py-2 text-xs bg-slate-50 hover:bg-blue-50/50 border border-slate-200 hover:border-blue-300 rounded-xl flex items-center justify-between gap-2 transition-all disabled:opacity-50 cursor-pointer group"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0" />
                    <span className="font-semibold text-slate-800 truncate">
                      Acute Inferior STEMI Pattern (II, III, aVF)
                    </span>
                  </div>
                  <span className="font-mono text-[11px] text-blue-600 font-semibold group-hover:translate-x-0.5 transition-transform shrink-0">
                    {uiLang === 'id' ? 'Uji AI →' : 'Analyze →'}
                  </span>
                </button>

                <button
                  type="button"
                  disabled={isAnalyzing}
                  onClick={() => onLoadSampleEcg('atrial_fibrillation')}
                  className="text-left px-3 py-2 text-xs bg-slate-50 hover:bg-blue-50/50 border border-slate-200 hover:border-blue-300 rounded-xl flex items-center justify-between gap-2 transition-all disabled:opacity-50 cursor-pointer group"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                    <span className="font-semibold text-slate-800 truncate">
                      Atrial Fibrillation with RVR (122 bpm)
                    </span>
                  </div>
                  <span className="font-mono text-[11px] text-blue-600 font-semibold group-hover:translate-x-0.5 transition-transform shrink-0">
                    {uiLang === 'id' ? 'Uji AI →' : 'Analyze →'}
                  </span>
                </button>
              </div>
            </div>
          </div>

          {/* Primary Action Button: Analyze ECG */}
          <div className="pt-4 border-t border-slate-200">
            {isAnalyzing ? (
              <button
                type="button"
                onClick={onCancelAnalysis}
                className="w-full flex items-center justify-center gap-2 px-5 py-3.5 bg-rose-600 text-white text-sm font-bold rounded-xl hover:bg-rose-700 transition-colors cursor-pointer shadow-sm"
              >
                <XCircle className="w-4 h-4 shrink-0" />
                <span>
                  {uiLang === 'id' ? 'Batalkan Permintaan Analisis' : 'Cancel Analysis Request'}
                </span>
              </button>
            ) : (
              <button
                type="button"
                disabled={!selectedImage}
                onClick={onTriggerAnalyze}
                className={`w-full flex items-center justify-center gap-2 px-5 py-3.5 text-sm font-bold rounded-xl transition-all ${
                  selectedImage
                    ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-md shadow-blue-600/20 cursor-pointer'
                    : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                }`}
              >
                <Activity className="w-4 h-4 shrink-0" />
                <span>
                  {uiLang === 'id'
                    ? 'Jalankan Analisis EKG Multimodal'
                    : 'Run Multimodal ECG Analysis'}
                </span>
              </button>
            )}
          </div>
        </div>

        {/* Right Column: Clear Image Preview & Live Multi-Stage Analysis Progress */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 flex flex-col justify-between space-y-4 shadow-2xs">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                {uiLang === 'id'
                  ? '2. Pratinjau Rekaman EKG & Status Orientasi'
                  : '2. ECG Tracing Preview & Orientation Status'}
              </h2>
              <p className="text-xs text-slate-500 font-mono">
                {selectedImage
                  ? `${selectedImage.file.name} · ${selectedImage.width}×${selectedImage.height} px · ${(selectedImage.sizeBytes / 1024).toFixed(1)} KB`
                  : uiLang === 'id'
                    ? 'Belum ada gambar EKG yang dimuat'
                    : 'No ECG image loaded yet'}
              </p>
            </div>

            <div className="flex items-center gap-2">
              {selectedImage && !isAnalyzing && (
                <>
                  <button
                    type="button"
                    onClick={() => setPreviewRotation((r) => (r + 90) % 360)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
                    title={uiLang === 'id' ? 'Putar tampilan pratinjau 90°' : 'Rotate preview 90°'}
                  >
                    <RotateCw className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">90°</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsLightboxOpen(true)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors cursor-pointer"
                  >
                    <Maximize2 className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">
                      {uiLang === 'id' ? 'Inspeksi Zoom' : 'Inspect'}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={onClearImage}
                    className="px-2.5 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                  >
                    {uiLang === 'id' ? 'Hapus' : 'Remove'}
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Image Preview Viewport */}
          <div className="relative flex-1 min-h-[360px] ecg-dark-grid rounded-2xl border border-slate-800 flex items-center justify-center overflow-hidden">
            {selectedImage ? (
              <>
                <img
                  src={selectedImage.previewDataUrl}
                  alt="Uploaded ECG tracing preview"
                  referrerPolicy="no-referrer"
                  onClick={() => !isAnalyzing && setIsLightboxOpen(true)}
                  style={{ transform: `rotate(${previewRotation}deg)` }}
                  className={`max-h-[440px] w-auto object-contain transition-transform duration-200 ${
                    !isAnalyzing ? 'cursor-zoom-in' : ''
                  }`}
                />

                {isAnalyzing && (
                  <div className="absolute inset-0 bg-slate-950/88 backdrop-blur-xs flex flex-col items-center justify-center p-6 text-center space-y-5">
                    {/* Animated Scanning Progress Bar */}
                    <div className="w-full max-w-md space-y-2">
                      <div className="flex items-center justify-between text-xs font-mono">
                        <span className="text-sky-400 font-semibold flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-sky-400 animate-ping" />
                          {uiLang === 'id' ? 'MEMPROSES AI VISION' : 'AI VISION ANALYZING'}
                        </span>
                        <span className="text-slate-300 tabular-nums">
                          {String(Math.floor(elapsedSeconds / 60)).padStart(2, '0')}:
                          {String(elapsedSeconds % 60).padStart(2, '0')}s
                        </span>
                      </div>
                      <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                        <div className="h-full w-2/5 bg-gradient-to-r from-blue-500 via-sky-400 to-emerald-400 rounded-full animate-ecg-scan" />
                      </div>
                    </div>

                    <div className="space-y-1 max-w-md">
                      <p className="text-sm sm:text-base font-bold text-white">
                        {uiLang === 'id'
                          ? 'Menganalisis Morfologi EKG 12-Lead...'
                          : 'Analyzing 12-Lead ECG Morphology...'}
                      </p>
                      <p className="text-xs font-mono text-sky-300">{analysisStageText}</p>
                    </div>

                    {/* 4-Step Live Checklist */}
                    <div className="w-full max-w-md bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 text-left space-y-2 text-xs">
                      {[
                        uiLang === 'id'
                          ? '1. Verifikasi orientasi EXIF, kecepatan kertas & kalibrasi mV'
                          : '1. Verifying EXIF orientation, paper speed & mV calibration',
                        uiLang === 'id'
                          ? '2. Identifikasi label 12 sadapan (I–aVF, V1–V6) & strip irama'
                          : '2. Identifying 12 lead labels (I–aVF, V1–V6) & rhythm strip',
                        uiLang === 'id'
                          ? '3. Pengukuran laju jantung, interval PR/QRS/QTc & aksis listrik'
                          : '3. Measuring heart rate, PR/QRS/QTc intervals & electrical axis',
                        uiLang === 'id'
                          ? '4. Evaluasi pola iskemia/STEMI, aritmia & validasi deterministik'
                          : '4. Evaluating ischemia/STEMI, arrhythmias & deterministic validation',
                      ].map((stepLabel, idx) => {
                        const isDone = idx < activeStageIndex;
                        const isCurrent = idx === activeStageIndex;
                        return (
                          <div
                            key={stepLabel}
                            className={`flex items-center gap-2.5 ${
                              isDone
                                ? 'text-emerald-400'
                                : isCurrent
                                  ? 'text-white font-semibold'
                                  : 'text-slate-500'
                            }`}
                          >
                            {isDone ? (
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                            ) : isCurrent ? (
                              <div className="w-3.5 h-3.5 border-2 border-sky-400 border-t-transparent rounded-full animate-spin shrink-0" />
                            ) : (
                              <div className="w-3.5 h-3.5 rounded-full border border-slate-700 shrink-0" />
                            )}
                            <span className="truncate">{stepLabel}</span>
                          </div>
                        );
                      })}
                    </div>

                    <button
                      type="button"
                      onClick={onCancelAnalysis}
                      className="px-4 py-1.5 bg-white/10 hover:bg-white/20 text-white border border-white/20 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                    >
                      {uiLang === 'id' ? 'Batalkan Permintaan' : 'Cancel Request'}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center p-8 space-y-3 max-w-md">
                <div className="w-14 h-14 rounded-2xl bg-slate-900/90 border border-slate-800 flex items-center justify-center mx-auto text-sky-400 shadow-inner">
                  <Activity className="w-7 h-7" />
                </div>
                <p className="text-sm sm:text-base font-bold text-slate-200">
                  {uiLang === 'id'
                    ? 'Menunggu Foto atau Gambar Rekaman EKG'
                    : 'Awaiting ECG Photograph or Image Upload'}
                </p>
                <p className="text-xs text-slate-400 leading-relaxed">
                  {uiLang === 'id'
                    ? 'Ambil foto kertas EKG dengan kamera, unggah berkas gambar, tekan Ctrl+V dari clipboard, atau klik salah satu contoh simulasi 12-lead di sebelah kiri.'
                    : 'Take a photo with your camera, upload an ECG image, press Ctrl+V to paste a screenshot, or select a calibrated 12-lead sample strip on the left.'}
                </p>
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={onOpenCalculator}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 text-sky-300 border border-slate-700 text-xs font-semibold transition-colors cursor-pointer"
                  >
                    <Calculator className="w-3.5 h-3.5" />
                    <span>
                      {uiLang === 'id'
                        ? 'Buka Kalkulator Referensi QTc & Kotak EKG'
                        : 'Open QTc & ECG Grid Calculator'}
                    </span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Zero-Preprocessing Metadata Footer */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs pt-1">
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
              <div className="text-slate-500 font-mono uppercase text-[10px]">
                {uiLang === 'id' ? 'Penanganan Orientasi' : 'Orientation Handling'}
              </div>
              <div className="font-semibold text-slate-900 mt-0.5 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span className="truncate">
                  {selectedImage
                    ? selectedImage.orientationDescription
                    : 'Auto 0°/90°/180°/270° & Tilt'}
                </span>
              </div>
            </div>
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
              <div className="text-slate-500 font-mono uppercase text-[10px]">
                {uiLang === 'id' ? 'Integritas Gelombang' : 'Waveform Integrity'}
              </div>
              <div className="font-semibold text-slate-900 mt-0.5">
                {uiLang === 'id' ? 'Resolusi Asli Tanpa Filter' : 'Unmodified Original Sent'}
              </div>
            </div>
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
              <div className="text-slate-500 font-mono uppercase text-[10px]">
                {uiLang === 'id' ? 'Privasi Server' : 'Server Privacy'}
              </div>
              <div className="font-semibold text-slate-900 mt-0.5">
                {uiLang === 'id' ? 'Ephemeral (Tanpa Simpan Foto)' : 'Ephemeral Memory Processing'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Fullscreen Interactive Inspector for Previewing Before Analysis */}
      {selectedImage && (
        <EcgImageLightbox
          isOpen={isLightboxOpen}
          onClose={() => setIsLightboxOpen(false)}
          imageUrl={selectedImage.previewDataUrl}
          title={selectedImage.file.name}
          dimensionsText={`${selectedImage.width}×${selectedImage.height} px`}
          uiLang={uiLang}
        />
      )}
    </div>
  );
};

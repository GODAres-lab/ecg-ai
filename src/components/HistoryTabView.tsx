import React, { useState, useMemo } from 'react';
import {
  History,
  Search,
  Trash2,
  FileDown,
  ArrowRight,
  Clock,
  Activity,
  ShieldCheck,
  PlusCircle,
  Filter,
} from 'lucide-react';
import type { AnalysisHistoryItem, UiLanguage } from '../types/ecg';
import { classifyUrgencyBanner } from '../utils/ecgValidation';
import { exportEcgReportToPdf } from '../utils/pdfExporter';

interface HistoryTabViewProps {
  historyItems: AnalysisHistoryItem[];
  onSelectHistoryItem: (item: AnalysisHistoryItem) => void;
  onDeleteHistoryItem: (id: string) => void;
  onClearAllHistory: () => void;
  onStartNewAnalysis: () => void;
  uiLang: UiLanguage;
}

type UrgencyFilter = 'all' | 'urgent' | 'abnormal' | 'normal' | 'indeterminate';

export const HistoryTabView: React.FC<HistoryTabViewProps> = ({
  historyItems,
  onSelectHistoryItem,
  onDeleteHistoryItem,
  onClearAllHistory,
  onStartNewAnalysis,
  uiLang,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [urgencyFilter, setUrgencyFilter] = useState<UrgencyFilter>('all');
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  const filteredItems = useMemo(() => {
    return historyItems.filter((item) => {
      const u = item.report.urgency_level;
      if (urgencyFilter === 'urgent') {
        if (
          u !== 'Critical pattern requiring immediate emergency evaluation' &&
          u !== 'Potentially urgent abnormality'
        ) {
          return false;
        }
      } else if (urgencyFilter === 'abnormal') {
        if (u !== 'Abnormal ECG') return false;
      } else if (urgencyFilter === 'normal') {
        if (u !== 'Normal ECG appearance') return false;
      } else if (urgencyFilter === 'indeterminate') {
        if (u !== 'Indeterminate because of image quality or insufficient information') {
          return false;
        }
      }

      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      const primary = item.report.ai_interpretation.primary_interpretation.toLowerCase();
      const summary = item.report.executive_summary.toLowerCase();
      const file = (item.fileName || '').toLowerCase();
      const patientId = (item.report.recording_information.patient_identifier || '').toLowerCase();
      const symptoms = (item.clinicalContext?.symptoms || '').toLowerCase();

      return (
        primary.includes(q) ||
        summary.includes(q) ||
        file.includes(q) ||
        patientId.includes(q) ||
        symptoms.includes(q)
      );
    });
  }, [historyItems, searchQuery, urgencyFilter]);

  const getBadgeTone = (tone: ReturnType<typeof classifyUrgencyBanner>['tone']) => {
    switch (tone) {
      case 'rose':
        return 'bg-rose-100 text-rose-800 border-rose-300';
      case 'orange':
        return 'bg-orange-100 text-orange-800 border-orange-300';
      case 'amber':
        return 'bg-amber-100 text-amber-800 border-amber-300';
      case 'emerald':
        return 'bg-emerald-100 text-emerald-800 border-emerald-300';
      default:
        return 'bg-slate-100 text-slate-700 border-slate-300';
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      {/* Header Row */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-blue-600 mb-1">
            <History className="w-3.5 h-3.5" />
            <span>
              {uiLang === 'id'
                ? 'Arsip Laporan Interpretasi Klinis & Edukasi'
                : 'Clinical & Educational Interpretation Archive'}
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
            {uiLang === 'id' ? 'Riwayat Analisis EKG' : 'ECG Analysis History'}
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 mt-1">
            {uiLang === 'id'
              ? 'Buka kembali laporan 14-seksi lengkap, unduh PDF, atau tinjau parameter interval & irama dari analisis sebelumnya.'
              : 'Reopen complete 14-section reports, export PDFs, or review interval and rhythm parameters from prior analyses.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 self-start md:self-center">
          {historyItems.length > 0 && (
            <>
              {confirmClearAll ? (
                <div className="flex items-center gap-2 bg-rose-50 border border-rose-200 px-3 py-1.5 rounded-xl">
                  <span className="text-xs font-semibold text-rose-900">
                    {uiLang === 'id' ? 'Hapus semua?' : 'Clear all?'}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      onClearAllHistory();
                      setConfirmClearAll(false);
                    }}
                    className="px-2.5 py-1 bg-rose-600 text-white text-xs font-bold rounded-lg hover:bg-rose-700 cursor-pointer"
                  >
                    {uiLang === 'id' ? 'Ya, Hapus' : 'Yes, Clear'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmClearAll(false)}
                    className="px-2 py-1 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
                  >
                    {uiLang === 'id' ? 'Batal' : 'Cancel'}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmClearAll(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-rose-700 bg-white border border-rose-200 hover:bg-rose-50 rounded-xl transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{uiLang === 'id' ? 'Bersihkan Riwayat' : 'Clear History'}</span>
                </button>
              )}
            </>
          )}

          <button
            type="button"
            onClick={onStartNewAnalysis}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-xs transition-colors cursor-pointer"
          >
            <PlusCircle className="w-4 h-4" />
            <span>{uiLang === 'id' ? 'Analisis EKG Baru' : 'New ECG Analysis'}</span>
          </button>
        </div>
      </div>

      {/* Privacy Notice */}
      <div className="p-3.5 bg-white border border-slate-200 rounded-xl flex items-start sm:items-center gap-3 text-xs text-slate-600">
        <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5 sm:mt-0" />
        <p>
          <strong className="text-slate-800">
            {uiLang === 'id' ? 'Perlindungan Privasi Gambar:' : 'Image Privacy Protection:'}
          </strong>{' '}
          {uiLang === 'id'
            ? 'Foto asli EKG diproses secara sementara (ephemeral) di memori server dan tidak pernah disimpan permanen di database server. Pratinjau mini (thumbnail) hanya disimpan secara lokal di peramban perangkat Anda.'
            : 'Raw ECG photographs are processed ephemerally in server memory and never stored in the server database. Compact thumbnails are stored strictly in your local browser.'}
        </p>
      </div>

      {historyItems.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
            <History className="w-7 h-7" />
          </div>
          <div className="space-y-1 max-w-md mx-auto">
            <h2 className="text-base font-bold text-slate-900">
              {uiLang === 'id' ? 'Belum Ada Riwayat Analisis EKG' : 'No ECG Analysis History Yet'}
            </h2>
            <p className="text-xs text-slate-500 leading-relaxed">
              {uiLang === 'id'
                ? 'Setiap hasil interpretasi EKG 12-lead yang Anda jalankan akan otomatis tersimpan di sini agar mudah ditinjau kembali atau diekspor ke PDF.'
                : 'Every 12-lead ECG interpretation you run will automatically appear here for instant review or PDF export.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onStartNewAnalysis}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition-colors cursor-pointer"
          >
            <Activity className="w-4 h-4" />
            <span>{uiLang === 'id' ? 'Mulai Analisis EKG Pertama' : 'Start First ECG Analysis'}</span>
          </button>
        </div>
      ) : (
        <>
          {/* Search & Urgency Filter Bar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={
                  uiLang === 'id'
                    ? 'Cari diagnosis, irama, nama file, ID pasien...'
                    : 'Search diagnosis, rhythm, filename, patient ID...'
                }
                className="w-full pl-10 pr-4 py-2 text-xs sm:text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
              <Filter className="w-3.5 h-3.5 text-slate-400 shrink-0 mr-1" />
              {(
                [
                  { id: 'all', labelId: 'Semua', labelEn: 'All' },
                  { id: 'urgent', labelId: 'Kritis / Segera', labelEn: 'Urgent / Critical' },
                  { id: 'abnormal', labelId: 'Abnormal', labelEn: 'Abnormal' },
                  { id: 'normal', labelId: 'Normal', labelEn: 'Normal' },
                  { id: 'indeterminate', labelId: 'Indeterminate', labelEn: 'Indeterminate' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setUrgencyFilter(tab.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                    urgencyFilter === tab.id
                      ? 'bg-slate-900 text-white'
                      : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {uiLang === 'id' ? tab.labelId : tab.labelEn}
                </button>
              ))}
            </div>
          </div>

          {/* History Cards Grid */}
          {filteredItems.length === 0 ? (
            <div className="p-8 bg-white border border-slate-200 rounded-2xl text-center text-xs text-slate-500">
              {uiLang === 'id'
                ? 'Tidak ditemukan laporan yang cocok dengan filter pencarian Anda.'
                : 'No saved reports match your current search or filter.'}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {filteredItems.map((item) => {
                const urgency = classifyUrgencyBanner(item.report.urgency_level);
                return (
                  <div
                    key={item.id}
                    className="bg-white border border-slate-200 hover:border-blue-300 rounded-2xl p-4 sm:p-5 transition-all shadow-2xs hover:shadow-sm flex flex-col md:flex-row gap-4 justify-between"
                  >
                    <div className="flex flex-col sm:flex-row gap-4 flex-1 min-w-0">
                      {/* Compact Local Thumbnail if available */}
                      <div
                        onClick={() => onSelectHistoryItem(item)}
                        className="w-full sm:w-36 h-24 rounded-xl bg-slate-950 border border-slate-800 shrink-0 overflow-hidden flex items-center justify-center cursor-pointer group"
                      >
                        {item.thumbnailDataUrl ? (
                          <img
                            src={item.thumbnailDataUrl}
                            alt={item.fileName}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                          />
                        ) : (
                          <div className="text-center p-2">
                            <Activity className="w-5 h-5 text-sky-400 mx-auto mb-1" />
                            <span className="text-[10px] font-mono text-slate-400 block truncate max-w-[120px]">
                              12-Lead Report
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Report Details */}
                      <div className="space-y-2 flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${getBadgeTone(
                              urgency.tone
                            )}`}
                          >
                            <span>{urgency.glyph}</span>
                            <span>{item.report.urgency_level}</span>
                          </span>
                          <span className="inline-flex items-center gap-1 text-[11px] font-mono text-slate-500">
                            <Clock className="w-3 h-3" />
                            {new Date(item.analyzedAt).toLocaleString(
                              uiLang === 'id' ? 'id-ID' : 'en-US',
                              {
                                day: '2-digit',
                                month: 'short',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              }
                            )}
                          </span>
                          <span className="text-[11px] font-mono text-slate-400 truncate">
                            • {item.fileName}
                          </span>
                        </div>

                        <h3
                          onClick={() => onSelectHistoryItem(item)}
                          className="text-sm sm:text-base font-bold text-slate-900 hover:text-blue-600 cursor-pointer line-clamp-1"
                        >
                          {item.report.ai_interpretation.primary_interpretation}
                        </h3>

                        <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">
                          {item.report.executive_summary}
                        </p>

                        {/* Quick Clinical Metrics Pills */}
                        <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px] font-mono">
                          <span className="px-2 py-0.5 bg-slate-100 text-slate-800 rounded-md">
                            HR: <strong>{item.report.heart_rate.ventricular_rate_bpm.value}</strong>{' '}
                            {item.report.heart_rate.ventricular_rate_bpm.unit}
                          </span>
                          <span className="px-2 py-0.5 bg-slate-100 text-slate-800 rounded-md">
                            QRS: <strong>{item.report.intervals.qrs_duration_ms.value}</strong> ms
                          </span>
                          <span className="px-2 py-0.5 bg-slate-100 text-slate-800 rounded-md">
                            QTc: <strong>{item.report.intervals.qtc_interval_ms.value}</strong> ms
                          </span>
                          <span className="px-2 py-0.5 bg-slate-100 text-slate-800 rounded-md">
                            Axis: <strong>{item.report.electrical_axis.qrs_axis.value}</strong>
                            {item.report.electrical_axis.qrs_axis.unit}
                          </span>
                          {item.clinicalContext?.symptoms && (
                            <span className="px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-200/70 rounded-md font-sans truncate max-w-[220px]">
                              {item.clinicalContext.symptoms}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Right Action Column */}
                    <div className="flex sm:flex-row md:flex-col items-center md:items-end justify-end gap-2 shrink-0 border-t md:border-t-0 border-slate-100 pt-3 md:pt-0">
                      <button
                        type="button"
                        onClick={() => onSelectHistoryItem(item)}
                        className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl transition-colors cursor-pointer"
                      >
                        <span>{uiLang === 'id' ? 'Buka Laporan' : 'Open Report'}</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            exportEcgReportToPdf(item.report, {
                              includeOriginalImage: Boolean(item.thumbnailDataUrl),
                              imagePreviewDataUrl: item.thumbnailDataUrl,
                            })
                          }
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                          title={uiLang === 'id' ? 'Unduh PDF' : 'Export PDF'}
                        >
                          <FileDown className="w-3.5 h-3.5" />
                          <span>PDF</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => onDeleteHistoryItem(item.id)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                          title={uiLang === 'id' ? 'Hapus dari riwayat' : 'Delete from history'}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
};


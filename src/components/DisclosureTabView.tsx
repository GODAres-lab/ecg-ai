import React from 'react';
import { ShieldCheck, AlertTriangle, RotateCcw, ArrowRight } from 'lucide-react';
import type { ConsentRecord, UiLanguage } from '../types/ecg';
import { DISCLAIMER_TRANSLATION } from '../utils/i18n';

interface DisclosureTabViewProps {
  consentRecord: ConsentRecord | null;
  onRevokeConsent: () => void;
  onProceedToAnalyzer: () => void;
  uiLang?: UiLanguage;
}

export const DisclosureTabView: React.FC<DisclosureTabViewProps> = ({
  consentRecord,
  onRevokeConsent,
  onProceedToAnalyzer,
  uiLang = 'id',
}) => {
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div className="border-b border-slate-200 pb-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <p className="text-xs font-mono uppercase tracking-wider text-blue-600 mb-1">
            {uiLang === 'id'
              ? 'Tata Kelola Keselamatan Klinis, Privasi & Edukasi'
              : 'Regulatory, Safety & Educational Governance'}
          </p>
          <h1 className="text-2xl font-bold text-slate-900">
            {uiLang === 'id'
              ? 'Kepatuhan Medis, Batasan AI & Persetujuan Pengguna'
              : 'Educational Purpose Disclosure & Informed Consent'}
          </h1>
        </div>
        <button
          type="button"
          onClick={onProceedToAnalyzer}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-xs font-semibold rounded-xl hover:bg-blue-700 transition-colors whitespace-nowrap self-start cursor-pointer"
        >
          <span>{uiLang === 'id' ? 'Kembali ke Workspace EKG' : 'Go to ECG Workspace'}</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>

      {/* Mandatory Medical Disclaimer Callout */}
      <section className="p-5 bg-white border border-slate-200 rounded-2xl space-y-3 shadow-2xs">
        <div className="flex items-center gap-2 text-amber-700 font-bold text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>
            {uiLang === 'id'
              ? 'Pernyataan Keselamatan Klinis & Edukasi Wajib'
              : 'Mandatory Clinical Support & Educational Disclaimer'}
          </span>
        </div>
        <p className="text-xs sm:text-sm text-slate-900 font-medium leading-relaxed bg-amber-50/60 p-4 rounded-xl border border-amber-200/80">
          "{DISCLAIMER_TRANSLATION[uiLang]}"
        </p>
      </section>

      {/* Active User Consent Status */}
      <section className="p-5 bg-white border border-slate-200 rounded-2xl space-y-4 shadow-2xs">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0" />
            <h2 className="text-base font-bold text-slate-900">
              {uiLang === 'id'
                ? 'Status Persetujuan Sesi Anda'
                : 'Your Active Disclosure & Consent Status'}
            </h2>
          </div>
          {consentRecord?.acknowledged && (
            <button
              type="button"
              onClick={onRevokeConsent}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>
                {uiLang === 'id'
                  ? 'Tinjau Ulang Dialog Persetujuan'
                  : 'Re-Open Consent Dialog'}
              </span>
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl">
            <div className="text-slate-500 font-mono uppercase mb-1">
              {uiLang === 'id' ? 'Status Persetujuan' : 'Consent State'}
            </div>
            <div className="font-bold text-emerald-700">
              {consentRecord?.acknowledged
                ? uiLang === 'id'
                  ? '● Disetujui & Aktif'
                  : '● Acknowledged & Active'
                : uiLang === 'id'
                  ? '▲ Menunggu Persetujuan'
                  : '▲ Pending User Consent'}
            </div>
            {consentRecord?.timestamp && (
              <div className="text-slate-500 font-mono mt-1 text-[11px]">
                {new Date(consentRecord.timestamp).toLocaleString(
                  uiLang === 'id' ? 'id-ID' : 'en-US'
                )}
              </div>
            )}
          </div>
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl">
            <div className="text-slate-500 font-mono uppercase mb-1">
              {uiLang === 'id' ? 'Cakupan Penggunaan' : 'Intended Use Scope'}
            </div>
            <div className="font-bold text-slate-900">
              {uiLang === 'id'
                ? 'Edukasi & Dukungan Keputusan Klinis'
                : 'Educational & Clinical Decision Support'}
            </div>
            <div className="text-slate-500 mt-1">
              {uiLang === 'id'
                ? 'Bukan untuk diagnosis primer atau keputusan terapi otonom'
                : 'Not for primary diagnosis or autonomous treatment decisions'}
            </div>
          </div>
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl">
            <div className="text-slate-500 font-mono uppercase mb-1">
              {uiLang === 'id' ? 'Retensi Gambar Server' : 'Server Image Retention'}
            </div>
            <div className="font-bold text-slate-900">
              {uiLang === 'id' ? 'Nol Penyimpanan Foto Permanen' : 'Zero Persistent Image Storage'}
            </div>
            <div className="text-slate-500 mt-1">
              {uiLang === 'id'
                ? 'Gambar dianalisis sementara di memori dan langsung dibuang'
                : 'Images analyzed ephemerally in memory and immediately discarded'}
            </div>
          </div>
        </div>
      </section>

      {/* Detailed Principles */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <section className="p-5 bg-white border border-slate-200 rounded-2xl space-y-3 shadow-2xs">
          <h3 className="text-sm font-bold text-slate-900">
            {uiLang === 'id'
              ? '1. Mengapa Alat Ini Bersifat Edukatif & Non-Diagnostik'
              : '1. Why This Tool Is Strictly Educational & Non-Diagnostic'}
          </h3>
          <ul className="space-y-2 text-xs text-slate-700 leading-relaxed list-disc pl-4">
            <li>
              {uiLang === 'id' ? (
                <>
                  <strong>Variabilitas Optik Kamera:</strong> Foto ponsel pada kertas EKG termal dapat mengalami distorsi perspektif, lengkungan kertas, pencahayaan tidak merata, dan variasi rasio piksel-ke-milimeter.
                </>
              ) : (
                <>
                  <strong>Optical Acquisition Variability:</strong> Smartphone photographs of thermal ECG paper introduce perspective skew, curvature, uneven lighting, and variable pixel-to-millimeter ratios.
                </>
              )}
            </li>
            <li>
              {uiLang === 'id' ? (
                <>
                  <strong>Kebutuhan Integrasi Klinis Menyeluruh:</strong> Gelombang EKG wajib diinterpretasikan bersama keluhan pasien, stabilitas hemodinamik, enzim jantung (troponin serial), dan EKG pembanding sebelumnya.
                </>
              ) : (
                <>
                  <strong>Full Clinical Integration Required:</strong> Waveforms cannot be interpreted in isolation from symptoms, hemodynamics, serial troponin biomarkers, and prior baseline ECGs.
                </>
              )}
            </li>
            <li>
              {uiLang === 'id' ? (
                <>
                  <strong>Tampilan Normal Tidak Menyingkirkan Patologi:</strong> Pasien fase awal sindrom koroner akut atau angina tidak stabil dapat menunjukkan rekaman EKG 12-lead awal yang tampak normal.
                </>
              ) : (
                <>
                  <strong>Normal Appearance Does Not Rule Out Pathology:</strong> Early acute myocardial infarction or unstable angina may present with an initially normal 12-lead ECG.
                </>
              )}
            </li>
          </ul>
        </section>

        <section className="p-5 bg-white border border-slate-200 rounded-2xl space-y-3 shadow-2xs">
          <h3 className="text-sm font-bold text-slate-900">
            {uiLang === 'id'
              ? '2. Integritas Pengukuran & Aturan Anti-Fabrikasi'
              : '2. Measurement Integrity & Anti-Fabrication Rules'}
          </h3>
          <ul className="space-y-2 text-xs text-slate-700 leading-relaxed list-disc pl-4">
            <li>
              {uiLang === 'id' ? (
                <>
                  <strong>Transparansi Sumber Angka:</strong> Setiap parameter (HR, PR, QRS, QT, QTc, Aksis) diberi label sumber: <code>Printed on ECG</code>, <code>Visually Estimated</code>, <code>AI Calculated</code>, atau <code>Unmeasurable</code>.
                </>
              ) : (
                <>
                  <strong>Provenance Transparency:</strong> Every numerical interval is tagged as <code>Printed on ECG</code>, <code>Visually Estimated</code>, <code>AI Calculated</code>, or <code>Unmeasurable</code>.
                </>
              )}
            </li>
            <li>
              {uiLang === 'id' ? (
                <>
                  <strong>Tanpa Asumsi Kalibrasi Buta:</strong> Bila kecepatan kertas 25 mm/s atau kalibrasi 10 mm/mV tidak tercetak jelas, AI melaporkan ketidakpastian kalibrasi secara eksplisit.
                </>
              ) : (
                <>
                  <strong>No Unverified Calibration Assumptions:</strong> If 25 mm/s speed or 10 mm/mV gain is illegible, calibration uncertainty is explicitly reported.
                </>
              )}
            </li>
            <li>
              {uiLang === 'id' ? (
                <>
                  <strong>Audit Independen Teks Mesin EKG:</strong> Teks otomatis yang tercetak pada header mesin EKG diekstraksi terpisah dan dibandingkan secara kritis terhadap morfologi gelombang.
                </>
              ) : (
                <>
                  <strong>Independent Machine Header Audit:</strong> Automated text printed on the ECG header is extracted separately and critically compared against actual waveforms.
                </>
              )}
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
};

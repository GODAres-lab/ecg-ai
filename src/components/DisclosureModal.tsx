import React, { useState } from 'react';
import { ShieldAlert, CheckSquare, BookOpen, AlertTriangle } from 'lucide-react';
import type { ConsentRecord, UiLanguage } from '../types/ecg';
import { DISCLAIMER_TRANSLATION } from '../utils/i18n';

interface DisclosureModalProps {
  onAcceptConsent: (record: ConsentRecord) => void;
  uiLang?: UiLanguage;
  onChangeUiLang?: (lang: UiLanguage) => void;
}

export const DisclosureModal: React.FC<DisclosureModalProps> = ({
  onAcceptConsent,
  uiLang = 'id',
  onChangeUiLang,
}) => {
  const [eduChecked, setEduChecked] = useState(false);
  const [nonDiagChecked, setNonDiagChecked] = useState(false);
  const [clinicianChecked, setClinicianChecked] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState<'overview' | 'limitations' | 'privacy'>('overview');

  const allChecked = eduChecked && nonDiagChecked && clinicianChecked;

  const handleConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!allChecked) return;
    onAcceptConsent({
      acknowledged: true,
      timestamp: new Date().toISOString(),
      educationalPurposeAccepted: true,
      nonDiagnosticAccepted: true,
      clinicianReviewAccepted: true,
    });
  };

  const handleCheckAll = () => {
    setEduChecked(true);
    setNonDiagChecked(true);
    setClinicianChecked(true);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="disclosure-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/75 backdrop-blur-xs p-4 overflow-y-auto"
    >
      <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-3xl shadow-2xl overflow-hidden my-8">
        {/* Top Header */}
        <div className="px-6 py-5 bg-slate-900 text-white flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-amber-400 text-xs font-mono uppercase tracking-wider mb-1">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              <span>
                {uiLang === 'id'
                  ? 'Persetujuan Wajib Penggunaan Edukasi & Dukungan Klinis'
                  : 'Mandatory Educational & Clinical Support Disclosure'}
              </span>
            </div>
            <h1 id="disclosure-modal-title" className="text-lg sm:text-xl font-bold tracking-tight text-white">
              {uiLang === 'id'
                ? 'AI ECG Analyzer — Pernyataan Keselamatan Medis'
                : 'AI ECG Analyzer — Educational Use & User Consent'}
            </h1>
            <p className="text-xs text-slate-300 mt-1">
              {uiLang === 'id'
                ? 'Harap tinjau ketentuan keselamatan klinis di bawah ini sebelum mengakses workspace analisis EKG.'
                : 'Please review the clinical safety disclosures below and confirm your acknowledgment before proceeding.'}
            </p>
          </div>

          {onChangeUiLang && (
            <div className="inline-flex bg-slate-800 p-0.5 rounded-lg text-[11px] font-bold shrink-0">
              <button
                type="button"
                onClick={() => onChangeUiLang('id')}
                className={`px-2 py-1 rounded-md cursor-pointer ${
                  uiLang === 'id' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                ID
              </button>
              <button
                type="button"
                onClick={() => onChangeUiLang('en')}
                className={`px-2 py-1 rounded-md cursor-pointer ${
                  uiLang === 'en' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                EN
              </button>
            </div>
          )}
        </div>

        {/* Disclosure Tabs inside the Opening Gate */}
        <div className="flex border-b border-slate-200 bg-slate-50 px-6 gap-5 overflow-x-auto" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeSubTab === 'overview'}
            onClick={() => setActiveSubTab('overview')}
            className={`py-3 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
              activeSubTab === 'overview'
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            {uiLang === 'id' ? '1. Tujuan Edukasi & Disclaimer' : '1. Educational Purpose'}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeSubTab === 'limitations'}
            onClick={() => setActiveSubTab('limitations')}
            className={`py-3 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
              activeSubTab === 'limitations'
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            {uiLang === 'id' ? '2. Batasan Non-Diagnostik' : '2. Non-Diagnostic Scope'}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeSubTab === 'privacy'}
            onClick={() => setActiveSubTab('privacy')}
            className={`py-3 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
              activeSubTab === 'privacy'
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            {uiLang === 'id' ? '3. Privasi & Keamanan Data' : '3. Privacy & Data Handling'}
          </button>
        </div>

        {/* Tab Panel Content */}
        <div className="p-6 space-y-4 text-sm text-slate-700 leading-relaxed">
          {activeSubTab === 'overview' && (
            <div className="space-y-3">
              <div className="p-4 bg-amber-50/90 border border-amber-200 rounded-2xl text-slate-900">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold text-xs uppercase tracking-wide text-amber-900 mb-1">
                      {uiLang === 'id' ? 'Peringatan Medis Wajib' : 'Mandatory Medical Disclaimer'}
                    </p>
                    <p className="text-xs sm:text-sm font-medium text-slate-900">
                      "{DISCLAIMER_TRANSLATION[uiLang]}"
                    </p>
                  </div>
                </div>
              </div>
              <p className="text-xs sm:text-sm">
                {uiLang === 'id' ? (
                  <>
                    <strong>Khusus Edukasi & Dukungan Keputusan Klinis:</strong> Aplikasi ini menggunakan kecerdasan buatan multimodal untuk membantu pembacaan sistematis rekaman EKG 12-lead dalam pembelajaran medis dan dukungan evaluasi klinis.
                  </>
                ) : (
                  <>
                    <strong>Educational & Clinical Support Purpose Only:</strong> This application uses multimodal artificial intelligence to examine uploaded or photographed ECG tracings for medical education and structured clinical decision support.
                  </>
                )}
              </p>
              <p className="text-xs sm:text-sm">
                {uiLang === 'id' ? (
                  <>
                    <strong>Bukan Alat Medis Diagnostik Mandiri:</strong> Pembacaan visual otomatis dapat salah mengartikan garis grid kertas termal, bayangan kamera, artefak, atau perubahan halus segmen ST-T.
                  </>
                ) : (
                  <>
                    <strong>Not a Standalone Medical Device:</strong> Automated multimodal readings can misinterpret optical grid lines, camera perspective, artifacts, or subtle ST-T waveform abnormalities.
                  </>
                )}
              </p>
            </div>
          )}

          {activeSubTab === 'limitations' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 font-bold text-slate-900 text-xs sm:text-sm">
                <BookOpen className="w-4 h-4 text-blue-600 shrink-0" />
                <span>
                  {uiLang === 'id'
                    ? 'Aturan Keselamatan Klinis & Batasan Teknis'
                    : 'Clinical Safety Rules & Limitations'}
                </span>
              </div>
              <ul className="list-disc pl-5 space-y-1.5 text-xs text-slate-700">
                <li>
                  {uiLang === 'id' ? (
                    <>
                      <strong>EKG Normal Tidak Menyingkirkan Penyakit Jantung:</strong> Klasifikasi "Normal ECG appearance" <em>tidak</em> menyingkirkan sindrom koroner akut (SKA/ACS), iskemia miokard, atau aritmia paroksismal.
                    </>
                  ) : (
                    <>
                      <strong>No False Reassurance:</strong> A normal-appearing ECG does <em>not</em> exclude acute coronary syndrome (ACS), myocardial ischemia, or paroxysmal arrhythmias.
                    </>
                  )}
                </li>
                <li>
                  {uiLang === 'id' ? (
                    <>
                      <strong>Tanpa Peresepan Obat Otomatis:</strong> Sistem ini tidak pernah meresepkan dosis obat atau terapi otonom.
                    </>
                  ) : (
                    <>
                      <strong>No Automated Prescriptions:</strong> This tool never prescribes medications or autonomous treatment regimens.
                    </>
                  )}
                </li>
                <li>
                  {uiLang === 'id' ? (
                    <>
                      <strong>Kondisi Gawat Darurat:</strong> Bila pasien mengalami nyeri dada, sesak napas, sinkop, atau instabilitas hemodinamik, segera lakukan penanganan gawat darurat medis.
                    </>
                  ) : (
                    <>
                      <strong>Medical Emergencies:</strong> If chest pain, dyspnea, syncope, or hemodynamic instability is present, seek emergency medical care immediately.
                    </>
                  )}
                </li>
              </ul>
            </div>
          )}

          {activeSubTab === 'privacy' && (
            <div className="space-y-3">
              <p className="font-bold text-slate-900 text-xs sm:text-sm">
                {uiLang === 'id'
                  ? 'Pemrosesan Ephemeral & Perlindungan Privasi Pasien'
                  : 'Ephemeral Processing & Patient Privacy Protection'}
              </p>
              <ul className="list-disc pl-5 space-y-1.5 text-xs text-slate-700">
                <li>
                  {uiLang === 'id' ? (
                    <>
                      <strong>Tanpa Penyimpanan Foto di Server:</strong> Gambar EKG yang diunggah diproses sesaat di memori server hanya untuk menghasilkan laporan interpretasi dan langsung dihapus setelah respons selesai.
                    </>
                  ) : (
                    <>
                      <strong>No Permanent Server Image Storage:</strong> Uploaded ECG images are processed ephemerally in server memory and never stored in a persistent server database.
                    </>
                  )}
                </li>
                <li>
                  {uiLang === 'id' ? (
                    <>
                      <strong>Anjuran De-Identifikasi:</strong> Disarankan menutup nama lengkap atau nomor rekam medis pasien pada kertas EKG sebelum memotret untuk tujuan pembelajaran.
                    </>
                  ) : (
                    <>
                      <strong>De-Identification Recommended:</strong> Cover patient names or medical record numbers before photographing an ECG for educational study.
                    </>
                  )}
                </li>
              </ul>
            </div>
          )}

          {/* User Consent Form */}
          <form onSubmit={handleConfirm} className="pt-3 border-t border-slate-200 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                {uiLang === 'id'
                  ? 'Konfirmasi Persetujuan Pengguna'
                  : 'Required User Consent Acknowledgment'}
              </span>
              <button
                type="button"
                onClick={handleCheckAll}
                className="text-xs font-semibold text-blue-600 hover:text-blue-800 underline cursor-pointer"
              >
                {uiLang === 'id' ? 'Centang Semua' : 'Select All'}
              </button>
            </div>

            <label className="flex items-start gap-3 p-3 rounded-xl border border-slate-200 hover:bg-slate-50 cursor-pointer">
              <input
                type="checkbox"
                checked={eduChecked}
                onChange={(e) => setEduChecked(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
              />
              <span className="text-xs text-slate-800">
                {uiLang === 'id' ? (
                  <>
                    Saya memahami aplikasi ini disediakan <strong>khusus untuk edukasi medis dan dukungan keputusan klinis</strong>, bukan sebagai alat diagnosis klinis mandiri.
                  </>
                ) : (
                  <>
                    I understand that this application is provided <strong>strictly for educational and clinical support purposes</strong> and not for standalone clinical diagnosis.
                  </>
                )}
              </span>
            </label>

            <label className="flex items-start gap-3 p-3 rounded-xl border border-slate-200 hover:bg-slate-50 cursor-pointer">
              <input
                type="checkbox"
                checked={nonDiagChecked}
                onChange={(e) => setNonDiagChecked(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
              />
              <span className="text-xs text-slate-800">
                {uiLang === 'id' ? (
                  <>
                    Saya menyadari interpretasi AI <strong>dapat mengandung kekeliruan</strong>, tampilan EKG normal tidak menyingkirkan penyakit jantung serius, dan tidak boleh dijadikan satu-satunya dasar terapi.
                  </>
                ) : (
                  <>
                    I acknowledge that AI-generated ECG interpretations <strong>may contain errors</strong>, a normal-appearing ECG does not exclude cardiac disease, and it must not be the sole basis for treatment.
                  </>
                )}
              </span>
            </label>

            <label className="flex items-start gap-3 p-3 rounded-xl border border-slate-200 hover:bg-slate-50 cursor-pointer">
              <input
                type="checkbox"
                checked={clinicianChecked}
                onChange={(e) => setClinicianChecked(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
              />
              <span className="text-xs text-slate-800">
                {uiLang === 'id' ? (
                  <>
                    Saya setuju bahwa setiap rekaman EKG wajib <strong>ditinjau oleh dokter/tenaga medis berwenang</strong>, serta segera mencari evaluasi gawat darurat jika dicurigai kondisi jantung akut.
                  </>
                ) : (
                  <>
                    I agree that all ECG tracings must be <strong>reviewed by a qualified healthcare professional</strong>, and immediate emergency evaluation must be sought if an urgent condition is suspected.
                  </>
                )}
              </span>
            </label>

            <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-3">
              <span className="text-xs text-slate-500">
                {allChecked
                  ? uiLang === 'id'
                    ? 'Seluruh pernyataan telah disetujui. Siap melanjutkan.'
                    : 'All disclosures acknowledged. Ready to proceed.'
                  : uiLang === 'id'
                    ? 'Centang ketiga kotak di atas untuk membuka AI ECG Analyzer.'
                    : 'Please check all three boxes above to unlock the ECG Analyzer.'}
              </span>
              <button
                type="submit"
                disabled={!allChecked}
                className={`w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
                  allChecked
                    ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-md shadow-blue-500/20 cursor-pointer'
                    : 'bg-slate-200 text-slate-500 cursor-not-allowed'
                }`}
              >
                <CheckSquare className="w-4 h-4 shrink-0" />
                <span>
                  {uiLang === 'id' ? 'Setuju & Masuk ke Workspace' : 'Acknowledge & Enter Workspace'}
                </span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

import type { UiLanguage } from '../types/ecg';

const UI_LANG_STORAGE_KEY = 'ai_ecg_ui_language_v1';

export function getSavedUiLanguage(): UiLanguage {
  try {
    const saved = localStorage.getItem(UI_LANG_STORAGE_KEY);
    if (saved === 'id' || saved === 'en') {
      return saved;
    }
  } catch {
    // Ignore storage access errors
  }
  return 'id';
}

export function saveUiLanguage(lang: UiLanguage): void {
  try {
    localStorage.setItem(UI_LANG_STORAGE_KEY, lang);
  } catch {
    // Ignore storage access errors
  }
}

export const DISCLAIMER_TRANSLATION = {
  id: 'Interpretasi EKG berbasis AI ini ditujukan khusus untuk dukungan keputusan klinis dan edukasi medis. Hasil dapat mengandung kekeliruan dan wajib ditinjau oleh dokter atau tenaga medis yang berwenang. Jangan digunakan sebagai satu-satunya dasar diagnosis atau terapi. Jika dicurigai kondisi jantung darurat, segera cari pertolongan medis gawat darurat.',
  en: 'This AI-generated ECG interpretation is for clinical support and educational purposes. It may contain errors and must be reviewed by a qualified healthcare professional. It must not be used as the sole basis for diagnosis or treatment. If a serious or urgent cardiac condition is suspected, seek immediate medical evaluation.',
} as const;


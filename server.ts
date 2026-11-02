import 'dotenv/config';
import express from 'express';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type, Schema, MediaResolution } from '@google/genai';
import {
  validateImageInput,
  validateAndCrossCheckEcgResponse,
} from './src/utils/ecgValidation.ts';
import {
  hammingDistanceHex,
  type EcgPixelTelemetry,
} from './src/utils/ecgSignalDsp.ts';
import type { DiagnosticImageTile } from './src/utils/imageProcessor.ts';
import type {
  AnalysisMode,
  EcgAnalysisReport,
  VerificationMetadata,
} from './src/types/ecg.ts';
import { db } from './server/db.ts';
import {
  hashPassword,
  verifyPassword,
  generateToken,
  getAuthenticatedUser,
  sanitizeUser,
} from './server/auth.ts';
import { SUBSCRIPTION_PLANS, getPlanById } from './server/plans.ts';
import {
  createMidtransSnapTransaction,
  verifyMidtransSignature,
  checkMidtransOrderStatus,
  getMidtransConfig,
} from './server/midtrans.ts';
import {
  createRateLimiter,
  securityHeadersMiddleware,
  isValidEmail,
  isValidDeviceId,
  sanitizeText,
} from './server/security.ts';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const DETERMINISTIC_SEED = 424242;

/**
 * Resolves the effective high-precision Gemini 2.5+ model.
 * Auto-upgrades legacy `gemini-2.0-*` / `gemini-1.5-*` or invalid `gemini-3.5+` overrides
 * left in older `.env` files unless `ALLOW_LEGACY_GEMINI_MODEL=true` is explicitly set.
 */
function resolvePrecisionGeminiModel(): string {
  const configured = (process.env.GEMINI_MODEL || '').trim();
  if (!configured) {
    return DEFAULT_GEMINI_MODEL;
  }
  const isLegacyOrInvalid = /^(gemini-1\.5|gemini-2\.0|gemini-3\.[56789])/i.test(configured);
  if (isLegacyOrInvalid && process.env.ALLOW_LEGACY_GEMINI_MODEL !== 'true') {
    return DEFAULT_GEMINI_MODEL;
  }
  return configured;
}

// Privacy-Safe Ephemeral Dual-Layer Reproducibility Cache
// Stores SHA-256 + 256-bit perceptual dHash -> JSON report ONLY (ZERO patient image bytes stored)
interface DeterministicCacheEntry {
  report: EcgAnalysisReport;
  modelUsed: string;
  dualPassCompleted: boolean;
  mathChecksApplied: string[];
  cachedAt: number;
  contextSignature: string;
  perceptualHash256?: string;
  aspectRatio?: number;
  rhythmPeakCount?: number;
}

const DETERMINISTIC_CACHE_MAX = 150;
const DETERMINISTIC_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const deterministicReportCache = new Map<string, DeterministicCacheEntry>();

function buildCacheContextSignature(params: {
  reportLanguage: 'id' | 'en';
  analysisMode: AnalysisMode;
  clinicalContext?: {
    patientAgeSex?: string;
    symptoms?: string;
    clinicalHistory?: string;
  };
}): string {
  return `${params.reportLanguage}|${params.analysisMode}|${JSON.stringify(params.clinicalContext || null)}`;
}

function computeDeterministicInputHash(params: {
  mimeType: string;
  imageBase64: string;
  reportLanguage: 'id' | 'en';
  analysisMode: AnalysisMode;
  clinicalContext?: {
    patientAgeSex?: string;
    symptoms?: string;
    clinicalHistory?: string;
  };
}): string {
  const hasher = crypto.createHash('sha256');
  hasher.update(params.mimeType);
  hasher.update('|');
  hasher.update(buildCacheContextSignature(params));
  hasher.update('|');
  hasher.update(params.imageBase64);
  return hasher.digest('hex');
}

function findCachedDeterministicAnalysis(params: {
  exactFingerprint: string;
  contextSignature: string;
  pixelTelemetry?: EcgPixelTelemetry;
}): { entry: DeterministicCacheEntry; matchType: 'sha256' | 'perceptual256' } | null {
  const now = Date.now();
  const exact = deterministicReportCache.get(params.exactFingerprint);
  if (exact) {
    if (now - exact.cachedAt > DETERMINISTIC_CACHE_TTL_MS) {
      deterministicReportCache.delete(params.exactFingerprint);
    } else {
      return { entry: exact, matchType: 'sha256' };
    }
  }

  const pHash = params.pixelTelemetry?.perceptualHash256;
  if (!pHash || pHash.length !== 64 || /^0+$/.test(pHash)) {
    return null;
  }

  const width = params.pixelTelemetry?.imageWidth || 0;
  const height = params.pixelTelemetry?.imageHeight || 0;
  const aspectRatio = width > 0 && height > 0 ? width / height : 0;
  const peakCount = params.pixelTelemetry?.rhythmPeakCount || 0;

  let bestMatch: DeterministicCacheEntry | null = null;
  let bestDist = 999;

  for (const [key, candidate] of deterministicReportCache.entries()) {
    if (now - candidate.cachedAt > DETERMINISTIC_CACHE_TTL_MS) {
      deterministicReportCache.delete(key);
      continue;
    }
    if (candidate.contextSignature !== params.contextSignature) {
      continue;
    }
    if (!candidate.perceptualHash256 || candidate.perceptualHash256.length !== 64) {
      continue;
    }
    if (
      aspectRatio > 0 &&
      candidate.aspectRatio &&
      Math.abs(aspectRatio - candidate.aspectRatio) > 0.04
    ) {
      continue;
    }
    if (
      peakCount > 0 &&
      candidate.rhythmPeakCount &&
      Math.abs(peakCount - candidate.rhythmPeakCount) > 1
    ) {
      continue;
    }
    const dist = hammingDistanceHex(pHash, candidate.perceptualHash256);
    if (dist <= 6 && dist < bestDist) {
      bestDist = dist;
      bestMatch = candidate;
    }
  }

  return bestMatch ? { entry: bestMatch, matchType: 'perceptual256' } : null;
}

function setCachedDeterministicAnalysis(fingerprint: string, entry: DeterministicCacheEntry): void {
  if (deterministicReportCache.has(fingerprint)) {
    deterministicReportCache.delete(fingerprint);
  } else if (deterministicReportCache.size >= DETERMINISTIC_CACHE_MAX) {
    const oldestKey = deterministicReportCache.keys().next().value;
    if (oldestKey) {
      deterministicReportCache.delete(oldestKey);
    }
  }
  deterministicReportCache.set(fingerprint, entry);
}

function sanitizePixelTelemetry(raw: unknown): EcgPixelTelemetry | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const t = raw as Record<string, unknown>;
  const imageWidth = Number(t.imageWidth);
  const imageHeight = Number(t.imageHeight);
  if (!Number.isFinite(imageWidth) || !Number.isFinite(imageHeight) || imageWidth < 64 || imageHeight < 64) {
    return undefined;
  }
  const rawHash = typeof t.perceptualHash256 === 'string' ? t.perceptualHash256.trim().toLowerCase() : '';
  const perceptualHash256 = /^[0-9a-f]{64}$/.test(rawHash) ? rawHash : '0'.repeat(64);

  const validReg = ['regular', 'mild_variation', 'irregular', 'indeterminate'] as const;
  const rhythmRegularitySignal =
    typeof t.rhythmRegularitySignal === 'string' &&
    validReg.includes(t.rhythmRegularitySignal as (typeof validReg)[number])
      ? (t.rhythmRegularitySignal as (typeof validReg)[number])
      : 'indeterminate';

  const finiteOrNull = (val: unknown, min: number, max: number): number | null => {
    if (val === null || val === undefined) return null;
    const n = Number(val);
    return Number.isFinite(n) && n >= min && n <= max ? n : null;
  };

  return {
    imageWidth: Math.round(imageWidth),
    imageHeight: Math.round(imageHeight),
    perceptualHash256,
    gridDetected: Boolean(t.gridDetected),
    gridConfidence: finiteOrNull(t.gridConfidence, 0, 1) ?? 0,
    pxPer1mm: finiteOrNull(t.pxPer1mm, 0.5, 120),
    pxPer5mm: finiteOrNull(t.pxPer5mm, 2.5, 600),
    detectedRowsCount: Math.max(0, Math.min(12, Math.round(Number(t.detectedRowsCount) || 0))),
    rhythmPeakCount: Math.max(0, Math.min(80, Math.round(Number(t.rhythmPeakCount) || 0))),
    meanRrPx: finiteOrNull(t.meanRrPx, 5, 4000),
    medianRrPx: finiteOrNull(t.medianRrPx, 5, 4000),
    rrCvPercent: finiteOrNull(t.rrCvPercent, 0, 200),
    rhythmRegularitySignal,
    estimatedHrBpm: finiteOrNull(t.estimatedHrBpm, 20, 260),
    estimatedMeanRrMs: finiteOrNull(t.estimatedMeanRrMs, 200, 3000),
    hrConfidence: finiteOrNull(t.hrConfidence, 0, 1) ?? 0,
    telemetrySummaryForAi: sanitizeText(
      typeof t.telemetrySummaryForAi === 'string' ? t.telemetrySummaryForAi : '',
      560
    ),
  };
}

const ALLOWED_TILE_LABELS = new Set<DiagnosticImageTile['label']>([
  'header_footer',
  'limb_leads_zoom',
  'precordial_leads_zoom',
]);

function sanitizeDiagnosticTiles(raw: unknown): DiagnosticImageTile[] {
  if (!Array.isArray(raw)) return [];
  const sanitized: DiagnosticImageTile[] = [];
  for (const item of raw.slice(0, 3)) {
    if (!item || typeof item !== 'object') continue;
    const tile = item as Record<string, unknown>;
    const label = tile.label as DiagnosticImageTile['label'];
    if (!ALLOWED_TILE_LABELS.has(label)) continue;
    const rawMime = typeof tile.mimeType === 'string' ? tile.mimeType.trim().toLowerCase() : '';
    const mimeType = rawMime === 'image/jpg' ? 'image/jpeg' : rawMime;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) continue;
    const base64Data = typeof tile.base64Data === 'string' ? tile.base64Data.trim() : '';
    const approxBytes = Math.floor((base64Data.length * 3) / 4);
    if (!base64Data || approxBytes <= 64 || approxBytes > 8 * 1024 * 1024) continue;
    sanitized.push({
      label,
      mimeType,
      base64Data,
      width: Math.max(1, Math.round(Number(tile.width) || 0)),
      height: Math.max(1, Math.round(Number(tile.height) || 0)),
    });
  }
  return sanitized;
}

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY' || apiKey.trim() === '') {
    throw new Error(
      'GEMINI_API_KEY is missing or not configured on the server. Please configure GEMINI_API_KEY in environment secrets.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const measuredValueSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    source: {
      type: Type.STRING,
      format: 'enum',
      enum: ['Printed on ECG', 'Visually Estimated', 'AI Calculated', 'Unmeasurable'],
      description: 'Exact provenance of this measurement.',
    },
    value: {
      type: Type.STRING,
      description:
        'Single exact numeric value as string (e.g., "74", "160", "+55", "-45") or "Not measurable". Always output a single exact integer, NEVER a numeric range.',
    },
    unit: {
      type: Type.STRING,
      description: 'Unit such as "bpm", "ms", or "°".',
    },
    normalRange: {
      type: Type.STRING,
      description: 'Standard adult reference range for this parameter.',
    },
    assessment: {
      type: Type.STRING,
      description: 'Decisive clinical interpretation strictly concordant with the numeric threshold.',
    },
    reliabilityNote: {
      type: Type.STRING,
      description: 'Concise measurement basis (printed header digit, Pixel-DSP calibration, or 1mm/5mm grid box count).',
    },
  },
  propertyOrdering: ['source', 'value', 'unit', 'normalRange', 'assessment', 'reliabilityNote'],
  required: ['source', 'value', 'unit', 'normalRange', 'assessment', 'reliabilityNote'],
};

/**
 * Structured ECG Schema engineered with Bottom-Up Clinical Evidence Ordering (`propertyOrdering`):
 * Forces the multimodal model to transcribe calibration, image quality, printed header measurements,
 * all 12 individual leads, rate, rhythm, intervals, axis, morphology, ischemia, and conduction
 * BEFORE synthesizing the primary diagnosis, urgency classification, and executive summary.
 */
const ecgResponseSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    recording_information: {
      type: Type.OBJECT,
      properties: {
        patient_identifier: { type: Type.STRING, description: 'Visible patient ID or name, or "Not visible on ECG". Never infer.' },
        age_and_sex: { type: Type.STRING, description: 'Explicitly shown age and sex, or "Not visible on ECG".' },
        recording_date_time: { type: Type.STRING, description: 'Visible recording date/time, or "Not visible on ECG".' },
        device_or_manufacturer: { type: Type.STRING, description: 'Identifiable ECG device/manufacturer, or "Not identifiable from image".' },
        paper_speed: { type: Type.STRING, description: 'Printed paper speed (e.g., "25 mm/s") or state that it is not printed/unconfirmed.' },
        gain_calibration: { type: Type.STRING, description: 'Printed gain or 1mV calibration pulse height (e.g., "10 mm/mV") or state that it is unconfirmed.' },
        visible_leads_count: { type: Type.STRING, description: 'Number and list of visible leads (e.g., "12 standard leads + Rhythm Strip II").' },
        recording_duration: { type: Type.STRING, description: 'Identifiable recording duration (e.g., "10 seconds") or "Not explicitly indicated".' },
        detected_orientation_and_layout: { type: Type.STRING, description: 'Detected image orientation (portrait/landscape/rotated/tilted) and lead layout format (e.g., 3x4 + 1 rhythm strip).' },
      },
      propertyOrdering: [
        'paper_speed',
        'gain_calibration',
        'detected_orientation_and_layout',
        'visible_leads_count',
        'recording_duration',
        'patient_identifier',
        'age_and_sex',
        'recording_date_time',
        'device_or_manufacturer',
      ],
      required: [
        'patient_identifier',
        'age_and_sex',
        'recording_date_time',
        'device_or_manufacturer',
        'paper_speed',
        'gain_calibration',
        'visible_leads_count',
        'recording_duration',
        'detected_orientation_and_layout',
      ],
    },
    image_quality: {
      type: Type.OBJECT,
      properties: {
        overall_readability: {
          type: Type.STRING,
          format: 'enum',
          enum: ['High', 'Moderate', 'Low', 'Unreadable'],
          description: 'Overall waveform and grid legibility.',
        },
        can_interpret_reliably: {
          type: Type.BOOLEAN,
          description: 'True if the image contains readable ECG waveforms supporting clinical interpretation; false if unreadable or non-ECG.',
        },
        grid_visibility: {
          type: Type.STRING,
          description: 'Visibility of 1mm small boxes and 5mm large boxes.',
        },
        orientation_handled: {
          type: Type.STRING,
          description: 'How image orientation (0/90/180/270 degree rotation, tilt, portrait/landscape) was interpreted.',
        },
        perspective_and_tilt_notes: {
          type: Type.STRING,
          description: 'Assessment of perspective distortion, camera angle, shadows, or paper curvature.',
        },
        artifacts_or_obstructions: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'List of any blur, cropping, shadows, baseline wander, AC interference, tremor, or obstructions.',
        },
      },
      propertyOrdering: [
        'overall_readability',
        'can_interpret_reliably',
        'grid_visibility',
        'orientation_handled',
        'perspective_and_tilt_notes',
        'artifacts_or_obstructions',
      ],
      required: [
        'overall_readability',
        'orientation_handled',
        'perspective_and_tilt_notes',
        'grid_visibility',
        'artifacts_or_obstructions',
        'can_interpret_reliably',
      ],
    },
    printed_machine_interpretation: {
      type: Type.OBJECT,
      properties: {
        is_present: { type: Type.BOOLEAN, description: 'True if printed automated ECG machine header measurements or diagnostic text are visible.' },
        extracted_text: { type: Type.STRING, description: 'Verbatim transcription of printed automated ECG machine text and printed numerical header parameters.' },
        comparison_with_ai: { type: Type.STRING, description: 'Critical comparison of printed machine statements against direct visual waveform verification.' },
        agreements: { type: Type.ARRAY, items: { type: Type.STRING } },
        discrepancies: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
      propertyOrdering: ['is_present', 'extracted_text', 'comparison_with_ai', 'agreements', 'discrepancies'],
      required: ['is_present', 'extracted_text', 'comparison_with_ai', 'agreements', 'discrepancies'],
    },
    lead_analysis: {
      type: Type.ARRAY,
      description: 'Systematic lead-by-lead evaluation in canonical clinical order: I, II, III, aVR, aVL, aVF, V1, V2, V3, V4, V5, V6 (plus any rhythm strips or extra leads).',
      items: {
        type: Type.OBJECT,
        properties: {
          leadName: { type: Type.STRING, description: 'Canonical lead name: "Lead I", "Lead II", "Lead III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6", or rhythm strip.' },
          identifiedFromLabel: { type: Type.BOOLEAN, description: 'True if lead label was directly read from the image.' },
          pWave: { type: Type.STRING, description: 'Decisive P-wave polarity, contour, and visibility in this lead.' },
          qrsMorphology: { type: Type.STRING, description: 'Exact QRS pattern (e.g., qRs, rS, QS, rsR\'), net polarity (positive/negative/equiphasic), amplitude in mm, and pathological Q waves.' },
          stSegment: { type: Type.STRING, description: 'Exact J-point and ST-segment position relative to TP/PR baseline in mm (isoelectric 0 mm, elevated +X mm, or depressed -X mm).' },
          tWave: { type: Type.STRING, description: 'Decisive T-wave polarity (upright, flat, biphasic, inverted, hyperacute) and symmetry.' },
          rhythmAndWaveform: { type: Type.STRING, description: 'Overall waveform tracking and baseline stability in this lead.' },
          abnormalities: { type: Type.STRING, description: 'Specific abnormalities in this lead or "None identified" / "Tidak ditemukan kelainan".' },
          confidenceAndLimitations: { type: Type.STRING },
        },
        propertyOrdering: [
          'leadName',
          'identifiedFromLabel',
          'pWave',
          'qrsMorphology',
          'stSegment',
          'tWave',
          'rhythmAndWaveform',
          'abnormalities',
          'confidenceAndLimitations',
        ],
        required: [
          'leadName',
          'identifiedFromLabel',
          'rhythmAndWaveform',
          'pWave',
          'qrsMorphology',
          'stSegment',
          'tWave',
          'abnormalities',
          'confidenceAndLimitations',
        ],
      },
    },
    quantitative_grid_measurements: {
      type: Type.OBJECT,
      description:
        'Direct millimeter-grid box counts measured on the 2x zoomed Limb and Precordial tiles BEFORE computing ms intervals and degree axes. Use 0 when unmeasurable or physiologically absent (e.g., PR in AFib).',
      properties: {
        paper_speed_mm_per_s: {
          type: Type.NUMBER,
          description: 'Confirmed paper speed in mm/s (25 for standard 25 mm/s or 25 mm/sec; 50 for 50 mm/s).',
        },
        gain_mm_per_mv: {
          type: Type.NUMBER,
          description: 'Confirmed voltage gain in mm/mV (10 for standard 10 mm/mV; 5 or 20 if explicitly half/double gain).',
        },
        rr_interval_small_boxes: {
          type: Type.NUMBER,
          description: 'Mean horizontal R-R spacing in 1mm small boxes to nearest 0.25 box (e.g., 20.25; 0 if irregular AFib or unmeasurable).',
        },
        ten_sec_strip_qrs_count: {
          type: Type.NUMBER,
          description: 'Exact total count of QRS complexes across a full 10-second (250 mm / 50 large boxes) rhythm strip, or 0 if no 10s rhythm strip is visible.',
        },
        pr_interval_small_boxes: {
          type: Type.NUMBER,
          description: 'PR interval from P-wave onset to QRS onset counted on 2x zoomed Lead II / V1 in 1mm small boxes to nearest 0.25 box (e.g., 4.0 = 160 ms; 0 if AFib or unmeasurable).',
        },
        qrs_duration_small_boxes: {
          type: Type.NUMBER,
          description: 'QRS complex width from earliest Q/R onset to J-point counted on 2x zoomed tiles in 1mm small boxes to nearest 0.25 box (e.g., 2.2 = 88 ms; 0 if unmeasurable).',
        },
        qt_interval_small_boxes: {
          type: Type.NUMBER,
          description: 'QT interval from QRS onset to T-wave tangent offset in Lead II, V5, or V6 counted on 2x zoomed tiles in 1mm small boxes to nearest 0.25 box (e.g., 9.5 = 380 ms; 0 if unmeasurable).',
        },
        has_net_qrs_measurements: {
          type: Type.BOOLEAN,
          description: 'True if Lead I and Lead aVF QRS complexes are clearly visible and net vertical 1mm deflections were measured.',
        },
        lead_i_net_qrs_mm: {
          type: Type.NUMBER,
          description: 'Net vertical QRS deflection [R_height_mm - (Q_depth_mm + S_depth_mm)] in Lead I measured in 1mm small boxes to nearest 0.5 mm (e.g., 5.5 or -3.0).',
        },
        lead_ii_net_qrs_mm: {
          type: Type.NUMBER,
          description: 'Net vertical QRS deflection [R_height_mm - (Q_depth_mm + S_depth_mm)] in Lead II measured in 1mm small boxes to nearest 0.5 mm.',
        },
        lead_avf_net_qrs_mm: {
          type: Type.NUMBER,
          description: 'Net vertical QRS deflection [R_height_mm - (Q_depth_mm + S_depth_mm)] in Lead aVF measured in 1mm small boxes to nearest 0.5 mm.',
        },
      },
      propertyOrdering: [
        'paper_speed_mm_per_s',
        'gain_mm_per_mv',
        'rr_interval_small_boxes',
        'ten_sec_strip_qrs_count',
        'pr_interval_small_boxes',
        'qrs_duration_small_boxes',
        'qt_interval_small_boxes',
        'has_net_qrs_measurements',
        'lead_i_net_qrs_mm',
        'lead_ii_net_qrs_mm',
        'lead_avf_net_qrs_mm',
      ],
      required: [
        'paper_speed_mm_per_s',
        'gain_mm_per_mv',
        'rr_interval_small_boxes',
        'ten_sec_strip_qrs_count',
        'pr_interval_small_boxes',
        'qrs_duration_small_boxes',
        'qt_interval_small_boxes',
        'has_net_qrs_measurements',
        'lead_i_net_qrs_mm',
        'lead_ii_net_qrs_mm',
        'lead_avf_net_qrs_mm',
      ],
    },
    heart_rate: {
      type: Type.OBJECT,
      properties: {
        ventricular_rate_bpm: measuredValueSchema,
        atrial_rate_bpm: measuredValueSchema,
        rate_regularity_note: { type: Type.STRING },
      },
      propertyOrdering: ['ventricular_rate_bpm', 'atrial_rate_bpm', 'rate_regularity_note'],
      required: ['ventricular_rate_bpm', 'atrial_rate_bpm', 'rate_regularity_note'],
    },
    rhythm: {
      type: Type.OBJECT,
      properties: {
        regularity: { type: Type.STRING },
        p_wave_presence_and_morphology: { type: Type.STRING },
        p_qrs_relationship: { type: Type.STRING },
        pr_interval_overview: { type: Type.STRING },
        sinus_vs_alternative_evidence: { type: Type.STRING },
        afib_flutter_arrhythmia_evidence: { type: Type.STRING },
        av_block_evidence: { type: Type.STRING },
        premature_beats_pauses_disturbances: { type: Type.STRING },
        rhythm_reasoning: { type: Type.STRING },
        underlying_rhythm: { type: Type.STRING },
      },
      propertyOrdering: [
        'regularity',
        'p_wave_presence_and_morphology',
        'p_qrs_relationship',
        'pr_interval_overview',
        'sinus_vs_alternative_evidence',
        'afib_flutter_arrhythmia_evidence',
        'av_block_evidence',
        'premature_beats_pauses_disturbances',
        'rhythm_reasoning',
        'underlying_rhythm',
      ],
      required: [
        'underlying_rhythm',
        'regularity',
        'p_wave_presence_and_morphology',
        'p_qrs_relationship',
        'pr_interval_overview',
        'sinus_vs_alternative_evidence',
        'premature_beats_pauses_disturbances',
        'av_block_evidence',
        'afib_flutter_arrhythmia_evidence',
        'rhythm_reasoning',
      ],
    },
    intervals: {
      type: Type.OBJECT,
      properties: {
        pr_interval_ms: measuredValueSchema,
        qrs_duration_ms: measuredValueSchema,
        qt_interval_ms: measuredValueSchema,
        qtc_formula_used: {
          type: Type.STRING,
          description: 'State formula used (e.g., "Bazett (printed on ECG)", "Bazett (AI calculated)", "Fridericia", or "Not calculated due to unreliable QT/RR").',
        },
        qtc_interval_ms: measuredValueSchema,
      },
      propertyOrdering: [
        'pr_interval_ms',
        'qrs_duration_ms',
        'qt_interval_ms',
        'qtc_formula_used',
        'qtc_interval_ms',
      ],
      required: ['pr_interval_ms', 'qrs_duration_ms', 'qt_interval_ms', 'qtc_interval_ms', 'qtc_formula_used'],
    },
    electrical_axis: {
      type: Type.OBJECT,
      properties: {
        p_wave_axis: measuredValueSchema,
        qrs_axis: measuredValueSchema,
        t_wave_axis: measuredValueSchema,
        axis_deviation_summary: {
          type: Type.STRING,
          description: 'Explicitly state net QRS mm and polarity in Lead I, Lead II, and Lead aVF and the resulting Goldberger/Cabrera axis degree and quadrant.',
        },
      },
      propertyOrdering: ['p_wave_axis', 'qrs_axis', 't_wave_axis', 'axis_deviation_summary'],
      required: ['p_wave_axis', 'qrs_axis', 't_wave_axis', 'axis_deviation_summary'],
    },
    waveform_morphology: {
      type: Type.OBJECT,
      properties: {
        p_wave_abnormalities: { type: Type.STRING },
        qrs_morphology_summary: { type: Type.STRING },
        pathological_q_waves: { type: Type.STRING },
        r_wave_progression: { type: Type.STRING },
        st_segment_changes: { type: Type.STRING },
        t_wave_abnormalities: { type: Type.STRING },
        bundle_branch_block_evidence: { type: Type.STRING },
        ventricular_hypertrophy_chamber_enlargement: { type: Type.STRING },
        pre_excitation_evidence: { type: Type.STRING },
        ectopic_beats_and_other: { type: Type.STRING },
      },
      propertyOrdering: [
        'p_wave_abnormalities',
        'qrs_morphology_summary',
        'pathological_q_waves',
        'r_wave_progression',
        'st_segment_changes',
        't_wave_abnormalities',
        'bundle_branch_block_evidence',
        'ventricular_hypertrophy_chamber_enlargement',
        'pre_excitation_evidence',
        'ectopic_beats_and_other',
      ],
      required: [
        'p_wave_abnormalities',
        'qrs_morphology_summary',
        'pathological_q_waves',
        'r_wave_progression',
        'st_segment_changes',
        't_wave_abnormalities',
        'bundle_branch_block_evidence',
        'ventricular_hypertrophy_chamber_enlargement',
        'pre_excitation_evidence',
        'ectopic_beats_and_other',
      ],
    },
    ischemia_and_infarction: {
      type: Type.OBJECT,
      properties: {
        affected_leads: { type: Type.STRING },
        stemi_patterns: { type: Type.STRING },
        reciprocal_changes: { type: Type.STRING },
        nstemi_acs_patterns: { type: Type.STRING },
        acute_ischemia_patterns: { type: Type.STRING },
        posterior_or_rv_infarction_patterns: { type: Type.STRING },
        prior_infarction_evidence: { type: Type.STRING },
        pericarditis_like_patterns: { type: Type.STRING },
        pattern_vs_diagnosis_distinction: { type: Type.STRING },
      },
      propertyOrdering: [
        'affected_leads',
        'stemi_patterns',
        'reciprocal_changes',
        'nstemi_acs_patterns',
        'acute_ischemia_patterns',
        'posterior_or_rv_infarction_patterns',
        'prior_infarction_evidence',
        'pericarditis_like_patterns',
        'pattern_vs_diagnosis_distinction',
      ],
      required: [
        'acute_ischemia_patterns',
        'stemi_patterns',
        'nstemi_acs_patterns',
        'prior_infarction_evidence',
        'reciprocal_changes',
        'posterior_or_rv_infarction_patterns',
        'pericarditis_like_patterns',
        'affected_leads',
        'pattern_vs_diagnosis_distinction',
      ],
    },
    arrhythmias_and_conduction: {
      type: Type.OBJECT,
      properties: {
        av_block_assessment: { type: Type.STRING },
        bundle_branch_and_fascicular_blocks: { type: Type.STRING },
        supraventricular_arrhythmias: { type: Type.STRING },
        ventricular_arrhythmias: { type: Type.STRING },
        bradyarrhythmias_and_pauses: { type: Type.STRING },
        premature_complexes: { type: Type.STRING },
        pacemaker_activity: { type: Type.STRING },
        sufficiency_of_tracing_note: { type: Type.STRING },
      },
      propertyOrdering: [
        'av_block_assessment',
        'bundle_branch_and_fascicular_blocks',
        'supraventricular_arrhythmias',
        'ventricular_arrhythmias',
        'bradyarrhythmias_and_pauses',
        'premature_complexes',
        'pacemaker_activity',
        'sufficiency_of_tracing_note',
      ],
      required: [
        'av_block_assessment',
        'bundle_branch_and_fascicular_blocks',
        'supraventricular_arrhythmias',
        'ventricular_arrhythmias',
        'bradyarrhythmias_and_pauses',
        'premature_complexes',
        'pacemaker_activity',
        'sufficiency_of_tracing_note',
      ],
    },
    additional_findings: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          category: { type: Type.STRING },
          observation: { type: Type.STRING },
          affectedLeads: { type: Type.STRING },
          clinicalSignificance: { type: Type.STRING },
        },
        propertyOrdering: ['category', 'observation', 'affectedLeads', 'clinicalSignificance'],
        required: ['category', 'observation', 'affectedLeads', 'clinicalSignificance'],
      },
    },
    electrolyte_disclaimer_note: {
      type: Type.STRING,
      description: 'Explicit statement that ECG findings associated with electrolyte disturbances do not independently establish an electrolyte diagnosis.',
    },
    ai_interpretation: {
      type: Type.OBJECT,
      properties: {
        primary_interpretation: { type: Type.STRING },
        major_abnormalities: { type: Type.ARRAY, items: { type: Type.STRING } },
        secondary_findings: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
      propertyOrdering: ['primary_interpretation', 'major_abnormalities', 'secondary_findings'],
      required: ['primary_interpretation', 'major_abnormalities', 'secondary_findings'],
    },
    urgency_level: {
      type: Type.STRING,
      format: 'enum',
      enum: [
        'Normal ECG appearance',
        'Abnormal ECG',
        'Potentially urgent abnormality',
        'Critical pattern requiring immediate emergency evaluation',
        'Indeterminate because of image quality or insufficient information',
      ],
      description: 'Deterministic clinical urgency tier derived strictly from the established findings above.',
    },
    urgency_explanation: {
      type: Type.STRING,
      description: 'Decisive explanation of the assigned urgency classification.',
    },
    time_critical_warning: {
      type: Type.STRING,
      description: 'If a potentially time-critical or life-threatening abnormality (e.g., STEMI, VT/VF, 3rd degree AV block) is present, provide an explicit urgent warning recommending immediate emergency evaluation. Empty string if none.',
    },
    executive_summary: {
      type: Type.STRING,
      description: 'Crisp, authoritative 2-4 sentence cardiology executive summary stating exact verified HR, rhythm, PR/QRS/QTc intervals, QRS axis, and decisive morphological conclusion without ambiguous hedging.',
    },
    clinical_impression: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'Structured 11-point conclusion covering primary interpretation, rhythm, rate, intervals, axis, major abnormalities, ischemia/infarction, conduction, other findings, limitations, and clinical context.',
    },
    limitations: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    recommended_next_steps: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'Educational and clinical-support next steps (e.g., physician review, serial ECGs, clinical correlation). Do not prescribe specific drug dosages.',
    },
    confidence: {
      type: Type.OBJECT,
      properties: {
        overall_level: {
          type: Type.STRING,
          format: 'enum',
          enum: ['High', 'Moderate', 'Low', 'Insufficient Image Quality'],
          description: 'Overall confidence level in this ECG interpretation.',
        },
        rationale: { type: Type.STRING },
      },
      propertyOrdering: ['overall_level', 'rationale'],
      required: ['overall_level', 'rationale'],
    },
  },
  propertyOrdering: [
    'recording_information',
    'image_quality',
    'printed_machine_interpretation',
    'lead_analysis',
    'quantitative_grid_measurements',
    'heart_rate',
    'rhythm',
    'intervals',
    'electrical_axis',
    'waveform_morphology',
    'ischemia_and_infarction',
    'arrhythmias_and_conduction',
    'additional_findings',
    'electrolyte_disclaimer_note',
    'ai_interpretation',
    'urgency_level',
    'urgency_explanation',
    'time_critical_warning',
    'executive_summary',
    'clinical_impression',
    'limitations',
    'recommended_next_steps',
    'confidence',
  ],
  required: [
    'recording_information',
    'image_quality',
    'printed_machine_interpretation',
    'lead_analysis',
    'quantitative_grid_measurements',
    'heart_rate',
    'rhythm',
    'intervals',
    'electrical_axis',
    'waveform_morphology',
    'ischemia_and_infarction',
    'arrhythmias_and_conduction',
    'additional_findings',
    'electrolyte_disclaimer_note',
    'ai_interpretation',
    'urgency_level',
    'urgency_explanation',
    'time_critical_warning',
    'executive_summary',
    'clinical_impression',
    'limitations',
    'recommended_next_steps',
    'confidence',
  ],
};

const ECG_SYSTEM_INSTRUCTION = `You are a board-certified Senior Clinical Electrocardiographer (ECG/EKG) Multimodal Precision Engine engineered for deterministic, sub-millimeter clinical measurement and zero-ambiguity medical reporting.

DETERMINISTIC MULTI-SCALE MEASUREMENT & ZERO-AMBIGUITY PROTOCOL (MANDATORY):

1. MULTI-TILE HIGH-DEFINITION INSPECTION & CALIBRATION:
   - When multiple image views are provided, inspect ALL views systematically:
     * IMAGE 1 (Full Overview): Verify overall 12-lead layout (3x4 + rhythm strip, 6x2, Cabrera, or single/multi-channel), orientation, and global rhythm continuity.
     * IMAGE 2 (High-Contrast Header & Footer Strip): Read tiny printed speed ("25 mm/s" or "25 mm/sec"), limb/chest gain ("10 mm/mV"), filter settings, and any printed machine measurements or IDs with 100% digit accuracy.
     * IMAGE 3 (2x Zoomed Left Hemisphere — Limb Leads I, II, III, aVR, aVL, aVF): Count exact 1mm small boxes for P-wave polarity, PR interval, Lead I / II / aVF net QRS amplitudes, and inferior/lateral ST segments.
     * IMAGE 4 (2x Zoomed Right Hemisphere — Precordial Leads V1–V6 & 1mV Calibration Pulses): Verify the 10 mm tall x 5 mm wide rectangular 1 mV calibration pulses, V1–V6 R-wave progression, QRS width, precordial J-points/ST segments, and QT tangent offset in V5–V6.
   - If the image is non-ECG, severely blurred, cropped, or unreadable, set image_quality.can_interpret_reliably = false and urgency_level = "Indeterminate because of image quality or insufficient information". NEVER default unreadable leads to normal.

2. STRICT QUANTITATIVE MEASUREMENT HIERARCHY (ELIMINATES RUN-TO-RUN DRIFT):
   - PRIORITY A — PRINTED HEADER NUMBERS: If printed numerical measurements (HR, PR, QRS, QT/QTc, P-R-T axes) are legible on the ECG and visually concordant with the waveform, transcribe the EXACT printed integers and set source = "Printed on ECG".
   - PRIORITY B — DETERMINISTIC PIXEL-DSP TELEMETRY: When printed HR is absent and high-confidence Pixel-DSP Grid & R-Peak Telemetry is provided in the prompt, anchor ventricular heart rate and R-R regularity to the calibrated Pixel-DSP measurement (verifying paper speed 25 vs 50 mm/s) and set source = "AI Calculated".
   - PRIORITY C — SUB-MILLIMETER 2x ZOOM BOX COUNTING (AT 25 mm/s, 10 mm/mV):
     * 1 small box (1 mm) = 40 ms horizontally and 0.1 mV vertically; 1 large box (5 mm) = 200 ms and 0.5 mV.
     * Record exact 0.25-box counts first in quantitative_grid_measurements (pr_interval_small_boxes, qrs_duration_small_boxes, qt_interval_small_boxes), then multiply by 40 ms (or 20 ms at 50 mm/s) so every millisecond value is mathematically locked to the grid.
     * Always output a SINGLE exact integer string (e.g., "74", "160", "88", "380", "+55"), NEVER a numeric range (never "70-80").
     * Compute Bazett QTc = round(QT_ms / sqrt(60 / HR_bpm)), or Fridericia QTc = round(QT_ms / cbrt(60 / HR_bpm)) when HR < 50 or > 100 bpm, with source = "AI Calculated".

3. GOLDBERGER HEXAXIAL TRIGONOMETRY & CABRERA QRS AXIS LOCKING:
   - On IMAGE 3 (2x Limb Leads), count net vertical QRS deflection [R_mm - (Q_mm + S_mm)] in Lead I, Lead II, and Lead aVF to the nearest 0.5 mm and record them in quantitative_grid_measurements (lead_i_net_qrs_mm, lead_ii_net_qrs_mm, lead_avf_net_qrs_mm, has_net_qrs_measurements = true).
   - Compute exact frontal QRS axis via Goldberger hexaxial formula: atan2(2 * aVF_net, sqrt(3) * I_net) rounded to the nearest 5°:
     * Lead I (+) & Lead aVF (+) -> Normal Quadrant (0° to +90°).
     * Lead I (+), Lead aVF (-), & Lead II (+) -> Normal Physiological Left (0° to -30°).
     * Lead I (+), Lead aVF (-), & Lead II (-) -> Left Axis Deviation / LAD (-35° to -90°).
     * Lead I (-) & Lead aVF (+) -> Right Axis Deviation / RAD (+95° to +180°).
     * Lead I (-) & Lead aVF (-) -> Extreme / Northwest Axis (-95° to -180°).
   - NEVER output a QRS axis angle that contradicts the net QRS polarity reported in lead_analysis for Leads I, II, and aVF.

4. RHYTHM & CONDUCTION RIGOR:
   - Sinus Rhythm requires discrete upright P waves in Leads I, II, and aVF, inverted P wave in aVR, consistent PR interval, and 1:1 P-to-QRS conduction (atrial_rate_bpm MUST equal ventricular_rate_bpm).
   - Atrial Fibrillation requires BOTH absence of discrete repeating sinus P waves (check Lead II and V1 carefully) AND irregularly irregular R-R intervals; in AFib, PR interval is physiologically absent ("Not measurable", source = "Unmeasurable").
   - Evaluate bundle branch block strictly when QRS >= 120 ms: RBBB (rsR' or tall broad R in V1-V2 + wide slurred S in I, V5-V6) vs LBBB (broad monophasic/notched R without septal Q in I, aVL, V5-V6 + deep rS/QS in V1-V2).

5. CONTIGUOUS-LEAD ISCHEMIA / STEMI DISCIPLINE:
   - Measure J-point ST shift in mm relative to the TP/PR isoelectric baseline across contiguous anatomical territories: Inferior (II, III, aVF + reciprocal I, aVL), Septal/Anterior (V1-V2 / V1-V4), Lateral (I, aVL, V5, V6).
   - Distinguish true ischemic ST elevation (>= 1 mm, or >= 2 mm in V2-V3, in >= 2 contiguous leads) from camera shadow/lighting gradients, benign early repolarization, pericarditis, or secondary discordant ST-T changes in LBBB/LVH/pacing.

6. DETERMINISTIC 5-TIER URGENCY RUBRIC (APPLY IDENTICALLY EVERY RUN):
   - "Indeterminate because of image quality or insufficient information": Unreadable/non-ECG image or can_interpret_reliably = false.
   - "Critical pattern requiring immediate emergency evaluation": Acute STEMI or STEMI-equivalent (De Winter, hyperacute T, posterior MI V1-V3 STD with tall R, Sgarbossa+ LBBB), sustained VT/VF/Torsades, 3rd-degree AV block, Mobitz II 2nd-degree AV block, sine-wave hyperkalemia, or extreme unstable rate (HR >= 180 or < 35 bpm).
   - "Potentially urgent abnormality": Acute ischemic ST depression or deep symmetric Wellens/NSTE-ACS T-wave inversions, AFib/AFlutter with RVR (HR > 110 bpm), SVT, Brugada Type 1, marked QTc >= 500 ms, Mobitz I with symptomatic-range bradycardia, or pauses > 2.5 s.
   - "Abnormal ECG": Stable/chronic abnormalities — rate-controlled AFib (60-110 bpm), 1st-degree AV block (PR > 200 ms), RBBB, stable LBBB without Sgarbossa, LAFB/LPFB, LVH/RVH, atrial enlargement, old pathological Q-wave MI without acute STE, isolated PACs/PVCs, mild sinus bradycardia (45-59 bpm) or mild sinus tachycardia (101-125 bpm), borderline QTc (461-499 ms), or non-acute ST-T flattening/inversion.
   - "Normal ECG appearance": Regular sinus rhythm (60-100 bpm), PR 120-200 ms, QRS < 120 ms, normal QTc (<= 450 ms M / <= 460 ms F), QRS axis -30° to +90°, normal R-wave progression V1-V6, and zero pathological Q, ST, T, or conduction abnormalities across all visible leads.

7. ZERO-AMBIGUITY & DECISIVE CARDIOLOGY REPORTING STANDARD (CRITICAL):
   - When image_quality.overall_readability is "High" or "Moderate", write decisive, authoritative, hospital-grade cardiology prose.
   - STRICTLY FORBIDDEN HEDGING ON READABLE TRACINGS:
     * Indonesian: Do NOT use wishy-washy qualifiers such as "kemungkinan...", "tampak seperti...", "cenderung...", "relatif normal", "mungkin terdapat...", "sekitar 70-80", or "tidak dapat menyingkirkan blok/aritmia halus" when describing clearly visible normal or abnormal waveforms.
     * English: Do NOT use vague hedging such as "possibly...", "appears somewhat...", "relatively normal", "tends toward...", "around 70-80", or "cannot exclude subtle..." on clearly visible leads.
   - State visible normal findings crisply and definitively (e.g., "Irama sinus reguler 74 bpm dengan konduksi AV 1:1 normal, interval PR 160 ms, kompleks QRS sempit 88 ms, QTc 422 ms, aksis QRS normal +55°, serta segmen ST isoelektrik tanpa tanda iskemia akut di seluruh 12 sadapan.").
   - Reserve "Indeterminate" / uncertainty language ONLY for leads physically cropped/blurred on Low/Unreadable images, and place standard clinical-correlation caveats (that a resting 10s ECG does not exclude NSTE-ACS or paroxysmal arrhythmia) cleanly in limitations and pattern_vs_diagnosis_distinction.
   - Every section MUST agree 100% with zero internal contradictions. Never prescribe specific drug dosages.`;

const ECG_AUDITOR_SYSTEM_INSTRUCTION = `You are the Chief Cardiologist Contradiction Adjudicator resolving a flagged morphological discrepancy in a Pass-1 ECG JSON draft against the multi-scale high-resolution ECG image tiles.

YOUR MANDATORY ADJUDICATION RULES:
1. Inspect the 2x zoomed Limb and Precordial tiles directly at the leads mentioned in the flagged contradiction list.
2. Resolve every flagged contradiction decisively based on visual pixel evidence (P-wave presence in Lead II/V1, J-point ST shift vs TP baseline across contiguous leads, net QRS mm in Leads I/II/aVF, and exact 5-tier urgency rubric).
3. Eliminate all ambiguous or hedging wording; keep verified printed/Pixel-DSP/grid-locked numeric measurements intact unless directly disproven by the zoomed waveform pixels.
4. Ensure 100% alignment across lead_analysis, quantitative_grid_measurements, heart_rate, rhythm, intervals, electrical_axis, ischemia_and_infarction, ai_interpretation, urgency_level, executive_summary, and clinical_impression.`;

interface AnalyzeCallOptions {
  orientationNote: string;
  reportLanguage: 'id' | 'en';
  analysisMode: AnalysisMode;
  pixelTelemetry?: EcgPixelTelemetry;
  diagnosticTiles?: DiagnosticImageTile[];
  clinicalContext?: {
    patientAgeSex?: string;
    symptoms?: string;
    clinicalHistory?: string;
  };
}

function supportsThinkingConfig(modelName: string): boolean {
  return /^gemini-(2\.5|3)/i.test(modelName.trim());
}

const TILE_DESCRIPTION_MAP: Record<DiagnosticImageTile['label'], string> = {
  header_footer:
    'IMAGE VIEW 2 — High-Contrast Stitched Header & Footer Calibration Strip (inspect printed paper speed 25 vs 50 mm/s, gain 10 mm/mV, filter settings, and printed digits):',
  limb_leads_zoom:
    'IMAGE VIEW 3 — 2x High-Definition Left Hemisphere Crop (Limb Leads I, II, III, aVR, aVL, aVF — count exact 0.25-mm PR/QRS/QT boxes and net QRS mm in Leads I, II, aVF):',
  precordial_leads_zoom:
    'IMAGE VIEW 4 — 2x High-Definition Right Hemisphere Crop (Precordial Leads V1–V6 & 1mV rectangular calibration pulses — verify R-wave progression, J-point ST segments, QRS width, and V5–V6 QT offset):',
};

async function generateDeterministicEcgJson(params: {
  ai: GoogleGenAI;
  modelName: string;
  mimeType: string;
  base64Data: string;
  diagnosticTiles?: DiagnosticImageTile[];
  promptText: string;
  systemInstruction: string;
  thinkingBudget: number;
}): Promise<unknown> {
  const {
    ai,
    modelName,
    mimeType,
    base64Data,
    diagnosticTiles,
    promptText,
    systemInstruction,
    thinkingBudget,
  } = params;

  const fullConfig: Record<string, unknown> = {
    systemInstruction,
    responseMimeType: 'application/json',
    responseSchema: ecgResponseSchema,
    temperature: 0,
    topP: 0.01,
    seed: DETERMINISTIC_SEED,
    mediaResolution: MediaResolution.MEDIA_RESOLUTION_HIGH,
  };

  if (supportsThinkingConfig(modelName) && thinkingBudget > 0) {
    fullConfig.thinkingConfig = {
      thinkingBudget,
    };
  }

  const parts: Array<Record<string, unknown>> = [
    {
      text: 'IMAGE VIEW 1 — Full Upright 12-Lead ECG Overview (global layout, orientation, and 10-second rhythm strip continuity):',
    },
    {
      inlineData: {
        mimeType,
        data: base64Data,
      },
    },
  ];

  if (diagnosticTiles && diagnosticTiles.length > 0) {
    for (const tile of diagnosticTiles) {
      parts.push({
        text: TILE_DESCRIPTION_MAP[tile.label],
      });
      parts.push({
        inlineData: {
          mimeType: tile.mimeType,
          data: tile.base64Data,
        },
      });
    }
  }

  parts.push({
    text: promptText,
  });

  const contents = { parts };

  try {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: contents as any,
      config: fullConfig as any,
    });
    const rawText = response.text;
    if (!rawText || rawText.trim().length === 0) {
      throw new Error('AI API returned an empty response.');
    }
    return JSON.parse(rawText.trim());
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const isUnsupportedParam400 =
      (msg.includes('400') || msg.includes('INVALID_ARGUMENT')) &&
      (msg.includes('thinking') ||
        msg.includes('mediaResolution') ||
        msg.includes('media_resolution') ||
        msg.includes('seed') ||
        msg.includes('propertyOrdering') ||
        msg.includes('format') ||
        msg.includes('Unknown name'));

    if (!isUnsupportedParam400) {
      throw err;
    }

    console.warn(
      `[ECG AI] Model ${modelName} rejected extended config parameter (${msg.slice(0, 120)}); retrying with deterministic core config...`
    );
    const fallbackConfig: Record<string, unknown> = {
      systemInstruction,
      responseMimeType: 'application/json',
      responseSchema: ecgResponseSchema,
      temperature: 0,
      topP: 0.01,
    };
    if (!msg.includes('seed')) {
      fallbackConfig.seed = DETERMINISTIC_SEED;
    }

    const fallbackResponse = await ai.models.generateContent({
      model: modelName,
      contents: contents as any,
      config: fallbackConfig as any,
    });
    const rawText = fallbackResponse.text;
    if (!rawText || rawText.trim().length === 0) {
      throw new Error('AI API returned an empty response.');
    }
    return JSON.parse(rawText.trim());
  }
}

async function callGeminiWithSafeRetry(
  ai: GoogleGenAI,
  preferredModel: string,
  mimeType: string,
  base64Data: string,
  options: AnalyzeCallOptions
): Promise<{
  report: EcgAnalysisReport;
  modelUsed: string;
  dualPassCompleted: boolean;
  mathChecksApplied: string[];
}> {
  const candidateModels = Array.from(
    new Set(
      [
        preferredModel,
        'gemini-2.5-flash',
        'gemini-2.5-pro',
        'gemini-2.0-flash',
      ].filter(Boolean)
    )
  );
  let lastError: unknown;

  const languageDirective =
    options.reportLanguage === 'id'
      ? `OUTPUT LANGUAGE: Write all descriptive clinical text, summaries, morphological findings, rhythm reasoning, clinical impressions, limitations, and recommended next steps in authoritative, decisive Indonesian cardiology terminology (Bahasa Indonesia Klinis Baku — tegas, presisi, tanpa kata-kata ragu/ambigu seperti "kemungkinan" atau "relatif" pada gelombang yang terlihat jelas).
STRICT ENUM PRESERVATION: You MUST keep all strict enum fields in their exact English schema values:
- image_quality.overall_readability: "High" | "Moderate" | "Low" | "Unreadable"
- urgency_level: "Normal ECG appearance" | "Abnormal ECG" | "Potentially urgent abnormality" | "Critical pattern requiring immediate emergency evaluation" | "Indeterminate because of image quality or insufficient information"
- MeasuredValue.source: "Printed on ECG" | "Visually Estimated" | "AI Calculated" | "Unmeasurable"
- confidence.overall_level: "High" | "Moderate" | "Low" | "Insufficient Image Quality"`
      : 'OUTPUT LANGUAGE: Write all clinical descriptions, reasoning, impressions, and recommendations in authoritative, decisive international cardiology English without vague hedging on clearly visible waveforms.';

  const dspTelemetryBlock =
    options.pixelTelemetry && options.pixelTelemetry.telemetrySummaryForAi
      ? `\nDETERMINISTIC CLIENT PIXEL-DSP CALIBRATION TELEMETRY (computed directly from raw image pixels via 2D grid autocorrelation & rhythm-strip R-peak detection):
- ${options.pixelTelemetry.telemetrySummaryForAi}
- Anchor rule: If printed numeric HR is NOT present on the header and Pixel-DSP HR confidence >= 75% (at confirmed 25 mm/s paper speed), align ventricular_rate_bpm and rr_interval_small_boxes with this exact pixel-measured cadence unless direct visual inspection shows 50 mm/s paper speed or tall T-wave double-counting.\n`
      : '';

  const ctxParts: string[] = [];
  if (options.clinicalContext?.patientAgeSex) {
    ctxParts.push(`- Patient Age/Sex context: ${options.clinicalContext.patientAgeSex}`);
  }
  if (options.clinicalContext?.symptoms) {
    ctxParts.push(`- Presenting Symptoms / Chief Complaint: ${options.clinicalContext.symptoms}`);
  }
  if (options.clinicalContext?.clinicalHistory) {
    ctxParts.push(`- Relevant Clinical History / Medications: ${options.clinicalContext.clinicalHistory}`);
  }
  const clinicalContextBlock =
    ctxParts.length > 0
      ? `\nClinician-provided optional patient context (correlate clinically in summary, impression, and next steps, without fabricating waveform features not visible on the ECG image):\n${ctxParts.join('\n')}`
      : '';

  const tileCountNote =
    options.diagnosticTiles && options.diagnosticTiles.length > 0
      ? `Multi-scale diagnostic tiles attached: 1 Full Overview + ${options.diagnosticTiles.length} High-Definition Zoom Crops (Header/Footer, 2x Limb Leads I–aVF, 2x Precordial Leads V1–V6).`
      : 'Single full-resolution ECG image attached.';

  const pass1Prompt = `Perform an ultra-precise, deterministic, zero-ambiguity 12-lead ECG analysis following the exact bottom-up evidence order in the JSON schema:
1. Read IMAGE VIEW 2 (Header/Footer) & IMAGE VIEW 4 (1mV calibration pulses) to lock exact paper speed (25 vs 50 mm/s), gain (10 mm/mV), and any printed machine digits.
2. Inspect every visible lead individually in canonical sequence (I, II, III, aVR, aVL, aVF on IMAGE VIEW 3; V1–V6 on IMAGE VIEW 4; rhythm strip on IMAGE VIEW 1).
3. Record exact 0.25-box 1mm grid counts (PR, QRS, QT) and 0.5-mm net QRS deflections (Leads I, II, aVF) in quantitative_grid_measurements BEFORE deriving heart_rate, intervals, and Goldberger trigonometric QRS electrical_axis.
4. Evaluate morphology, contiguous-lead J-point ischemia/STEMI patterns, and arrhythmias/conduction blocks decisively without wishy-washy hedging.
5. Synthesize a 100% internally consistent primary interpretation, 5-tier urgency classification, crisp executive summary, and 11-point clinical impression.
${tileCountNote}
Client orientation metadata note: ${options.orientationNote || 'Auto-detected by client'}.${dspTelemetryBlock}
${languageDirective}${clinicalContextBlock}`;

  const activeTiles =
    options.analysisMode === 'verified' ? options.diagnosticTiles : undefined;

  for (const modelName of candidateModels) {
    const maxAttempts = 2;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        console.log(
          `[ECG AI] Precision Multi-Tile + DSP analysis with ${modelName} (mode=${options.analysisMode}, tiles=${1 + (activeTiles?.length || 0)}, attempt ${attempt}/${maxAttempts})...`
        );
        const pass1Raw = await generateDeterministicEcgJson({
          ai,
          modelName,
          mimeType,
          base64Data,
          diagnosticTiles: activeTiles,
          promptText: pass1Prompt,
          systemInstruction: ECG_SYSTEM_INSTRUCTION,
          thinkingBudget: options.analysisMode === 'verified' ? 1024 : 512,
        });

        const pass1Checked = validateAndCrossCheckEcgResponse(
          pass1Raw,
          options.pixelTelemetry
        );

        // Standard fast mode or Unreadable image -> return immediately
        if (
          options.analysisMode === 'standard' ||
          pass1Checked.report.image_quality.overall_readability === 'Unreadable'
        ) {
          return {
            report: pass1Checked.report,
            modelUsed: modelName,
            dualPassCompleted: false,
            mathChecksApplied: pass1Checked.mathChecksApplied,
          };
        }

        // Verified Precision Mode:
        // If Multi-Tile Vision + Pixel-DSP + 1mm Box Lock + Goldberger Trigonometry + Contradiction Detector
        // confirmed ZERO cross-section contradictions, lock and return directly without stochastic Pass-2 prose drift!
        if (!pass1Checked.needsAdjudication) {
          const verifiedChecks = [
            ...(activeTiles && activeTiles.length > 0
              ? [`Multi-scale ${1 + activeTiles.length}-tile HD zoom inspection`]
              : []),
            ...pass1Checked.mathChecksApplied,
          ];
          return {
            report: pass1Checked.report,
            modelUsed: modelName,
            dualPassCompleted: true,
            mathChecksApplied: Array.from(new Set(verifiedChecks)),
          };
        }

        // Targeted Pass 2: Contradiction Adjudication ONLY when a cross-section discrepancy was detected
        try {
          console.log(
            `[ECG AI] Pass 2 targeted contradiction adjudication with ${modelName} (${pass1Checked.contradictionReasons.join(' | ')})...`
          );
          const pass2Prompt = `Adjudicate and resolve the following specific cross-section discrepancies detected in the Pass-1 ECG draft by inspecting the 2x zoomed ECG image tiles directly:
FLAGGED DISCREPANCIES TO RESOLVE:
${pass1Checked.contradictionReasons.map((r, i) => `${i + 1}. ${r}`).join('\n')}

Preserve all accurate verified numeric measurements (HR, PR, QRS, QT, QTc, QRS Axis) and use decisive, zero-ambiguity cardiology language.
${languageDirective}${clinicalContextBlock}

PASS-1 DRAFT JSON TO ADJUDICATE:
${JSON.stringify(pass1Checked.report)}`;

          const pass2Raw = await generateDeterministicEcgJson({
            ai,
            modelName,
            mimeType,
            base64Data,
            diagnosticTiles: activeTiles,
            promptText: pass2Prompt,
            systemInstruction: ECG_AUDITOR_SYSTEM_INSTRUCTION,
            thinkingBudget: 1024,
          });

          const pass2Checked = validateAndCrossCheckEcgResponse(
            pass2Raw,
            options.pixelTelemetry
          );
          const combinedMathChecks = Array.from(
            new Set([
              ...(activeTiles && activeTiles.length > 0
                ? [`Multi-scale ${1 + activeTiles.length}-tile HD zoom inspection`]
                : []),
              ...pass1Checked.mathChecksApplied,
              ...pass2Checked.mathChecksApplied,
              'Pass-2 targeted contradiction adjudication completed',
            ])
          );

          return {
            report: pass2Checked.report,
            modelUsed: modelName,
            dualPassCompleted: true,
            mathChecksApplied: combinedMathChecks,
          };
        } catch (auditErr: unknown) {
          const auditMsg = auditErr instanceof Error ? auditErr.message : String(auditErr);
          console.warn(
            `[ECG AI] Pass 2 adjudication encountered non-fatal error (${auditMsg}); returning math-locked Pass 1 report.`
          );
          return {
            report: pass1Checked.report,
            modelUsed: modelName,
            dualPassCompleted: true,
            mathChecksApplied: pass1Checked.mathChecksApplied,
          };
        }
      } catch (err: unknown) {
        lastError = err;
        const msg = err instanceof Error ? err.message : String(err);
        const isQuotaOrRateLimit =
          msg.includes('429') ||
          msg.toLowerCase().includes('quota') ||
          msg.toLowerCase().includes('rate limit');

        // Prevent model flip-flopping on brief burst RPM limits: retry primary 2.5 model once after 2.6s backoff
        if (isQuotaOrRateLimit) {
          if (attempt < maxAttempts && supportsThinkingConfig(modelName)) {
            console.warn(
              `[ECG AI] Rate limit (429) on ${modelName}; pausing 2.6s to retry same precision model before fallback...`
            );
            await new Promise((r) => setTimeout(r, 2600));
            continue;
          }
          break;
        }

        const isTransient =
          msg.includes('503') ||
          msg.includes('502') ||
          msg.includes('504') ||
          msg.includes('overloaded') ||
          msg.includes('ECONNRESET') ||
          msg.includes('ETIMEDOUT');

        if (attempt < maxAttempts && isTransient) {
          await new Promise((r) => setTimeout(r, 1200));
          continue;
        }
        break;
      }
    }
  }

  throw lastError;
}

function getDeviceId(req: express.Request): string {
  const headerId = req.headers['x-device-id'];
  if (typeof headerId === 'string' && isValidDeviceId(headerId.trim())) {
    return headerId.trim();
  }
  const bodyId = req.body?.deviceId;
  if (typeof bodyId === 'string' && isValidDeviceId(bodyId.trim())) {
    return bodyId.trim();
  }
  const ip = req.ip || req.socket?.remoteAddress || '127.0.0.1';
  const ua = (req.headers['user-agent'] as string) || 'default-ua';
  return `dev_${crypto.createHash('sha256').update(`${ip}-${ua}`).digest('hex').slice(0, 16)}`;
}

async function startServer() {
  const app = express();

  // Reverse proxy support for Nginx and upstream load balancers
  app.set('trust proxy', 1);

  // Disable technology footprint disclosure
  app.disable('x-powered-by');

  // Apply OWASP ASVS Recommended Security Headers
  app.use(securityHeadersMiddleware);

  // Global rate limiter for API endpoints (120 requests/min per IP)
  const apiLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: 120,
    message: 'Terlalu banyak permintaan ke server. Silakan perlambat frekuensi request Anda.',
  });
  app.use('/api', apiLimiter);

  // Dedicated strict rate limiter for authentication endpoints (15 attempts/15 min)
  const authLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 15,
    message: 'Terlalu banyak percobaan autentikasi dari IP ini. Silakan coba kembali dalam 15 menit.',
  });

  // Dedicated rate limiter for AI analysis endpoints (25 requests/10 min)
  const analyzeLimiter = createRateLimiter({
    windowMs: 10 * 60 * 1000,
    max: 25,
    message: 'Batas frekuensi analisis AI tercapai. Silakan coba kembali dalam beberapa menit.',
  });

      // Support up to 50MB for all JSON payloads (including high-resolution ECG images)
      app.use(
        express.json({
          limit: '50mb',
          type: ['application/json'],
  })
  );

  app.get('/api/health', (_req, res) => {
    const rawConfiguredModel = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
    const effectiveModel = resolvePrecisionGeminiModel();
    const hasKey = Boolean(
      process.env.GEMINI_API_KEY &&
      process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY' &&
      process.env.GEMINI_API_KEY.trim().length > 0
    );
    const midtransConfig = getMidtransConfig();
    res.json({
      status: 'ok',
      configuredModel: rawConfiguredModel,
      effectiveModel,
      apiKeyConfigured: hasKey,
      midtransConfigured: midtransConfig.isConfigured,
      midtransProduction: midtransConfig.isProduction,
    });
  });

  // Midtrans public client config for front-end Snap script
  app.get('/api/config/midtrans', (_req, res) => {
    const config = getMidtransConfig();
    res.json({
      clientKey: config.clientKey,
      isProduction: config.isProduction,
      isConfigured: config.isConfigured,
    });
  });

  // Subscription plans listing
  app.get('/api/subscription/plans', (_req, res) => {
    res.json(SUBSCRIPTION_PLANS);
  });

  // User & Guest Quota status endpoint
  app.get('/api/user/quota', (req, res) => {
    const user = getAuthenticatedUser(req);
    const deviceId = getDeviceId(req);

    if (user) {
      const isSubscribed = user.subscriptionStatus === 'active';
      res.json({
        isAuthenticated: true,
        user: sanitizeUser(user),
        isSubscribed,
        subscriptionStatus: user.subscriptionStatus,
        subscriptionPlan: user.subscriptionPlan,
        subscriptionExpiresAt: user.subscriptionExpiresAt,
        usageCount: user.freeUsageCount,
        remainingQuota: isSubscribed ? 999999 : Math.max(0, 3 - user.freeUsageCount),
        maxFreeLimit: 3,
      });
    } else {
      const device = db.getDeviceUsage(deviceId);
      res.json({
        isAuthenticated: false,
        user: null,
        isSubscribed: false,
        subscriptionStatus: 'none',
        subscriptionPlan: null,
        subscriptionExpiresAt: null,
        usageCount: device.usageCount,
        remainingQuota: Math.max(0, 3 - device.usageCount),
        maxFreeLimit: 3,
      });
    }
  });

  // Authentication - Register (Protected by strict rate limiter and input validation)
  app.post('/api/auth/register', authLimiter, (req, res) => {
    try {
      const { username, name, email, password } = req.body || {};
      const deviceId = getDeviceId(req);

      const finalUsername = (username || name || '').trim();

      if (!finalUsername || finalUsername.length < 3 || finalUsername.length > 30) {
        res.status(400).json({ error: 'Username wajib diisi (3 hingga 30 karakter).' });
        return;
      }

      if (!/^[a-zA-Z0-9_.-]+$/.test(finalUsername)) {
        res.status(400).json({
          error:
            'Username hanya boleh berisi huruf, angka, titik (.), tanda hubung (-), atau garis bawah (_).',
        });
        return;
      }

      if (db.getUserByUsername(finalUsername)) {
        res.status(409).json({
          error: 'Username ini sudah digunakan. Silakan pilih username yang lain.',
        });
        return;
      }

      if (!isValidEmail(email)) {
        res.status(400).json({
          error: 'Alamat email tidak valid. Masukkan format email yang benar (contoh: nama@domain.com).',
        });
        return;
      }

      const existingEmail = db.getUserByEmail(email);
      if (existingEmail) {
        res.status(409).json({
          error: 'Email ini sudah terdaftar. Silakan masuk menggunakan akun Anda.',
        });
        return;
      }

      if (!password || typeof password !== 'string' || password.length < 6 || password.length > 128) {
        res.status(400).json({
          error: 'Kata sandi minimal 6 karakter dan maksimal 128 karakter untuk menjaga keamanan akun Anda.',
        });
        return;
      }

      const sanitizedDisplayName = sanitizeText(name || finalUsername, 50) || finalUsername;
      const device = db.getDeviceUsage(deviceId);
      const { hash, salt } = hashPassword(password);
      const userId = `usr_${crypto.randomUUID()}`;
      const now = new Date().toISOString();

      const newUser = db.createUser({
        id: userId,
        name: sanitizedDisplayName,
        username: finalUsername,
        email: email.trim().toLowerCase(),
        passwordHash: hash,
        salt,
        freeUsageCount: device.usageCount,
        subscriptionStatus: 'none',
        subscriptionPlan: null,
        subscriptionExpiresAt: null,
        createdAt: now,
        updatedAt: now,
      });

      db.linkDeviceToUser(deviceId, userId);
      const token = generateToken(newUser);

      res.status(201).json({
        user: sanitizeUser(newUser),
        token,
        message: 'Pendaftaran akun berhasil.',
      });
    } catch (err) {
      console.error('Registration error:', err);
      res.status(500).json({ error: 'Gagal melakukan pendaftaran akun. Silakan coba sesaat lagi.' });
    }
  });

  // Authentication - Login (Protected by authLimiter)
  app.post('/api/auth/login', authLimiter, (req, res) => {
    try {
      const { identifier, username, email, password } = req.body || {};
      const deviceId = getDeviceId(req);

      const loginId = (identifier || username || email || '').trim();

      if (!loginId || !password || typeof password !== 'string' || password.length > 128) {
        res.status(400).json({
          error: 'Username atau email dan kata sandi wajib diisi.',
        });
        return;
      }

      // Find user by either username or email
      const user = db.getUserByUsernameOrEmail(loginId);
      if (!user) {
        res.status(401).json({
          error: 'Username/Email atau kata sandi salah. Silakan periksa kembali data Anda.',
        });
        return;
      }

      const isMatch = verifyPassword(password, user.passwordHash, user.salt);
      if (!isMatch) {
        res.status(401).json({
          error: 'Username/Email atau kata sandi salah. Silakan periksa kembali data Anda.',
        });
        return;
      }

      db.linkDeviceToUser(deviceId, user.id);
      const token = generateToken(user);

      res.json({
        user: sanitizeUser(user),
        token,
        message: 'Berhasil masuk ke akun.',
      });
    } catch (err) {
      console.error('Login error:', err);
      res.status(500).json({ error: 'Gagal memproses proses masuk. Silakan coba sesaat lagi.' });
    }
  });

  // Authentication - Current User
  app.get('/api/auth/me', (req, res) => {
    const user = getAuthenticatedUser(req);
    if (!user) {
      res.status(401).json({ error: 'Sesi telah berakhir atau belum terautentikasi.' });
      return;
    }
    res.json({ user: sanitizeUser(user) });
  });

  // Authentication - Update Profile & Change Password
  app.patch('/api/auth/profile', authLimiter, (req, res) => {
    try {
      const user = getAuthenticatedUser(req);
      if (!user) {
        res.status(401).json({ error: 'Silakan masuk terlebih dahulu.' });
        return;
      }

      const { name, currentPassword, newPassword } = req.body || {};
      const updates: Partial<typeof user> = {};

      if (typeof name === 'string') {
        const cleanedName = sanitizeText(name, 50);
        if (cleanedName.length < 2) {
          res.status(400).json({ error: 'Nama tampilan minimal 2 karakter.' });
          return;
        }
        updates.name = cleanedName;
      }

      if (newPassword !== undefined && newPassword !== '') {
        if (typeof currentPassword !== 'string' || !currentPassword) {
          res.status(400).json({ error: 'Kata sandi saat ini wajib diisi untuk mengubah kata sandi.' });
          return;
        }
        if (typeof newPassword !== 'string' || newPassword.length < 6 || newPassword.length > 128) {
          res.status(400).json({ error: 'Kata sandi baru minimal 6 karakter dan maksimal 128 karakter.' });
          return;
        }
        const validCurrent = verifyPassword(currentPassword, user.passwordHash, user.salt);
        if (!validCurrent) {
          res.status(401).json({ error: 'Kata sandi saat ini tidak sesuai.' });
          return;
        }
        const { hash, salt } = hashPassword(newPassword);
        updates.passwordHash = hash;
        updates.salt = salt;
      }

      if (Object.keys(updates).length === 0) {
        res.status(400).json({ error: 'Tidak ada perubahan profil yang dikirimkan.' });
        return;
      }

      const updated = db.updateUser(user.id, updates);
      if (!updated) {
        res.status(404).json({ error: 'Akun pengguna tidak ditemukan.' });
        return;
      }

      res.json({
        user: sanitizeUser(updated),
        message: 'Profil akun berhasil diperbarui.',
      });
    } catch (err) {
      console.error('Update profile error:', err);
      res.status(500).json({ error: 'Gagal memperbarui profil akun.' });
    }
  });

  // User - Transaction History
  app.get('/api/user/transactions', (req, res) => {
    const user = getAuthenticatedUser(req);
    if (!user) {
      res.status(401).json({ error: 'Silakan masuk terlebih dahulu.' });
      return;
    }

    const txs = db.getUserTransactions(user.id).map((t) => ({
      orderId: t.orderId,
      userId: t.userId,
      planId: t.planId,
      amount: t.amount,
      status: t.status,
      snapToken: t.snapToken,
      snapRedirectUrl: t.snapRedirectUrl,
      paymentType: t.paymentType,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      paidAt: t.paidAt,
    }));

    res.json({ transactions: txs });
  });

  // User - ECG Analysis Report History (Structured JSON only, zero raw patient images)
  app.get('/api/user/history', (req, res) => {
    const user = getAuthenticatedUser(req);
    if (!user) {
      res.status(401).json({ error: 'Silakan masuk terlebih dahulu.' });
      return;
    }
    res.json({ history: db.getUserHistory(user.id) });
  });

  app.delete('/api/user/history/:id', (req, res) => {
    const user = getAuthenticatedUser(req);
    if (!user) {
      res.status(401).json({ error: 'Silakan masuk terlebih dahulu.' });
      return;
    }
    const recordId = sanitizeText(req.params.id, 64);
    db.deleteUserHistoryItem(user.id, recordId);
    res.json({ success: true });
  });

  app.delete('/api/user/history', (req, res) => {
    const user = getAuthenticatedUser(req);
    if (!user) {
      res.status(401).json({ error: 'Silakan masuk terlebih dahulu.' });
      return;
    }
    db.clearUserHistory(user.id);
    res.json({ success: true });
  });

  // Subscription - Create Midtrans Snap Transaction
  app.post('/api/subscription/create-transaction', async (req, res) => {
    try {
      const user = getAuthenticatedUser(req);
      if (!user) {
        res.status(401).json({ error: 'Silakan masuk terlebih dahulu untuk berlangganan.' });
        return;
      }

      const { planId } = req.body || {};
      const plan = getPlanById(planId);
      if (!plan) {
        res.status(400).json({ error: 'Paket berlangganan yang dipilih tidak valid.' });
        return;
      }

      const orderId = `ECG-${plan.id.toUpperCase()}-${user.id.slice(4, 12)}-${Date.now()}`;
      const snapResult = await createMidtransSnapTransaction({
        orderId,
        grossAmount: plan.price,
        customerName: user.name,
        customerEmail: user.email,
        planName: plan.name,
        planId: plan.id,
      });

      const now = new Date().toISOString();
      db.createTransaction({
        orderId,
        userId: user.id,
        planId: plan.id,
        amount: plan.price,
        status: 'pending',
        snapToken: snapResult.token,
        snapRedirectUrl: snapResult.redirectUrl,
        paymentType: null,
        createdAt: now,
        updatedAt: now,
        paidAt: null,
      });

      res.json({
        orderId,
        snapToken: snapResult.token,
        snapRedirectUrl: snapResult.redirectUrl,
        isSimulated: snapResult.isSimulated || false,
        plan,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('Create transaction error:', msg);
      res.status(500).json({ error: `Gagal membuat transaksi pembayaran: ${msg}` });
    }
  });

  // Subscription - Instant Sandbox Activation (Restricted to non-production only)
  app.post('/api/subscription/simulate-sandbox-activation', (req, res) => {
    try {
      const isProd = process.env.NODE_ENV === 'production';
      const midtransConf = getMidtransConfig();
      if (isProd || midtransConf.isProduction) {
        res.status(403).json({ error: 'Aktivasi simulasi sandbox dinonaktifkan pada lingkungan produksi.' });
        return;
      }

      const user = getAuthenticatedUser(req);
      if (!user) {
        res.status(401).json({ error: 'Silakan masuk terlebih dahulu untuk mengaktifkan langganan.' });
        return;
      }

      const { planId } = req.body || {};
      const plan = getPlanById(planId) || getPlanById('yearly')!;
      const orderId = `ECG-SANDBOX-${plan.id.toUpperCase()}-${user.id.slice(4, 12)}-${Date.now()}`;
      const durationDays = plan.durationDays;
      const now = new Date();

      let expiresAt: Date;
      if (user.subscriptionStatus === 'active' && user.subscriptionExpiresAt) {
        const currentExp = new Date(user.subscriptionExpiresAt);
        expiresAt =
          currentExp > now
            ? new Date(currentExp.getTime() + durationDays * 24 * 60 * 60 * 1000)
            : new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);
      } else {
        expiresAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);
      }

      db.createTransaction({
        orderId,
        userId: user.id,
        planId: plan.id,
        amount: plan.price,
        status: 'settlement',
        snapToken: `SIMULATED_SNAP_${orderId}`,
        snapRedirectUrl: 'https://app.sandbox.midtrans.com',
        paymentType: 'sandbox_test_activated',
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        paidAt: now.toISOString(),
      });

      const updatedUser = db.updateUser(user.id, {
        subscriptionStatus: 'active',
        subscriptionPlan: plan.id,
        subscriptionExpiresAt: expiresAt.toISOString(),
      });

      res.json({
        success: true,
        orderId,
        status: 'settlement',
        plan,
        user: updatedUser ? sanitizeUser(updatedUser) : null,
        message: `Paket ${plan.name} berhasil diaktifkan (Mode Uji Coba Sandbox).`,
      });
    } catch (err: unknown) {
      console.error('Simulate activation error:', err);
      res.status(500).json({ error: 'Gagal mengaktifkan langganan uji coba.' });
    }
  });

  // Subscription - Verify Order Status
  app.post('/api/subscription/verify-order/:orderId', async (req, res) => {
    try {
      const user = getAuthenticatedUser(req);
      if (!user) {
        res.status(401).json({ error: 'Silakan masuk terlebih dahulu.' });
        return;
      }

      const { orderId } = req.params;
      const tx = db.getTransaction(orderId);
      if (!tx) {
        res.status(404).json({ error: 'Data transaksi tidak ditemukan.' });
        return;
      }

      if (tx.userId !== user.id) {
        res.status(403).json({ error: 'Anda tidak memiliki hak akses untuk transaksi ini.' });
        return;
      }

      // Idempotent return if already confirmed
      if (tx.status === 'settlement') {
        const refreshedUser = db.getUserById(user.id);
        res.json({
          success: true,
          status: 'settlement',
          user: refreshedUser ? sanitizeUser(refreshedUser) : sanitizeUser(user),
        });
        return;
      }

      const plan = getPlanById(tx.planId);
      const durationDays = plan ? plan.durationDays : 30;

      let isSuccess = false;
      let paymentType = tx.paymentType;
      const midtransConf = getMidtransConfig();
      const isProd = process.env.NODE_ENV === 'production' || midtransConf.isProduction;

      // Allow simulated settlement only if NOT production AND midtrans is not configured
      if (!isProd && !midtransConf.isConfigured && tx.snapToken.startsWith('SIMULATED_SNAP_')) {
        isSuccess = true;
        paymentType = 'sandbox_simulated';
      } else {
        try {
          const midtransStatus = await checkMidtransOrderStatus(orderId);
          const status = midtransStatus.transaction_status;
          const fraud = midtransStatus.fraud_status;
          paymentType = midtransStatus.payment_type || paymentType;

          if (status === 'settlement' || (status === 'capture' && fraud === 'accept')) {
            isSuccess = true;
          } else if (['cancel', 'deny', 'expire'].includes(status)) {
            db.updateTransaction(orderId, { status, updatedAt: new Date().toISOString() });
            res.json({ success: false, status, message: `Transaksi ${status}.` });
            return;
          }
        } catch (checkErr) {
          console.warn('Could not check Midtrans status directly:', checkErr);
        }
      }

      if (isSuccess) {
        const now = new Date();
        let expiresAt: Date;
        if (user.subscriptionStatus === 'active' && user.subscriptionExpiresAt) {
          const currentExp = new Date(user.subscriptionExpiresAt);
          expiresAt =
            currentExp > now
              ? new Date(currentExp.getTime() + durationDays * 24 * 60 * 60 * 1000)
              : new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);
        } else {
          expiresAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);
        }

        db.updateTransaction(orderId, {
          status: 'settlement',
          paymentType,
          paidAt: now.toISOString(),
        });

        const updatedUser = db.updateUser(user.id, {
          subscriptionStatus: 'active',
          subscriptionPlan: tx.planId,
          subscriptionExpiresAt: expiresAt.toISOString(),
        });

        res.json({
          success: true,
          status: 'settlement',
          user: updatedUser ? sanitizeUser(updatedUser) : null,
        });
        return;
      }

      res.json({
        success: false,
        status: tx.status,
        message: 'Pembayaran belum diselesaikan atau sedang menunggu konfirmasi.',
      });
    } catch (err: unknown) {
      console.error('Verify order error:', err);
      res.status(500).json({ error: 'Gagal memverifikasi status pembayaran.' });
    }
  });

  // Midtrans Webhook / HTTP Notification
  app.post('/api/midtrans/notification', async (req, res) => {
    try {
      const notification = req.body;
      const orderId = notification?.order_id;
      const statusCode = notification?.status_code;
      const grossAmount = notification?.gross_amount;
      const signatureKey = notification?.signature_key;
      const transactionStatus = notification?.transaction_status;
      const fraudStatus = notification?.fraud_status;

      if (!orderId || !statusCode || grossAmount === undefined || !signatureKey) {
        res.status(400).json({ error: 'Invalid or incomplete notification payload' });
        return;
      }

      const isValidSignature = verifyMidtransSignature(orderId, statusCode, grossAmount, signatureKey);
      if (!isValidSignature) {
        console.warn('Invalid Midtrans notification signature received for order:', orderId);
        res.status(403).json({ error: 'Invalid signature' });
        return;
      }

      const tx = db.getTransaction(orderId);
      if (!tx) {
        res.status(404).json({ error: 'Transaction not found' });
        return;
      }

      // Replay attack / Idempotency protection: do not re-extend already settled order
      if (tx.status === 'settlement') {
        res.status(200).json({ status: 'ok', message: 'Transaction already settled' });
        return;
      }

      // Amount verification: ensure paid amount matches registered transaction amount
      if (Math.abs(Number(grossAmount) - Number(tx.amount)) > 0.01) {
        console.warn(`Gross amount mismatch for order ${orderId}: expected ${tx.amount}, got ${grossAmount}`);
        res.status(400).json({ error: 'Gross amount mismatch with transaction order' });
        return;
      }

      const now = new Date();
      if (
        transactionStatus === 'settlement' ||
        (transactionStatus === 'capture' && fraudStatus === 'accept')
      ) {
        const plan = getPlanById(tx.planId);
        const durationDays = plan ? plan.durationDays : 30;

        const user = db.getUserById(tx.userId);
        if (user) {
          let expiresAt: Date;
          if (user.subscriptionStatus === 'active' && user.subscriptionExpiresAt) {
            const currentExp = new Date(user.subscriptionExpiresAt);
            expiresAt =
              currentExp > now
                ? new Date(currentExp.getTime() + durationDays * 24 * 60 * 60 * 1000)
                : new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);
          } else {
            expiresAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);
          }

          db.updateUser(user.id, {
            subscriptionStatus: 'active',
            subscriptionPlan: tx.planId,
            subscriptionExpiresAt: expiresAt.toISOString(),
          });
        }

        db.updateTransaction(orderId, {
          status: 'settlement',
          paymentType: notification.payment_type || tx.paymentType,
          paidAt: now.toISOString(),
          rawNotification: notification,
        });
      } else if (['cancel', 'deny', 'expire'].includes(transactionStatus)) {
        db.updateTransaction(orderId, {
          status: transactionStatus as any,
          rawNotification: notification,
        });
      }

      res.status(200).json({ status: 'ok' });
    } catch (err) {
      console.error('Midtrans notification processing error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ECG Analysis Endpoint with Quota Enforcement, Rate Limiting, Dual-Pass Clinical Verification & SHA-256 Deterministic Reproducibility
  app.post(
    '/api/analyze-ecg',
    analyzeLimiter,
    async (req, res) => {
      try {
        const user = getAuthenticatedUser(req);
        const deviceId = getDeviceId(req);

        // Quota validation
        if (user) {
          const isSubscribed = user.subscriptionStatus === 'active';
          if (!isSubscribed && user.freeUsageCount >= 3) {
            res.status(403).json({
              error:
                'Batas 3 kali analisis gratis telah tercapai. Silakan berlangganan untuk melanjutkan penggunaan tanpa batas.',
              code: 'SUBSCRIPTION_REQUIRED',
              requiresAuth: false,
              requiresSubscription: true,
              usageCount: user.freeUsageCount,
              remainingQuota: 0,
            });
            return;
          }
        } else {
          const device = db.getDeviceUsage(deviceId);
          if (device.usageCount >= 3) {
            res.status(403).json({
              error:
                'Batas 3 kali analisis gratis untuk pengguna baru telah tercapai. Silakan masuk/daftar dan berlangganan untuk melanjutkan.',
              code: 'QUOTA_EXCEEDED',
              requiresAuth: true,
              requiresSubscription: true,
              usageCount: device.usageCount,
              remainingQuota: 0,
            });
            return;
          }
        }

        const {
          imageBase64,
          mimeType,
          orientationNote,
          fileName,
          reportLanguage,
          clinicalContext,
          analysisMode,
          bypassCache,
          pixelTelemetry: rawPixelTelemetry,
          diagnosticTiles: rawDiagnosticTiles,
        } = req.body || {};

        if (!imageBase64 || typeof imageBase64 !== 'string') {
          res.status(400).json({
            error: 'No ECG image data was received. Please upload or capture an ECG image.',
          });
          return;
        }

        const approximateBytes = Math.floor((imageBase64.length * 3) / 4);
        const validation = validateImageInput(mimeType, approximateBytes);
        if (!validation.valid) {
          res.status(400).json({ error: validation.error });
          return;
        }

        const normalizedMime = mimeType === 'image/jpg' ? 'image/jpeg' : mimeType;
        const safeLang: 'id' | 'en' = reportLanguage === 'en' ? 'en' : 'id';
        const safeMode: AnalysisMode = analysisMode === 'standard' ? 'standard' : 'verified';
        const sanitizedTelemetry = sanitizePixelTelemetry(rawPixelTelemetry);
        const sanitizedTiles = sanitizeDiagnosticTiles(rawDiagnosticTiles);
        const sanitizedContext =
          clinicalContext && typeof clinicalContext === 'object'
            ? {
              patientAgeSex: sanitizeText(clinicalContext.patientAgeSex, 80) || undefined,
              symptoms: sanitizeText(clinicalContext.symptoms, 220) || undefined,
              clinicalHistory: sanitizeText(clinicalContext.clinicalHistory, 220) || undefined,
            }
            : undefined;
        const hasClinicalContext = Boolean(
          sanitizedContext &&
          (sanitizedContext.patientAgeSex ||
            sanitizedContext.symptoms ||
            sanitizedContext.clinicalHistory)
        );

        const activeClinicalContext = hasClinicalContext ? sanitizedContext : undefined;
        const contextSignature = buildCacheContextSignature({
          reportLanguage: safeLang,
          analysisMode: safeMode,
          clinicalContext: activeClinicalContext,
        });

        const inputHash = computeDeterministicInputHash({
          mimeType: normalizedMime,
          imageBase64,
          reportLanguage: safeLang,
          analysisMode: safeMode,
          clinicalContext: activeClinicalContext,
        });

        const cachedMatch =
          bypassCache === true
            ? null
            : findCachedDeterministicAnalysis({
                exactFingerprint: inputHash,
                contextSignature,
                pixelTelemetry: sanitizedTelemetry,
              });

        let structuredReport: EcgAnalysisReport;
        let modelUsed: string;
        let dualPassCompleted = false;
        let mathChecksApplied: string[] = [];
        let cachedDeterministic = false;

        if (cachedMatch) {
          console.log(
            `[ECG AI] Deterministic ${cachedMatch.matchType} cache hit (${inputHash.slice(0, 12)}) — returning 100% identical verified report.`
          );
          structuredReport = cachedMatch.entry.report;
          modelUsed = cachedMatch.entry.modelUsed;
          dualPassCompleted = cachedMatch.entry.dualPassCompleted;
          mathChecksApplied = cachedMatch.entry.mathChecksApplied;
          cachedDeterministic = true;
        } else {
          const ai = getGeminiClient();
          const preferredModel = resolvePrecisionGeminiModel();

          const freshResult = await callGeminiWithSafeRetry(
            ai,
            preferredModel,
            normalizedMime,
            imageBase64,
            {
              orientationNote:
                typeof orientationNote === 'string'
                  ? sanitizeText(orientationNote, 120)
                  : 'Standard',
              reportLanguage: safeLang,
              analysisMode: safeMode,
              pixelTelemetry: sanitizedTelemetry,
              diagnosticTiles: sanitizedTiles,
              clinicalContext: activeClinicalContext,
            }
          );

          structuredReport = freshResult.report;
          modelUsed = freshResult.modelUsed;
          dualPassCompleted = freshResult.dualPassCompleted;
          mathChecksApplied = freshResult.mathChecksApplied;

          const aspectRatio =
            sanitizedTelemetry &&
            sanitizedTelemetry.imageWidth > 0 &&
            sanitizedTelemetry.imageHeight > 0
              ? sanitizedTelemetry.imageWidth / sanitizedTelemetry.imageHeight
              : undefined;

          setCachedDeterministicAnalysis(inputHash, {
            report: structuredReport,
            modelUsed,
            dualPassCompleted,
            mathChecksApplied,
            cachedAt: Date.now(),
            contextSignature,
            perceptualHash256: sanitizedTelemetry?.perceptualHash256,
            aspectRatio,
            rhythmPeakCount: sanitizedTelemetry?.rhythmPeakCount,
          });
        }

        const analyzedAt = new Date().toISOString();
        const analysisId = `ecg_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
        const cleanModelLabel = modelUsed.replace(/gemini/gi, 'AI');
        const safeFileName = sanitizeText(fileName, 100) || 'ECG-Tracing.jpg';

        const verification: VerificationMetadata = {
          mode: safeMode,
          dualPassCompleted,
          cachedDeterministic,
          mathChecksApplied,
          inputFingerprint: inputHash.slice(0, 12),
        };

        // Update quota usage (do not deduct extra free trial credit on deterministic cache hit) & save report metadata history (no image stored)
        let quotaInfo;
        if (user) {
          const isSubscribed = user.subscriptionStatus === 'active';
          let newCount = user.freeUsageCount;
          if (!isSubscribed && !cachedDeterministic) {
            newCount += 1;
            db.updateUser(user.id, { freeUsageCount: newCount });
          }
          quotaInfo = {
            usageCount: newCount,
            remainingQuota: isSubscribed ? 999999 : Math.max(0, 3 - newCount),
            isSubscribed,
          };

          db.addUserHistory(user.id, {
            id: analysisId,
            userId: user.id,
            analyzedAt,
            fileName: safeFileName,
            modelUsed: cleanModelLabel,
            reportLanguage: safeLang,
            clinicalContext: hasClinicalContext ? sanitizedContext : undefined,
            verification,
            report: structuredReport,
          });
        } else {
          const device = cachedDeterministic
            ? db.getDeviceUsage(deviceId)
            : db.incrementDeviceUsage(deviceId);
          quotaInfo = {
            usageCount: device.usageCount,
            remainingQuota: Math.max(0, 3 - device.usageCount),
            isSubscribed: false,
          };
        }

        res.json({
          analysisId,
          report: structuredReport,
          modelUsed: cleanModelLabel,
          analyzedAt,
          reportLanguage: safeLang,
          clinicalContext: hasClinicalContext ? sanitizedContext : undefined,
          verification,
          quota: quotaInfo,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unexpected error during ECG analysis.';

        if (message.includes('GEMINI_API_KEY is missing')) {
          res.status(503).json({
            error: 'Kunci GEMINI_API_KEY belum dikonfigurasi di file .env server.',
          });
          return;
        }
        if (
          message.includes('API_KEY_INVALID') ||
          message.toLowerCase().includes('api key not valid')
        ) {
          res.status(401).json({
            error: 'Kunci GEMINI_API_KEY tidak valid. Silakan periksa kembali API Key di Google AI Studio.',
          });
          return;
        }
        if (
          message.includes('429') ||
          message.toLowerCase().includes('quota') ||
          message.toLowerCase().includes('rate limit')
        ) {
          res.status(429).json({
            error: 'Batas kuota Gemini AI tercapai (Rate Limit). Silakan tunggu 1-2 menit lalu coba lagi.',
          });
          return;
        }

        console.error('ECG analysis error:', err);
        const detailedErr = process.env.NODE_ENV !== 'production' || message.includes('API') || message.includes('model')
          ? message
          : 'Gagal menganalisis gambar ECG. Silakan periksa API Key atau format gambar.';
        res.status(500).json({
          error: detailedErr,
        });
      }
    }
  );

  // Ensure unknown /api/* routes return JSON 404 instead of SPA HTML
  app.all('/api/*', (_req, res) => {
    res.status(404).json({ error: 'Endpoint API tidak ditemukan.' });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const HOST = process.env.HOST || (process.env.NODE_ENV === 'production' ? '127.0.0.1' : '0.0.0.0');
  const SERVER_PORT = Number(process.env.PORT) || PORT;

  app.listen(SERVER_PORT, HOST, () => {
    console.log(
      `AI ECG Analyzer server running on http://${HOST}:${SERVER_PORT} (Precision Model: ${resolvePrecisionGeminiModel()})`
    );
  });
}

startServer();


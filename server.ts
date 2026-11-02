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

// Privacy-Safe Ephemeral Deterministic Reproducibility Cache (stores SHA-256 hex -> JSON report ONLY; ZERO image bytes)
interface DeterministicCacheEntry {
  report: EcgAnalysisReport;
  modelUsed: string;
  dualPassCompleted: boolean;
  mathChecksApplied: string[];
  cachedAt: number;
}

const DETERMINISTIC_CACHE_MAX = 150;
const DETERMINISTIC_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const deterministicReportCache = new Map<string, DeterministicCacheEntry>();

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
  hasher.update(params.reportLanguage);
  hasher.update('|');
  hasher.update(params.analysisMode);
  hasher.update('|');
  hasher.update(JSON.stringify(params.clinicalContext || null));
  hasher.update('|');
  hasher.update(params.imageBase64);
  return hasher.digest('hex');
}

function getCachedDeterministicAnalysis(fingerprint: string): DeterministicCacheEntry | null {
  const entry = deterministicReportCache.get(fingerprint);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > DETERMINISTIC_CACHE_TTL_MS) {
    deterministicReportCache.delete(fingerprint);
    return null;
  }
  return entry;
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
      enum: ['Printed on ECG', 'Visually Estimated', 'AI Calculated', 'Unmeasurable'],
      description: 'Exact provenance of this measurement.',
    },
    value: {
      type: Type.STRING,
      description:
        'Single exact numeric value as string (e.g., "74", "158", "+54", "-45") or "Not measurable". Prefer a single representative integer rather than a vague range. Never fabricate precision.',
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
      description: 'Clinical interpretation of this value strictly concordant with the numeric threshold.',
    },
    reliabilityNote: {
      type: Type.STRING,
      description: 'Explanation of measurement reliability based on printed header legibility or 1mm/5mm paper grid.',
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
          pWave: { type: Type.STRING, description: 'P-wave polarity, contour, and visibility in this lead.' },
          qrsMorphology: { type: Type.STRING, description: 'Exact QRS pattern (e.g., qRs, rS, QS, rsR\'), net polarity (positive/negative/equiphasic), and pathological Q waves.' },
          stSegment: { type: Type.STRING, description: 'J-point and ST-segment position relative to TP/PR baseline in mm (isoelectric, elevated, or depressed).' },
          tWave: { type: Type.STRING, description: 'T-wave polarity (upright, flat, biphasic, inverted, hyperacute) and symmetry.' },
          rhythmAndWaveform: { type: Type.STRING, description: 'Overall waveform quality and tracking in this lead.' },
          abnormalities: { type: Type.STRING, description: 'Specific abnormalities in this lead or "None identified".' },
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
          description: 'Explicitly state net QRS polarity in Lead I, Lead II, and Lead aVF and the resulting Cabrera axis quadrant.',
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
      description: 'Detailed explanation of the assigned urgency classification.',
    },
    time_critical_warning: {
      type: Type.STRING,
      description: 'If a potentially time-critical or life-threatening abnormality (e.g., STEMI, VT/VF, 3rd degree AV block) is present, provide an explicit urgent warning recommending immediate emergency evaluation. Empty string if none.',
    },
    executive_summary: {
      type: Type.STRING,
      description: 'Concise, comprehensive 2-4 sentence executive clinical summary synthesized strictly from all verified measurements and lead findings.',
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

const ECG_SYSTEM_INSTRUCTION = `You are a board-level Senior Clinical Electrocardiography (ECG/EKG) Multimodal Analysis Engine built for high-precision, reproducible clinical decision support and medical education.

DETERMINISTIC CLINICAL MEASUREMENT & CONSISTENCY PROTOCOL (MANDATORY):

1. ORIENTATION, LAYOUT & CALIBRATION FIRST:
   - Automatically account for portrait/landscape orientation, 90/180/270-degree rotation, camera tilt, perspective distortion, and 12-lead layout (3x4 + 1 or 3 rhythm strips, 6x2, Cabrera, or single/multi-channel strips).
   - Verify paper speed (standard 25 mm/s vs 50 mm/s) and voltage gain (standard 10 mm/mV vs 5 or 20 mm/mV) from printed text OR the rectangular 1 mV calibration pulse (standard pulse = 10 mm tall x 5 mm wide). Never silently assume 25 mm/s and 10 mm/mV if neither printed text nor calibration pulse/grid is visible.
   - If the image is non-ECG, severely blurred, cropped, or unreadable, set image_quality.can_interpret_reliably = false and urgency_level = "Indeterminate because of image quality or insufficient information". NEVER default unreadable leads to normal.

2. PRINTED HEADER ANCHORING (ELIMINATES RUN-TO-RUN NUMERIC JITTER):
   - Inspect the top/bottom/margin header for printed numerical measurements (HR / Vent. Rate, PR, QRS, QT/QTc, P-R-T Axes).
   - When printed numbers are clearly legible AND visually concordant with the waveform tracing, transcribe the EXACT printed integer values and mark source = "Printed on ECG". Never arbitrarily round or jitter legible printed digits.
   - Only override a printed machine measurement if direct waveform inspection proves machine artifact error (e.g., double-counting tall T waves, baseline tremor); if overridden, document the exact discrepancy in printed_machine_interpretation.discrepancies.

3. QUANTITATIVE MILLIMETER GRID BOX-COUNTING (WHEN ESTIMATING VISUALLY AT 25 mm/s, 10 mm/mV):
   - Horizontal time grid: 1 small box (1 mm) = 40 ms; 1 large box (5 mm) = 200 ms; 5 large boxes (25 mm) = 1,000 ms (1.0 s).
   - Vertical voltage grid: 1 small box (1 mm) = 0.1 mV; 2 large boxes (10 mm) = 1.0 mV.
   - Regular Heart Rate: Calculate 1500 / (small 1mm boxes between R-R peaks) or 300 / (large 5mm boxes between R-R peaks). Output a single exact integer bpm (e.g., "75"), NOT a vague range.
   - Irregular Heart Rate (e.g., AFib): Count total QRS complexes across a 10-second rhythm strip (50 large boxes) and multiply by 6, outputting a single representative integer bpm.
   - QTc Calculation: Compute Bazett QTc = round(QT_ms / sqrt(60 / HR_bpm)), or Fridericia QTc = round(QT_ms / cbrt(60 / HR_bpm)) when HR < 50 or > 100 bpm. Mark derived QTc as source = "AI Calculated".

4. CABRERA HEXAXIAL QRS AXIS QUADRANT LOCKING (ZERO CONTRADICTION RULE):
   - Determine net QRS area/amplitude [R - (Q + S)] in Lead I, Lead II, and Lead aVF BEFORE writing electrical_axis.qrs_axis:
     * Lead I (+) AND Lead aVF (+) -> Normal Quadrant (0° to +90°).
     * Lead I (+), Lead aVF (-), AND Lead II (+) -> Normal Physiological Left (0° to -30°).
     * Lead I (+), Lead aVF (-), AND Lead II (-) -> Left Axis Deviation / LAD (-30° to -90°).
     * Lead I (-) AND Lead aVF (+) -> Right Axis Deviation / RAD (+90° to +180°).
     * Lead I (-) AND Lead aVF (-) -> Extreme / Northwest Axis (-90° to -180°).
   - Refine the degree angle to the nearest 5° using the most equiphasic (isoelectric) limb lead (axis lies ±90° perpendicular to the equiphasic lead). NEVER output a QRS axis angle that contradicts the net QRS polarity reported in lead_analysis for Leads I, II, and aVF.

5. RHYTHM & CONDUCTION RIGOR:
   - Sinus Rhythm requires discrete upright P waves in Leads I, II, and aVF with inverted P wave in aVR, consistent PR morphology, and 1:1 P-to-QRS conduction.
   - Atrial Fibrillation requires BOTH (a) absence of discrete repeating sinus P waves (verify carefully in Lead II and V1) AND (b) irregularly irregular R-R intervals (unless complete AV block or ventricularly paced). Never misclassify sinus arrhythmia, PACs, or noisy baseline with visible P waves as AFib.
   - Check bundle branch criteria strictly when QRS >= 120 ms: RBBB (rsR' or tall broad R in V1-V2 + wide slurred S in I, V5-V6) vs LBBB (broad monophasic R/notched R without Q in I, aVL, V5-V6 + deep rS/QS in V1-V2).

6. CONTIGUOUS-LEAD ISCHEMIA / STEMI DISCIPLINE:
   - Measure ST elevation or depression at the J-point relative to the TP/PR isoelectric baseline.
   - Acute STEMI pattern requires J-point ST elevation >= 1 mm (>= 2 mm in V2-V3) in >= 2 anatomically contiguous leads:
     * Inferior: II, III, aVF (always check reciprocal ST depression in I, aVL)
     * Septal / Anterior: V1-V2 / V1-V4
     * Lateral: I, aVL, V5, V6
   - Carefully distinguish true primary ischemic ST shifts from: (a) uneven camera lighting/shadows or paper curvature, (b) benign early repolarization (notched J-point with tall concordant T waves, no reciprocal STD), (c) acute pericarditis (diffuse concave STE across territories + PR depression without reciprocal STD except aVR), and (d) expected discordant secondary ST-T changes in LBBB, RV pacing, or LVH strain.

7. DETERMINISTIC 5-TIER URGENCY RUBRIC (APPLY CONSISTENTLY EVERY RUN):
   - "Indeterminate because of image quality or insufficient information": Unreadable/non-ECG image or can_interpret_reliably = false.
   - "Critical pattern requiring immediate emergency evaluation": Acute STEMI or STEMI-equivalent (De Winter, hyperacute T, isolated posterior MI V1-V3 STD with tall R, Sgarbossa-positive LBBB), sustained VT/VF/Torsades, 3rd-degree (complete) AV block, Mobitz II 2nd-degree AV block, sine-wave severe hyperkalemia pattern, or extreme unstable-rate arrhythmia (HR >= 180 or < 35 bpm).
   - "Potentially urgent abnormality": Acute ischemic ST depression or deep symmetric Wellens/NSTE-ACS T-wave inversions, AFib/AFlutter with rapid ventricular response (HR > 110 bpm), narrow/wide regular SVT, Brugada Type 1 pattern, marked QTc prolongation (QTc >= 500 ms), Mobitz I with symptomatic-range bradycardia, or ventricular pauses > 2.5 s.
   - "Abnormal ECG": Non-emergent / chronic / stable abnormalities — rate-controlled AFib (60-110 bpm), 1st-degree AV block, RBBB, stable LBBB without Sgarbossa criteria, LAFB/LPFB, LVH/RVH, atrial enlargement, old pathological Q-wave MI without acute ST elevation, isolated PACs/PVCs, mild sinus bradycardia (45-59 bpm) or mild sinus tachycardia (101-125 bpm), borderline QTc (460-499 ms), or nonspecific ST-T flattening/inversion.
   - "Normal ECG appearance": Regular sinus rhythm (60-100 bpm), PR 120-200 ms, QRS < 120 ms, normal QTc (<= 450 ms M / <= 460 ms F), QRS axis -30° to +90°, normal R-wave progression V1-V6, and zero pathological Q, ST, T, or conduction abnormalities across all visible leads. Always note that a normal ECG does not exclude ACS or cardiac disease.

8. COMPLETE CROSS-SECTION INTERNAL CONSISTENCY:
   - Every section (lead_analysis, heart_rate, rhythm, intervals, electrical_axis, waveform_morphology, ischemia_and_infarction, arrhythmias_and_conduction, ai_interpretation, urgency_level, executive_summary, and 11-point clinical_impression) MUST agree 100% with zero internal contradictions. Do not prescribe specific drug dosages.`;

const ECG_AUDITOR_SYSTEM_INSTRUCTION = `You are the Chief Cardiologist Quality & Consistency Auditor reviewing a Pass-1 AI ECG analysis draft against the actual ECG image pixels.

YOUR MANDATORY VERIFICATION CHECKLIST:
1. HEADER & DIGIT AUDIT: Zoom into any printed ECG header numbers (HR, PR, QRS, QT/QTc, P-R-T axes) and printed machine text. If Pass-1 misread any digit or failed to use clearly legible concordant printed measurements, fix them immediately.
2. BOX-COUNT & RHYTHM AUDIT: Re-verify R-R spacing on the 1mm/5mm grid, P-wave presence in Lead II and V1, and 1:1 AV conduction. Correct any false AFib calls when sinus P waves exist, or missed AFib when P waves are absent with irregularly irregular R-R intervals.
3. CABRERA QRS AXIS AUDIT: Check net QRS polarity in Lead I, Lead II, and Lead aVF on the image. Ensure electrical_axis.qrs_axis degree value and assessment match the true Cabrera quadrant with zero contradiction against lead_analysis.
4. CONTIGUOUS ST-T & ARTIFACT AUDIT: Re-check every ST-elevation/depression claim at the J-point vs TP baseline across contiguous territories (II/III/aVF, V1-V4, I/aVL/V5-V6). Eliminate false-positive STEMI calls caused by camera shadow or baseline drift, and ensure genuine contiguous ST shifts + reciprocal changes are accurately reported.
5. 14-SECTION HARMONIZATION: Ensure lead_analysis, intervals, axis, morphology, ischemia, conduction, ai_interpretation, urgency_level (using the exact 5-tier rubric), executive_summary, and 11-point clinical_impression are 100% aligned with zero contradictions.

Return the final, verified, deterministic JSON report conforming strictly to the schema.`;

interface AnalyzeCallOptions {
  orientationNote: string;
  reportLanguage: 'id' | 'en';
  analysisMode: AnalysisMode;
  clinicalContext?: {
    patientAgeSex?: string;
    symptoms?: string;
    clinicalHistory?: string;
  };
}

function supportsThinkingConfig(modelName: string): boolean {
  return /^gemini-(2\.5|3)/i.test(modelName.trim());
}

async function generateDeterministicEcgJson(params: {
  ai: GoogleGenAI;
  modelName: string;
  mimeType: string;
  base64Data: string;
  promptText: string;
  systemInstruction: string;
  thinkingBudget: number;
}): Promise<unknown> {
  const { ai, modelName, mimeType, base64Data, promptText, systemInstruction, thinkingBudget } = params;

  const fullConfig: Record<string, unknown> = {
    systemInstruction,
    responseMimeType: 'application/json',
    responseSchema: ecgResponseSchema,
    temperature: 0,
    topP: 0.05,
    seed: DETERMINISTIC_SEED,
    mediaResolution: MediaResolution.MEDIA_RESOLUTION_HIGH,
  };

  if (supportsThinkingConfig(modelName) && thinkingBudget > 0) {
    fullConfig.thinkingConfig = {
      thinkingBudget,
    };
  }

  const contents = {
    parts: [
      {
        inlineData: {
          mimeType,
          data: base64Data,
        },
      },
      {
        text: promptText,
      },
    ],
  };

  try {
    const response = await ai.models.generateContent({
      model: modelName,
      contents,
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
        msg.includes('Unknown name'));

    if (!isUnsupportedParam400) {
      throw err;
    }

    console.warn(
      `[ECG AI] Model ${modelName} rejected extended config parameter; retrying with core deterministic config (temperature=0)...`
    );
    const fallbackResponse = await ai.models.generateContent({
      model: modelName,
      contents,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: ecgResponseSchema,
        temperature: 0,
      },
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
      ? `OUTPUT LANGUAGE: Write all descriptive clinical text, summaries, morphological findings, rhythm reasoning, clinical impressions, limitations, and recommended next steps in professional, clear Indonesian medical terminology (Bahasa Indonesia Klinis).
STRICT ENUM PRESERVATION: You MUST keep all strict enum fields in their exact English schema values:
- image_quality.overall_readability: "High" | "Moderate" | "Low" | "Unreadable"
- urgency_level: "Normal ECG appearance" | "Abnormal ECG" | "Potentially urgent abnormality" | "Critical pattern requiring immediate emergency evaluation" | "Indeterminate because of image quality or insufficient information"
- MeasuredValue.source: "Printed on ECG" | "Visually Estimated" | "AI Calculated" | "Unmeasurable"
- confidence.overall_level: "High" | "Moderate" | "Low" | "Insufficient Image Quality"`
      : 'OUTPUT LANGUAGE: Write all clinical descriptions, reasoning, impressions, and recommendations in clear, standard international clinical English.';

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

  const pass1Prompt = `Perform a high-precision, reproducible systematic 12-lead ECG analysis following the exact bottom-up evidence order in the JSON schema:
1. First inspect paper speed, mV gain calibration, layout, and printed machine header text/digits.
2. Examine every visible lead individually in canonical sequence (I, II, III, aVR, aVL, aVF, V1–V6, rhythm strip).
3. Establish accurate heart rate, rhythm, PR/QRS/QT/QTc intervals, and Cabrera QRS electrical axis locked to Leads I, II, and aVF.
4. Evaluate morphology, contiguous-lead ischemia/STEMI patterns, and arrhythmias/conduction blocks.
5. Synthesize a 100% internally consistent primary interpretation, urgency tier, executive summary, and 11-point clinical impression.
Client orientation metadata note: ${options.orientationNote || 'Auto-detected by client'}.
${languageDirective}${clinicalContextBlock}`;

  for (const modelName of candidateModels) {
    const maxAttempts = 2;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        console.log(
          `[ECG AI] Pass 1 primary analysis with ${modelName} (mode=${options.analysisMode}, attempt ${attempt}/${maxAttempts})...`
        );
        const pass1Raw = await generateDeterministicEcgJson({
          ai,
          modelName,
          mimeType,
          base64Data,
          promptText: pass1Prompt,
          systemInstruction: ECG_SYSTEM_INSTRUCTION,
          thinkingBudget: 2048,
        });

        const pass1Checked = validateAndCrossCheckEcgResponse(pass1Raw);

        // If fast 1-pass mode requested or image is completely unreadable, return Pass 1 + Math Check directly
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

        // Pass 2: Senior Cardiologist Consistency & Pixel-Verification Audit
        try {
          console.log(`[ECG AI] Pass 2 clinical consistency audit with ${modelName}...`);
          const pass2Prompt = `Audit and verify the following Pass-1 ECG JSON draft directly against the attached high-resolution ECG image.
Correct any misread header digits, R-R box-count errors, P-wave/rhythm misclassifications, Lead I/II/aVF Cabrera QRS axis contradictions, false ST-elevation from shadow/tilt, or cross-section inconsistencies. Preserve accurate verified measurements without unnecessary wording drift.
${languageDirective}${clinicalContextBlock}

PASS-1 DRAFT JSON TO AUDIT AGAINST THE IMAGE:
${JSON.stringify(pass1Checked.report)}`;

          const pass2Raw = await generateDeterministicEcgJson({
            ai,
            modelName,
            mimeType,
            base64Data,
            promptText: pass2Prompt,
            systemInstruction: ECG_AUDITOR_SYSTEM_INSTRUCTION,
            thinkingBudget: 1024,
          });

          const pass2Checked = validateAndCrossCheckEcgResponse(pass2Raw);
          const combinedMathChecks = Array.from(
            new Set([...pass1Checked.mathChecksApplied, ...pass2Checked.mathChecksApplied])
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
            `[ECG AI] Pass 2 audit encountered non-fatal error (${auditMsg}); returning deterministically cross-checked Pass 1 report.`
          );
          return {
            report: pass1Checked.report,
            modelUsed: modelName,
            dualPassCompleted: false,
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

        if (isQuotaOrRateLimit) {
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
    const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
    const hasKey = Boolean(
      process.env.GEMINI_API_KEY &&
      process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY' &&
      process.env.GEMINI_API_KEY.trim().length > 0
    );
    const midtransConfig = getMidtransConfig();
    res.json({
      status: 'ok',
      configuredModel: model,
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

        const inputHash = computeDeterministicInputHash({
          mimeType: normalizedMime,
          imageBase64,
          reportLanguage: safeLang,
          analysisMode: safeMode,
          clinicalContext: hasClinicalContext ? sanitizedContext : undefined,
        });

        const cachedHit =
          bypassCache === true ? null : getCachedDeterministicAnalysis(inputHash);

        let structuredReport: EcgAnalysisReport;
        let modelUsed: string;
        let dualPassCompleted = false;
        let mathChecksApplied: string[] = [];
        let cachedDeterministic = false;

        if (cachedHit) {
          console.log(
            `[ECG AI] Deterministic SHA-256 cache hit (${inputHash.slice(0, 12)}) — returning 100% identical verified report.`
          );
          structuredReport = cachedHit.report;
          modelUsed = cachedHit.modelUsed;
          dualPassCompleted = cachedHit.dualPassCompleted;
          mathChecksApplied = cachedHit.mathChecksApplied;
          cachedDeterministic = true;
        } else {
          const ai = getGeminiClient();
          const preferredModel = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;

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
              clinicalContext: hasClinicalContext ? sanitizedContext : undefined,
            }
          );

          structuredReport = freshResult.report;
          modelUsed = freshResult.modelUsed;
          dualPassCompleted = freshResult.dualPassCompleted;
          mathChecksApplied = freshResult.mathChecksApplied;

          setCachedDeterministicAnalysis(inputHash, {
            report: structuredReport,
            modelUsed,
            dualPassCompleted,
            mathChecksApplied,
            cachedAt: Date.now(),
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
    console.log(`AI ECG Analyzer server running on http://${HOST}:${SERVER_PORT}`);
  });
}

startServer();


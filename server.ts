import 'dotenv/config';
import express from 'express';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type, Schema } from '@google/genai';
import {
  validateImageInput,
  validateAndNormalizeEcgResponse,
} from './src/utils/ecgValidation.ts';
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
const DEFAULT_GEMINI_MODEL = 'gemini-3.6-flash';

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
    value: {
      type: Type.STRING,
      description: 'Numeric value as string (e.g., "74", "158", "+54") or "Not measurable". Never fabricate precision.',
    },
    unit: {
      type: Type.STRING,
      description: 'Unit such as "bpm", "ms", or "°".',
    },
    source: {
      type: Type.STRING,
      description: 'Must be one of: "Printed on ECG", "Visually Estimated", "AI Calculated", or "Unmeasurable".',
    },
    normalRange: {
      type: Type.STRING,
      description: 'Standard adult reference range for this parameter.',
    },
    assessment: {
      type: Type.STRING,
      description: 'Clinical interpretation of this value (e.g., "Within normal limits", "Prolonged", "Indeterminate").',
    },
    reliabilityNote: {
      type: Type.STRING,
      description: 'Explanation of measurement reliability based on paper grid visibility, speed, gain, or printed header.',
    },
  },
  required: ['value', 'unit', 'source', 'normalRange', 'assessment', 'reliabilityNote'],
};

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
        gain_calibration: { type: Type.STRING, description: 'Printed gain or calibration pulse (e.g., "10 mm/mV") or state that it is unconfirmed.' },
        visible_leads_count: { type: Type.STRING, description: 'Number and list of visible leads (e.g., "12 standard leads + Rhythm Strip II").' },
        recording_duration: { type: Type.STRING, description: 'Identifiable recording duration (e.g., "10 seconds") or "Not explicitly indicated".' },
        detected_orientation_and_layout: { type: Type.STRING, description: 'Detected image orientation (portrait/landscape/rotated/tilted) and lead layout format.' },
      },
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
          description: 'Must be one of: "High", "Moderate", "Low", or "Unreadable".',
        },
        orientation_handled: {
          type: Type.STRING,
          description: 'How image orientation (0/90/180/270 degree rotation, tilt, portrait/landscape) was interpreted.',
        },
        perspective_and_tilt_notes: {
          type: Type.STRING,
          description: 'Assessment of perspective distortion, camera angle, or paper curvature.',
        },
        grid_visibility: {
          type: Type.STRING,
          description: 'Visibility of 1mm and 5mm calibration grid lines.',
        },
        artifacts_or_obstructions: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'List of any blur, cropping, shadows, baseline wander, or obstructions.',
        },
        can_interpret_reliably: {
          type: Type.BOOLEAN,
          description: 'True if the image contains readable ECG waveforms supporting clinical interpretation; false if unreadable or non-ECG.',
        },
      },
      required: [
        'overall_readability',
        'orientation_handled',
        'perspective_and_tilt_notes',
        'grid_visibility',
        'artifacts_or_obstructions',
        'can_interpret_reliably',
      ],
    },
    executive_summary: {
      type: Type.STRING,
      description: 'Concise, comprehensive 2-4 sentence executive clinical summary of the ECG.',
    },
    urgency_level: {
      type: Type.STRING,
      description:
        'Must be one of: "Normal ECG appearance", "Abnormal ECG", "Potentially urgent abnormality", "Critical pattern requiring immediate emergency evaluation", or "Indeterminate because of image quality or insufficient information".',
    },
    urgency_explanation: {
      type: Type.STRING,
      description: 'Detailed explanation of the assigned urgency classification.',
    },
    time_critical_warning: {
      type: Type.STRING,
      description: 'If a potentially time-critical or life-threatening abnormality (e.g., STEMI, VT/VF, 3rd degree AV block) is present, provide an explicit urgent warning recommending immediate emergency evaluation. Empty string if none.',
    },
    heart_rate: {
      type: Type.OBJECT,
      properties: {
        ventricular_rate_bpm: measuredValueSchema,
        atrial_rate_bpm: measuredValueSchema,
        rate_regularity_note: { type: Type.STRING },
      },
      required: ['ventricular_rate_bpm', 'atrial_rate_bpm', 'rate_regularity_note'],
    },
    rhythm: {
      type: Type.OBJECT,
      properties: {
        underlying_rhythm: { type: Type.STRING },
        regularity: { type: Type.STRING },
        p_wave_presence_and_morphology: { type: Type.STRING },
        p_qrs_relationship: { type: Type.STRING },
        pr_interval_overview: { type: Type.STRING },
        sinus_vs_alternative_evidence: { type: Type.STRING },
        premature_beats_pauses_disturbances: { type: Type.STRING },
        av_block_evidence: { type: Type.STRING },
        afib_flutter_arrhythmia_evidence: { type: Type.STRING },
        rhythm_reasoning: { type: Type.STRING },
      },
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
        qtc_interval_ms: measuredValueSchema,
        qtc_formula_used: {
          type: Type.STRING,
          description: 'State formula used (e.g., "Bazett (printed on ECG)", "Bazett (AI calculated)", "Fridericia", or "Not calculated due to unreliable QT/RR").',
        },
      },
      required: ['pr_interval_ms', 'qrs_duration_ms', 'qt_interval_ms', 'qtc_interval_ms', 'qtc_formula_used'],
    },
    electrical_axis: {
      type: Type.OBJECT,
      properties: {
        p_wave_axis: measuredValueSchema,
        qrs_axis: measuredValueSchema,
        t_wave_axis: measuredValueSchema,
        axis_deviation_summary: { type: Type.STRING },
      },
      required: ['p_wave_axis', 'qrs_axis', 't_wave_axis', 'axis_deviation_summary'],
    },
    lead_analysis: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          leadName: { type: Type.STRING, description: 'Lead name (e.g., "Lead I", "Lead II", "Lead III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6") or state if unidentified.' },
          identifiedFromLabel: { type: Type.BOOLEAN, description: 'True if lead label was directly read from the image.' },
          rhythmAndWaveform: { type: Type.STRING },
          pWave: { type: Type.STRING },
          qrsMorphology: { type: Type.STRING },
          stSegment: { type: Type.STRING },
          tWave: { type: Type.STRING },
          abnormalities: { type: Type.STRING },
          confidenceAndLimitations: { type: Type.STRING },
        },
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
        acute_ischemia_patterns: { type: Type.STRING },
        stemi_patterns: { type: Type.STRING },
        nstemi_acs_patterns: { type: Type.STRING },
        prior_infarction_evidence: { type: Type.STRING },
        reciprocal_changes: { type: Type.STRING },
        posterior_or_rv_infarction_patterns: { type: Type.STRING },
        pericarditis_like_patterns: { type: Type.STRING },
        affected_leads: { type: Type.STRING },
        pattern_vs_diagnosis_distinction: { type: Type.STRING },
      },
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
        required: ['category', 'observation', 'affectedLeads', 'clinicalSignificance'],
      },
    },
    electrolyte_disclaimer_note: {
      type: Type.STRING,
      description: 'Explicit statement that ECG findings associated with electrolyte disturbances do not independently establish an electrolyte diagnosis.',
    },
    printed_machine_interpretation: {
      type: Type.OBJECT,
      properties: {
        is_present: { type: Type.BOOLEAN },
        extracted_text: { type: Type.STRING },
        comparison_with_ai: { type: Type.STRING },
        agreements: { type: Type.ARRAY, items: { type: Type.STRING } },
        discrepancies: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
      required: ['is_present', 'extracted_text', 'comparison_with_ai', 'agreements', 'discrepancies'],
    },
    ai_interpretation: {
      type: Type.OBJECT,
      properties: {
        primary_interpretation: { type: Type.STRING },
        major_abnormalities: { type: Type.ARRAY, items: { type: Type.STRING } },
        secondary_findings: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
      required: ['primary_interpretation', 'major_abnormalities', 'secondary_findings'],
    },
    clinical_impression: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'Structured 11-point conclusion covering primary interpretation, rhythm, rate, intervals, axis, major abnormalities, ischemia/infarction, conduction, other findings, limitations, and clinical context.',
    },
    recommended_next_steps: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'Educational and clinical-support next steps (e.g., physician review, serial ECGs, clinical correlation). Do not prescribe specific drug dosages.',
    },
    limitations: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    confidence: {
      type: Type.OBJECT,
      properties: {
        overall_level: {
          type: Type.STRING,
          description: 'Must be one of: "High", "Moderate", "Low", or "Insufficient Image Quality".',
        },
        rationale: { type: Type.STRING },
      },
      required: ['overall_level', 'rationale'],
    },
  },
  required: [
    'recording_information',
    'image_quality',
    'executive_summary',
    'urgency_level',
    'urgency_explanation',
    'time_critical_warning',
    'heart_rate',
    'rhythm',
    'intervals',
    'electrical_axis',
    'lead_analysis',
    'waveform_morphology',
    'ischemia_and_infarction',
    'arrhythmias_and_conduction',
    'additional_findings',
    'electrolyte_disclaimer_note',
    'printed_machine_interpretation',
    'ai_interpretation',
    'clinical_impression',
    'recommended_next_steps',
    'limitations',
    'confidence',
  ],
};

const ECG_SYSTEM_INSTRUCTION = `You are an expert clinical electrocardiography (ECG/EKG) multimodal analysis system built for clinical decision support and medical education.

CRITICAL DIRECTIVES:
1. ZERO MANUAL PREPROCESSING: Automatically account for portrait/landscape orientation, 90/180/270-degree rotation, upside-down images, camera tilt, perspective distortion, and varied 12-lead layouts (e.g., 3x4 with 1 or 3 rhythm strips, 6x2, Cabrillo, or single/multi-channel strips).
2. STRICT MEASUREMENT & RELIABILITY RULES:
   - NEVER fabricate measurements or patient demographics.
   - NEVER assume standard paper speed (25 mm/s) or gain (10 mm/mV) if they are not printed or verifiable from a calibration pulse.
   - Prefer clearly printed machine measurements when legible, and explicitly mark their source as "Printed on ECG". Mark visually measured values as "Visually Estimated" and derived values as "AI Calculated". If unreadable, mark as "Unmeasurable".
   - Do not report a precise QTc if the QT interval or heart rate cannot be reliably determined. State the formula used (e.g., Bazett or Fridericia).
   - Do not interpret optical perspective distortion or camera shadow as genuine ST-segment elevation/depression.
   - If the image is blurry, incomplete, obstructed, or not an ECG, analyze only what is genuinely visible, set can_interpret_reliably to false if appropriate, and classify urgency_level as "Indeterminate because of image quality or insufficient information". Never silently claim every lead was normal if unreadable.
3. SYSTEMATIC 10-PART EVALUATION:
   - A. Patient and Recording Information (only what is visible; never infer).
   - B. Heart Rate and Rhythm (ventricular/atrial rate, regularity, P waves, P-QRS relationship, PR interval, sinus vs alternative rhythm, reasoning).
   - C. ECG Intervals and Axis (PR, QRS, QT, QTc with formula, P/QRS/T axes, distinguishing printed vs estimated vs calculated).
   - D. Waveform Morphology (P waves, QRS, pathological Q waves, R-wave progression, ST elevation/depression, T-wave inversion/flattening, BBB, hypertrophy, pre-excitation, ectopy with affected leads).
   - E. Lead-by-Lead Interpretation (examine each readable lead individually: I, II, III, aVR, aVL, aVF, V1–V6; identify leads from actual labels rather than assuming layout; explicitly note if a lead cannot be identified).
   - F. Ischemia, Infarction, and Acute Cardiac Patterns (acute ischemia, STEMI, NSTEMI/ACS, prior MI, reciprocal changes, posterior/RV patterns, pericarditis; distinguish suggestive ECG patterns from confirmed clinical diagnosis; state that a normal ECG does not rule out ACS; trigger time_critical_warning if urgent).
   - G. Conduction Abnormalities and Arrhythmias (1st/2nd/3rd degree AV block, RBBB, LBBB, fascicular blocks, AFib, AFlutter, SVT, VT, VF, bradyarrhythmias, pauses, PACs/PVCs, pacing).
   - H. Additional ECG Findings (low voltage, electrical alternans, early repolarization, long/short QT, Brugada-like, hyperkalemia/hypokalemia patterns — explicitly state electrolyte-associated ECG patterns do not independently establish an electrolyte diagnosis).
   - I. Printed Machine Interpretation (extract printed machine interpretation separately, compare with your independent waveform assessment, list agreements and discrepancies, do not automatically accept machine text as correct).
   - J. Final Clinical Impression (structured 11-point conclusion, urgency classification, technical limitations, and recommended clinical-support next steps without prescribing specific medications).`;

interface AnalyzeCallOptions {
  orientationNote: string;
  reportLanguage: 'id' | 'en';
  clinicalContext?: {
    patientAgeSex?: string;
    symptoms?: string;
    clinicalHistory?: string;
  };
}

async function callGeminiWithSafeRetry(
  ai: GoogleGenAI,
  preferredModel: string,
  mimeType: string,
  base64Data: string,
  options: AnalyzeCallOptions
): Promise<{ report: ReturnType<typeof validateAndNormalizeEcgResponse>; modelUsed: string }> {
  const candidateModels = Array.from(
    new Set([
      preferredModel,
      'gemini-3.6-flash',
      'gemini-3.5-flash',
      'gemini-3.8-flash',
      'gemini-3.1-flash-lite',
      'gemini-2.5-flash',
    ])
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

  for (const modelName of candidateModels) {
    const maxAttempts = 2;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        console.log(`[ECG AI] Attempting analysis with model ${modelName} (attempt ${attempt}/${maxAttempts})...`);
        const response = await ai.models.generateContent({
          model: modelName,
          contents: {
            parts: [
              {
                inlineData: {
                  mimeType,
                  data: base64Data,
                },
              },
              {
                text: `Analyze this ECG image systematically across all required sections (A through J).
Client orientation metadata note: ${options.orientationNote || 'Auto-detected by client'}.
${languageDirective}${clinicalContextBlock}
Examine all visible leads, calibration pulses, millimeter grid lines, waveform morphologies, rhythm strips, and any printed machine measurements or interpretations. Return the complete structured JSON assessment.`,
              },
            ],
          },
          config: {
            systemInstruction: ECG_SYSTEM_INSTRUCTION,
            responseMimeType: 'application/json',
            responseSchema: ecgResponseSchema,
            temperature: 0.1,
          },
        });

        const rawText = response.text;
        if (!rawText || rawText.trim().length === 0) {
          throw new Error('AI API returned an empty response.');
        }

        const parsed = JSON.parse(rawText.trim());
        return {
          report: validateAndNormalizeEcgResponse(parsed),
          modelUsed: modelName,
        };
      } catch (err: unknown) {
        lastError = err;
        const msg = err instanceof Error ? err.message : String(err);
        const isQuotaOrRateLimit =
          msg.includes('429') ||
          msg.toLowerCase().includes('quota') ||
          msg.toLowerCase().includes('rate limit');

        if (isQuotaOrRateLimit) {
          // Break inner retry loop and try next candidate model immediately
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

  // Strict 100kb payload limit for standard API JSON payloads
  // (Large payload up to 25MB is scoped specifically to /api/analyze-ecg)
  app.use(
    express.json({
      limit: '100kb',
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

  // ECG Analysis Endpoint with Quota Enforcement, Rate Limiting, and Scoped Payload Limit
  app.post(
    '/api/analyze-ecg',
    analyzeLimiter,
    express.json({ limit: '25mb' }),
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

        const safeLang: 'id' | 'en' = reportLanguage === 'en' ? 'en' : 'id';
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

        const ai = getGeminiClient();
        const preferredModel = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;

        const { report: structuredReport, modelUsed } = await callGeminiWithSafeRetry(
          ai,
          preferredModel,
          mimeType === 'image/jpg' ? 'image/jpeg' : mimeType,
          imageBase64,
          {
            orientationNote: typeof orientationNote === 'string' ? sanitizeText(orientationNote, 120) : 'Standard',
            reportLanguage: safeLang,
            clinicalContext: hasClinicalContext ? sanitizedContext : undefined,
          }
        );

        const analyzedAt = new Date().toISOString();
        const analysisId = `ecg_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
        const cleanModelLabel = modelUsed.replace(/gemini/gi, 'AI');
        const safeFileName = sanitizeText(fileName, 100) || 'ECG-Tracing.jpg';

        // Successfully analyzed! Update quota usage & save report metadata history (no image stored)
        let quotaInfo;
        if (user) {
          const isSubscribed = user.subscriptionStatus === 'active';
          let newCount = user.freeUsageCount;
          if (!isSubscribed) {
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
            report: structuredReport,
          });
        } else {
          const device = db.incrementDeviceUsage(deviceId);
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
          quota: quotaInfo,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unexpected error during ECG analysis.';

        if (message.includes('GEMINI_API_KEY is missing')) {
          res.status(503).json({
            error: 'The server AI API key is not configured. Please verify the API key in the environment settings.',
          });
          return;
        }
        if (
          message.includes('429') ||
          message.toLowerCase().includes('quota') ||
          message.toLowerCase().includes('rate limit')
        ) {
          res.status(429).json({
            error: 'AI API quota or rate limit reached. Please wait a moment and retry your ECG analysis.',
          });
          return;
        }

        console.error('ECG analysis error:', err);
        res.status(500).json({
          error: 'Gagal menganalisis gambar ECG. Silakan periksa format gambar atau coba kembali.',
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


import type {
  EcgAnalysisReport,
  LeadAnalysisItem,
  MeasuredValue,
  MeasurementSource,
  UrgencyCategory,
} from '../types/ecg';

export const SUPPORTED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
] as const;

export const MAX_IMAGE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

export const MANDATORY_MEDICAL_DISCLAIMER =
  'This AI-generated ECG interpretation is for clinical support and educational purposes. It may contain errors and must be reviewed by a qualified healthcare professional. It must not be used as the sole basis for diagnosis or treatment. If a serious or urgent cardiac condition is suspected, seek immediate medical evaluation.';

export interface ImageValidationResult {
  valid: boolean;
  error?: string;
}

export function validateImageInput(
  mimeType: string | undefined | null,
  sizeBytes: number | undefined | null
): ImageValidationResult {
  if (!mimeType || typeof mimeType !== 'string' || mimeType.trim() === '') {
    return {
      valid: false,
      error: 'No image selected or MIME type could not be determined. Please upload a JPEG, PNG, or WebP ECG image.',
    };
  }

  const normalizedMime = mimeType.toLowerCase().trim();
  if (!SUPPORTED_IMAGE_MIME_TYPES.includes(normalizedMime as (typeof SUPPORTED_IMAGE_MIME_TYPES)[number])) {
    return {
      valid: false,
      error: `Unsupported image format "${mimeType}". Supported formats are JPEG, JPG, PNG, and WebP.`,
    };
  }

  if (typeof sizeBytes !== 'number' || Number.isNaN(sizeBytes) || sizeBytes <= 0) {
    return {
      valid: false,
      error: 'The selected image file is empty or unreadable. Please capture or upload a valid ECG image.',
    };
  }

  if (sizeBytes > MAX_IMAGE_SIZE_BYTES) {
    return {
      valid: false,
      error: 'The selected image exceeds the 20 MB limit. Please upload a standard photograph or scan of the ECG.',
    };
  }

  return { valid: true };
}

/**
 * Ensures missing or null values are NEVER silently converted into "Normal" findings.
 * Instead, missing fields are explicitly marked as Indeterminate / Not Measurable.
 */
function safeText(value: unknown, fallback = 'Indeterminate / Not visible on tracing'): string {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  return fallback;
}

function safeMeasurementSource(value: unknown): MeasurementSource {
  const validSources: MeasurementSource[] = [
    'Printed on ECG',
    'Visually Estimated',
    'AI Calculated',
    'Unmeasurable',
  ];
  if (typeof value === 'string' && validSources.includes(value as MeasurementSource)) {
    return value as MeasurementSource;
  }
  return 'Unmeasurable';
}

function normalizeMeasuredValue(raw: unknown, defaultUnit: string, defaultRange: string): MeasuredValue {
  if (!raw || typeof raw !== 'object') {
    return {
      value: 'Not measurable',
      unit: defaultUnit,
      source: 'Unmeasurable',
      normalRange: defaultRange,
      assessment: 'Indeterminate — insufficient waveform clarity or missing calibration',
      reliabilityNote: 'Measurement could not be established from the provided image.',
    };
  }
  const obj = raw as Record<string, unknown>;
  const val = safeText(obj.value, 'Not measurable');
  const isUnmeasurable =
    val.toLowerCase().includes('not measurable') ||
    val.toLowerCase().includes('unmeasurable') ||
    val.toLowerCase().includes('indeterminate') ||
    val.toLowerCase() === 'n/a' ||
    val.toLowerCase() === 'unknown';

  return {
    value: val,
    unit: typeof obj.unit === 'string' ? obj.unit : defaultUnit,
    source: isUnmeasurable ? 'Unmeasurable' : safeMeasurementSource(obj.source),
    normalRange: safeText(obj.normalRange, defaultRange),
    assessment: safeText(
      obj.assessment,
      'Indeterminate — cannot confirm normality without reliable measurement'
    ),
    reliabilityNote: safeText(
      obj.reliabilityNote,
      'Subject to visual grid resolution and recording calibration.'
    ),
  };
}

function normalizeUrgencyCategory(raw: unknown, canInterpretReliably: boolean): UrgencyCategory {
  const validCategories: UrgencyCategory[] = [
    'Normal ECG appearance',
    'Abnormal ECG',
    'Potentially urgent abnormality',
    'Critical pattern requiring immediate emergency evaluation',
    'Indeterminate because of image quality or insufficient information',
  ];
  if (typeof raw === 'string' && validCategories.includes(raw as UrgencyCategory)) {
    // Do not allow "Normal ECG appearance" if the image cannot be interpreted reliably
    if (raw === 'Normal ECG appearance' && !canInterpretReliably) {
      return 'Indeterminate because of image quality or insufficient information';
    }
    return raw as UrgencyCategory;
  }
  return 'Indeterminate because of image quality or insufficient information';
}

function normalizeStringArray(raw: unknown, fallbackItem?: string): string[] {
  if (Array.isArray(raw)) {
    const cleaned = raw
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map((item) => item.trim());
    if (cleaned.length > 0) {
      return cleaned;
    }
  }
  return fallbackItem ? [fallbackItem] : [];
}

export function validateAndNormalizeEcgResponse(rawPayload: unknown): EcgAnalysisReport {
  if (!rawPayload || typeof rawPayload !== 'object') {
    throw new Error('AI response is empty or not a valid JSON object.');
  }

  const data = rawPayload as Record<string, unknown>;
  const rec = (data.recording_information as Record<string, unknown>) || {};
  const qual = (data.image_quality as Record<string, unknown>) || {};
  const hr = (data.heart_rate as Record<string, unknown>) || {};
  const rhy = (data.rhythm as Record<string, unknown>) || {};
  const intv = (data.intervals as Record<string, unknown>) || {};
  const axis = (data.electrical_axis as Record<string, unknown>) || {};
  const morph = (data.waveform_morphology as Record<string, unknown>) || {};
  const isch = (data.ischemia_and_infarction as Record<string, unknown>) || {};
  const arr = (data.arrhythmias_and_conduction as Record<string, unknown>) || {};
  const machine = (data.printed_machine_interpretation as Record<string, unknown>) || {};
  const aiInterp = (data.ai_interpretation as Record<string, unknown>) || {};
  const conf = (data.confidence as Record<string, unknown>) || {};

  const validReadability = ['High', 'Moderate', 'Low', 'Unreadable'] as const;
  const readability =
    typeof qual.overall_readability === 'string' &&
    validReadability.includes(qual.overall_readability as (typeof validReadability)[number])
      ? (qual.overall_readability as (typeof validReadability)[number])
      : 'Low';

  const canInterpretReliably =
    typeof qual.can_interpret_reliably === 'boolean'
      ? qual.can_interpret_reliably && readability !== 'Unreadable'
      : readability === 'High' || readability === 'Moderate';

  const urgencyLevel = normalizeUrgencyCategory(data.urgency_level, canInterpretReliably);

  const rawLeads = Array.isArray(data.lead_analysis) ? data.lead_analysis : [];
  const leadAnalysis: LeadAnalysisItem[] =
    rawLeads.length > 0
      ? rawLeads.map((item: unknown, idx: number) => {
          const l = (item as Record<string, unknown>) || {};
          return {
            leadName: safeText(l.leadName, `Unidentified Lead #${idx + 1}`),
            identifiedFromLabel: typeof l.identifiedFromLabel === 'boolean' ? l.identifiedFromLabel : false,
            rhythmAndWaveform: safeText(
              l.rhythmAndWaveform,
              'Waveform not reliably assessable on this lead'
            ),
            pWave: safeText(l.pWave, 'Not reliably identifiable'),
            qrsMorphology: safeText(l.qrsMorphology, 'Not reliably identifiable'),
            stSegment: safeText(l.stSegment, 'Indeterminate baseline / ST segment'),
            tWave: safeText(l.tWave, 'Not reliably identifiable'),
            abnormalities: safeText(
              l.abnormalities,
              'Indeterminate due to lead visibility or not separately distinguished'
            ),
            confidenceAndLimitations: safeText(
              l.confidenceAndLimitations,
              'Limited by optical resolution and paper grid legibility'
            ),
          };
        })
      : [
          {
            leadName: 'Lead Identification Incomplete',
            identifiedFromLabel: false,
            rhythmAndWaveform: 'Individual leads could not be reliably separated from the provided image.',
            pWave: 'Indeterminate',
            qrsMorphology: 'Indeterminate',
            stSegment: 'Indeterminate',
            tWave: 'Indeterminate',
            abnormalities: 'Unable to exclude lead-specific abnormalities due to image limitations.',
            confidenceAndLimitations: 'Low confidence — clear lead labels were not legible.',
          },
        ];

  const rawAdditional = Array.isArray(data.additional_findings) ? data.additional_findings : [];
  const additionalFindings = rawAdditional.map((item: unknown) => {
    const f = (item as Record<string, unknown>) || {};
    return {
      category: safeText(f.category, 'Observation'),
      observation: safeText(f.observation, 'Indeterminate finding'),
      affectedLeads: safeText(f.affectedLeads, 'Not specified'),
      clinicalSignificance: safeText(
        f.clinicalSignificance,
        'Requires clinical correlation by a healthcare professional'
      ),
    };
  });

  const validConfidence = ['High', 'Moderate', 'Low', 'Insufficient Image Quality'] as const;
  const confidenceLevel =
    typeof conf.overall_level === 'string' &&
    validConfidence.includes(conf.overall_level as (typeof validConfidence)[number])
      ? (conf.overall_level as (typeof validConfidence)[number])
      : canInterpretReliably
        ? 'Moderate'
        : 'Insufficient Image Quality';

  return {
    recording_information: {
      patient_identifier: safeText(rec.patient_identifier, 'Not visible on ECG'),
      age_and_sex: safeText(rec.age_and_sex, 'Not visible on ECG'),
      recording_date_time: safeText(rec.recording_date_time, 'Not visible on ECG'),
      device_or_manufacturer: safeText(rec.device_or_manufacturer, 'Not identifiable from image'),
      paper_speed: safeText(rec.paper_speed, 'Not printed / Unconfirmed (do not assume 25 mm/s)'),
      gain_calibration: safeText(
        rec.gain_calibration,
        'Not printed / Unconfirmed (do not assume 10 mm/mV)'
      ),
      visible_leads_count: safeText(rec.visible_leads_count, 'Indeterminate'),
      recording_duration: safeText(rec.recording_duration, 'Not explicitly indicated'),
      detected_orientation_and_layout: safeText(
        rec.detected_orientation_and_layout,
        'Standardized automatically during multimodal analysis'
      ),
    },
    image_quality: {
      overall_readability: readability,
      orientation_handled: safeText(
        qual.orientation_handled,
        'Automatically inspected without manual preprocessing'
      ),
      perspective_and_tilt_notes: safeText(
        qual.perspective_and_tilt_notes,
        'Evaluated directly from uploaded image geometry'
      ),
      grid_visibility: safeText(qual.grid_visibility, 'Partially visible'),
      artifacts_or_obstructions: normalizeStringArray(
        qual.artifacts_or_obstructions,
        'No specific optical obstructions reported'
      ),
      can_interpret_reliably: canInterpretReliably,
    },
    executive_summary: safeText(
      data.executive_summary,
      'Automated educational ECG analysis completed with noted technical and clinical limitations. Review detailed sections below.'
    ),
    urgency_level: urgencyLevel,
    urgency_explanation: safeText(
      data.urgency_explanation,
      'Clinical urgency must be determined in conjunction with patient symptoms, history, and serial ECGs.'
    ),
    time_critical_warning: safeText(data.time_critical_warning, ''),
    heart_rate: {
      ventricular_rate_bpm: normalizeMeasuredValue(hr.ventricular_rate_bpm, 'bpm', '60–100 bpm'),
      atrial_rate_bpm: normalizeMeasuredValue(hr.atrial_rate_bpm, 'bpm', '60–100 bpm'),
      rate_regularity_note: safeText(
        hr.rate_regularity_note,
        'Rate assessment depends on visible R-R interval consistency and paper speed.'
      ),
    },
    rhythm: {
      underlying_rhythm: safeText(rhy.underlying_rhythm, 'Indeterminate rhythm'),
      regularity: safeText(rhy.regularity, 'Indeterminate regularity'),
      p_wave_presence_and_morphology: safeText(
        rhy.p_wave_presence_and_morphology,
        'P-wave morphology cannot be definitively confirmed across all leads'
      ),
      p_qrs_relationship: safeText(
        rhy.p_qrs_relationship,
        'P-QRS relationship requires clear baseline inspection'
      ),
      pr_interval_overview: safeText(rhy.pr_interval_overview, 'Indeterminate from available tracing'),
      sinus_vs_alternative_evidence: safeText(
        rhy.sinus_vs_alternative_evidence,
        'Insufficient evidence to confirm or exclude sinus origin definitively'
      ),
      premature_beats_pauses_disturbances: safeText(
        rhy.premature_beats_pauses_disturbances,
        'None definitively identified on visible segments; cannot exclude on unrecorded beats'
      ),
      av_block_evidence: safeText(
        rhy.av_block_evidence,
        'Indeterminate or no clear AV conduction delay identified on visible complexes'
      ),
      afib_flutter_arrhythmia_evidence: safeText(
        rhy.afib_flutter_arrhythmia_evidence,
        'Indeterminate from available tracing'
      ),
      rhythm_reasoning: safeText(
        rhy.rhythm_reasoning,
        'Rhythm assessment is constrained by the visible lead segments and calibration markers.'
      ),
    },
    intervals: {
      pr_interval_ms: normalizeMeasuredValue(intv.pr_interval_ms, 'ms', '120–200 ms'),
      qrs_duration_ms: normalizeMeasuredValue(intv.qrs_duration_ms, 'ms', '< 120 ms'),
      qt_interval_ms: normalizeMeasuredValue(intv.qt_interval_ms, 'ms', '350–450 ms'),
      qtc_interval_ms: normalizeMeasuredValue(
        intv.qtc_interval_ms,
        'ms',
        '< 450 ms (M) / < 460 ms (F)'
      ),
      qtc_formula_used: safeText(
        intv.qtc_formula_used,
        'Not calculated or printed directly on report'
      ),
    },
    electrical_axis: {
      p_wave_axis: normalizeMeasuredValue(axis.p_wave_axis, '°', '0° to +75°'),
      qrs_axis: normalizeMeasuredValue(axis.qrs_axis, '°', '-30° to +90°'),
      t_wave_axis: normalizeMeasuredValue(axis.t_wave_axis, '°', 'Concordant with QRS'),
      axis_deviation_summary: safeText(
        axis.axis_deviation_summary,
        'Electrical axis evaluation depends on limb lead I, II, III, and aVF clarity.'
      ),
    },
    lead_analysis: leadAnalysis,
    waveform_morphology: {
      p_wave_abnormalities: safeText(morph.p_wave_abnormalities, 'Indeterminate / Not clearly abnormal'),
      qrs_morphology_summary: safeText(morph.qrs_morphology_summary, 'Indeterminate'),
      pathological_q_waves: safeText(
        morph.pathological_q_waves,
        'Cannot be definitively confirmed or excluded without full lead clarity'
      ),
      r_wave_progression: safeText(
        morph.r_wave_progression,
        'Precordial R-wave progression assessment limited by V1–V6 visibility'
      ),
      st_segment_changes: safeText(
        morph.st_segment_changes,
        'Indeterminate — verify ST segments directly on high-resolution paper grid'
      ),
      t_wave_abnormalities: safeText(morph.t_wave_abnormalities, 'Indeterminate'),
      bundle_branch_block_evidence: safeText(morph.bundle_branch_block_evidence, 'Indeterminate'),
      ventricular_hypertrophy_chamber_enlargement: safeText(
        morph.ventricular_hypertrophy_chamber_enlargement,
        'Voltage criteria depend on verified 10 mm/mV gain calibration'
      ),
      pre_excitation_evidence: safeText(morph.pre_excitation_evidence, 'No clear delta wave identified'),
      ectopic_beats_and_other: safeText(morph.ectopic_beats_and_other, 'None definitively identified'),
    },
    ischemia_and_infarction: {
      acute_ischemia_patterns: safeText(
        isch.acute_ischemia_patterns,
        'Indeterminate — acute coronary syndrome cannot be ruled out by ECG alone'
      ),
      stemi_patterns: safeText(isch.stemi_patterns, 'Indeterminate from image'),
      nstemi_acs_patterns: safeText(isch.nstemi_acs_patterns, 'Indeterminate from image'),
      prior_infarction_evidence: safeText(isch.prior_infarction_evidence, 'Indeterminate from image'),
      reciprocal_changes: safeText(isch.reciprocal_changes, 'None definitively identified'),
      posterior_or_rv_infarction_patterns: safeText(
        isch.posterior_or_rv_infarction_patterns,
        'Requires V1–V3 mirror assessment and right-sided/posterior leads if clinically indicated'
      ),
      pericarditis_like_patterns: safeText(isch.pericarditis_like_patterns, 'None definitively identified'),
      affected_leads: safeText(isch.affected_leads, 'Not applicable or indeterminate'),
      pattern_vs_diagnosis_distinction: safeText(
        isch.pattern_vs_diagnosis_distinction,
        'ECG waveform patterns are morphological observations only and do not establish or exclude a clinical diagnosis of myocardial ischemia or infarction. A normal-appearing ECG does not exclude acute coronary syndrome.'
      ),
    },
    arrhythmias_and_conduction: {
      av_block_assessment: safeText(arr.av_block_assessment, 'Indeterminate'),
      bundle_branch_and_fascicular_blocks: safeText(
        arr.bundle_branch_and_fascicular_blocks,
        'Indeterminate'
      ),
      supraventricular_arrhythmias: safeText(arr.supraventricular_arrhythmias, 'Indeterminate'),
      ventricular_arrhythmias: safeText(arr.ventricular_arrhythmias, 'Indeterminate'),
      bradyarrhythmias_and_pauses: safeText(arr.bradyarrhythmias_and_pauses, 'Indeterminate'),
      premature_complexes: safeText(arr.premature_complexes, 'Indeterminate'),
      pacemaker_activity: safeText(arr.pacemaker_activity, 'No pacing spikes clearly identified'),
      sufficiency_of_tracing_note: safeText(
        arr.sufficiency_of_tracing_note,
        'Single snapshot ECG tracings represent a brief time window (~10 seconds) and may miss paroxysmal arrhythmias.'
      ),
    },
    additional_findings: additionalFindings,
    electrolyte_disclaimer_note: safeText(
      data.electrolyte_disclaimer_note,
      'ECG findings potentially associated with electrolyte disturbances (such as T-wave peaking, U waves, or QT prolongation) are non-specific and do not independently establish an electrolyte diagnosis. Laboratory serum measurement is required.'
    ),
    printed_machine_interpretation: {
      is_present: typeof machine.is_present === 'boolean' ? machine.is_present : false,
      extracted_text: safeText(
        machine.extracted_text,
        'No printed automated machine interpretation text visible on the ECG image.'
      ),
      comparison_with_ai: safeText(
        machine.comparison_with_ai,
        'No printed machine interpretation was available for comparison, or image quality prevented text comparison.'
      ),
      agreements: normalizeStringArray(machine.agreements),
      discrepancies: normalizeStringArray(machine.discrepancies),
    },
    ai_interpretation: {
      primary_interpretation: safeText(
        aiInterp.primary_interpretation,
        'Indeterminate ECG — requires direct physician review of original tracing'
      ),
      major_abnormalities: normalizeStringArray(
        aiInterp.major_abnormalities,
        'None definitively confirmed or limited by tracing quality'
      ),
      secondary_findings: normalizeStringArray(aiInterp.secondary_findings),
    },
    clinical_impression: normalizeStringArray(
      data.clinical_impression,
      'Automated educational assessment completed. A normal-appearing or indeterminate ECG does not exclude serious cardiac disease.'
    ),
    recommended_next_steps: normalizeStringArray(
      data.recommended_next_steps,
      'Have a qualified physician or cardiologist review the original ECG tracing alongside the patient’s clinical presentation, symptoms, vital signs, and prior ECGs.'
    ),
    limitations: normalizeStringArray(
      data.limitations,
      'Optical image analysis of printed or displayed ECGs is subject to camera perspective, grid resolution, and calibration uncertainty.'
    ),
    confidence: {
      overall_level: confidenceLevel,
      rationale: safeText(
        conf.rationale,
        'Confidence reflects optical legibility of waveforms, millimeter grid lines, and calibration markings; it is not a measure of clinical diagnostic certainty.'
      ),
    },
  };
}

export interface UrgencyVisualDescriptor {
  glyph: string;
  shortLabel: string;
  requiresEmergencyBanner: boolean;
  tone: 'emerald' | 'amber' | 'orange' | 'rose' | 'slate';
}

export function classifyUrgencyBanner(category: UrgencyCategory): UrgencyVisualDescriptor {
  switch (category) {
    case 'Critical pattern requiring immediate emergency evaluation':
      return {
        glyph: '✖',
        shortLabel: 'CRITICAL PATTERN — IMMEDIATE EMERGENCY EVALUATION',
        requiresEmergencyBanner: true,
        tone: 'rose',
      };
    case 'Potentially urgent abnormality':
      return {
        glyph: '◆',
        shortLabel: 'POTENTIALLY URGENT ABNORMALITY — PROMPT CLINICAL REVIEW',
        requiresEmergencyBanner: true,
        tone: 'orange',
      };
    case 'Abnormal ECG':
      return {
        glyph: '▲',
        shortLabel: 'ABNORMAL ECG APPEARANCE — CLINICIAN REVIEW REQUIRED',
        requiresEmergencyBanner: false,
        tone: 'amber',
      };
    case 'Normal ECG appearance':
      return {
        glyph: '●',
        shortLabel: 'NORMAL ECG APPEARANCE (DOES NOT EXCLUDE CARDIAC DISEASE)',
        requiresEmergencyBanner: false,
        tone: 'emerald',
      };
    case 'Indeterminate because of image quality or insufficient information':
    default:
      return {
        glyph: '?',
        shortLabel: 'INDETERMINATE — IMAGE QUALITY OR INSUFFICIENT INFORMATION',
        requiresEmergencyBanner: false,
        tone: 'slate',
      };
  }
}

/**
 * Parses JPEG EXIF orientation tag (1..8) from an ArrayBuffer so the client
 * can log/normalize orientation automatically without asking the user.
 */
export function detectExifOrientationFromBuffer(buffer: ArrayBuffer): number {
  const view = new DataView(buffer);
  if (view.byteLength < 4 || view.getUint16(0, false) !== 0xffd8) {
    return 1; // Not a JPEG or no EXIF
  }
  let offset = 2;
  const length = view.byteLength;
  while (offset + 4 <= length) {
    const marker = view.getUint16(offset, false);
    offset += 2;
    if (marker === 0xffe1) {
      if (offset + 8 > length) return 1;
      const exifHeader = view.getUint32(offset + 2, false);
      if (exifHeader !== 0x45786966) return 1; // "Exif"
      const tiffOffset = offset + 8;
      if (tiffOffset + 8 > length) return 1;
      const littleEndian = view.getUint16(tiffOffset, false) === 0x4949;
      const firstIfdOffset = view.getUint32(tiffOffset + 4, littleEndian);
      const dirStart = tiffOffset + firstIfdOffset;
      if (dirStart + 2 > length) return 1;
      const entries = view.getUint16(dirStart, littleEndian);
      for (let i = 0; i < entries; i++) {
        const entryOffset = dirStart + 2 + i * 12;
        if (entryOffset + 10 > length) break;
        if (view.getUint16(entryOffset, littleEndian) === 0x0112) {
          return view.getUint16(entryOffset + 8, littleEndian);
        }
      }
      return 1;
    } else if ((marker & 0xff00) !== 0xff00) {
      break;
    } else {
      if (offset + 2 > length) break;
      offset += view.getUint16(offset, false);
    }
  }
  return 1;
}

export function describeExifOrientation(orientation: number): string {
  switch (orientation) {
    case 2:
      return 'Mirrored horizontal (auto-normalized)';
    case 3:
      return 'Rotated 180° upside-down (auto-detected)';
    case 4:
      return 'Mirrored vertical (auto-normalized)';
    case 5:
      return 'Mirrored horizontal & rotated 270° CW (auto-detected)';
    case 6:
      return 'Rotated 90° CW portrait/landscape (auto-detected)';
    case 7:
      return 'Mirrored horizontal & rotated 90° CW (auto-detected)';
    case 8:
      return 'Rotated 270° CW (auto-detected)';
    case 1:
    default:
      return 'Standard orientation (auto-verified)';
  }
}

export function formatReportAsPlainText(report: EcgAnalysisReport): string {
  const lines: string[] = [
    '====================================================================',
    'AI ECG ANALYZER — EDUCATIONAL & CLINICAL SUPPORT INTERPRETATION REPORT',
    '====================================================================',
    `DISCLAIMER: ${MANDATORY_MEDICAL_DISCLAIMER}`,
    '',
    '1. EXECUTIVE SUMMARY',
    report.executive_summary,
    '',
    '2. URGENCY ASSESSMENT',
    `Classification: ${report.urgency_level}`,
    `Explanation: ${report.urgency_explanation}`,
    ...(report.time_critical_warning ? [`URGENT WARNING: ${report.time_critical_warning}`] : []),
    '',
    '3. RECORDING & IMAGE QUALITY',
    `Patient ID: ${report.recording_information.patient_identifier}`,
    `Age / Sex: ${report.recording_information.age_and_sex}`,
    `Date / Time: ${report.recording_information.recording_date_time}`,
    `Device: ${report.recording_information.device_or_manufacturer}`,
    `Paper Speed: ${report.recording_information.paper_speed}`,
    `Gain Calibration: ${report.recording_information.gain_calibration}`,
    `Visible Leads: ${report.recording_information.visible_leads_count}`,
    `Image Readability: ${report.image_quality.overall_readability}`,
    `Orientation Handling: ${report.image_quality.orientation_handled}`,
    '',
    '4. HEART RATE & RHYTHM',
    `Ventricular Rate: ${report.heart_rate.ventricular_rate_bpm.value} ${report.heart_rate.ventricular_rate_bpm.unit} (${report.heart_rate.ventricular_rate_bpm.source})`,
    `Atrial Rate: ${report.heart_rate.atrial_rate_bpm.value} ${report.heart_rate.atrial_rate_bpm.unit} (${report.heart_rate.atrial_rate_bpm.source})`,
    `Underlying Rhythm: ${report.rhythm.underlying_rhythm}`,
    `Regularity: ${report.rhythm.regularity}`,
    `P Waves: ${report.rhythm.p_wave_presence_and_morphology}`,
    `P-QRS Relationship: ${report.rhythm.p_qrs_relationship}`,
    `Rhythm Reasoning: ${report.rhythm.rhythm_reasoning}`,
    '',
    '5. ECG INTERVALS & ELECTRICAL AXIS',
    `PR Interval: ${report.intervals.pr_interval_ms.value} ${report.intervals.pr_interval_ms.unit} [${report.intervals.pr_interval_ms.source}]`,
    `QRS Duration: ${report.intervals.qrs_duration_ms.value} ${report.intervals.qrs_duration_ms.unit} [${report.intervals.qrs_duration_ms.source}]`,
    `QT Interval: ${report.intervals.qt_interval_ms.value} ${report.intervals.qt_interval_ms.unit} [${report.intervals.qt_interval_ms.source}]`,
    `QTc Interval: ${report.intervals.qtc_interval_ms.value} ${report.intervals.qtc_interval_ms.unit} [${report.intervals.qtc_interval_ms.source}] (Formula: ${report.intervals.qtc_formula_used})`,
    `P Axis: ${report.electrical_axis.p_wave_axis.value}${report.electrical_axis.p_wave_axis.unit} | QRS Axis: ${report.electrical_axis.qrs_axis.value}${report.electrical_axis.qrs_axis.unit} | T Axis: ${report.electrical_axis.t_wave_axis.value}${report.electrical_axis.t_wave_axis.unit}`,
    `Axis Summary: ${report.electrical_axis.axis_deviation_summary}`,
    '',
    '6. LEAD-BY-LEAD ANALYSIS',
    ...report.lead_analysis.map(
      (lead) =>
        `- ${lead.leadName} (${lead.identifiedFromLabel ? 'Labeled' : 'Position/Unlabeled'}): QRS: ${lead.qrsMorphology} | ST: ${lead.stSegment} | T: ${lead.tWave} | Findings: ${lead.abnormalities}`
    ),
    '',
    '7. WAVEFORM MORPHOLOGY',
    `P Waves: ${report.waveform_morphology.p_wave_abnormalities}`,
    `QRS Complexes: ${report.waveform_morphology.qrs_morphology_summary}`,
    `Pathological Q Waves: ${report.waveform_morphology.pathological_q_waves}`,
    `R-Wave Progression: ${report.waveform_morphology.r_wave_progression}`,
    `ST Segments: ${report.waveform_morphology.st_segment_changes}`,
    `T Waves: ${report.waveform_morphology.t_wave_abnormalities}`,
    '',
    '8. ISCHEMIA & INFARCTION ASSESSMENT',
    `Acute Ischemia: ${report.ischemia_and_infarction.acute_ischemia_patterns}`,
    `STEMI Patterns: ${report.ischemia_and_infarction.stemi_patterns}`,
    `NSTEMI / ACS Patterns: ${report.ischemia_and_infarction.nstemi_acs_patterns}`,
    `Prior Infarction: ${report.ischemia_and_infarction.prior_infarction_evidence}`,
    `Affected Leads: ${report.ischemia_and_infarction.affected_leads}`,
    `Clinical Note: ${report.ischemia_and_infarction.pattern_vs_diagnosis_distinction}`,
    '',
    '9. ARRHYTHMIAS & CONDUCTION ABNORMALITIES',
    `AV Block: ${report.arrhythmias_and_conduction.av_block_assessment}`,
    `Bundle Branch / Fascicular: ${report.arrhythmias_and_conduction.bundle_branch_and_fascicular_blocks}`,
    `Supraventricular: ${report.arrhythmias_and_conduction.supraventricular_arrhythmias}`,
    `Ventricular: ${report.arrhythmias_and_conduction.ventricular_arrhythmias}`,
    '',
    '10. PRINTED MACHINE INTERPRETATION',
    `Present on ECG: ${report.printed_machine_interpretation.is_present ? 'Yes' : 'No'}`,
    `Extracted Text: ${report.printed_machine_interpretation.extracted_text}`,
    `Comparison with AI: ${report.printed_machine_interpretation.comparison_with_ai}`,
    '',
    '11. FINAL CLINICAL IMPRESSION',
    `Primary Interpretation: ${report.ai_interpretation.primary_interpretation}`,
    ...report.clinical_impression.map((item, i) => `${i + 1}. ${item}`),
    '',
    '12. RECOMMENDED NEXT STEPS',
    ...report.recommended_next_steps.map((item, i) => `- ${item}`),
    '',
    '13. TECHNICAL LIMITATIONS & CONFIDENCE',
    `Confidence Level: ${report.confidence.overall_level} — ${report.confidence.rationale}`,
    ...report.limitations.map((item) => `* ${item}`),
  ];

  return lines.join('\n');
}

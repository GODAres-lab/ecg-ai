export type UrgencyCategory =
  | 'Normal ECG appearance'
  | 'Abnormal ECG'
  | 'Potentially urgent abnormality'
  | 'Critical pattern requiring immediate emergency evaluation'
  | 'Indeterminate because of image quality or insufficient information';

export type MeasurementSource =
  | 'Printed on ECG'
  | 'Visually Estimated'
  | 'AI Calculated'
  | 'Unmeasurable';

export interface MeasuredValue {
  value: string;
  unit: string;
  source: MeasurementSource;
  normalRange: string;
  assessment: string;
  reliabilityNote: string;
}

export interface LeadAnalysisItem {
  leadName: string;
  identifiedFromLabel: boolean;
  rhythmAndWaveform: string;
  pWave: string;
  qrsMorphology: string;
  stSegment: string;
  tWave: string;
  abnormalities: string;
  confidenceAndLimitations: string;
}

export interface AdditionalFindingItem {
  category: string;
  observation: string;
  affectedLeads: string;
  clinicalSignificance: string;
}

export interface EcgAnalysisReport {
  recording_information: {
    patient_identifier: string;
    age_and_sex: string;
    recording_date_time: string;
    device_or_manufacturer: string;
    paper_speed: string;
    gain_calibration: string;
    visible_leads_count: string;
    recording_duration: string;
    detected_orientation_and_layout: string;
  };
  image_quality: {
    overall_readability: 'High' | 'Moderate' | 'Low' | 'Unreadable';
    orientation_handled: string;
    perspective_and_tilt_notes: string;
    grid_visibility: string;
    artifacts_or_obstructions: string[];
    can_interpret_reliably: boolean;
  };
  executive_summary: string;
  urgency_level: UrgencyCategory;
  urgency_explanation: string;
  time_critical_warning: string;
  heart_rate: {
    ventricular_rate_bpm: MeasuredValue;
    atrial_rate_bpm: MeasuredValue;
    rate_regularity_note: string;
  };
  rhythm: {
    underlying_rhythm: string;
    regularity: string;
    p_wave_presence_and_morphology: string;
    p_qrs_relationship: string;
    pr_interval_overview: string;
    sinus_vs_alternative_evidence: string;
    premature_beats_pauses_disturbances: string;
    av_block_evidence: string;
    afib_flutter_arrhythmia_evidence: string;
    rhythm_reasoning: string;
  };
  intervals: {
    pr_interval_ms: MeasuredValue;
    qrs_duration_ms: MeasuredValue;
    qt_interval_ms: MeasuredValue;
    qtc_interval_ms: MeasuredValue;
    qtc_formula_used: string;
  };
  electrical_axis: {
    p_wave_axis: MeasuredValue;
    qrs_axis: MeasuredValue;
    t_wave_axis: MeasuredValue;
    axis_deviation_summary: string;
  };
  lead_analysis: LeadAnalysisItem[];
  waveform_morphology: {
    p_wave_abnormalities: string;
    qrs_morphology_summary: string;
    pathological_q_waves: string;
    r_wave_progression: string;
    st_segment_changes: string;
    t_wave_abnormalities: string;
    bundle_branch_block_evidence: string;
    ventricular_hypertrophy_chamber_enlargement: string;
    pre_excitation_evidence: string;
    ectopic_beats_and_other: string;
  };
  ischemia_and_infarction: {
    acute_ischemia_patterns: string;
    stemi_patterns: string;
    nstemi_acs_patterns: string;
    prior_infarction_evidence: string;
    reciprocal_changes: string;
    posterior_or_rv_infarction_patterns: string;
    pericarditis_like_patterns: string;
    affected_leads: string;
    pattern_vs_diagnosis_distinction: string;
  };
  arrhythmias_and_conduction: {
    av_block_assessment: string;
    bundle_branch_and_fascicular_blocks: string;
    supraventricular_arrhythmias: string;
    ventricular_arrhythmias: string;
    bradyarrhythmias_and_pauses: string;
    premature_complexes: string;
    pacemaker_activity: string;
    sufficiency_of_tracing_note: string;
  };
  additional_findings: AdditionalFindingItem[];
  electrolyte_disclaimer_note: string;
  printed_machine_interpretation: {
    is_present: boolean;
    extracted_text: string;
    comparison_with_ai: string;
    agreements: string[];
    discrepancies: string[];
  };
  ai_interpretation: {
    primary_interpretation: string;
    major_abnormalities: string[];
    secondary_findings: string[];
  };
  clinical_impression: string[];
  recommended_next_steps: string[];
  limitations: string[];
  confidence: {
    overall_level: 'High' | 'Moderate' | 'Low' | 'Insufficient Image Quality';
    rationale: string;
  };
}

export interface ConsentRecord {
  acknowledged: boolean;
  timestamp: string;
  educationalPurposeAccepted: boolean;
  nonDiagnosticAccepted: boolean;
  clinicianReviewAccepted: boolean;
}

export type UiLanguage = 'id' | 'en';

export type AnalysisMode = 'verified' | 'standard';

export interface VerificationMetadata {
  mode: AnalysisMode;
  dualPassCompleted: boolean;
  cachedDeterministic: boolean;
  mathChecksApplied: string[];
  inputFingerprint?: string;
}

export interface ClinicalContextInput {
  patientAgeSex?: string;
  symptoms?: string;
  clinicalHistory?: string;
}

export interface AnalysisHistoryItem {
  id: string;
  analyzedAt: string;
  fileName: string;
  modelUsed: string;
  reportLanguage?: UiLanguage;
  clinicalContext?: ClinicalContextInput;
  verification?: VerificationMetadata;
  thumbnailDataUrl?: string;
  report: EcgAnalysisReport;
}

import type { EcgAnalysisReport } from '../types/ecg';
import { MANDATORY_MEDICAL_DISCLAIMER } from './ecgValidation';

export interface PdfExportOptions {
  includeOriginalImage: boolean;
  imagePreviewDataUrl?: string;
  imageWidth?: number;
  imageHeight?: number;
}

export async function exportEcgReportToPdf(
  report: EcgAnalysisReport,
  options: PdfExportOptions
): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;
  const contentWidth = pageWidth - margin * 2;
  let cursorY = 16;

  const ensureSpace = (neededMm: number) => {
    if (cursorY + neededMm > pageHeight - 16) {
      doc.addPage();
      cursorY = 16;
    }
  };

  const addSectionHeading = (title: string) => {
    ensureSpace(14);
    cursorY += 3;
    doc.setFillColor(241, 245, 249);
    doc.rect(margin, cursorY - 4.5, contentWidth, 7, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text(title.toUpperCase(), margin + 2, cursorY + 0.5);
    cursorY += 6.5;
  };

  const addKeyValueRow = (label: string, value: string) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(51, 65, 85);
    const labelWidth = 48;
    const wrappedValue = doc.splitTextToSize(value || 'Indeterminate', contentWidth - labelWidth);
    const rowHeight = Math.max(5, wrappedValue.length * 4.2);
    ensureSpace(rowHeight + 2);
    doc.text(label, margin, cursorY);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(15, 23, 42);
    doc.text(wrappedValue, margin + labelWidth, cursorY);
    cursorY += rowHeight + 1;
  };

  const addParagraph = (text: string, isBold = false) => {
    doc.setFont('helvetica', isBold ? 'bold' : 'normal');
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    const lines = doc.splitTextToSize(text, contentWidth);
    const blockHeight = lines.length * 4.3;
    ensureSpace(blockHeight + 2);
    doc.text(lines, margin, cursorY);
    cursorY += blockHeight + 2;
  };

  // Document Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(15, 23, 42);
  doc.text('AI ECG ANALYZER — INTERPRETATION REPORT', margin, cursorY);
  cursorY += 5.5;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text(
    `Generated: ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC  |  Educational & Clinical Support Record`,
    margin,
    cursorY
  );
  cursorY += 5;

  // Mandatory Safety Disclaimer Box
  doc.setDrawColor(203, 213, 225);
  doc.setFillColor(248, 250, 252);
  const disclaimerLines = doc.splitTextToSize(
    `MEDICAL SAFETY & EDUCATIONAL DISCLAIMER: ${MANDATORY_MEDICAL_DISCLAIMER}`,
    contentWidth - 6
  );
  const disclaimerHeight = disclaimerLines.length * 3.8 + 5;
  doc.rect(margin, cursorY, contentWidth, disclaimerHeight, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(71, 85, 105);
  doc.text(disclaimerLines, margin + 3, cursorY + 4);
  cursorY += disclaimerHeight + 5;

  // Embedded ECG Image (if privacy toggle enabled)
  if (options.includeOriginalImage && options.imagePreviewDataUrl) {
    try {
      const imgW = options.imageWidth || 1200;
      const imgH = options.imageHeight || 800;
      const ratio = imgH / imgW;
      const drawW = contentWidth;
      const drawH = Math.min(72, drawW * ratio);
      ensureSpace(drawH + 8);
      const format = options.imagePreviewDataUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG';
      doc.addImage(options.imagePreviewDataUrl, format, margin, cursorY, drawW, drawH);
      cursorY += drawH + 5;
    } catch {
      // Continue safely if image embedding encounters format issue
    }
  }

  // 1 & 2. Executive Summary & Urgency Assessment
  addSectionHeading('1. Executive Summary & 2. Urgency Assessment');
  addKeyValueRow('Urgency Classification:', report.urgency_level);
  if (report.time_critical_warning) {
    addKeyValueRow('Urgent Warning:', report.time_critical_warning);
  }
  addKeyValueRow('Urgency Rationale:', report.urgency_explanation);
  addParagraph(report.executive_summary);

  // Recording Info
  addSectionHeading('Patient, Recording & Image Quality Metadata');
  addKeyValueRow('Patient Identifier:', report.recording_information.patient_identifier);
  addKeyValueRow('Age / Sex:', report.recording_information.age_and_sex);
  addKeyValueRow('Recording Date/Time:', report.recording_information.recording_date_time);
  addKeyValueRow('Device / Speed / Gain:', `${report.recording_information.device_or_manufacturer} | ${report.recording_information.paper_speed} | ${report.recording_information.gain_calibration}`);
  addKeyValueRow('Visible Leads / Readability:', `${report.recording_information.visible_leads_count} | Readability: ${report.image_quality.overall_readability}`);
  addKeyValueRow('Orientation Handling:', report.image_quality.orientation_handled);

  // 3. Heart Rate & Rhythm
  addSectionHeading('3. Heart Rate and Rhythm');
  addKeyValueRow(
    'Ventricular Rate:',
    `${report.heart_rate.ventricular_rate_bpm.value} ${report.heart_rate.ventricular_rate_bpm.unit} (${report.heart_rate.ventricular_rate_bpm.source}) — ${report.heart_rate.ventricular_rate_bpm.assessment}`
  );
  addKeyValueRow(
    'Atrial Rate:',
    `${report.heart_rate.atrial_rate_bpm.value} ${report.heart_rate.atrial_rate_bpm.unit} (${report.heart_rate.atrial_rate_bpm.source})`
  );
  addKeyValueRow('Underlying Rhythm:', `${report.rhythm.underlying_rhythm} (${report.rhythm.regularity})`);
  addKeyValueRow('P Waves & P-QRS:', `${report.rhythm.p_wave_presence_and_morphology} | ${report.rhythm.p_qrs_relationship}`);
  addKeyValueRow('Rhythm Reasoning:', report.rhythm.rhythm_reasoning);

  // 4 & 5. Intervals & Electrical Axis
  addSectionHeading('4. ECG Measurements & 5. Electrical Axis');
  addKeyValueRow(
    'PR Interval:',
    `${report.intervals.pr_interval_ms.value} ${report.intervals.pr_interval_ms.unit} [${report.intervals.pr_interval_ms.source}] (Ref: ${report.intervals.pr_interval_ms.normalRange})`
  );
  addKeyValueRow(
    'QRS Duration:',
    `${report.intervals.qrs_duration_ms.value} ${report.intervals.qrs_duration_ms.unit} [${report.intervals.qrs_duration_ms.source}] (Ref: ${report.intervals.qrs_duration_ms.normalRange})`
  );
  addKeyValueRow(
    'QT / QTc Interval:',
    `QT: ${report.intervals.qt_interval_ms.value} ms | QTc: ${report.intervals.qtc_interval_ms.value} ms [${report.intervals.qtc_interval_ms.source}] (${report.intervals.qtc_formula_used})`
  );
  addKeyValueRow(
    'Electrical Axes:',
    `P: ${report.electrical_axis.p_wave_axis.value}° | QRS: ${report.electrical_axis.qrs_axis.value}° | T: ${report.electrical_axis.t_wave_axis.value}° — ${report.electrical_axis.axis_deviation_summary}`
  );

  // 6. Lead-by-Lead Analysis
  addSectionHeading('6. Lead-by-Lead Interpretation');
  for (const lead of report.lead_analysis) {
    addKeyValueRow(
      `${lead.leadName} (${lead.identifiedFromLabel ? 'Labeled' : 'Unlabeled'}):`,
      `QRS: ${lead.qrsMorphology} | ST: ${lead.stSegment} | T: ${lead.tWave} | Findings: ${lead.abnormalities}`
    );
  }

  // 7. Waveform Morphology
  addSectionHeading('7. Waveform Morphology');
  addKeyValueRow('P Waves & QRS:', `${report.waveform_morphology.p_wave_abnormalities} | ${report.waveform_morphology.qrs_morphology_summary}`);
  addKeyValueRow('Q Waves & R Progression:', `${report.waveform_morphology.pathological_q_waves} | ${report.waveform_morphology.r_wave_progression}`);
  addKeyValueRow('ST Segment & T Waves:', `${report.waveform_morphology.st_segment_changes} | ${report.waveform_morphology.t_wave_abnormalities}`);
  addKeyValueRow('Hypertrophy / BBB:', `${report.waveform_morphology.ventricular_hypertrophy_chamber_enlargement} | ${report.waveform_morphology.bundle_branch_block_evidence}`);

  // 8. Ischemia & Infarction
  addSectionHeading('8. Ischemia and Infarction Assessment');
  addKeyValueRow('Acute Ischemia / STEMI:', `${report.ischemia_and_infarction.acute_ischemia_patterns} | ${report.ischemia_and_infarction.stemi_patterns}`);
  addKeyValueRow('NSTEMI / Prior MI:', `${report.ischemia_and_infarction.nstemi_acs_patterns} | ${report.ischemia_and_infarction.prior_infarction_evidence}`);
  addKeyValueRow('Affected Leads:', report.ischemia_and_infarction.affected_leads);
  addKeyValueRow('Clinical Caution:', report.ischemia_and_infarction.pattern_vs_diagnosis_distinction);

  // 9 & 10. Arrhythmias, Conduction & Other Findings
  addSectionHeading('9. Arrhythmias & Conduction / 10. Other Findings');
  addKeyValueRow('AV Block & Bundle Branch:', `${report.arrhythmias_and_conduction.av_block_assessment} | ${report.arrhythmias_and_conduction.bundle_branch_and_fascicular_blocks}`);
  addKeyValueRow('Arrhythmias:', `${report.arrhythmias_and_conduction.supraventricular_arrhythmias} | ${report.arrhythmias_and_conduction.ventricular_arrhythmias}`);
  if (report.additional_findings.length > 0) {
    for (const item of report.additional_findings) {
      addKeyValueRow(`${item.category}:`, `${item.observation} (${item.affectedLeads}) — ${item.clinicalSignificance}`);
    }
  }
  addKeyValueRow('Electrolyte Note:', report.electrolyte_disclaimer_note);

  // 11. Printed Machine Interpretation
  addSectionHeading('11. Printed Machine Interpretation Comparison');
  addKeyValueRow('Printed Text:', report.printed_machine_interpretation.extracted_text);
  addKeyValueRow('AI vs Machine:', report.printed_machine_interpretation.comparison_with_ai);

  // 12, 13, 14. Clinical Impression, Limitations & Next Steps
  addSectionHeading('12. Final Clinical Impression & 14. Recommended Next Steps');
  addKeyValueRow('Primary Interpretation:', report.ai_interpretation.primary_interpretation);
  addParagraph('Clinical Impression Summary: ' + report.clinical_impression.join(' • '));
  addParagraph('Recommended Next Steps: ' + report.recommended_next_steps.join(' • '));

  addSectionHeading('13. Limitations and Confidence');
  addKeyValueRow('Confidence Level:', `${report.confidence.overall_level} — ${report.confidence.rationale}`);
  addParagraph('Technical Limitations: ' + report.limitations.join(' • '));

  doc.save(`ECG-Analysis-Report-${Date.now()}.pdf`);
}

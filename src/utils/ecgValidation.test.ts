import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateImageInput,
  validateAndNormalizeEcgResponse,
  validateAndCrossCheckEcgResponse,
  parseMeasuredNumber,
  classifyUrgencyBanner,
  detectExifOrientationFromBuffer,
  formatReportAsPlainText,
  MANDATORY_MEDICAL_DISCLAIMER,
} from './ecgValidation.ts';

test('validateImageInput accepts supported MIME types and rejects unsupported or empty inputs', () => {
  assert.equal(validateImageInput('image/jpeg', 1024 * 500).valid, true);
  assert.equal(validateImageInput('image/png', 1024 * 500).valid, true);
  assert.equal(validateImageInput('image/webp', 1024 * 500).valid, true);

  const missingMime = validateImageInput('', 1024);
  assert.equal(missingMime.valid, false);

  const badFormat = validateImageInput('application/pdf', 1024);
  assert.equal(badFormat.valid, false);
  assert.match(badFormat.error || '', /Unsupported image format/);

  const zeroBytes = validateImageInput('image/jpeg', 0);
  assert.equal(zeroBytes.valid, false);

  const oversized = validateImageInput('image/jpeg', 25 * 1024 * 1024);
  assert.equal(oversized.valid, false);
});

test('validateAndNormalizeEcgResponse never converts missing or null fields into normal findings', () => {
  const sparsePayload = {
    image_quality: {
      overall_readability: 'Unreadable',
      can_interpret_reliably: false,
    },
    urgency_level: 'Normal ECG appearance', // Should be overridden to Indeterminate when unreadable
  };

  const normalized = validateAndNormalizeEcgResponse(sparsePayload);

  // Must not claim Normal ECG appearance when unreadable
  assert.equal(
    normalized.urgency_level,
    'Indeterminate because of image quality or insufficient information'
  );
  assert.equal(normalized.heart_rate.ventricular_rate_bpm.source, 'Unmeasurable');
  assert.equal(normalized.intervals.qtc_interval_ms.source, 'Unmeasurable');
  assert.match(normalized.rhythm.underlying_rhythm, /Indeterminate/);
  assert.match(normalized.recording_information.paper_speed, /Not printed/);
});

test('classifyUrgencyBanner provides non-hue-only glyph and emergency banner flags', () => {
  const critical = classifyUrgencyBanner(
    'Critical pattern requiring immediate emergency evaluation'
  );
  assert.equal(critical.requiresEmergencyBanner, true);
  assert.equal(critical.glyph, '✖');

  const normal = classifyUrgencyBanner('Normal ECG appearance');
  assert.equal(normal.requiresEmergencyBanner, false);
  assert.equal(normal.glyph, '●');
  assert.match(normal.shortLabel, /DOES NOT EXCLUDE CARDIAC DISEASE/);
});

test('detectExifOrientationFromBuffer returns 1 for non-JPEG buffers safely', () => {
  const buffer = new ArrayBuffer(16);
  assert.equal(detectExifOrientationFromBuffer(buffer), 1);
});

test('formatReportAsPlainText includes mandatory medical disclaimer and structured sections', () => {
  const report = validateAndNormalizeEcgResponse({
    executive_summary: 'Sinus rhythm at 74 bpm with normal intervals.',
    urgency_level: 'Normal ECG appearance',
    image_quality: { overall_readability: 'High', can_interpret_reliably: true },
  });
  const text = formatReportAsPlainText(report);
  assert.ok(text.includes(MANDATORY_MEDICAL_DISCLAIMER));
  assert.ok(text.includes('Sinus rhythm at 74 bpm with normal intervals.'));
  assert.ok(text.includes('1. EXECUTIVE SUMMARY'));
});

test('validateAndCrossCheckEcgResponse deterministically auto-corrects drifted AI QTc arithmetic and stamps math cross-check', () => {
  // HR = 75 bpm -> RR = 0.8s -> sqrt(RR) = 0.894427 -> Bazett = round(380 / 0.894427) = 425 ms
  const { report, mathChecksApplied } = validateAndCrossCheckEcgResponse({
    image_quality: { overall_readability: 'High', can_interpret_reliably: true },
    urgency_level: 'Normal ECG appearance',
    heart_rate: {
      ventricular_rate_bpm: {
        value: '~75 bpm',
        unit: 'bpm',
        source: 'Visually Estimated',
        normalRange: '60-100 bpm',
        assessment: 'Within normal limits',
        reliabilityNote: '4 large boxes',
      },
    },
    intervals: {
      qt_interval_ms: {
        value: '380',
        unit: 'ms',
        source: 'Visually Estimated',
        normalRange: '350-450 ms',
        assessment: 'Within normal limits',
        reliabilityNote: '9.5 small boxes',
      },
      qtc_interval_ms: {
        value: '478', // LLM arithmetic error (>8ms drift from 425)
        unit: 'ms',
        source: 'AI Calculated',
        normalRange: '< 450 ms',
        assessment: 'Prolonged QTc',
        reliabilityNote: 'Calculated by AI',
      },
      qtc_formula_used: 'Bazett',
    },
  });

  assert.equal(report.heart_rate.ventricular_rate_bpm.value, '75');
  assert.equal(report.intervals.qtc_interval_ms.value, '425');
  assert.match(report.intervals.qtc_interval_ms.reliabilityNote, /Math Cross-Check: Bazett=425 ms/);
  assert.ok(mathChecksApplied.some((m) => m.includes('QTc arithmetic auto-corrected')));
});

test('validateAndCrossCheckEcgResponse normalizes Unicode minus axes, enforces Cabrera LAD quadrant, and sorts 12 leads canonically', () => {
  const { report } = validateAndCrossCheckEcgResponse({
    image_quality: { overall_readability: 'High', can_interpret_reliably: true },
    urgency_level: 'Normal ECG appearance',
    electrical_axis: {
      qrs_axis: {
        value: '\u221248°', // Unicode minus −48°
        unit: '°',
        source: 'Printed on ECG',
        normalRange: '-30° to +90°',
        assessment: 'Within normal limits', // Contradicts -48° LAD!
        reliabilityNote: 'Header',
      },
    },
    lead_analysis: [
      { leadName: 'V2', identifiedFromLabel: true },
      { leadName: 'Lead I', identifiedFromLabel: true },
      { leadName: 'Rhythm Strip II', identifiedFromLabel: true },
      { leadName: 'aVF', identifiedFromLabel: true },
    ],
  });

  assert.equal(parseMeasuredNumber('\u221248°'), -48);
  assert.equal(report.electrical_axis.qrs_axis.value, '-48');
  assert.match(report.electrical_axis.qrs_axis.assessment, /Left Axis Deviation/);
  // Normal ECG appearance should also be upgraded to Abnormal ECG because QRS axis is -48° (< -30°)
  assert.equal(report.urgency_level, 'Abnormal ECG');
  assert.deepEqual(
    report.lead_analysis.map((l) => l.leadName),
    ['Lead I', 'aVF', 'V2', 'Rhythm Strip II']
  );
});

test('validateAndCrossCheckEcgResponse upgrades Normal ECG appearance when QTc >= 500 ms or QRS >= 120 ms', () => {
  const severeQtc = validateAndCrossCheckEcgResponse({
    image_quality: { overall_readability: 'High', can_interpret_reliably: true },
    urgency_level: 'Normal ECG appearance',
    intervals: {
      qtc_interval_ms: {
        value: '518',
        unit: 'ms',
        source: 'Printed on ECG',
        normalRange: '< 450 ms',
        assessment: 'Markedly prolonged',
        reliabilityNote: 'Printed header',
      },
    },
  });
  assert.equal(severeQtc.report.urgency_level, 'Potentially urgent abnormality');

  const wideQrs = validateAndCrossCheckEcgResponse({
    image_quality: { overall_readability: 'High', can_interpret_reliably: true },
    urgency_level: 'Normal ECG appearance',
    intervals: {
      qrs_duration_ms: {
        value: '138',
        unit: 'ms',
        source: 'Printed on ECG',
        normalRange: '< 120 ms',
        assessment: 'Within normal limits',
        reliabilityNote: 'Printed header',
      },
    },
  });
  assert.equal(wideQrs.report.urgency_level, 'Abnormal ECG');
  assert.match(wideQrs.report.intervals.qrs_duration_ms.assessment, /Wide \/ Prolonged QRS/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateImageInput,
  validateAndNormalizeEcgResponse,
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

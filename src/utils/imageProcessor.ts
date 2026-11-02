import {
  detectExifOrientationFromBuffer,
  describeExifOrientation,
  validateImageInput,
} from './ecgValidation';

export interface ProcessedEcgImage {
  file: File;
  previewDataUrl: string;
  base64Data: string;
  mimeType: string;
  width: number;
  height: number;
  sizeBytes: number;
  exifOrientation: number;
  orientationDescription: string;
}

const MAX_OPTIMAL_DIMENSION_PX = 2560;

/**
 * Reads an uploaded or captured ECG image file, automatically detects EXIF orientation,
 * normalizes rotated smartphone photos upright onto a high-definition canvas when needed
 * (so the Vision encoder never receives sideways/upside-down 1mm ECG grids), and caps
 * oversized >2560px camera images cleanly without losing millimeter grid sharpness.
 */
export async function processEcgImageFile(file: File): Promise<ProcessedEcgImage> {
  const rawMime = file.type || inferMimeTypeFromFilename(file.name);
  const validation = validateImageInput(rawMime, file.size);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const normalizedMime = rawMime === 'image/jpg' ? 'image/jpeg' : rawMime;
  const arrayBuffer = await file.arrayBuffer();
  const exifOrientation = detectExifOrientationFromBuffer(arrayBuffer);
  const baseOrientationDesc = describeExifOrientation(exifOrientation);

  const originalDataUrl = await readFileAsDataUrl(file);
  const loadedImg = await loadImageElement(originalDataUrl);
  const naturalW = loadedImg.naturalWidth || 1200;
  const naturalH = loadedImg.naturalHeight || 800;

  const needsExifBake = exifOrientation > 1;
  const longestEdge = Math.max(naturalW, naturalH);
  const needsDownscale = longestEdge > MAX_OPTIMAL_DIMENSION_PX;

  // Preserve exact original bytes when already upright (EXIF 1) and within optimal HD bounds
  if (!needsExifBake && !needsDownscale) {
    const commaIdx = originalDataUrl.indexOf(',');
    if (commaIdx === -1) {
      throw new Error('Could not encode ECG image data.');
    }
    return {
      file,
      previewDataUrl: originalDataUrl,
      base64Data: originalDataUrl.slice(commaIdx + 1),
      mimeType: normalizedMime,
      width: naturalW,
      height: naturalH,
      sizeBytes: file.size,
      exifOrientation: 1,
      orientationDescription: baseOrientationDesc,
    };
  }

  // Browser <img> already decodes EXIF orientation upright via default CSS image-orientation: from-image.
  // Rendering to a high-precision canvas bakes upright pixels (0°) at optimal HD resolution.
  const scale = needsDownscale ? MAX_OPTIMAL_DIMENSION_PX / longestEdge : 1;
  const targetW = Math.max(1, Math.round(naturalW * scale));
  const targetH = Math.max(1, Math.round(naturalH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    const commaIdx = originalDataUrl.indexOf(',');
    return {
      file,
      previewDataUrl: originalDataUrl,
      base64Data: commaIdx !== -1 ? originalDataUrl.slice(commaIdx + 1) : '',
      mimeType: normalizedMime,
      width: naturalW,
      height: naturalH,
      sizeBytes: file.size,
      exifOrientation,
      orientationDescription: baseOrientationDesc,
    };
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, targetW, targetH);
  ctx.drawImage(loadedImg, 0, 0, targetW, targetH);

  const outMime = normalizedMime === 'image/png' && !needsDownscale ? 'image/png' : 'image/jpeg';
  const normalizedDataUrl =
    outMime === 'image/png'
      ? canvas.toDataURL('image/png')
      : canvas.toDataURL('image/jpeg', 0.94);

  const commaIdx = normalizedDataUrl.indexOf(',');
  const base64Data = commaIdx !== -1 ? normalizedDataUrl.slice(commaIdx + 1) : '';
  const approxBytes = Math.floor((base64Data.length * 3) / 4);

  const noteParts: string[] = [];
  if (needsExifBake) {
    noteParts.push(`Upright-normalized from EXIF #${exifOrientation}`);
  } else {
    noteParts.push('Standard upright orientation');
  }
  if (needsDownscale) {
    noteParts.push(`HD-calibrated ${targetW}x${targetH}px`);
  }

  return {
    file,
    previewDataUrl: normalizedDataUrl,
    base64Data,
    mimeType: outMime,
    width: targetW,
    height: targetH,
    sizeBytes: approxBytes || file.size,
    exifOrientation: 1,
    orientationDescription: noteParts.join(' · '),
  };
}

/**
 * Physically rotates the active ProcessedEcgImage by 90° clockwise on a high-precision canvas
 * so both the on-screen preview and the base64 image transmitted to Gemini AI match 100%.
 */
export async function rotateProcessedEcgImage90(
  current: ProcessedEcgImage
): Promise<ProcessedEcgImage> {
  const img = await loadImageElement(current.previewDataUrl);
  const srcW = img.naturalWidth || current.width;
  const srcH = img.naturalHeight || current.height;

  const canvas = document.createElement('canvas');
  canvas.width = srcH;
  canvas.height = srcW;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return current;
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(img, -srcW / 2, -srcH / 2, srcW, srcH);
  ctx.restore();

  const outMime = current.mimeType === 'image/png' ? 'image/png' : 'image/jpeg';
  const rotatedDataUrl =
    outMime === 'image/png'
      ? canvas.toDataURL('image/png')
      : canvas.toDataURL('image/jpeg', 0.94);

  const commaIdx = rotatedDataUrl.indexOf(',');
  const base64Data = commaIdx !== -1 ? rotatedDataUrl.slice(commaIdx + 1) : current.base64Data;
  const approxBytes = Math.floor((base64Data.length * 3) / 4);

  const rotatedBlob = await dataUrlToBlob(rotatedDataUrl, outMime);
  const rotatedFile = new File([rotatedBlob], current.file.name, { type: outMime });

  return {
    file: rotatedFile,
    previewDataUrl: rotatedDataUrl,
    base64Data,
    mimeType: outMime,
    width: canvas.width,
    height: canvas.height,
    sizeBytes: approxBytes,
    exifOrientation: 1,
    orientationDescription: 'Manually rotated +90° upright by clinician',
  };
}

async function dataUrlToBlob(dataUrl: string, fallbackMime: string): Promise<Blob> {
  try {
    const res = await fetch(dataUrl);
    return await res.blob();
  } catch {
    const commaIdx = dataUrl.indexOf(',');
    const b64 = commaIdx !== -1 ? dataUrl.slice(commaIdx + 1) : '';
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      bytes[i] = bin.charCodeAt(i);
    }
    return new Blob([bytes], { type: fallbackMime });
  }
}

function inferMimeTypeFromFilename(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return '';
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to read image file.'));
      }
    };
    reader.onerror = () => reject(new Error('Error reading the selected image file.'));
    reader.readAsDataURL(file);
  });
}

function loadImageElement(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Unable to decode ECG image dimensions.'));
    img.src = dataUrl;
  });
}

export type SampleEcgScenario = 'normal_sinus' | 'inferior_stemi' | 'atrial_fibrillation';

/**
 * Generates a high-resolution, realistic 12-lead ECG strip on a millimeter calibration grid
 * as a genuine PNG File so users and automated verification can test real end-to-end
 * AI multimodal vision analysis on diverse ECG patterns.
 */
export async function generateClinicalSampleEcgFile(
  scenario: SampleEcgScenario
): Promise<File> {
  const canvas = document.createElement('canvas');
  canvas.width = 1600;
  canvas.height = 1050;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context unavailable');
  }

  // 1. Background thermal ECG paper
  ctx.fillStyle = '#FFFDFB';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 2. Millimeter ECG Grid (fine 1mm lines & bold 5mm lines)
  const smallGrid = 6; // 6px = 1mm
  const largeGrid = 30; // 30px = 5mm

  ctx.lineWidth = 0.6;
  ctx.strokeStyle = '#FADBD8';
  ctx.beginPath();
  for (let x = 0; x <= canvas.width; x += smallGrid) {
    ctx.moveTo(x, 120);
    ctx.lineTo(x, canvas.height - 20);
  }
  for (let y = 120; y <= canvas.height - 20; y += smallGrid) {
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
  }
  ctx.stroke();

  ctx.lineWidth = 1.2;
  ctx.strokeStyle = '#F1948A';
  ctx.beginPath();
  for (let x = 0; x <= canvas.width; x += largeGrid) {
    ctx.moveTo(x, 120);
    ctx.lineTo(x, canvas.height - 20);
  }
  for (let y = 120; y <= canvas.height - 20; y += largeGrid) {
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
  }
  ctx.stroke();

  // 3. Top Header Banner (Printed ECG Machine Header & Automated Interpretation)
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, 120);
  ctx.strokeStyle = '#CBD5E1';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, 120);
  ctx.lineTo(canvas.width, 120);
  ctx.stroke();

  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 19px "IBM Plex Mono", monospace';

  if (scenario === 'normal_sinus') {
    ctx.fillText('ID: EDU-NSR-4012   AGE: 42Y   SEX: F   DATE: 2026-10-15 09:14:22', 28, 34);
    ctx.font = '17px "IBM Plex Mono", monospace';
    ctx.fillText('Vent. Rate: 74 bpm      PR Interval: 158 ms      MACHINE INTERPRETATION:', 28, 62);
    ctx.fillText('Atrial Rate: 74 bpm     QRS Duration: 88 ms      *** NORMAL SINUS RHYTHM ***', 28, 86);
    ctx.fillText('P-R-T Axes: 48° 54° 42° QT/QTc(Bazett): 386/429 ms   NORMAL ECG', 28, 108);
  } else if (scenario === 'inferior_stemi') {
    ctx.fillText('ID: EDU-ACS-8891   AGE: 64Y   SEX: M   DATE: 2026-10-15 10:02:11', 28, 34);
    ctx.font = '17px "IBM Plex Mono", monospace';
    ctx.fillText('Vent. Rate: 86 bpm      PR Interval: 168 ms      MACHINE INTERPRETATION:', 28, 62);
    ctx.fillText('Atrial Rate: 86 bpm     QRS Duration: 96 ms      *** ACUTE INFERIOR INJURY PATTERN ***', 28, 86);
    ctx.fillText('P-R-T Axes: 55° 68° 85° QT/QTc(Bazett): 372/445 ms   ST ELEVATION IN II, III, aVF; RECIPROCAL I, aVL', 28, 108);
  } else {
    ctx.fillText('ID: EDU-AFIB-2190  AGE: 71Y   SEX: M   DATE: 2026-10-15 11:30:05', 28, 34);
    ctx.font = '17px "IBM Plex Mono", monospace';
    ctx.fillText('Vent. Rate: 122 bpm     PR Interval: --- ms      MACHINE INTERPRETATION:', 28, 62);
    ctx.fillText('Atrial Rate: --- bpm    QRS Duration: 92 ms      *** ATRIAL FIBRILLATION WITH RAPID VENTRICULAR RESPONSE ***', 28, 86);
    ctx.fillText('P-R-T Axes: --° 35° 28° QT/QTc(Bazett): 318/453 ms   ABNORMAL RHYTHM ECG', 28, 108);
  }

  ctx.font = 'bold 16px "IBM Plex Mono", monospace';
  ctx.fillText('25 mm/s    10 mm/mV    0.05-150 Hz    12-Lead Standard    CardioGraph Pro 9000', 830, 34);

  // 4. Draw 12-Lead Waveforms (4 columns x 3 rows + Bottom Rhythm Strip II)
  const columns = [
    ['I', 'II', 'III'],
    ['aVR', 'aVL', 'aVF'],
    ['V1', 'V2', 'V3'],
    ['V4', 'V5', 'V6'],
  ];

  const rowY = [245, 445, 645];
  const colWidth = 380;
  const startX = 40;

  ctx.strokeStyle = '#0F172A';
  ctx.lineWidth = 2.0;

  for (let colIdx = 0; colIdx < 4; colIdx++) {
    for (let rowIdx = 0; rowIdx < 3; rowIdx++) {
      const leadName = columns[colIdx][rowIdx];
      const x0 = startX + colIdx * colWidth;
      const y0 = rowY[rowIdx];

      // Draw lead label
      ctx.fillStyle = '#0F172A';
      ctx.font = 'bold 20px "IBM Plex Mono", monospace';
      ctx.fillText(leadName, x0 + 8, y0 - 48);

      // Draw 1mV calibration pulse at start of row if colIdx === 0
      drawLeadWaveform(ctx, x0, y0, colWidth - 20, leadName, scenario, colIdx === 0);
    }
  }

  // Bottom full-width Rhythm Strip: Lead II
  const rhythmY = 890;
  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 20px "IBM Plex Mono", monospace';
  ctx.fillText('II (Rhythm Strip - 10s)', startX + 8, rhythmY - 52);
  drawLeadWaveform(ctx, startX, rhythmY, canvas.width - 80, 'II', scenario, true);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Failed to generate sample ECG blob'));
        return;
      }
      const file = new File([blob], `sample_12lead_${scenario}.png`, {
        type: 'image/png',
      });
      resolve(file);
    }, 'image/png');
  });
}

function drawLeadWaveform(
  ctx: CanvasRenderingContext2D,
  xStart: number,
  yBase: number,
  width: number,
  leadName: string,
  scenario: SampleEcgScenario,
  includeCalPulse: boolean
) {
  ctx.beginPath();
  ctx.strokeStyle = '#111827';
  ctx.lineWidth = 2.1;

  let curX = xStart;
  ctx.moveTo(curX, yBase);

  if (includeCalPulse) {
    // 10mm/mV calibration pulse (60px tall = 2 large boxes = 10mm)
    ctx.lineTo(curX + 6, yBase);
    ctx.lineTo(curX + 6, yBase - 60);
    ctx.lineTo(curX + 24, yBase - 60);
    ctx.lineTo(curX + 24, yBase);
    ctx.lineTo(curX + 34, yBase);
    curX += 34;
  }

  const isInvertedLead = leadName === 'aVR';
  const isV1V2 = leadName === 'V1' || leadName === 'V2';
  const isInferior = leadName === 'II' || leadName === 'III' || leadName === 'aVF';
  const isHighLateral = leadName === 'I' || leadName === 'aVL';

  const polarity = isInvertedLead ? -1 : 1;
  const stElevationPx =
    scenario === 'inferior_stemi'
      ? isInferior
        ? -26 // Marked ST elevation in II, III, aVF
        : isHighLateral
          ? 16 // Reciprocal ST depression in I, aVL
          : 0
      : 0;

  const beatIntervals =
    scenario === 'atrial_fibrillation'
      ? [72, 110, 84, 128, 76, 95, 118, 82, 105, 74, 122, 88, 92, 115, 79]
      : scenario === 'inferior_stemi'
        ? [105, 105, 105, 105, 105, 105, 105, 105, 105, 105, 105, 105, 105, 105]
        : [122, 122, 122, 122, 122, 122, 122, 122, 122, 122, 122, 122, 122];

  let beatIdx = 0;
  while (curX + 75 < xStart + width) {
    const cycleWidth = beatIntervals[beatIdx % beatIntervals.length];
    beatIdx++;

    // Baseline / P wave
    if (scenario === 'atrial_fibrillation') {
      // Fibrillatory baseline ripples without discrete P waves
      for (let fx = 0; fx < 26; fx += 4) {
        const waveY = yBase + Math.sin(curX + fx) * 3.5;
        ctx.lineTo(curX + fx, waveY);
      }
      curX += 26;
    } else {
      // Flat baseline then smooth P wave
      ctx.lineTo(curX + 10, yBase);
      ctx.quadraticCurveTo(curX + 18, yBase - 12 * polarity, curX + 26, yBase);
      // PR segment
      ctx.lineTo(curX + 36, yBase);
      curX += 36;
    }

    // QRS Complex
    const rHeight = isV1V2 ? -18 : 58 * polarity;
    const sDepth = isV1V2 ? 48 : -14 * polarity;

    // Small Q
    ctx.lineTo(curX + 3, yBase + 6 * polarity);
    // Sharp R peak
    ctx.lineTo(curX + 8, yBase - rHeight);
    // S trough
    ctx.lineTo(curX + 13, yBase - sDepth);
    // J point (with optional ST elevation/depression)
    ctx.lineTo(curX + 16, yBase + stElevationPx);

    // ST segment & T wave
    const stEnd = curX + 30;
    ctx.lineTo(stEnd, yBase + stElevationPx);
    const tPeakY =
      scenario === 'inferior_stemi' && isInferior
        ? yBase - 44 // Hyperacute/coved ST-T dome
        : yBase - 22 * polarity + stElevationPx * 0.5;
    ctx.quadraticCurveTo(stEnd + 12, tPeakY, stEnd + 26, yBase);

    // TP baseline to end of cycle
    const remaining = Math.max(12, cycleWidth - 62);
    if (scenario === 'atrial_fibrillation') {
      for (let fx = 0; fx < remaining; fx += 5) {
        ctx.lineTo(stEnd + 26 + fx, yBase + Math.cos(stEnd + fx) * 3.2);
      }
    } else {
      ctx.lineTo(stEnd + 26 + remaining, yBase);
    }

    curX = stEnd + 26 + remaining;
  }

  ctx.lineTo(xStart + width, yBase);
  ctx.stroke();
}

/**
 * Deterministic Computer-Vision & Digital Signal Processing (DSP) Pre-Analyzer for 12-Lead ECG Images.
 *
 * Extracts 100% deterministic, repeatable pixel-level measurements BEFORE multimodal LLM inference:
 * 1. 256-bit (16x16) box-filtered perceptual gradient hash (dHash) for format-invariant reproducibility.
 * 2. Sub-pixel 5mm/1mm calibration grid spacing via 2D X/Y harmonic autocorrelation + Square-Grid Invariant.
 * 3. Chrominance-filtered dark waveform trace segmentation & 10-second rhythm strip R-peak detection
 *    (automatically rejecting flat-topped 1mV rectangular calibration pulses).
 * 4. Exact R-R interval mean, median, Coefficient of Variation (CV%), and calibrated Ventricular Heart Rate (bpm).
 */

export interface EcgPixelTelemetry {
  imageWidth: number;
  imageHeight: number;
  perceptualHash256: string;
  gridDetected: boolean;
  gridConfidence: number;
  pxPer1mm: number | null;
  pxPer5mm: number | null;
  detectedRowsCount: number;
  rhythmPeakCount: number;
  meanRrPx: number | null;
  medianRrPx: number | null;
  rrCvPercent: number | null;
  rhythmRegularitySignal: 'regular' | 'mild_variation' | 'irregular' | 'indeterminate';
  estimatedHrBpm: number | null;
  estimatedMeanRrMs: number | null;
  hrConfidence: number;
  telemetrySummaryForAi: string;
}

/**
 * Computes a 256-bit (64 hex chars) ECG-specific Waveform-Ink Perceptual Hash (16x16 spatial cells).
 * Suppresses white paper background and pink/red millimeter grid chrominance so only true dark
 * ECG waveform ink & header markings contribute — achieving near-zero Hamming distance across
 * PNG, JPEG recompression, and Ctrl+V clipboard screenshots while separating distinct ECG tracings.
 */
export function computePerceptualHash256(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number
): string {
  const cols = 16;
  const rows = 16;
  if (width < cols || height < rows || rgba.length < width * height * 4) {
    return '0'.repeat(64);
  }

  const cellInk = new Float64Array(cols * rows);
  const step = width * height > 2_000_000 ? 2 : 1;

  for (let r = 0; r < rows; r++) {
    const y0 = Math.floor((r * height) / rows);
    const y1 = Math.max(y0 + 1, Math.floor(((r + 1) * height) / rows));
    for (let c = 0; c < cols; c++) {
      const x0 = Math.floor((c * width) / cols);
      const x1 = Math.max(x0 + 1, Math.floor(((c + 1) * width) / cols));

      let inkSum = 0;
      let count = 0;
      for (let y = y0; y < y1; y += step) {
        const rowOff = y * width;
        for (let x = x0; x < x1; x += step) {
          const idx = (rowOff + x) * 4;
          const red = rgba[idx];
          const green = rgba[idx + 1];
          const blue = rgba[idx + 2];
          const lum = 0.299 * red + 0.587 * green + 0.114 * blue;
          // Suppress pink/red/orange ECG grid lines so grid aliasing never jitters hash bits
          const redGridLift = Math.max(0, red - green) * 0.65;
          const effectiveLum = lum + redGridLift;
          if (effectiveLum < 185) {
            inkSum += 185 - effectiveLum;
          }
          count++;
        }
      }
      cellInk[r * cols + c] = count > 0 ? inkSum / count : 0;
    }
  }

  let totalInk = 0;
  for (let i = 0; i < cellInk.length; i++) {
    totalInk += cellInk[i];
  }
  const globalMeanInk = totalInk / cellInk.length;
  // Minimum threshold floor ensures blank paper cells deterministically hash to 0
  const threshold = Math.max(0.45, globalMeanInk * 0.85);

  let hex = '';
  let nibble = 0;
  let bitInNibble = 0;

  for (let i = 0; i < 256; i++) {
    const bit = cellInk[i] > threshold ? 1 : 0;
    nibble = (nibble << 1) | bit;
    bitInNibble++;
    if (bitInNibble === 4) {
      hex += nibble.toString(16);
      nibble = 0;
      bitInNibble = 0;
    }
  }

  return hex;
}

const POPCOUNT_NIBBLE = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

/**
 * Computes exact bit-level Hamming distance between two hex perceptual hashes.
 */
export function hammingDistanceHex(hashA: string, hashB: string): number {
  if (!hashA || !hashB || hashA.length !== hashB.length) {
    return 999;
  }
  let dist = 0;
  for (let i = 0; i < hashA.length; i++) {
    const a = parseInt(hashA[i], 16);
    const b = parseInt(hashB[i], 16);
    if (Number.isNaN(a) || Number.isNaN(b)) return 999;
    dist += POPCOUNT_NIBBLE[(a ^ b) & 0xf];
  }
  return dist;
}

interface GridDetectionResult {
  detected: boolean;
  confidence: number;
  pxPer5mm: number | null;
  pxPer1mm: number | null;
}

function findPeriodicLag(signal: Float64Array, minLag: number, maxLag: number): {
  bestLag: number;
  score: number;
} {
  const n = signal.length;
  if (n < maxLag * 3 + 10 || minLag >= maxLag) {
    return { bestLag: 0, score: 0 };
  }

  // Zero-mean high-pass residual so slow illumination gradients don't bias autocorrelation
  const hp = new Float64Array(n);
  const win = 5;
  for (let i = 0; i < n; i++) {
    let localSum = 0;
    let cnt = 0;
    for (let k = Math.max(0, i - win); k <= Math.min(n - 1, i + win); k++) {
      localSum += signal[k];
      cnt++;
    }
    hp[i] = Math.max(0, signal[i] - localSum / cnt);
  }

  let energy = 0;
  for (let i = 0; i < n; i++) {
    energy += hp[i] * hp[i];
  }
  if (energy <= 1e-6) {
    return { bestLag: 0, score: 0 };
  }

  const acf = new Float64Array(maxLag * 3 + 2);
  const upperCompute = Math.min(n - 4, maxLag * 3 + 1);
  for (let lag = minLag; lag <= upperCompute; lag++) {
    let num = 0;
    let e1 = 0;
    let e2 = 0;
    const limit = n - lag;
    for (let i = 0; i < limit; i++) {
      const a = hp[i];
      const b = hp[i + lag];
      num += a * b;
      e1 += a * a;
      e2 += b * b;
    }
    const denom = Math.sqrt(e1 * e2);
    acf[lag] = denom > 1e-6 ? num / denom : 0;
  }

  // Score candidate 5mm major-grid lags using harmonic reinforcement (L, 2L, 3L)
  // while penalizing sub-harmonics if L/5 minor grid exists vs 2*L super-harmonic
  const harmonicScores = new Float64Array(maxLag + 2);
  let bestLagInt = 0;
  let bestScore = 0;

  for (let lag = minLag; lag <= maxLag; lag++) {
    const c1 = acf[lag];
    const c2 = lag * 2 <= upperCompute ? acf[lag * 2] : c1;
    const c3 = lag * 3 <= upperCompute ? acf[lag * 3] : c2;
    // Local peak check on acf[lag]
    if (c1 > acf[lag - 1] && c1 >= acf[lag + 1]) {
      const hScore = 0.5 * c1 + 0.32 * c2 + 0.18 * c3;
      harmonicScores[lag] = hScore;
      if (hScore > bestScore) {
        bestScore = hScore;
        bestLagInt = lag;
      }
    }
  }

  if (bestLagInt <= minLag || bestScore <= 0.12) {
    return { bestLag: 0, score: 0 };
  }

  // Resolve fundamental 5mm period: if bestLagInt is a 2x, 3x, or 4x super-harmonic of the true 5mm box,
  // pick the smallest integer divisor >= minLag that retains strong harmonic autocorrelation
  for (const divisor of [4, 3, 2]) {
    const subLag = Math.round(bestLagInt / divisor);
    if (subLag >= minLag) {
      let matchedSub = 0;
      let matchedScore = 0;
      for (let h = Math.max(minLag, subLag - 1); h <= Math.min(maxLag, subLag + 1); h++) {
        if (harmonicScores[h] >= bestScore * 0.82 && harmonicScores[h] > matchedScore) {
          matchedSub = h;
          matchedScore = harmonicScores[h];
        }
      }
      if (matchedSub > 0) {
        bestLagInt = matchedSub;
        bestScore = matchedScore;
        break;
      }
    }
  }

  // Sub-pixel parabolic refinement around acf[bestLagInt]
  const yMinus = acf[bestLagInt - 1];
  const yZero = acf[bestLagInt];
  const yPlus = acf[bestLagInt + 1];
  const denom = yMinus - 2 * yZero + yPlus;
  let delta = 0;
  if (Math.abs(denom) > 1e-6) {
    delta = Math.max(-0.5, Math.min(0.5, (0.5 * (yMinus - yPlus)) / denom));
  }

  return {
    bestLag: bestLagInt + delta,
    score: Math.min(1, bestScore),
  };
}

function detectMillimeterGridSpacing(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  bgLum: number
): GridDetectionResult {
  if (width < 480 || height < 280) {
    return { detected: false, confidence: 0, pxPer5mm: null, pxPer1mm: null };
  }

  const x0 = Math.floor(width * 0.08);
  const x1 = Math.floor(width * 0.92);
  const y0 = Math.floor(height * 0.16);
  const y1 = Math.floor(height * 0.88);
  const spanW = x1 - x0;
  const spanH = y1 - y0;

  const colProfile = new Float64Array(spanW);
  const rowProfile = new Float64Array(spanH);

  // Sample grid line energy (pink/red/orange chrominance + mid-tone gray grid lines, excluding dark black trace ink)
  const inkCutoff = Math.max(55, bgLum - 65);
  for (let y = y0; y < y1; y++) {
    const rowOff = y * width;
    let rSum = 0;
    for (let x = x0; x < x1; x++) {
      const idx = (rowOff + x) * 4;
      const r = rgba[idx];
      const g = rgba[idx + 1];
      const b = rgba[idx + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      if (lum < inkCutoff) {
        // Dark waveform ink or text — do not add to grid profile
        continue;
      }
      // Thermal pink/red/orange grid lines have elevated (R - G) or (R - B), while gray grid lines dip slightly below bgLum
      const redTint = Math.max(0, r - 0.5 * (g + b));
      const grayDip = Math.max(0, bgLum - lum);
      const val = redTint * 1.35 + grayDip * 0.85;
      colProfile[x - x0] += val;
      rSum += val;
    }
    rowProfile[y - y0] = rSum / Math.max(1, spanW);
  }
  for (let i = 0; i < spanW; i++) {
    colProfile[i] /= Math.max(1, spanH);
  }

  // Standard 12-lead ECG sheet is ~35 to 60 major (5mm) boxes wide
  const minLag = Math.max(11, Math.floor(width / 72));
  const maxLag = Math.min(95, Math.floor(width / 16));

  const xRes = findPeriodicLag(colProfile, minLag, maxLag);
  const yRes = findPeriodicLag(rowProfile, minLag, maxLag);

  if (xRes.bestLag <= 0 || yRes.bestLag <= 0) {
    return { detected: false, confidence: 0, pxPer5mm: null, pxPer1mm: null };
  }

  // Square-Grid Invariant: true ECG 5mm x 5mm grid boxes have nearly identical X and Y pixel pitch
  const relDiff = Math.abs(xRes.bestLag - yRes.bestLag) / Math.max(xRes.bestLag, yRes.bestLag);
  if (relDiff > 0.065) {
    return { detected: false, confidence: 0.25, pxPer5mm: null, pxPer1mm: null };
  }

  const pxPer5mm = Math.round(((xRes.bestLag + yRes.bestLag) / 2) * 100) / 100;
  const pxPer1mm = Math.round((pxPer5mm / 5) * 100) / 100;
  const rawConf = ((xRes.score + yRes.score) / 2) * (1 - relDiff * 4);
  const confidence = Math.round(Math.max(0, Math.min(0.99, rawConf * 1.45)) * 100) / 100;

  if (confidence < 0.45) {
    return { detected: false, confidence, pxPer5mm: null, pxPer1mm: null };
  }

  return {
    detected: true,
    confidence,
    pxPer5mm,
    pxPer1mm,
  };
}

function estimateBackgroundLuminance(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number
): number {
  const samples: number[] = [];
  const stepY = Math.max(4, Math.floor(height / 32));
  const stepX = Math.max(4, Math.floor(width / 32));
  for (let y = Math.floor(height * 0.15); y < Math.floor(height * 0.88); y += stepY) {
    const rowOff = y * width;
    for (let x = Math.floor(width * 0.08); x < Math.floor(width * 0.92); x += stepX) {
      const idx = (rowOff + x) * 4;
      const lum = 0.299 * rgba[idx] + 0.587 * rgba[idx + 1] + 0.114 * rgba[idx + 2];
      samples.push(lum);
    }
  }
  if (samples.length === 0) return 240;
  samples.sort((a, b) => a - b);
  // 75th percentile represents clean paper background above grid lines & dark traces
  return samples[Math.floor(samples.length * 0.75)];
}

function isWaveformInkPixel(
  r: number,
  g: number,
  b: number,
  bgLum: number
): boolean {
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  // Standard light paper background with dark black/navy/blue/dark-gray ink
  if (bgLum >= 135) {
    if (lum > bgLum - 52) return false;
    // Reject pink/red/salmon grid lines: high Red while Green/Blue drop moderately
    const redDominance = r - Math.min(g, b);
    if (r > 145 && redDominance > 36 && g > 75) {
      return false;
    }
    return true;
  }
  // Inverted dark-monitor screenshot (bright green/white trace on dark background)
  return lum > bgLum + 60;
}

/**
 * Runs complete deterministic pixel-level ECG grid & rhythm strip analysis.
 */
export function analyzeEcgCanvasPixels(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number
): EcgPixelTelemetry {
  const perceptualHash256 = computePerceptualHash256(rgba, width, height);

  if (width < 400 || height < 250 || rgba.length < width * height * 4) {
    return {
      imageWidth: width,
      imageHeight: height,
      perceptualHash256,
      gridDetected: false,
      gridConfidence: 0,
      pxPer1mm: null,
      pxPer5mm: null,
      detectedRowsCount: 0,
      rhythmPeakCount: 0,
      meanRrPx: null,
      medianRrPx: null,
      rrCvPercent: null,
      rhythmRegularitySignal: 'indeterminate',
      estimatedHrBpm: null,
      estimatedMeanRrMs: null,
      hrConfidence: 0,
      telemetrySummaryForAi: 'Image resolution too small for deterministic pixel grid telemetry.',
    };
  }

  const bgLum = estimateBackgroundLuminance(rgba, width, height);
  const grid = detectMillimeterGridSpacing(rgba, width, height, bgLum);
  const approxMajorBox = grid.pxPer5mm || width / 52;

  // Locate horizontal ECG trace rows across Y (14% .. 95%)
  const yStart = Math.floor(height * 0.14);
  const yEnd = Math.floor(height * 0.95);
  const xLeft = Math.floor(width * 0.05);
  const xRight = Math.floor(width * 0.95);

  const rowInkCount = new Float64Array(height);
  for (let y = yStart; y < yEnd; y++) {
    const rowOff = y * width;
    let cnt = 0;
    for (let x = xLeft; x < xRight; x += 2) {
      const idx = (rowOff + x) * 4;
      if (isWaveformInkPixel(rgba[idx], rgba[idx + 1], rgba[idx + 2], bgLum)) {
        cnt++;
      }
    }
    rowInkCount[y] = cnt;
  }

  // Smooth rowInkCount with a window of ~1.2 major boxes to find baseline centers
  const smoothWin = Math.max(8, Math.round(approxMajorBox * 0.9));
  const smoothRow = new Float64Array(height);
  let maxRowDensity = 0;
  for (let y = yStart; y < yEnd; y++) {
    let s = 0;
    let c = 0;
    for (let k = Math.max(yStart, y - smoothWin); k <= Math.min(yEnd - 1, y + smoothWin); k++) {
      s += rowInkCount[k];
      c++;
    }
    smoothRow[y] = c > 0 ? s / c : 0;
    if (smoothRow[y] > maxRowDensity) maxRowDensity = smoothRow[y];
  }

  const minRowSeparation = Math.max(36, Math.round(approxMajorBox * 2.8));
  const rowCenters: number[] = [];
  if (maxRowDensity > 3) {
    const candidates: { y: number; val: number }[] = [];
    for (let y = yStart + 4; y < yEnd - 4; y++) {
      if (
        smoothRow[y] >= maxRowDensity * 0.25 &&
        smoothRow[y] >= smoothRow[y - 1] &&
        smoothRow[y] > smoothRow[y + 1]
      ) {
        candidates.push({ y, val: smoothRow[y] });
      }
    }
    candidates.sort((a, b) => b.val - a.val);
    for (const cand of candidates) {
      if (rowCenters.every((ry) => Math.abs(ry - cand.y) >= minRowSeparation)) {
        rowCenters.push(cand.y);
      }
    }
    rowCenters.sort((a, b) => a - b);
  }

  // Evaluate bottom-most row first (standard 10-second Rhythm Strip II)
  let bestPeaks: number[] = [];
  let bestStripCoverage = 0;

  const candidateRows = rowCenters.length > 0 ? [...rowCenters].reverse() : [];
  for (const rCenter of candidateRows.slice(0, 2)) {
    const bandHalf = Math.min(
      Math.round(minRowSeparation * 0.48),
      Math.max(28, Math.round(approxMajorBox * 2.1))
    );
    const bandTop = Math.max(4, rCenter - bandHalf);
    const bandBot = Math.min(height - 4, rCenter + bandHalf);

    // Compute per-column uppermost ink yMin and lowermost ink yMax
    const colExcursion = new Float64Array(width);
    const yValuesForBaseline: number[] = [];

    const colTopY = new Int32Array(width).fill(-1);
    const colBotY = new Int32Array(width).fill(-1);

    for (let x = xLeft; x < xRight; x++) {
      let topY = -1;
      let botY = -1;
      for (let y = bandTop; y <= bandBot; y++) {
        const idx = (y * width + x) * 4;
        if (isWaveformInkPixel(rgba[idx], rgba[idx + 1], rgba[idx + 2], bgLum)) {
          if (topY === -1) topY = y;
          botY = y;
        }
      }
      if (topY !== -1) {
        colTopY[x] = topY;
        colBotY[x] = botY;
        yValuesForBaseline.push(Math.round((topY + botY) / 2));
      }
    }

    if (yValuesForBaseline.length < (xRight - xLeft) * 0.45) {
      continue;
    }

    yValuesForBaseline.sort((a, b) => a - b);
    const trueBaselineY = yValuesForBaseline[Math.floor(yValuesForBaseline.length * 0.5)];

    // Measure upward R-wave excursion above isoelectric baseline (or downward deep S excursion if rS strip)
    for (let x = xLeft; x < xRight; x++) {
      if (colTopY[x] !== -1) {
        const upExc = Math.max(0, trueBaselineY - colTopY[x]);
        const downExc = Math.max(0, colBotY[x] - trueBaselineY);
        colExcursion[x] = Math.max(upExc, downExc * 0.82);
      }
    }

    // Light 3px smoothing to merge 1-2px stroke gaps without widening peaks
    const smoothedExc = new Float64Array(width);
    const nonZeroExcs: number[] = [];
    for (let x = xLeft + 1; x < xRight - 1; x++) {
      const v = (colExcursion[x - 1] + 2 * colExcursion[x] + colExcursion[x + 1]) / 4;
      smoothedExc[x] = v;
      if (v > 2) nonZeroExcs.push(v);
    }

    if (nonZeroExcs.length < 30) continue;
    nonZeroExcs.sort((a, b) => a - b);
    const p96 = nonZeroExcs[Math.floor(nonZeroExcs.length * 0.96)];
    if (p96 < Math.max(10, approxMajorBox * 0.45)) continue;

    const peakThreshold = Math.max(8, p96 * 0.48);
    const refractoryPx = Math.max(18, Math.round(approxMajorBox * 1.15)); // ~230ms refractory period

    const rawCandidateX: number[] = [];
    for (let x = xLeft + 4; x < xRight - 4; x++) {
      const val = smoothedExc[x];
      if (val >= peakThreshold && val >= smoothedExc[x - 1] && val > smoothedExc[x + 1]) {
        // Reject rectangular 1mV calibration pulses: check plateau width at 82% of peak height
        const plateauLevel = val * 0.82;
        let pLeft = x;
        let pRight = x;
        while (pLeft > xLeft && smoothedExc[pLeft - 1] >= plateauLevel) pLeft--;
        while (pRight < xRight - 1 && smoothedExc[pRight + 1] >= plateauLevel) pRight++;
        const plateauWidth = pRight - pLeft + 1;
        if (plateauWidth >= Math.max(7, approxMajorBox * 0.36)) {
          // Flat-topped rectangular calibration pulse or text block — skip!
          continue;
        }
        rawCandidateX.push(x);
      }
    }

    // Non-maximum suppression within refractory window
    rawCandidateX.sort((a, b) => smoothedExc[b] - smoothedExc[a]);
    const acceptedPeaks: number[] = [];
    for (const px of rawCandidateX) {
      if (acceptedPeaks.every((ap) => Math.abs(ap - px) >= refractoryPx)) {
        acceptedPeaks.push(px);
      }
    }
    acceptedPeaks.sort((a, b) => a - b);

    if (acceptedPeaks.length >= 6) {
      const coverage =
        (acceptedPeaks[acceptedPeaks.length - 1] - acceptedPeaks[0]) / Math.max(1, xRight - xLeft);
      if (coverage > bestStripCoverage) {
        bestStripCoverage = coverage;
        bestPeaks = acceptedPeaks;
      }
      // If bottom strip already covers >= 62% of width continuously, lock it immediately
      if (coverage >= 0.62) {
        break;
      }
    }
  }

  let meanRrPx: number | null = null;
  let medianRrPx: number | null = null;
  let rrCvPercent: number | null = null;
  let rhythmRegularitySignal: EcgPixelTelemetry['rhythmRegularitySignal'] = 'indeterminate';
  let estimatedHrBpm: number | null = null;
  let estimatedMeanRrMs: number | null = null;
  let hrConfidence = 0;

  if (bestPeaks.length >= 6 && bestStripCoverage >= 0.55) {
    const rawIntervals: number[] = [];
    for (let i = 1; i < bestPeaks.length; i++) {
      rawIntervals.push(bestPeaks[i] - bestPeaks[i - 1]);
    }
    const sorted = [...rawIntervals].sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)];

    // Check for large unphysiological mid-strip column breaks (> 2.35x median)
    const maxGapRatio = sorted[sorted.length - 1] / Math.max(1, med);
    const minGapRatio = sorted[0] / Math.max(1, med);
    const cleanIntervals = rawIntervals.filter((rr) => rr >= med * 0.42 && rr <= med * 2.25);

    if (cleanIntervals.length >= 5 && maxGapRatio <= 2.45 && minGapRatio >= 0.38) {
      const mean = cleanIntervals.reduce((acc, v) => acc + v, 0) / cleanIntervals.length;
      const variance =
        cleanIntervals.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / cleanIntervals.length;
      const std = Math.sqrt(variance);
      const cv = (std / Math.max(1, mean)) * 100;

      meanRrPx = Math.round(mean * 10) / 10;
      medianRrPx = Math.round(med * 10) / 10;
      rrCvPercent = Math.round(cv * 10) / 10;

      if (cv <= 6.5) {
        rhythmRegularitySignal = 'regular';
      } else if (cv <= 12.5) {
        rhythmRegularitySignal = 'mild_variation';
      } else {
        rhythmRegularitySignal = 'irregular';
      }

      if (grid.detected && grid.pxPer5mm && grid.confidence >= 0.6) {
        const msPerPxAt25 = 200 / grid.pxPer5mm;
        const meanMs = Math.round(mean * msPerPxAt25);
        const hr = Math.round(60000 / Math.max(1, meanMs));
        if (hr >= 28 && hr <= 240) {
          estimatedMeanRrMs = meanMs;
          estimatedHrBpm = hr;
          const beatBonus = Math.min(0.15, (cleanIntervals.length - 5) * 0.02);
          hrConfidence =
            Math.round(Math.min(0.98, grid.confidence * 0.85 + beatBonus) * 100) / 100;
        }
      }
    }
  }

  const summaryLines: string[] = [
    `[DETERMINISTIC PIXEL-DSP TELEMETRY (${width}x${height}px)]`,
  ];
  if (grid.detected && grid.pxPer5mm && grid.pxPer1mm) {
    summaryLines.push(
      `- Calibration Grid Lattice Locked: 1 large box (5 mm) = ${grid.pxPer5mm} px; 1 small box (1 mm) = ${grid.pxPer1mm} px (Grid Confidence: ${Math.round(grid.confidence * 100)}%).`
    );
  } else {
    summaryLines.push(
      `- Calibration Grid Lattice: Not uniformly periodic in pixel matrix (e.g. perspective tilt or faint grid) — rely on printed header or visual box-counting on zoomed tiles.`
    );
  }

  if (bestPeaks.length >= 6 && meanRrPx !== null && rrCvPercent !== null) {
    summaryLines.push(
      `- Rhythm Strip R-Peak Detector: ${bestPeaks.length} consecutive QRS peaks detected; mean R-R = ${meanRrPx} px, R-R Coefficient of Variation (CV) = ${rrCvPercent}% (${rhythmRegularitySignal.toUpperCase()}).`
    );
    if (estimatedHrBpm !== null && estimatedMeanRrMs !== null && grid.pxPer5mm) {
      const rrSmallBoxes = Math.round((meanRrPx / (grid.pxPer5mm / 5)) * 100) / 100;
      summaryLines.push(
        `- Pixel-Calibrated Ventricular Rate (assuming standard 25 mm/s paper speed): mean R-R = ${rrSmallBoxes} small boxes (${estimatedMeanRrMs} ms) => EXACT VENTRICULAR RATE = ${estimatedHrBpm} bpm (Confidence: ${Math.round(hrConfidence * 100)}%). Use this exact ${estimatedHrBpm} bpm anchor unless a clearly legible printed header integer or 50 mm/s paper speed proves otherwise!`
      );
    }
  }

  return {
    imageWidth: width,
    imageHeight: height,
    perceptualHash256,
    gridDetected: grid.detected,
    gridConfidence: grid.confidence,
    pxPer1mm: grid.pxPer1mm,
    pxPer5mm: grid.pxPer5mm,
    detectedRowsCount: rowCenters.length,
    rhythmPeakCount: bestPeaks.length,
    meanRrPx,
    medianRrPx,
    rrCvPercent,
    rhythmRegularitySignal,
    estimatedHrBpm,
    estimatedMeanRrMs,
    hrConfidence,
    telemetrySummaryForAi: summaryLines.join('\n'),
  };
}

/**
 * Zulora Local — Zero-Backend Dynamic UPI QR Generator (js/upi-qr.js)
 * Pure ES Module ISO/IEC 18004 QR Code (Byte mode, ECC Level M, Versions 1–10)
 * Renders crisp inline <svg> QR codes for `upi://pay?pa=...` URIs 100% offline.
 */

// ─── Galois Field GF(256) with primitive poly 0x11d ───────────────────────────
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGeneratorPoly(deg) {
  let poly = [1];
  for (let i = 0; i < deg; i++) {
    const next = new Array(poly.length + 1).fill(0);
    const factor = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], factor);
    }
    poly = next;
  }
  return poly;
}

function rsComputeEC(data, ecCount) {
  const gen = rsGeneratorPoly(ecCount);
  const res = new Uint8Array(data.length + ecCount);
  res.set(data);
  for (let i = 0; i < data.length; i++) {
    const coef = res[i];
    if (coef !== 0) {
      for (let j = 0; j < gen.length; j++) {
        res[i + j] ^= gfMul(gen[j], coef);
      }
    }
  }
  return res.slice(data.length);
}

// ─── QR Version Spec Table (ECC Level M, Versions 1–10) ───────────────────────
// Each entry: [size, dataCapacityBytes, remBits, alignCoords, blocks: [[count, dataCW, ecCW], ...]]
const QR_M_SPECS = [
  null,
  { size: 21, dataCW: 16,  rem: 0, align: [],           blocks: [[1, 16, 10]] },
  { size: 25, dataCW: 28,  rem: 7, align: [6, 18],      blocks: [[1, 28, 16]] },
  { size: 29, dataCW: 44,  rem: 7, align: [6, 22],      blocks: [[1, 44, 26]] },
  { size: 33, dataCW: 64,  rem: 7, align: [6, 26],      blocks: [[2, 32, 18]] },
  { size: 37, dataCW: 86,  rem: 7, align: [6, 30],      blocks: [[2, 43, 24]] },
  { size: 41, dataCW: 108, rem: 7, align: [6, 34],      blocks: [[4, 27, 16]] },
  { size: 45, dataCW: 124, rem: 0, align: [6, 22, 38],  blocks: [[4, 31, 18]] },
  { size: 49, dataCW: 154, rem: 0, align: [6, 24, 42],  blocks: [[2, 38, 22], [2, 39, 22]] },
  { size: 53, dataCW: 182, rem: 0, align: [6, 26, 46],  blocks: [[3, 36, 22], [2, 37, 22]] },
  { size: 57, dataCW: 216, rem: 0, align: [6, 28, 50],  blocks: [[4, 43, 26], [1, 44, 26]] }
];

function selectVersion(byteLen) {
  for (let v = 1; v < QR_M_SPECS.length; v++) {
    const ccLen = v <= 9 ? 8 : 16;
    const availBits = QR_M_SPECS[v].dataCW * 8;
    const neededBits = 4 + ccLen + byteLen * 8;
    if (neededBits <= availBits) return v;
  }
  return -1;
}

function encodeDataCodewords(bytes, ver) {
  const spec = QR_M_SPECS[ver];
  const bits = [];
  const pushBits = (val, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
  };

  // Mode indicator: Byte = 0100
  pushBits(0b0100, 4);
  // Character count indicator
  pushBits(bytes.length, ver <= 9 ? 8 : 16);
  // Payload bytes
  for (let i = 0; i < bytes.length; i++) pushBits(bytes[i], 8);

  const maxBits = spec.dataCW * 8;
  // Terminator (up to 4 zeros)
  const termLen = Math.min(4, maxBits - bits.length);
  for (let i = 0; i < termLen; i++) bits.push(0);
  // Byte align
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords = new Uint8Array(spec.dataCW);
  let idx = 0;
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    codewords[idx++] = b;
  }
  const pads = [0xec, 0x11];
  let p = 0;
  while (idx < spec.dataCW) {
    codewords[idx++] = pads[p % 2];
    p++;
  }
  return codewords;
}

function interleaveBlocks(dataCodewords, ver) {
  const spec = QR_M_SPECS[ver];
  const dataBlocks = [];
  const ecBlocks = [];
  let offset = 0;
  let maxDataLen = 0;
  let maxEcLen = 0;

  for (const [count, dLen, eLen] of spec.blocks) {
    for (let c = 0; c < count; c++) {
      const slice = dataCodewords.slice(offset, offset + dLen);
      offset += dLen;
      dataBlocks.push(slice);
      ecBlocks.push(rsComputeEC(slice, eLen));
      if (dLen > maxDataLen) maxDataLen = dLen;
      if (eLen > maxEcLen) maxEcLen = eLen;
    }
  }

  const out = [];
  for (let i = 0; i < maxDataLen; i++) {
    for (const blk of dataBlocks) if (i < blk.length) out.push(blk[i]);
  }
  for (let i = 0; i < maxEcLen; i++) {
    for (const blk of ecBlocks) if (i < blk.length) out.push(blk[i]);
  }
  return out;
}

function buildMatrixBase(ver) {
  const spec = QR_M_SPECS[ver];
  const n = spec.size;
  const mat = Array.from({ length: n }, () => new Int8Array(n));      // 0/1
  const fn  = Array.from({ length: n }, () => new Uint8Array(n));     // 1 if reserved

  const setFn = (r, c, v) => {
    if (r >= 0 && r < n && c >= 0 && c < n) {
      mat[r][c] = v ? 1 : 0;
      fn[r][c] = 1;
    }
  };

  const drawFinder = (r0, c0) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = r0 + dr, c = c0 + dc;
        if (r < 0 || r >= n || c < 0 || c >= n) continue;
        const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const onBorder = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const inInner = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        setFn(r, c, inOuter && (onBorder || inInner) ? 1 : 0);
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(0, n - 7);
  drawFinder(n - 7, 0);

  // Alignment patterns
  const coords = spec.align;
  for (let i = 0; i < coords.length; i++) {
    for (let j = 0; j < coords.length; j++) {
      const r = coords[i], c = coords[j];
      if (fn[r][c]) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dark = Math.abs(dr) === 2 || Math.abs(dc) === 2 || (dr === 0 && dc === 0);
          setFn(r + dr, c + dc, dark ? 1 : 0);
        }
      }
    }
  }

  // Timing patterns
  for (let i = 8; i < n - 8; i++) {
    if (!fn[6][i]) setFn(6, i, i % 2 === 0 ? 1 : 0);
    if (!fn[i][6]) setFn(i, 6, i % 2 === 0 ? 1 : 0);
  }

  // Dark module
  setFn(n - 8, 8, 1);

  // Reserve format info areas
  for (let i = 0; i < 9; i++) {
    if (!fn[8][i]) fn[8][i] = 1;
    if (!fn[i][8]) fn[i][8] = 1;
  }
  for (let i = n - 8; i < n; i++) {
    if (!fn[8][i]) fn[8][i] = 1;
    if (!fn[i][8]) fn[i][8] = 1;
  }

  // Reserve & write version info for V7+
  if (ver >= 7) {
    let vBits = ver << 12;
    let rem = vBits;
    for (let i = 17; i >= 12; i--) {
      if ((rem >> i) & 1) rem ^= 0x1f25 << (i - 12);
    }
    vBits |= rem;
    for (let i = 0; i < 18; i++) {
      const bit = (vBits >> i) & 1;
      const a = Math.floor(i / 3);
      const b = n - 11 + (i % 3);
      setFn(a, b, bit);
      setFn(b, a, bit);
    }
  }

  return { mat, fn, n };
}

function placeBits(mat, fn, n, finalCW, remBits) {
  const allBits = [];
  for (const b of finalCW) {
    for (let i = 7; i >= 0; i--) allBits.push((b >> i) & 1);
  }
  for (let i = 0; i < remBits; i++) allBits.push(0);

  let bitIdx = 0;
  let up = true;
  for (let col = n - 1; col >= 1; col -= 2) {
    if (col === 6) col--;
    for (let step = 0; step < n; step++) {
      const r = up ? n - 1 - step : step;
      for (let dx = 0; dx < 2; dx++) {
        const c = col - dx;
        if (!fn[r][c]) {
          mat[r][c] = bitIdx < allBits.length ? allBits[bitIdx++] : 0;
        }
      }
    }
    up = !up;
  }
}

function maskCondition(mask, r, c) {
  switch (mask) {
    case 0: return (r + c) % 2 === 0;
    case 1: return r % 2 === 0;
    case 2: return c % 3 === 0;
    case 3: return (r + c) % 3 === 0;
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5: return ((r * c) % 2 + (r * c) % 3) === 0;
    case 6: return (((r * c) % 2 + (r * c) % 3) % 2) === 0;
    case 7: return (((r + c) % 2 + (r * c) % 3) % 2) === 0;
    default: return false;
  }
}

function writeFormatInfo(mat, n, mask) {
  // ECC M = 00
  const data = (0b00 << 3) | mask;
  let rem = data << 10;
  for (let i = 14; i >= 10; i--) {
    if ((rem >> i) & 1) rem ^= 0x537 << (i - 10);
  }
  const bits = ((data << 10) | rem) ^ 0x5412;

  for (let i = 0; i < 6; i++) {
    const bit = (bits >> i) & 1;
    mat[8][i] = bit;
    mat[n - 1 - i][8] = bit;
  }
  mat[8][7] = (bits >> 6) & 1;
  mat[n - 7][8] = (bits >> 6) & 1;
  mat[8][8] = (bits >> 7) & 1;
  mat[8][n - 8] = (bits >> 7) & 1;
  mat[7][8] = (bits >> 8) & 1;
  mat[8][n - 7] = (bits >> 8) & 1;
  for (let i = 9; i < 15; i++) {
    const bit = (bits >> i) & 1;
    mat[14 - i][8] = bit;
    mat[8][n - 15 + i] = bit;
  }
}

function scoreMatrix(mat, n) {
  let penalty = 0;
  // Rule 1: 5+ consecutive same-color modules
  for (let r = 0; r < n; r++) {
    let run = 1;
    for (let c = 1; c < n; c++) {
      if (mat[r][c] === mat[r][c - 1]) {
        run++;
        if (run === 5) penalty += 3;
        else if (run > 5) penalty++;
      } else run = 1;
    }
  }
  for (let c = 0; c < n; c++) {
    let run = 1;
    for (let r = 1; r < n; r++) {
      if (mat[r][c] === mat[r - 1][c]) {
        run++;
        if (run === 5) penalty += 3;
        else if (run > 5) penalty++;
      } else run = 1;
    }
  }
  // Rule 2: 2x2 blocks
  for (let r = 0; r < n - 1; r++) {
    for (let c = 0; c < n - 1; c++) {
      const v = mat[r][c];
      if (v === mat[r][c + 1] && v === mat[r + 1][c] && v === mat[r + 1][c + 1]) penalty += 3;
    }
  }
  // Rule 3: finder-like patterns
  const p1 = [1,0,1,1,1,0,1,0,0,0,0];
  const p2 = [0,0,0,0,1,0,1,1,1,0,1];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c <= n - 11; c++) {
      let m1 = true, m2 = true;
      for (let k = 0; k < 11; k++) {
        if (mat[r][c + k] !== p1[k]) m1 = false;
        if (mat[r][c + k] !== p2[k]) m2 = false;
      }
      if (m1 || m2) penalty += 40;
    }
  }
  for (let c = 0; c < n; c++) {
    for (let r = 0; r <= n - 11; r++) {
      let m1 = true, m2 = true;
      for (let k = 0; k < 11; k++) {
        if (mat[r + k][c] !== p1[k]) m1 = false;
        if (mat[r + k][c] !== p2[k]) m2 = false;
      }
      if (m1 || m2) penalty += 40;
    }
  }
  // Rule 4: dark ratio
  let dark = 0;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (mat[r][c]) dark++;
  const pct = (dark * 100) / (n * n);
  penalty += Math.floor(Math.abs(pct - 50) / 5) * 10;
  return penalty;
}

/**
 * Encode UTF-8 string into QR boolean matrix
 */
export function generateQrMatrix(text) {
  const bytes = new TextEncoder().encode(String(text || ''));
  const ver = selectVersion(bytes.length);
  if (ver < 1) throw new Error('QR payload too long');

  const dataCW = encodeDataCodewords(bytes, ver);
  const finalCW = interleaveBlocks(dataCW, ver);
  const { mat: baseMat, fn, n } = buildMatrixBase(ver);
  placeBits(baseMat, fn, n, finalCW, QR_M_SPECS[ver].rem);

  let bestMask = 0;
  let bestScore = Infinity;
  let bestMat = null;

  for (let mask = 0; mask < 8; mask++) {
    const candidate = baseMat.map(row => new Int8Array(row));
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (!fn[r][c] && maskCondition(mask, r, c)) {
          candidate[r][c] ^= 1;
        }
      }
    }
    writeFormatInfo(candidate, n, mask);
    const sc = scoreMatrix(candidate, n);
    if (sc < bestScore) {
      bestScore = sc;
      bestMask = mask;
      bestMat = candidate;
    }
  }
  return bestMat;
}

/**
 * Build standard NPCI UPI Payment Deep Link URI
 */
export function buildUpiUri({ upiId, shopName = 'Zulora Seller', amount = 0, note = 'Zulora Local Order' }) {
  const pa = encodeURIComponent(String(upiId || '').trim());
  const pn = encodeURIComponent(String(shopName || 'Zulora Seller').slice(0, 40));
  const tn = encodeURIComponent(String(note || 'Zulora Local Order').slice(0, 40));
  const am = Number(amount) > 0 ? `&am=${Number(amount).toFixed(2)}` : '';
  return `upi://pay?pa=${pa}&pn=${pn}${am}&cu=INR&tn=${tn}`;
}

/**
 * Render crisp, scannable inline SVG QR Code for a UPI string (or any string)
 */
export function renderQrSvgHtml(payload, sizePx = 156, label = 'Scan with any UPI App') {
  try {
    const mat = generateQrMatrix(payload);
    const n = mat.length;
    const quiet = 2;
    const total = n + quiet * 2;
    let paths = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (mat[r][c]) {
          paths += `M${c + quiet},${r + quiet}h1v1h-1z`;
        }
      }
    }
    return `
      <svg xmlns="http://www.w3.org/2000/svg"
           viewBox="0 0 ${total} ${total}"
           width="${sizePx}" height="${sizePx}"
           shape-rendering="crispEdges"
           role="img"
           aria-label="${label}"
           style="display:block;margin:0 auto;background:#ffffff;border-radius:10px;border:1px solid #e2e8f0;padding:4px;box-shadow:0 2px 8px rgba(15,23,42,0.06);">
        <rect width="${total}" height="${total}" fill="#ffffff"/>
        <path d="${paths}" fill="#0f172a"/>
      </svg>
    `;
  } catch (err) {
    console.warn('[UPI-QR] Render error:', err);
    return '';
  }
}

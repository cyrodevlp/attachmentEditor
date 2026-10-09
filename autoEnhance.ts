/* 
   Auto enhance:
   A per-pixel, color-aware pipeline that works in the OKLab perceptual color space.

   analyzeAutoData() studies a small copy of the picture (tones, color cast, how much of each hue is
   present, haze) and returns AutoParams. applyAutoData() then enhances every pixel of an image of
   any size with those parameters and blends the result with the original by `t` (Intensity).

   What happens to each pixel:
   1. Dehaze          optional, only when the picture really is hazy (dark channel prior)
   2. White balance   cast measured on near-neutral pixels (median fallback), shifted in OKLab a/b
   3. Global tone     black / white points and a midtone curve, in either direction
   4. Local tone map  an edge-preserving (guided filter) brightness map lifts what is dark and calms
                      what is blown *around that pixel*, so there are no halos
   5. Detail          clarity (wide) and sharpening (tight): noise-gated, overshoot-limited, midtone
                      weighted, and held back on skin and smooth sky
   6. Color           per-hue-band chroma targets measured on the picture itself, vibrance, extra care
                      for skin / sky / foliage, chroma follows tone changes
   7. Gamut mapping   out-of-range colors are pulled in along chroma (hue and lightness kept)
   Everything is guarded: grayscale pictures stay neutral, and nothing is boosted that is not needed.
 */

export interface AutoParams {
    gray: boolean;
    wbA: number;
    wbB: number;
    bp: number;
    wp: number;
    gamma: number;
    shadow: number;
    highlight: number;
    clarity: number;
    vibrance: number;
    bandGain: number[]; 
    haze: number;       
    hazeA: [number, number, number]; //
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const smoothstep = (e0: number, e1: number, x: number) => {
    const t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
};
const bump = (x: number, a: number, b: number, c: number, d: number) =>
    x <= a || x >= d ? 0 : x < b ? (x - a) / (b - a) : x <= c ? 1 : (d - x) / (d - c);
const TOE = 0.04;
const gammaCurve = (x: number, g: number) => {
    const t0 = Math.pow(TOE, g);
    return (Math.pow(x + TOE, g) - t0) / (Math.pow(1 + TOE, g) - t0);
};
const liftTone = (Lc: number, gain: number) => {
    if (gain <= 1) return Lc * gain;
    const inv = 1 - Lc;
    return (Lc * gain) / (1 + (gain - 1) * Lc) + 0.12 * (gain - 1) * inv * inv * inv;
};

// COLOR CONVERSION
const DEC = new Float32Array(256);
for (let i = 0; i < 256; i++) {
    const c = i / 255;
    DEC[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
const ENC_N = 4096;
const ENC = new Float32Array(ENC_N + 1);
for (let i = 0; i <= ENC_N; i++) {
    const x = i / ENC_N;
    ENC[i] = 255 * (x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);
}
const encode = (x: number) => ENC[(x <= 0 ? 0 : x >= 1 ? ENC_N : x * ENC_N + 0.5) | 0];
let oL = 0;
let oA = 0;
let oB = 0;
let lr = 0;
let lg = 0;
let lb = 0;

function toOK(r: number, g: number, b: number) {
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    oL = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
    oA = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    oB = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
}

function fromOK(L: number, a: number, b: number) {
    const l = L + 0.3963377774 * a + 0.2158037573 * b;
    const m = L - 0.1055613458 * a - 0.0638541728 * b;
    const s = L - 0.0894841775 * a - 1.291485548 * b;
    const l3 = l * l * l;
    const m3 = m * m * m;
    const s3 = s * s * s;
    lr = 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
    lg = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
    lb = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3;
}
const EPS_G = 0.0015;
const inGamut = () => lr >= -EPS_G && lr <= 1 + EPS_G && lg >= -EPS_G && lg <= 1 + EPS_G && lb >= -EPS_G && lb <= 1 + EPS_G;

// FILTERS
function boxBlur(src: Float32Array, w: number, h: number, r: number, passes: number): Float32Array {
    let a = new Float32Array(src);
    if (r < 1) return a;
    let b = new Float32Array(a.length);
    const inv = 1 / (2 * r + 1);
    const axis = (from: Float32Array, to: Float32Array, lines: number, len: number, lineStep: number, step: number) => {
        for (let l = 0; l < lines; l++) {
            const base = l * lineStep;
            let sum = 0;
            for (let k = -r; k <= r; k++) sum += from[base + clamp(k, 0, len - 1) * step];
            to[base] = sum * inv;
            for (let i = 1; i < len; i++) {
                sum += from[base + Math.min(len - 1, i + r) * step] - from[base + Math.max(0, i - r - 1) * step];
                to[base + i * step] = sum * inv;
            }
        }
    };
    for (let p = 0; p < passes; p++) {
        axis(a, b, h, w, w, 1);
        axis(b, a, w, h, 1, w);
    }
    return a;
}

// Square minimum filter (separable)
function minFilter(src: Float32Array, w: number, h: number, r: number): Float32Array {
    const tmp = new Float32Array(src.length);
    const out = new Float32Array(src.length);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let m = 1e9;
            for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) m = Math.min(m, src[y * w + k]);
            tmp[y * w + x] = m;
        }
    }
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let m = 1e9;
            for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) m = Math.min(m, tmp[k * w + x]);
            out[y * w + x] = m;
        }
    }
    return out;
}

// Self-guided filter (He et al.): smooths flat areas, keeps edges
function guidedSelf(I: Float32Array, w: number, h: number, r: number, eps: number): Float32Array {
    const mean = boxBlur(I, w, h, r, 1);
    const sq = new Float32Array(I.length);
    for (let i = 0; i < I.length; i++) sq[i] = I[i] * I[i];
    const meanSq = boxBlur(sq, w, h, r, 1);
    const a = sq; // reuse
    const b = new Float32Array(I.length);
    for (let i = 0; i < I.length; i++) {
        const v = Math.max(0, meanSq[i] - mean[i] * mean[i]);
        const ai = v / (v + eps);
        a[i] = ai;
        b[i] = mean[i] - ai * mean[i];
    }
    const ma = boxBlur(a, w, h, r, 1);
    const mb = boxBlur(b, w, h, r, 1);
    const out = new Float32Array(I.length);
    for (let i = 0; i < I.length; i++) out[i] = ma[i] * I[i] + mb[i];
    return out;
}

function sampleMap(map: Float32Array, sw: number, sh: number, f: number, x: number, y: number) {
    const gx = clamp((x + 0.5) / f - 0.5, 0, sw - 1);
    const gy = clamp((y + 0.5) / f - 0.5, 0, sh - 1);
    const x0 = gx | 0;
    const y0 = gy | 0;
    const x1 = x0 + 1 < sw ? x0 + 1 : x0;
    const y1 = y0 + 1 < sh ? y0 + 1 : y0;
    const fx = gx - x0;
    const fy = gy - y0;
    const top = map[y0 * sw + x0] * (1 - fx) + map[y0 * sw + x1] * fx;
    const bot = map[y1 * sw + x0] * (1 - fx) + map[y1 * sw + x1] * fx;
    return top * (1 - fy) + bot * fy;
}

// ANALYSIS
// target chroma per 30° hue band (band centers 15°, 45°, ... in OKLCh degrees)
const BAND_TARGET = [0.1, 0.085, 0.105, 0.115, 0.11, 0.1, 0.1, 0.11, 0.125, 0.12, 0.11, 0.11];

export function analyzeAutoData(d: Uint8ClampedArray, w: number, h: number): AutoParams {
    const P: AutoParams = {
        gray: false, wbA: 0, wbB: 0, bp: 0, wp: 1, gamma: 1, shadow: 0, highlight: 0, clarity: 0.35, vibrance: 0,
        bandGain: new Array(360).fill(1), haze: 0, hazeA: [1, 1, 1]
    };
    const N = w * h;
    if (N < 64) return P;

    const histL = new Uint32Array(512);
    const histA = new Uint32Array(256);
    const histB = new Uint32Array(256);
    const bandCnt = new Float64Array(12);
    const bandSum = new Float64Array(12);
    const dark = new Float32Array(N);
    let n = 0;
    let nMid = 0;
    let sumC = 0;
    let nNeu = 0;
    let neuA = 0;
    let neuB = 0;
    let nMed = 0;

    for (let p = 0, i = 0; p < N; p++, i += 4) {
        if (d[i + 3] < 8) continue;
        const R = d[i];
        const G = d[i + 1];
        const B = d[i + 2];
        toOK(DEC[R], DEC[G], DEC[B]);
        n++;
        dark[p] = Math.min(R, G, B) / 255;
        histL[Math.min(511, (oL * 512) | 0)]++;
        if (oL < 0.1 || oL > 0.95) continue;
        const C = Math.hypot(oA, oB);
        nMid++;
        sumC += C;
        if (oL >= 0.15 && oL <= 0.9) {
            histA[clamp(((oA + 0.4) / 0.8 * 256) | 0, 0, 255)]++;
            histB[clamp(((oB + 0.4) / 0.8 * 256) | 0, 0, 255)]++;
            nMed++;
            if (C < 0.06 && oL >= 0.2 && oL <= 0.92) {
                nNeu++;
                neuA += oA;
                neuB += oB;
            }
        }
        if (C > 0.03) {
            let deg = Math.atan2(oB, oA) * 57.29578;
            if (deg < 0) deg += 360;
            const pos = (deg - 15) / 30;
            const i0 = Math.floor(pos);
            const fr = pos - i0;
            const b0 = ((i0 % 12) + 12) % 12;
            const b1 = (b0 + 1) % 12;
            bandCnt[b0] += 1 - fr;
            bandCnt[b1] += fr;
            bandSum[b0] += (1 - fr) * C;
            bandSum[b1] += fr * C;
        }
    }
    if (n < 64) return P;

    const pctL = (q: number) => {
        let acc = 0;
        for (let i = 0; i < 512; i++) {
            acc += histL[i];
            if (acc >= n * q) return (i + 0.5) / 512;
        }
        return 1;
    };
    const median = (hist: Uint32Array, total: number) => {
        let acc = 0;
        for (let i = 0; i < 256; i++) {
            acc += hist[i];
            if (acc >= total / 2) return ((i + 0.5) / 256) * 0.8 - 0.4;
        }
        return 0;
    };
    const meanC = nMid ? sumC / nMid : 0;
    P.gray = nMid < n * 0.1 || meanC < 0.015;
    if (!P.gray) {
        let sa: number;
        let sb: number;
        let strength: number;
        let cap: number;
        if (nNeu >= n * 0.04) {
            sa = neuA / nNeu;
            sb = neuB / nNeu;
            strength = 0.8;
            cap = 0.05;
        } else {
            sa = median(histA, nMed);
            sb = median(histB, nMed);
            strength = 0.5;
            cap = 0.03;
        }
        const mag = Math.hypot(sa, sb);
        const k = mag > cap ? cap / mag : 1;
        P.wbA = sa * k * strength;
        P.wbB = sb * k * strength;
    }

    // tone
    const p005 = pctL(0.005);
    const p05 = pctL(0.05);
    const p10 = pctL(0.1);
    const p50 = pctL(0.5);
    const p90 = pctL(0.9);
    const p95 = pctL(0.95);
    const p995 = pctL(0.995);
    P.bp = Math.min(p005, 0.3) * 0.9;
    P.wp = Math.max(p995, 0.8);
    const range = Math.max(0.25, P.wp - P.bp);
    const lv = (x: number) => clamp((x - P.bp) / range, 0, 1);
    const target = 0.55 - 0.15 * clamp((0.5 - p90) / 0.3, 0, 1);
    const med = clamp(lv(p50), 0.05, 0.95);
    P.gamma = clamp(1 + (Math.log(target) / Math.log(med) - 1) * 0.9, 0.6, 1.3);
    const curve = (x: number) => gammaCurve(lv(x), P.gamma);
    P.shadow = clamp((0.32 - curve(p10)) / 0.32, 0, 1) * 0.6;
    P.highlight = clamp((curve(p90) - 0.82) / 0.18, 0, 1) * 0.55;

    // color
    if (!P.gray) {
        const raw = new Array<number>(12).fill(1);
        for (let b = 0; b < 12; b++) {
            const frac = bandCnt[b] / n;
            if (frac < 0.008) continue;
            const mc = bandSum[b] / bandCnt[b];
            const g = clamp(1 + 0.7 * (BAND_TARGET[b] / Math.max(mc, 0.01) - 1), 0.9, 1.4);
            const conf = clamp(frac / 0.04, 0, 1);
            raw[b] = 1 + (g - 1) * conf;
        }
        const sm = raw.map((_, b) => 0.25 * raw[(b + 11) % 12] + 0.5 * raw[b] + 0.25 * raw[(b + 1) % 12]);
        for (let deg = 0; deg < 360; deg++) {
            const pos = (deg - 15) / 30;
            const i0 = Math.floor(pos);
            const fr = pos - i0;
            P.bandGain[deg] = sm[((i0 % 12) + 12) % 12] * (1 - fr) + sm[(((i0 + 1) % 12) + 12) % 12] * fr;
        }
        P.vibrance = clamp((0.07 - meanC) * 4, -0.25, 0.35);
    }

    // haze
    const rr = Math.max(2, Math.round(Math.min(w, h) / 40));
    const dc = minFilter(dark, w, h, rr);
    let dsum = 0;
    const hd = new Uint32Array(256);
    for (let i = 0; i < N; i++) {
        dsum += dc[i];
        hd[Math.min(255, (dc[i] * 255) | 0)]++;
    }
    const meanDark = dsum / N;
    const hazeAmt = clamp((meanDark - 0.22) / 0.3, 0, 1) * clamp((0.7 - (p95 - p05)) / 0.25, 0, 1) * 0.45;
    if (hazeAmt > 0.05) {
        let acc = 0;
        let thr = 255;
        for (let i = 255; i >= 0; i--) {
            acc += hd[i];
            if (acc >= N * 0.005) {
                thr = i;
                break;
            }
        }
        let cnt = 0;
        const A = [0, 0, 0];
        for (let p = 0, i = 0; p < N; p++, i += 4) {
            if (((dc[p] * 255) | 0) < thr) continue;
            A[0] += DEC[d[i]];
            A[1] += DEC[d[i + 1]];
            A[2] += DEC[d[i + 2]];
            cnt++;
        }
        if (cnt) {
            P.haze = hazeAmt;
            P.hazeA = [Math.max(0.2, A[0] / cnt), Math.max(0.2, A[1] / cnt), Math.max(0.2, A[2] / cnt)];
        }
    }
    return P;
}


// APPLY
export function applyAutoData(d: Uint8ClampedArray, w: number, h: number, P: AutoParams, t: number) {
    t = clamp(t, 0, 1);
    if (t === 0 || !w || !h) return;
    const N = w * h;
    const f = Math.max(1, Math.floor(Math.max(w, h) / 1024));
    const sw = Math.ceil(w / f);
    const sh = Math.ceil(h / f);
    const SN = sw * sh;
    const [A0, A1, A2] = P.hazeA;
    let tmap: Float32Array | null = null;
    if (P.haze > 0.02) {
        const ds = new Float32Array(SN);
        const cnt = new Float32Array(SN);
        for (let y = 0; y < h; y++) {
            const row = ((y / f) | 0) * sw;
            for (let x = 0; x < w; x++) {
                const i = (y * w + x) * 4;
                const s = row + ((x / f) | 0);
                ds[s] += Math.min(DEC[d[i]] / A0, DEC[d[i + 1]] / A1, DEC[d[i + 2]] / A2);
                cnt[s]++;
            }
        }
        for (let i = 0; i < SN; i++) ds[i] /= cnt[i] || 1;
        const rr = Math.max(2, Math.round(Math.min(sw, sh) / 40));
        const dark = boxBlur(minFilter(ds, sw, sh, rr), sw, sh, rr, 2);
        tmap = new Float32Array(SN);
        for (let i = 0; i < SN; i++) tmap[i] = clamp(1 - P.haze * Math.min(1, dark[i]), 0.55, 1);
    }
    const L = new Float32Array(N);
    const Ap = new Float32Array(N);
    const Bp = new Float32Array(N);
    const smallL = new Float32Array(SN);
    const smallA = new Float32Array(SN);
    const smallB = new Float32Array(SN);
    const smallW = new Float32Array(SN); 
    const smallN = new Float32Array(SN);
    for (let y = 0; y < h; y++) {
        const row = ((y / f) | 0) * sw;
        for (let x = 0; x < w; x++) {
            const p = y * w + x;
            const i = p * 4;
            let r = DEC[d[i]];
            let g = DEC[d[i + 1]];
            let b = DEC[d[i + 2]];
            if (tmap) {
                const tt = sampleMap(tmap, sw, sh, f, x, y);
                r = Math.max(0, (r - A0) / tt + A0);
                g = Math.max(0, (g - A1) / tt + A1);
                b = Math.max(0, (b - A2) / tt + A2);
            }
            toOK(r, g, b);
            L[p] = oL;
            Ap[p] = oA;
            Bp[p] = oB;
            const s = row + ((x / f) | 0);
            smallL[s] += oL;
            const wd = 1 - smoothstep(0.15, 0.4, oL);
            smallA[s] += oA * wd;
            smallB[s] += oB * wd;
            smallW[s] += wd;
            smallN[s]++;
        }
    }
    for (let i = 0; i < SN; i++) {
        const c = smallN[i] || 1;
        smallL[i] /= c;
        smallW[i] /= c;
        smallA[i] /= c;
        smallB[i] /= c;
    }
    const chromaR = Math.max(2, Math.round(Math.min(sw, sh) / 24));
    const blurW = boxBlur(smallW, sw, sh, chromaR, 2);
    const localA = boxBlur(smallA, sw, sh, chromaR, 2);
    const localB = boxBlur(smallB, sw, sh, chromaR, 2);
    for (let i = 0; i < SN; i++) {
        const den = Math.max(blurW[i], 1e-3);
        localA[i] /= den;
        localB[i] /= den;
    }

    const range = Math.max(0.25, P.wp - P.bp);
    const LUT = new Float32Array(1025);
    for (let i = 0; i <= 1024; i++) LUT[i] = gammaCurve(clamp((i / 1024 - P.bp) / range, 0, 1), P.gamma);
    const curve = (x: number) => LUT[(clamp(x, 0, 1) * 1024 + 0.5) | 0];
    const base = guidedSelf(smallL, sw, sh, Math.max(2, Math.round(Math.min(sw, sh) / 12)), 0.01);
    const gainMap = new Float32Array(SN);
    const baseTone = new Float32Array(SN); // the local base after the same lift the pixels get
    for (let i = 0; i < SN; i++) {
        const c = curve(base[i]);
        const g = clamp(Math.pow(0.55 / Math.max(c, 0.05), c < 0.55 ? P.shadow : P.highlight), 0.6, 2.2);
        gainMap[i] = g;
        baseTone[i] = liftTone(c, g);
    }
    const m = Math.min(w, h);
    const wide = boxBlur(L, w, h, Math.max(2, Math.round(m * 0.02)), 3);
    const tight = boxBlur(L, w, h, Math.max(1, Math.round(m * 0.0035)), 2);
    const sample: number[] = [];
    let edgeSum = 0;
    let edgeN = 0;
    const stride = Math.max(1, Math.floor(Math.sqrt(N / 40000)));
    for (let y = 1; y < h - 1; y += stride) {
        for (let x = 1; x < w - 1; x += stride) {
            const p = y * w + x;
            const v = Math.abs(4 * L[p] - L[p - 1] - L[p + 1] - L[p - w] - L[p + w]);
            sample.push(v);
            edgeSum += v;
            edgeN++;
        }
    }
    sample.sort((a, b) => a - b);
    const sigma = sample.length ? (1.4826 * sample[sample.length >> 1]) / Math.sqrt(20) : 0;
    const edge = edgeN ? edgeSum / edgeN : 0;
    const floorN = clamp(sigma * 2, 0.0015, 0.03);
    const sharpen = clamp(0.45 + (0.035 - edge) * 10, 0.3, 1) * 0.8;
    const clarity = P.clarity;
    const wbA = P.wbA;
    const wbB = P.wbB;
    const vib = P.vibrance;
    const gray = P.gray;

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const p = y * w + x;
            const i = p * 4;
            const L0 = L[p];
            const wf = smoothstep(0.02, 0.25, L0);
            let a = Ap[p] - wbA * wf;
            let b = Bp[p] - wbB * wf;
            const Lc = curve(L0);
            const gain = sampleMap(gainMap, sw, sh, f, x, y);
            let Lt = liftTone(Lc, gain);
            const lift = clamp((gain - 1) / 0.3, 0, 1);
            if (lift > 0) {
                const crushed = (1 - smoothstep(0.04, 0.14, L0)) * lift * 0.9;
                if (crushed > 0) {
                    const lbt = sampleMap(baseTone, sw, sh, f, x, y);
                    if (lbt > Lt) Lt += (lbt - Lt) * crushed;
                    a += (sampleMap(localA, sw, sh, f, x, y) - a) * crushed;
                    b += (sampleMap(localB, sw, sh, f, x, y) - b) * crushed;
                }
            }
            let C = Math.hypot(a, b);
            let deg = 0;
            let skin = 0;
            let sky = 0;
            let foliage = 0;
            const dW = L0 - wide[p];
            const dT = L0 - tight[p];
            if (!gray && C > 0.02) {
                deg = Math.atan2(b, a) * 57.29578;
                if (deg < 0) deg += 360;
                skin = bump(deg, 20, 35, 75, 90) * bump(C, 0.025, 0.05, 0.15, 0.2) * bump(Lt, 0.2, 0.35, 0.9, 0.97);
                sky = bump(deg, 205, 225, 285, 300) * bump(C, 0.025, 0.05, 0.25, 0.3) * bump(Lt, 0.4, 0.55, 1, 1.01) *
                    (1 - clamp((Math.abs(dW) - 0.015) / 0.03, 0, 1));
                foliage = bump(deg, 100, 115, 165, 180) * bump(C, 0.03, 0.06, 0.25, 0.3);
            }
            const wm = 0.2 + 0.8 * 4 * Lt * (1 - Lt);
            const mask = Math.max(0.15, 1 - 0.5 * skin - 0.85 * sky + 0.2 * foliage);
            const dwc = dW / (1 + (dW * dW) / 0.0144);
            const am = Math.abs(dT) - floorN;
            const ds = am > 0 ? (dT > 0 ? am : -am) : 0;
            const dsc = ds / (1 + (ds * ds) / 0.01);
            const dark = smoothstep(0.07, 0.22, L0);
            Lt = clamp(Lt + mask * dark * (clarity * wm * dwc + sharpen * dsc), 0, 1);

            // color
            if (!gray && C > 1e-4) {
                const ratio = Lt / Math.max(L0, 0.04);
                const g = ratio > 1 ? Math.min(2.2, Math.pow(ratio, 0.8)) : Math.pow(Math.max(ratio, 0.4), 0.25);
                const hueGain = P.bandGain[(deg | 0) % 360] || 1;
                let v = 1;
                if (vib > 0) v = 1 + vib * Math.pow(1 - clamp(C / 0.25, 0, 1), 1.5);
                else if (vib < 0) v = 1 + vib * clamp(C / 0.25, 0, 1);
                let cg = hueGain * v;
                cg = cg + (Math.min(cg, 1.05) - cg) * skin; // skin keeps its natural saturation
                cg *= 1 + 0.12 * sky + 0.06 * foliage;
                const roll = smoothstep(0.03, 0.2, Lt) * (1 - smoothstep(0.9, 1, Lt));
                cg = 1 + (cg - 1) * roll;
                const k = g * cg;
                a *= k;
                b *= k;
                C *= k;
            }
            fromOK(Lt, a, b);
            if (!inGamut()) {
                let lo = 0;
                let hi = 1;
                for (let it = 0; it < 8; it++) {
                    const mid = (lo + hi) / 2;
                    fromOK(Lt, a * mid, b * mid);
                    if (inGamut()) lo = mid; else hi = mid;
                }
                fromOK(Lt, a * lo, b * lo);
            }
            const o0 = d[i];
            const o1 = d[i + 1];
            const o2 = d[i + 2];
            let hh = Math.imul(p + 0x9e3779b9, 0x85ebca6b);
            hh ^= hh >>> 13;
            hh = Math.imul(hh, 0xc2b2ae35);
            hh ^= hh >>> 16;
            const dn = (((hh & 0xffff) + ((hh >>> 16) & 0xffff)) / 65536 - 1) * 0.6 * t;
            d[i] = o0 + (encode(lr) - o0) * t + dn;
            d[i + 1] = o1 + (encode(lg) - o1) * t + dn;
            d[i + 2] = o2 + (encode(lb) - o2) * t + dn;
        }
    }
}

// CANVAS WRAPPERS
export function analyzeAuto(canvas: HTMLCanvasElement): AutoParams {
    const { width: w, height: h } = canvas;
    const data = canvas.getContext("2d")!.getImageData(0, 0, w, h).data;
    return analyzeAutoData(data, w, h);
}

export function applyAuto(canvas: HTMLCanvasElement, P: AutoParams, t: number) {
    const { width: w, height: h } = canvas;
    if (!w || !h || t <= 0) return;
    const ctx = canvas.getContext("2d")!;
    const image = ctx.getImageData(0, 0, w, h);
    applyAutoData(image.data, w, h, P, t);
    ctx.putImageData(image, 0, 0);
}
/*
  Vencord, a Discord client mod
  Copyright (c) 2026 Vendicated and contributors
  SPDX-License-Identifier: GPL-3.0-or-later
 */

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);
const smoothstep = (e0: number, e1: number, x: number) => {
    const t = clamp01((x - e0) / (e1 - e0));
    return t * t * (3 - 2 * t);
};

function box(src: Float32Array, w: number, h: number, r: number): Float32Array {
    const tmp = new Float32Array(src.length);
    const out = new Float32Array(src.length);
    const inv = 1 / (2 * r + 1);
    for (let y = 0; y < h; y++) {
        const o = y * w;
        let sum = 0;
        for (let k = -r; k <= r; k++) sum += src[o + Math.min(w - 1, Math.max(0, k))];
        tmp[o] = sum * inv;
        for (let x = 1; x < w; x++) {
            sum += src[o + Math.min(w - 1, x + r)] - src[o + Math.max(0, x - r - 1)];
            tmp[o + x] = sum * inv;
        }
    }
    for (let x = 0; x < w; x++) {
        let sum = 0;
        for (let k = -r; k <= r; k++) sum += tmp[Math.min(h - 1, Math.max(0, k)) * w + x];
        out[x] = sum * inv;
        for (let y = 1; y < h; y++) {
            sum += tmp[Math.min(h - 1, y + r) * w + x] - tmp[Math.max(0, y - r - 1) * w + x];
            out[y * w + x] = sum * inv;
        }
    }
    return out;
}
function guided(I: Float32Array, p: Float32Array, w: number, h: number, r: number, eps: number): Float32Array {
    const N = I.length;
    const II = new Float32Array(N);
    const Ip = new Float32Array(N);
    for (let i = 0; i < N; i++) {
        II[i] = I[i] * I[i];
        Ip[i] = I[i] * p[i];
    }
    const mI = box(I, w, h, r);
    const mP = box(p, w, h, r);
    const mII = box(II, w, h, r);
    const mIp = box(Ip, w, h, r);
    const a = II; 
    const b = Ip;
    for (let i = 0; i < N; i++) {
        const v = Math.max(0, mII[i] - mI[i] * mI[i]);
        const cov = mIp[i] - mI[i] * mP[i];
        const ai = cov / (v + eps);
        a[i] = ai;
        b[i] = mP[i] - ai * mI[i];
    }
    const ma = box(a, w, h, r);
    const mb = box(b, w, h, r);
    const out = new Float32Array(N);
    for (let i = 0; i < N; i++) out[i] = clamp01(ma[i] * I[i] + mb[i]);
    return out;
}

function label(on: Uint8Array, w: number, h: number, m = 1) {
    const id = new Int32Array(on.length).fill(-1);
    const sizes: number[] = [];
    const border: boolean[] = [];
    const stack = new Int32Array(on.length);
    for (let s = 0; s < on.length; s++) {
        if (!on[s] || id[s] !== -1) continue;
        const c = sizes.length;
        let n = 0;
        let touches = false;
        let sp = 0;
        stack[sp++] = s;
        id[s] = c;
        while (sp) {
            const p = stack[--sp];
            n++;
            const x = p % w;
            const y = (p - x) / w;
            if (x < m || y < m || x >= w - m || y >= h - m) touches = true;
            if (x > 0 && on[p - 1] && id[p - 1] === -1) { id[p - 1] = c; stack[sp++] = p - 1; }
            if (x < w - 1 && on[p + 1] && id[p + 1] === -1) { id[p + 1] = c; stack[sp++] = p + 1; }
            if (y > 0 && on[p - w] && id[p - w] === -1) { id[p - w] = c; stack[sp++] = p - w; }
            if (y < h - 1 && on[p + w] && id[p + w] === -1) { id[p + w] = c; stack[sp++] = p + w; }
        }
        sizes.push(n);
        border.push(touches);
    }
    return { id, sizes, border };
}
function morph(src: Uint8Array, w: number, h: number, r: number, grow: boolean): Uint8Array {
    const hit = grow ? 1 : 0;
    const tmp = new Uint8Array(src.length);
    const out = new Uint8Array(src.length);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let v = grow ? 0 : 1;
            for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) {
                if (src[y * w + k] === hit) { v = hit; break; }
            }
            tmp[y * w + x] = v;
        }
    }
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let v = grow ? 0 : 1;
            for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) {
                if (tmp[k * w + x] === hit) { v = hit; break; }
            }
            out[y * w + x] = v;
        }
    }
    return out;
}
function flatBand(rgba: Uint8ClampedArray, w: number, h: number, off: number): [number, number, number] | null {
    const ring: number[] = [];
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const d = Math.min(x, y, w - 1 - x, h - 1 - y);
            if (d >= off && d < off + 2) ring.push((y * w + x) * 4);
        }
    }
    if (ring.length < 16) return null;
    const med = (c: number) => {
        const v = ring.map(i => rgba[i + c]).sort((a, b) => a - b);
        return v[v.length >> 1];
    };
    const m: [number, number, number] = [med(0), med(1), med(2)];
    let near = 0;
    for (const i of ring) { if (Math.abs(rgba[i] - m[0]) <= 14 && Math.abs(rgba[i + 1] - m[1]) <= 14 && Math.abs(rgba[i + 2] - m[2]) <= 14) near++; }
    return near >= ring.length * 0.85 ? m : null;
}

function flatBackground(rgba: Uint8ClampedArray, w: number, h: number): { color: [number, number, number]; frame: number; edge: [number, number, number] } | null {
    const c0 = flatBand(rgba, w, h, 0);
    if (!c0) return null;
    const far = (i: number) => Math.max(Math.abs(rgba[i] - c0[0]), Math.abs(rgba[i + 1] - c0[1]), Math.abs(rgba[i + 2] - c0[2])) > 40;
    const cap = Math.max(2, Math.round(Math.min(w, h) * 0.04));
    const walks = [
        (k: number) => (Math.floor(h / 2) * w + k) * 4,
        (k: number) => (Math.floor(h / 2) * w + (w - 1 - k)) * 4,
        (k: number) => (k * w + Math.floor(w / 2)) * 4,
        (k: number) => ((h - 1 - k) * w + Math.floor(w / 2)) * 4
    ].map(at => { let k = 0; while (k < cap && !far(at(k))) k++; return k; }).sort((a, b) => a - b);
    const f = (walks[1] + walks[2]) >> 1;
    if (f <= 2 || f >= cap) return { color: c0, frame: 0, edge: c0 };
    const inner = flatBand(rgba, w, h, f + 1);
    return inner && Math.max(Math.abs(inner[0] - c0[0]), Math.abs(inner[1] - c0[1]), Math.abs(inner[2] - c0[2])) > 40
        ? { color: inner, frame: f + 1, edge: c0 }
        : { color: c0, frame: 0, edge: c0 };
}
function outsideOf(rgba: Uint8ClampedArray, w: number, h: number, bg: [number, number, number] | null, tol: number): Uint8Array {
    const N = w * h;
    const ok = new Uint8Array(N);
    for (let p = 0, i = 0; p < N; p++, i += 4) {
        if (rgba[i + 3] < 128) { ok[p] = 1; continue; }
        if (bg && Math.max(Math.abs(rgba[i] - bg[0]), Math.abs(rgba[i + 1] - bg[1]), Math.abs(rgba[i + 2] - bg[2])) <= tol) ok[p] = 1;
    }
    const out = new Uint8Array(N);
    const stack = new Int32Array(N);
    let sp = 0;
    const push = (p: number) => { if (ok[p] && !out[p]) { out[p] = 1; stack[sp++] = p; } };
    for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
    while (sp) {
        const p = stack[--sp];
        const x = p % w;
        if (x > 0) push(p - 1);
        if (x < w - 1) push(p + 1);
        if (p >= w) push(p - w);
        if (p < N - w) push(p + w);
    }
    return out;
}
function near(on: Uint8Array, w: number, h: number, r: number): Uint8Array {
    const f = new Float32Array(on.length);
    for (let i = 0; i < on.length; i++) f[i] = on[i];
    const b = box(f, w, h, r);
    const out = new Uint8Array(on.length);
    for (let i = 0; i < on.length; i++) out[i] = b[i] > 1e-4 ? 1 : 0;
    return out;
}

export function refineAlpha(rgba: Uint8ClampedArray, alpha: Float32Array, w: number, h: number): Float32Array {
    const N = w * h;
    const luma = new Float32Array(N);
    for (let p = 0, i = 0; p < N; p++, i += 4) luma[p] = (0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2]) / 255;
    const a = new Float32Array(alpha);
    const fb = flatBackground(rgba, w, h);
    const bgc = fb ? fb.color : null;
    const fm = fb ? Math.max(1, fb.frame) : 1; 
    if (bgc) {
        const like = new Uint8Array(N); 
        const pale = new Uint8Array(N);
        for (let p = 0, i = 0; p < N; p++, i += 4) {
            const d = Math.max(Math.abs(rgba[i] - bgc[0]), Math.abs(rgba[i + 1] - bgc[1]), Math.abs(rgba[i + 2] - bgc[2]));
            like[p] = d <= 12 ? 1 : 0;
            pale[p] = d <= 40 ? 1 : 0;
        }
        const rc = Math.max(1, Math.round(Math.min(w, h) * 0.006));
        const closed = morph(morph(like, w, h, rc, true), w, h, rc, false);
        for (let p = 0; p < N; p++) if (like[p]) closed[p] = 1;
        const L = label(closed, w, h, fm);
        const kept = new Float64Array(L.sizes.length);
        for (let p = 0; p < N; p++) if (closed[p] && a[p] > 0.5) kept[L.id[p]]++;
        for (let p = 0; p < N; p++) {
            if (!closed[p] || !pale[p]) continue;
            const c = L.id[p];
            if (L.border[c] || L.sizes[c] < N * 0.0005) continue;
            a[p] = kept[c] / L.sizes[c] >= 0.8 && L.sizes[c] < N * 0.03 ? 1 : 0;
        }
        const key = new Uint8Array(N);
        for (let p = 0, i = 0; p < N; p++, i += 4) {
            const d = Math.max(Math.abs(rgba[i] - bgc[0]), Math.abs(rgba[i + 1] - bgc[1]), Math.abs(rgba[i + 2] - bgc[2]));
            key[p] = d > 70 && rgba[i + 3] >= 128 ? 1 : 0;
        }
        const K = label(key, w, h, fm);
        const conf = new Uint8Array(N);
        for (let p = 0; p < N; p++) conf[p] = a[p] > 0.5 ? 1 : 0;
        const keptK = new Float64Array(K.sizes.length);
        for (let p = 0; p < N; p++) if (key[p] && conf[p]) keptK[K.id[p]]++;
        const whole = new Uint8Array(K.sizes.length);
        for (let c = 0; c < K.sizes.length; c++) whole[c] = !K.border[c] && keptK[c] / K.sizes[c] >= 0.1 ? 1 : 0;
        for (let p = 0; p < N; p++) if (key[p] && whole[K.id[p]]) a[p] = 1;
        for (let p = 0; p < N; p++) conf[p] = a[p] > 0.5 ? 1 : 0;
        const nearSubject = near(conf, w, h, Math.max(3, Math.round(Math.min(w, h) * 0.04)));
        const touch = new Uint8Array(K.sizes.length);
        for (let p = 0; p < N; p++) if (key[p] && nearSubject[p]) touch[K.id[p]] = 1;
        for (let p = 0; p < N; p++) {
            if (!key[p]) continue;
            const c = K.id[p];
            if (!K.border[c] && touch[c] && K.sizes[c] < N * 0.01) a[p] = 1;
        }
        let confN = 0;
        let confKey = 0;
        for (let p = 0; p < N; p++) if (conf[p]) { confN++; confKey += key[p]; }
        if (confN && confKey >= confN * 0.5) {
            for (let p = 0; p < N; p++) if (like[p] && L.border[L.id[p]]) a[p] = 0;
        }
    }
    const outside = outsideOf(rgba, w, h, fb ? fb.edge : null, 40);
    let outN = 0;
    for (let p = 0; p < N; p++) outN += outside[p];
    let clear = 0;
    for (let p = 0, i = 3; p < N; p++, i += 4) if (rgba[i] < 128) clear++;
    if (outN < N * 0.15 && clear > N * 0.002) {
        let inN = 0;
        let keptN = 0;
        for (let p = 0; p < N; p++) if (!outside[p]) { inN++; if (a[p] > 0.5) keptN++; }
        if (inN > N * 0.5 && keptN < inN * 0.6) for (let p = 0; p < N; p++) if (!outside[p]) a[p] = 1;
    }
    for (let p = 0, i = 3; p < N; p++, i += 4) if (rgba[i] < 128) a[p] = 0;
    const fg = new Uint8Array(N);
    for (let i = 0; i < N; i++) fg[i] = a[i] > 0.1 ? 1 : 0;
    const f = label(fg, w, h);
    const biggest = f.sizes.length ? Math.max(...f.sizes) : 0;
    const minKeep = Math.max(biggest * 0.04, N * 0.0003);
    const core = new Uint8Array(N);
    for (let i = 0; i < N; i++) if (fg[i] && f.sizes[f.id[i]] >= minKeep) core[i] = 1;
    const close = near(core, w, h, Math.max(3, Math.round(Math.min(w, h) * 0.04)));
    const sum = new Float64Array(f.sizes.length);
    for (let i = 0; i < N; i++) if (fg[i]) sum[f.id[i]] += a[i];
    for (let i = 0; i < N; i++) {
        if (!fg[i]) continue;
        const c = f.id[i];
        if (f.sizes[c] >= minKeep || close[i] || sum[c] / f.sizes[c] >= 0.6) continue;
        a[i] = 0;
    }
    const bgm = new Uint8Array(N);
    for (let i = 0; i < N; i++) bgm[i] = a[i] < 0.5 ? 1 : 0;
    const b = label(bgm, w, h);
    const maxHole = N * 0.002;
    for (let i = 0; i < N; i++) {
        if (bgm[i] && !b.border[b.id[i]] && b.sizes[b.id[i]] < maxHole) a[i] = 1;
    }
    const r = Math.max(2, Math.round(Math.min(w, h) * 0.005));
    const g = guided(luma, a, w, h, r, 2e-3);
    for (let i = 0, j = 3; i < N; i++, j += 4) g[i] = rgba[j] < 128 ? 0 : smoothstep(0.22, 0.78, g[i]);
    return g;
}
export function extendColors(data: Uint8ClampedArray, w: number, h: number, reach: number) {
    const N = w * h;
    const known = new Uint8Array(N);
    for (let p = 0; p < N; p++) known[p] = data[p * 4 + 3] >= 250 ? 1 : 0;
    const done = new Uint8Array(known);
    for (let it = 0; it < reach; it++) {
        const grown: number[] = [];
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const p = y * w + x;
                if (done[p]) continue;
                let r = 0;
                let g = 0;
                let b = 0;
                let n = 0;
                for (let dy = -1; dy <= 1; dy++) {
                    const yy = y + dy;
                    if (yy < 0 || yy >= h) continue;
                    for (let dx = -1; dx <= 1; dx++) {
                        const xx = x + dx;
                        if (xx < 0 || xx >= w) continue;
                        const q = yy * w + xx;
                        if (!done[q] || (known[q] === 0 && it === 0)) continue;
                        r += data[q * 4];
                        g += data[q * 4 + 1];
                        b += data[q * 4 + 2];
                        n++;
                    }
                }
                if (n) grown.push(p, Math.round(r / n), Math.round(g / n), Math.round(b / n));
            }
        }
        if (!grown.length) break;
        for (let k = 0; k < grown.length; k += 4) {
            const p = grown[k];
            data[p * 4] = grown[k + 1];
            data[p * 4 + 1] = grown[k + 2];
            data[p * 4 + 2] = grown[k + 3];
            done[p] = 1;
        }
    }
}

// CANVAS WRAPPER
const WORK_MAX = 2048;
export function refineCutout(original: HTMLCanvasElement, cut: HTMLCanvasElement): HTMLCanvasElement {
    const W = original.width;
    const H = original.height;
    const k = Math.min(1, WORK_MAX / Math.max(W, H));
    const w = Math.max(1, Math.round(W * k));
    const h = Math.max(1, Math.round(H * k));

    const scaled = (src: HTMLCanvasElement) => {
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const ctx = c.getContext("2d", { willReadFrequently: true })!;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(src, 0, 0, w, h);
        return ctx.getImageData(0, 0, w, h).data;
    };
    const px = scaled(original);
    const cp = scaled(cut);
    const alpha = new Float32Array(w * h);
    for (let p = 0, i = 3; p < w * h; p++, i += 4) alpha[p] = cp[i] / 255;
    const fine = refineAlpha(px, alpha, w, h);
    const mask = document.createElement("canvas");
    mask.width = w;
    mask.height = h;
    const mctx = mask.getContext("2d")!;
    const md = mctx.createImageData(w, h);
    for (let p = 0, i = 0; p < w * h; p++, i += 4) md.data[i + 3] = Math.round(fine[p] * 255);
    mctx.putImageData(md, 0, 0);
    const out = document.createElement("canvas");
    out.width = W;
    out.height = H;
    const ctx = out.getContext("2d")!;
    ctx.drawImage(original, 0, 0);
    ctx.globalCompositeOperation = "destination-in";
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(mask, 0, 0, W, H);
    const img = ctx.getImageData(0, 0, W, H);
    extendColors(img.data, W, H, Math.max(3, Math.round(Math.min(W, H) * 0.004)));
    ctx.putImageData(img, 0, 0);
    return out;
}

/*
   Image Operations:
   A file that is responsible for image manipulation and processing, 
   including cropping, resizing, rotating, and applying filters. 
   It provides a set of functions that can be used to perform various operations on images, 
   such as adjusting brightness, contrast, saturation, and more. 

   The functions are designed to work with HTMLCanvasElement and 
   ImageData objects, allowing for efficient image processing in the browser.
 */

export type RatioKey = "free" | "original" | "1:1" | "3:2" | "2:3" | "4:3" | "3:4" | "16:9" | "9:16";

export const RATIOS: { key: RatioKey; label: string; }[] = [
    { key: "free", label: "Free" },
    { key: "original", label: "Original" },
    { key: "1:1", label: "1:1" },
    { key: "3:2", label: "3:2" },
    { key: "2:3", label: "2:3" },
    { key: "4:3", label: "4:3" },
    { key: "3:4", label: "3:4" },
    { key: "16:9", label: "16:9" },
    { key: "9:16", label: "9:16" }
];

export const MAX_ZOOM = 10;
export interface EditState {
    quarterTurns: number; 
    angle: number;        
    flipH: boolean;
    flipV: boolean;
    ratio: RatioKey;
    zoom: number;        
    panX: number;        
    panY: number;
    outW: number;         
    outH: number;
}

export const INITIAL_STATE: EditState = {
    quarterTurns: 0,
    angle: 0,
    flipH: false,
    flipV: false,
    ratio: "original",
    zoom: 1,
    panX: 0,
    panY: 0,
    outW: 1,
    outH: 1
};

export function loadImage(file: File): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not load image")); };
        img.src = url;
    });
}

export function makeBase(img: HTMLImageElement, quarterTurns: number, flipH: boolean, flipV: boolean) {
    const odd = quarterTurns % 2 !== 0;
    const ow = odd ? img.naturalHeight : img.naturalWidth;
    const oh = odd ? img.naturalWidth : img.naturalHeight;
    const c = document.createElement("canvas");
    c.width = ow;
    c.height = oh;
    const ctx = c.getContext("2d")!;
    ctx.translate(ow / 2, oh / 2);
    ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
    ctx.rotate((quarterTurns * Math.PI) / 2);
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    return c;
}

export function aspectOf(st: EditState, ow: number, oh: number): number {
    if (st.ratio === "free") return st.outW / st.outH;
    if (st.ratio === "original") return ow / oh;
    const [a, b] = st.ratio.split(":").map(Number);
    return a / b;
}

export function coverSize(ow: number, oh: number, aspect: number) {
    return ow / oh > aspect
        ? { cw: oh * aspect, ch: oh }
        : { cw: ow, ch: ow / aspect };
}

export function minZoomFor(ow: number, oh: number, aspect: number, angleDeg: number) {
    const { cw, ch } = coverSize(ow, oh, aspect);
    const t = (angleDeg * Math.PI) / 180;
    const c = Math.abs(Math.cos(t));
    const s = Math.abs(Math.sin(t));
    return Math.max(1, (cw * c + ch * s) / ow, (cw * s + ch * c) / oh);
}

export function clampPan(px: number, py: number, W: number, H: number, angleDeg: number, ow: number, oh: number) {
    const t = (angleDeg * Math.PI) / 180;
    const cos = Math.cos(t);
    const sin = Math.sin(t);
    const ac = Math.abs(cos);
    const as = Math.abs(sin);
    const mx = Math.max(0, ow / 2 - (W / 2) * ac - (H / 2) * as);
    const my = Math.max(0, oh / 2 - (W / 2) * as - (H / 2) * ac);
    let x = px * cos + py * sin;
    let y = -px * sin + py * cos;
    x = Math.min(mx, Math.max(-mx, x));
    y = Math.min(my, Math.max(-my, y));
    return { x: x * cos - y * sin, y: x * sin + y * cos };
}

export function normalize(ow: number, oh: number, s: EditState): EditState {
    const aspect = aspectOf(s, ow, oh);
    const minZ = minZoomFor(ow, oh, aspect, s.angle);
    const zoom = Math.min(Math.max(MAX_ZOOM, minZ), Math.max(minZ, s.zoom));
    const { cw, ch } = coverSize(ow, oh, aspect);
    const { x, y } = clampPan(s.panX, s.panY, cw / zoom, ch / zoom, s.angle, ow, oh);
    return { ...s, zoom, panX: x, panY: y };
}

export function deriveView(ow: number, oh: number, st: EditState) {
    const aspect = aspectOf(st, ow, oh);
    const { cw, ch } = coverSize(ow, oh, aspect);
    return {
        aspect,
        W: cw / st.zoom,
        H: ch / st.zoom,
        px: st.panX,
        py: st.panY,
        theta: (st.angle * Math.PI) / 180
    };
}

type View = ReturnType<typeof deriveView>;
export interface StageLayout {
    k: number;
    cx: number; 
    cy: number;
    fx: number; 
    fy: number;
    fw: number;
    fh: number;
}

export type Handle = "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";
const STAGE_MARGIN = 36;

export interface StageLock {
    k: number;
    cx: number;
    cy: number;
}

export function fitLock(v: View, w: number, h: number): StageLock {
    const k = Math.min((w - STAGE_MARGIN * 2) / v.W, (h - STAGE_MARGIN * 2) / v.H);
    return { k, cx: w / 2 - v.px * k, cy: h / 2 - v.py * k };
}

export function getStageLayout(v: View, w: number, h: number, lock?: StageLock): StageLayout {
    const { k, cx, cy } = lock ?? fitLock(v, w, h);
    const fw = v.W * k;
    const fh = v.H * k;
    return { k, cx, cy, fx: cx + v.px * k - fw / 2, fy: cy + v.py * k - fh / 2, fw, fh };
}

export function drawBackdrop(ctx: CanvasRenderingContext2D, base: HTMLCanvasElement, v: View, w: number, h: number, lock?: StageLock, src?: HTMLCanvasElement): StageLayout {
    ctx.clearRect(0, 0, w, h);
    const L = getStageLayout(v, w, h, lock);
    const { k, cx, cy, fx, fy, fw, fh } = L;
    ctx.save();
    ctx.imageSmoothingQuality = "high";
    ctx.translate(cx, cy);
    ctx.scale(k, k);
    ctx.rotate(v.theta);
    ctx.drawImage(src ?? base, -base.width / 2, -base.height / 2, base.width, base.height);
    ctx.restore();
    ctx.save();
    ctx.fillStyle = "rgba(0, 0, 0, 0.62)";
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.rect(fx, fy, fw, fh);
    ctx.fill("evenodd");
    ctx.restore();

    return L;
}

export function drawStage(ctx: CanvasRenderingContext2D, base: HTMLCanvasElement, v: View, w: number, h: number, lock?: StageLock, src?: HTMLCanvasElement, overlay?: (ctx: CanvasRenderingContext2D, L: StageLayout) => void): StageLayout {
    const L = drawBackdrop(ctx, base, v, w, h, lock, src);
    const { fx, fy, fw, fh } = L;

    if (overlay) {
        ctx.save();
        overlay(ctx, L);
        ctx.restore();
    }
    ctx.save();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.28)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < 3; i++) {
        ctx.moveTo(fx + (fw * i) / 3, fy);
        ctx.lineTo(fx + (fw * i) / 3, fy + fh);
        ctx.moveTo(fx, fy + (fh * i) / 3);
        ctx.lineTo(fx + fw, fy + (fh * i) / 3);
    }
    ctx.stroke();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.strokeRect(fx, fy, fw, fh);
    ctx.restore();
    ctx.save();
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
    ctx.shadowBlur = 3;
    const mx = fx + fw / 2;
    const my = fy + fh / 2;
    const r = fx + fw;
    const b = fy + fh;
    for (const [x, y] of [[fx, fy], [r, fy], [fx, b], [r, b]]) ctx.fillRect(x - 5, y - 5, 10, 10);
    for (const [x, y] of [[mx, fy], [mx, b]]) ctx.fillRect(x - 10, y - 3, 20, 6);
    for (const [x, y] of [[fx, my], [r, my]]) ctx.fillRect(x - 3, y - 10, 6, 20);
    ctx.restore();

    return L;
}

export function hitTest(l: StageLayout, x: number, y: number): Handle | "move" | null {
    const T = 10;
    const { fx, fy, fw, fh } = l;
    const r = fx + fw;
    const b = fy + fh;
    const nl = Math.abs(x - fx) <= T;
    const nr = Math.abs(x - r) <= T;
    const nt = Math.abs(y - fy) <= T;
    const nb = Math.abs(y - b) <= T;
    const inX = x >= fx - T && x <= r + T;
    const inY = y >= fy - T && y <= b + T;
    if (nt && nl) return "nw";
    if (nt && nr) return "ne";
    if (nb && nl) return "sw";
    if (nb && nr) return "se";
    if (nt && inX) return "n";
    if (nb && inX) return "s";
    if (nl && inY) return "w";
    if (nr && inY) return "e";
    if (x > fx && x < r && y > fy && y < b) return "move";
    return null;
}

const MIN_CROP = 8;
const clampOut = (n: number) => Math.min(8000, Math.max(1, n));

export function withRelativeSize(ow: number, oh: number, prev: EditState, next: EditState): EditState {
    const a = deriveView(ow, oh, prev);
    const b = deriveView(ow, oh, next);
    return {
        ...next,
        outW: clampOut(prev.outW * (b.W / a.W)),
        outH: clampOut(prev.outH * (b.H / a.H))
    };
}

export function resizeCrop(ow: number, oh: number, start: EditState, handle: Handle, dx: number, dy: number): EditState {
    const free = start.ratio === "free";
    const aspect0 = aspectOf(start, ow, oh);
    const { cw, ch } = coverSize(ow, oh, aspect0);
    const W0 = cw / start.zoom;
    const H0 = ch / start.zoom;
    const L = start.panX - W0 / 2;
    const R = start.panX + W0 / 2;
    const T = start.panY - H0 / 2;
    const B = start.panY + H0 / 2;
    const sx = handle.includes("e") ? 1 : handle.includes("w") ? -1 : 0;
    const sy = handle.includes("s") ? 1 : handle.includes("n") ? -1 : 0;
    const th = (start.angle * Math.PI) / 180;
    const cos = Math.cos(th);
    const sin = Math.sin(th);
    const windowFor = (t: number) => {
        let nW: number;
        let nH: number;
        if (free) {
            nW = Math.max(MIN_CROP, W0 + sx * dx * t);
            nH = Math.max(MIN_CROP, H0 + sy * dy * t);
        } else {
            const fromX = W0 + sx * dx * t;
            const fromY = (H0 + sy * dy * t) * aspect0;
            nW = sx && sy ? Math.max(fromX, fromY) : sx ? fromX : fromY;
            nW = Math.max(nW, MIN_CROP * Math.max(1, aspect0));
            nH = nW / aspect0;
        }
        return {
            W: nW,
            H: nH,
            x: sx === 1 ? L + nW / 2 : sx === -1 ? R - nW / 2 : start.panX,
            y: sy === 1 ? T + nH / 2 : sy === -1 ? B - nH / 2 : start.panY
        };
    };
    const fits = (w: ReturnType<typeof windowFor>) => {
        for (const [ux, uy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
            const x = w.x + (ux * w.W) / 2;
            const y = w.y + (uy * w.H) / 2;
            if (Math.abs(x * cos + y * sin) > ow / 2 + 1e-6) return false;
            if (Math.abs(-x * sin + y * cos) > oh / 2 + 1e-6) return false;
        }
        const oW = start.outW * (w.W / W0);
        const oH = start.outH * (free ? w.H / H0 : w.W / W0);
        const aspect = free ? oW / oH : aspect0;
        return coverSize(ow, oh, aspect).cw / w.W <= MAX_ZOOM + 1e-6;
    };
    let t = 1;
    if (!fits(windowFor(1))) {
        let lo = 0;
        let hi = 1;
        for (let i = 0; i < 30; i++) {
            const mid = (lo + hi) / 2;
            if (fits(windowFor(mid))) lo = mid; else hi = mid;
        }
        t = lo;
    }
    const w = windowFor(t);
    const next: EditState = {
        ...start,
        outW: clampOut(start.outW * (w.W / W0)),
        outH: clampOut(start.outH * (free ? w.H / H0 : w.W / W0)),
        panX: w.x,
        panY: w.y
    };
    next.zoom = coverSize(ow, oh, aspectOf(next, ow, oh)).cw / w.W;
    return normalize(ow, oh, next);
}

export function renderOutput(base: HTMLCanvasElement, st: EditState, src?: HTMLCanvasElement) {
    const v = deriveView(base.width, base.height, st);
    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(st.outW));
    out.height = Math.max(1, Math.round(st.outH));
    const ctx = out.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.scale(out.width / v.W, out.height / v.H);
    ctx.translate(v.W / 2 - v.px, v.H / 2 - v.py);
    ctx.rotate(v.theta);
    ctx.drawImage(src ?? base, -base.width / 2, -base.height / 2, base.width, base.height);
    return out;
}

// ADJUSTMENTS
export interface Adjustments {
    brightness: number;
    exposure: number;
    contrast: number;
    highlights: number;
    shadows: number;
    vignette: number;   
    saturation: number;
    warmth: number;
    tint: number;       
    sharpness: number;
}

export const NO_ADJUSTMENTS: Adjustments = {
    brightness: 0,
    exposure: 0,
    contrast: 0,
    highlights: 0,
    shadows: 0,
    vignette: 0,
    saturation: 0,
    warmth: 0,
    tint: 0,
    sharpness: 0
};

export function hasAdjustments(a: Adjustments) {
    return (Object.keys(NO_ADJUSTMENTS) as (keyof Adjustments)[]).some(k => a[k] !== 0);
}

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

function smooth(e0: number, e1: number, x: number) {
    const t = clamp01((x - e0) / (e1 - e0));
    return t * t * (3 - 2 * t);
}

// Applies the adjustments to a canvas in place
export function applyAdjustments(canvas: HTMLCanvasElement, a: Adjustments) {
    if (!hasAdjustments(a)) return;
    const w = canvas.width;
    const h = canvas.height;
    const ctx = canvas.getContext("2d")!;
    const image = ctx.getImageData(0, 0, w, h);
    const d = image.data;
    const exposure = Math.pow(2, a.exposure / 50); 
    const brightness = (a.brightness / 100) * 0.4;
    const contrast = 1 + a.contrast / 100;
    const highlights = (a.highlights / 100) * 0.35;
    const shadows = (a.shadows / 100) * 0.35;
    const saturation = 1 + a.saturation / 100;
    const warmth = (a.warmth / 100) * 0.15;
    const tint = (a.tint / 100) * 0.1;
    const vignette = a.vignette / 100;
    for (let y = 0; y < h; y++) {
        const dy = ((y + 0.5) / h) * 2 - 1;
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            let r = (d[i] / 255) * exposure + brightness;
            let g = (d[i + 1] / 255) * exposure + brightness;
            let b = (d[i + 2] / 255) * exposure + brightness;
            r = (r - 0.5) * contrast + 0.5;
            g = (g - 0.5) * contrast + 0.5;
            b = (b - 0.5) * contrast + 0.5;
            let lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            const tone = smooth(0.5, 1, lum) * highlights + (1 - smooth(0, 0.5, lum)) * shadows;
            r += tone;
            g += tone;
            b += tone;
            lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            r = lum + (r - lum) * saturation;
            g = lum + (g - lum) * saturation;
            b = lum + (b - lum) * saturation;
            r += warmth + tint * 0.5;
            g -= tint;
            b += -warmth + tint * 0.5;
            if (vignette !== 0) {
                const dx = ((x + 0.5) / w) * 2 - 1;
                const f = smooth(0.3, 1, Math.sqrt((dx * dx + dy * dy) / 2));
                if (vignette > 0) {
                    const m = 1 - vignette * f;
                    r *= m;
                    g *= m;
                    b *= m;
                } else {
                    const m = -vignette * f;
                    r += (1 - r) * m;
                    g += (1 - g) * m;
                    b += (1 - b) * m;
                }
            }

            d[i] = clamp01(r) * 255;
            d[i + 1] = clamp01(g) * 255;
            d[i + 2] = clamp01(b) * 255;
        }
    }
    if (a.sharpness > 0) {
        const amount = (a.sharpness / 100) * 1.2;
        const src = new Uint8ClampedArray(d);
        for (let y = 0; y < h; y++) {
            const up = Math.max(0, y - 1);
            const down = Math.min(h - 1, y + 1);
            for (let x = 0; x < w; x++) {
                const left = Math.max(0, x - 1);
                const right = Math.min(w - 1, x + 1);
                const i = (y * w + x) * 4;
                const iu = (up * w + x) * 4;
                const id = (down * w + x) * 4;
                const il = (y * w + left) * 4;
                const ir = (y * w + right) * 4;
                for (let c = 0; c < 3; c++) {
                    d[i + c] = src[i + c] + amount * (4 * src[i + c] - src[iu + c] - src[id + c] - src[il + c] - src[ir + c]);
                }
            }
        }
    } else if (a.sharpness < 0) {
        const t = -a.sharpness / 100;
        const R = 2;
        const n = 2 * R + 1;
        const src = new Uint8ClampedArray(d);
        const tmp = new Float32Array(d.length);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const i = (y * w + x) * 4;
                for (let c = 0; c < 3; c++) {
                    let sum = 0;
                    for (let k = -R; k <= R; k++) {
                        const xx = Math.min(w - 1, Math.max(0, x + k));
                        sum += src[(y * w + xx) * 4 + c];
                    }
                    tmp[i + c] = sum / n;
                }
            }
        }
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const i = (y * w + x) * 4;
                for (let c = 0; c < 3; c++) {
                    let sum = 0;
                    for (let k = -R; k <= R; k++) {
                        const yy = Math.min(h - 1, Math.max(0, y + k));
                        sum += tmp[(yy * w + x) * 4 + c];
                    }
                    d[i + c] = src[i + c] + t * (sum / n - src[i + c]);
                }
            }
        }
    }

    ctx.putImageData(image, 0, 0);
}

// FILTERS
export interface Filter {
    key: string;
    label: string;
    adj?: Partial<Adjustments>;
    fade?: number;  
    sepia?: number; 
}

export const FILTER_GROUPS: { title: string; filters: Filter[]; }[] = [
    {
        title: "Classic",
        filters: [
            { key: "none", label: "None" },
            { key: "portrait", label: "Portrait", adj: { contrast: 8, saturation: 6, warmth: 6, sharpness: 15, highlights: -10 } },
            { key: "brighten", label: "Brighten", adj: { brightness: 25, exposure: 10, shadows: 25 } },
            { key: "natural-warmth", label: "Natural warmth", adj: { warmth: 25, saturation: 8, tint: 4 } },
            { key: "cool-tone", label: "Cool tone", adj: { warmth: -25, saturation: 5 } },
            { key: "soft-contrast", label: "Soft contrast", adj: { contrast: -12, shadows: 20, highlights: -15 } },
            { key: "clarity", label: "Clarity", adj: { contrast: 15, sharpness: 40, saturation: 8 } },
            { key: "sunbath", label: "Sunbath", adj: { warmth: 35, brightness: 8, saturation: 15, exposure: 8 } }
        ]
    },
    {
        title: "Vibrant",
        filters: [
            { key: "vivid", label: "Vivid", adj: { saturation: 40, contrast: 12 } },
            { key: "radiance", label: "Radiance", adj: { exposure: 12, saturation: 25, highlights: -15, shadows: 20, warmth: 8 } },
            { key: "breeze", label: "Breeze", adj: { warmth: -15, saturation: 20, brightness: 8, tint: -5 } },
            { key: "color-punch", label: "Color punch", adj: { saturation: 55, contrast: 25 } },
            { key: "dreamy", label: "Dreamy", adj: { brightness: 10, contrast: -15, saturation: 15, tint: 10, sharpness: -40 } },
            { key: "evergreen", label: "Evergreen", adj: { tint: -20, saturation: 25, warmth: -8, contrast: 8 } }
        ]
    },
    {
        title: "Black & White",
        filters: [
            { key: "bright-bw", label: "Bright B&W", adj: { saturation: -100, brightness: 15, contrast: 5 } },
            { key: "standard-bw", label: "Standard B&W", adj: { saturation: -100 } },
            { key: "matte-bw", label: "Matte B&W", adj: { saturation: -100, contrast: -10 }, fade: 0.15 },
            { key: "sepia", label: "Sepia", adj: { saturation: -100 }, sepia: 0.8 },
            { key: "noir", label: "Noir", adj: { saturation: -100, contrast: 45, brightness: -10, vignette: 35 } },
            { key: "charcoal", label: "Charcoal", adj: { saturation: -100, contrast: 25, brightness: -18, shadows: -20 } }
        ]
    },
    {
        title: "Mood",
        filters: [
            { key: "shadow", label: "Shadow", adj: { exposure: -15, contrast: 20, shadows: -25, saturation: -10 } },
            { key: "grit", label: "Grit", adj: { contrast: 35, saturation: -25, sharpness: 50, vignette: 25 } },
            { key: "cinematic", label: "Cinematic", adj: { contrast: 18, saturation: -10, warmth: 12, tint: -6, vignette: 30, shadows: -10 } },
            { key: "soft-glow", label: "Soft glow", adj: { brightness: 12, contrast: -18, highlights: -10, sharpness: -35, warmth: 8 } },
            { key: "mist", label: "Mist", adj: { brightness: 12, contrast: -25, saturation: -20, warmth: -8 }, fade: 0.12 },
            { key: "amber-dusk", label: "Amber dusk", adj: { warmth: 40, exposure: -10, contrast: 12, saturation: 10, vignette: 20 } }
        ]
    },
    {
        title: "Retro",
        filters: [
            { key: "golden-hour", label: "Golden hour", adj: { warmth: 35, exposure: 5, saturation: 10, contrast: 8, vignette: 15 } },
            { key: "soft-pastel", label: "Soft pastel", adj: { brightness: 15, contrast: -20, saturation: -10, tint: 8 }, fade: 0.15 },
            { key: "disposable-camera", label: "Disposable camera", adj: { contrast: 15, saturation: 15, warmth: 12, vignette: 35, tint: -5 } },
            { key: "faded-film", label: "Faded film", adj: { contrast: -15, saturation: -15, warmth: 8 }, fade: 0.2 },
            { key: "vintage", label: "Vintage", adj: { warmth: 25, saturation: -20, contrast: -8, vignette: 25 }, fade: 0.18, sepia: 0.15 },
            { key: "cool-retro", label: "Cool retro", adj: { warmth: -20, tint: -8, saturation: -10, contrast: -5 }, fade: 0.15 }
        ]
    }
];

const NO_FILTER: Filter = { key: "none", label: "None" };
const ALL_FILTERS = FILTER_GROUPS.flatMap(g => g.filters);
export function findFilter(key: string): Filter {
    return ALL_FILTERS.find(f => f.key === key) ?? NO_FILTER;
}

// Applies a filter to a canvas in place. Intensity (0..100) scales every part of the filter.
export function applyFilter(canvas: HTMLCanvasElement, f: Filter, intensity = 100) {
    const t = Math.max(0, Math.min(1, intensity / 100));
    if (t === 0) return;
    if (f.adj) {
        const scaled: Adjustments = { ...NO_ADJUSTMENTS };
        for (const k of Object.keys(f.adj) as (keyof Adjustments)[]) scaled[k] = (f.adj[k] ?? 0) * t;
        applyAdjustments(canvas, scaled);
    }
    const fade = (f.fade ?? 0) * t;
    const sepia = (f.sepia ?? 0) * t;
    if (!fade && !sepia) return;
    const ctx = canvas.getContext("2d")!;
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = image.data;
    const lift = fade * 100;
    for (let i = 0; i < d.length; i += 4) {
        let r = d[i];
        let g = d[i + 1];
        let b = d[i + 2];
        if (sepia > 0) {
            const sr = Math.min(255, r * 0.393 + g * 0.769 + b * 0.189);
            const sg = Math.min(255, r * 0.349 + g * 0.686 + b * 0.168);
            const sb = Math.min(255, r * 0.272 + g * 0.534 + b * 0.131);
            r += (sr - r) * sepia;
            g += (sg - g) * sepia;
            b += (sb - b) * sepia;
        }
        if (lift > 0) {
            r = lift + (r * (255 - lift)) / 255;
            g = lift + (g * (255 - lift)) / 255;
            b = lift + (b * (255 - lift)) / 255;
        }
        d[i] = r;
        d[i + 1] = g;
        d[i + 2] = b;
    }
    ctx.putImageData(image, 0, 0);
}

export async function canvasToFile(canvas: HTMLCanvasElement, original: File): Promise<File> {
    const keep = ["image/png", "image/jpeg", "image/webp"].includes(original.type);
    const type = keep ? original.type : "image/png";
    const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, type, 0.92));
    if (!blob) throw new Error("Failed to export image");
    const name = keep ? original.name : original.name.replace(/\.[^.]+$/, "") + ".png";
    return new File([blob], name, { type });
}

// MARK-UPS
export type MarkTool = "pen" | "highlighter" | "eraser";
export type MarkStyle = "free" | "free-arrow" | "free-double" | "line" | "arrow" | "double" | "rect" | "ellipse";
export const isTwoPoint = (style: MarkStyle) =>
    style === "line" || style === "arrow" || style === "double" || style === "rect" || style === "ellipse";
export interface MarkPoint { x: number; y: number; }
export interface Stroke {
    tool: MarkTool;
    color: string;
    size: number; 
    style: MarkStyle;
    pts: MarkPoint[];
    opacity?: number; 
}

export const MARK_MIN_SIZE = 1;
export const MARK_MAX_SIZE = 6;
export const MARK_COLORS = [
    "#FFD83A", "#FFB020", "#F26B2A", "#E5252E", "#5B2D8E", "#9A4FC0", "#D0287B", "#C2185B",
    "#3EC6FF", "#1E7FE0", "#0B4FB4", "#7AB800", "#10B04A", "#EEEEEE", "#B5B5B5", "#1E1E1E"
];

export const eraserRadius = (size: number) => size * 0.012;
export const strokeWidth = (s: Pick<Stroke, "tool" | "size">) =>
    s.tool === "eraser" ? eraserRadius(s.size) * 2 : s.size * (s.tool === "highlighter" ? 0.01 : 0.0025);

function distToSegment(p: MarkPoint, a: MarkPoint, b: MarkPoint) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : clamp01(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2);
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function strokeHit(s: Stroke, p: MarkPoint, reach = 0.01) {
    if (s.tool === "eraser") return false; // pixel-erase strokes are not things to pick up
    const tol = strokeWidth(s) / 2 + reach;
    let pts = s.pts;
    if (s.style === "rect" || s.style === "ellipse") {
        const a = s.pts[0];
        const b = s.pts[s.pts.length - 1];
        const x0 = Math.min(a.x, b.x);
        const x1 = Math.max(a.x, b.x);
        const y0 = Math.min(a.y, b.y);
        const y1 = Math.max(a.y, b.y);
        if (s.style === "rect") {
            pts = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }, { x: x0, y: y0 }];
        } else {
            const cx = (x0 + x1) / 2;
            const cy = (y0 + y1) / 2;
            pts = [];
            for (let i = 0; i <= 48; i++) {
                const t = (i / 48) * Math.PI * 2;
                pts.push({ x: cx + ((x1 - x0) / 2) * Math.cos(t), y: cy + ((y1 - y0) / 2) * Math.sin(t) });
            }
        }
    }
    for (let i = 0; i < pts.length - 1; i++) { if (distToSegment(p, pts[i], pts[i + 1]) <= tol) return true; }
    return false;
}

function drawHead(ctx: CanvasRenderingContext2D, tip: MarkPoint, from: MarkPoint, lw: number, len: number) {
    const a = Math.atan2(tip.y - from.y, tip.x - from.x);
    const spread = 0.42;          // half-angle of the barb wings
    const notch  = 0.60;          // how far back along the shaft the notch sits (0–1)
    const lx = tip.x - len * Math.cos(a - spread), ly = tip.y - len * Math.sin(a - spread);
    const rx = tip.x - len * Math.cos(a + spread), ry = tip.y - len * Math.sin(a + spread);
    const nx = tip.x - len * notch * Math.cos(a),  ny = tip.y - len * notch * Math.sin(a);
    ctx.save();
    ctx.lineWidth  = lw;
    ctx.lineCap    = "round";
    ctx.lineJoin   = "round";
    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.lineTo(tip.x, tip.y);
    ctx.lineTo(rx, ry);
    ctx.moveTo(lx, ly);
    ctx.lineTo(nx, ny);
    ctx.lineTo(rx, ry);
    ctx.stroke();
    ctx.restore();
}

function trimPts(pts: MarkPoint[], d: number, atStart: boolean): MarkPoint[] {
    const a = atStart ? [...pts].reverse() : [...pts];
    let left = d;
    while (a.length > 2) {
        const last = a[a.length - 1];
        const prev = a[a.length - 2];
        const seg = Math.hypot(last.x - prev.x, last.y - prev.y);
        if (seg > left) break;
        left -= seg;
        a.pop();
    }
    const last = a[a.length - 1];
    const prev = a[a.length - 2] ?? last;
    const seg = Math.hypot(last.x - prev.x, last.y - prev.y);
    if (seg > 0) {
        const t = Math.min(left, seg * 0.95) / seg;
        a[a.length - 1] = { x: last.x + (prev.x - last.x) * t, y: last.y + (prev.y - last.y) * t };
    }
    return atStart ? a.reverse() : a;
}

export function drawStrokes(ctx: CanvasRenderingContext2D, strokes: Stroke[], W: number) {
    if (!strokes.some(s => s.tool === "eraser")) return paintStrokes(ctx, strokes, W);
    const layer = document.createElement("canvas");
    layer.width = ctx.canvas.width;
    layer.height = ctx.canvas.height;
    paintStrokes(layer.getContext("2d")!, strokes, W);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(layer, 0, 0);
    ctx.restore();
}

function paintStrokes(ctx: CanvasRenderingContext2D, strokes: Stroke[], W: number) {
    for (const s of strokes) {
        const pts = s.pts.map(p => ({ x: p.x * W, y: p.y * W }));
        if (!pts.length) continue;
        const lw = Math.max(1, strokeWidth(s) * W);
        const arrowEnd = s.tool === "pen" && (s.style === "arrow" || s.style === "free-arrow" || s.style === "double" || s.style === "free-double");
        const arrowStart = s.tool === "pen" && (s.style === "double" || s.style === "free-double");
        const len = Math.max(lw * 2.4, 0.02 * W);
        let line = pts;
        if (pts.length >= 2) {
            if (arrowEnd) line = trimPts(line, len * 0.7, false);
            if (arrowStart) line = trimPts(line, len * 0.7, true);
        }
        ctx.save();
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.lineWidth = lw;
        ctx.strokeStyle = s.color;
        ctx.fillStyle = s.color;
        ctx.globalAlpha = (s.tool === "highlighter" ? 0.4 : 1) * Math.min(1, Math.max(0, s.opacity ?? 1));
        if (s.tool === "eraser") ctx.globalCompositeOperation = "destination-out";

        if (s.tool === "pen" && (s.style === "rect" || s.style === "ellipse")) {
            const a = pts[0];
            const b = pts[pts.length - 1];
            const x = Math.min(a.x, b.x);
            const y = Math.min(a.y, b.y);
            const w = Math.abs(a.x - b.x);
            const h = Math.abs(a.y - b.y);
            ctx.beginPath();
            if (s.style === "rect") ctx.rect(x, y, w, h);
            else ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
            continue;
        }

        ctx.beginPath();
        ctx.moveTo(line[0].x, line[0].y);
        if (line.length <= 2) {
            ctx.lineTo(line[line.length - 1].x, line[line.length - 1].y);
        } else {
            for (let i = 1; i < line.length - 1; i++) {
                const mx = (line[i].x + line[i + 1].x) / 2;
                const my = (line[i].y + line[i + 1].y) / 2;
                ctx.quadraticCurveTo(line[i].x, line[i].y, mx, my);
            }
            ctx.lineTo(line[line.length - 1].x, line[line.length - 1].y);
        }
        ctx.stroke();

        if (s.tool === "pen") {
            const end = arrowEnd;
            const start = arrowStart;
            if (end) {
                const tip = pts[pts.length - 1];
                const ref = [...pts].reverse().find(p => Math.hypot(p.x - tip.x, p.y - tip.y) >= len * 0.6);
                if (ref) drawHead(ctx, tip, ref, lw, len);
            }
            if (start) {
                const tip = pts[0];
                const ref = pts.find(p => Math.hypot(p.x - tip.x, p.y - tip.y) >= len * 0.6);
                if (ref) drawHead(ctx, tip, ref, lw, len);
            }
        }
        ctx.restore();
    }
}
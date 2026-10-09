/* 
   Background Presets:
   Background presets for the Background tab. Every preset is painted with canvas code, so there are
   no image files to ship. A preset can have an `inset`: the picture is then shrunk into the middle and
   the preset becomes a frame around it (used by the Frame group). Presets without an inset sit behind a
   picture whose own background has been removed.
 */ 

export interface Background {
    key: string;
    label: string;
    inset?: number; // 0..1, share of the canvas the picture keeps
    paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
}
export interface BackgroundGroup {
    title: string;
    items: Background[];
}
type Stop = [number, string];
function rng(seed: number) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function linear(ctx: CanvasRenderingContext2D, w: number, h: number, deg: number, stops: Stop[], area?: [number, number, number, number]) {
    const a = (deg * Math.PI) / 180;
    const r = (Math.abs(w * Math.sin(a)) + Math.abs(h * Math.cos(a))) / 2;
    const dx = Math.sin(a) * r;
    const dy = -Math.cos(a) * r;
    const g = ctx.createLinearGradient(w / 2 - dx, h / 2 - dy, w / 2 + dx, h / 2 + dy);
    for (const [o, c] of stops) g.addColorStop(o, c);
    ctx.fillStyle = g;
    const [x, y, ww, hh] = area ?? [0, 0, w, h];
    ctx.fillRect(x, y, ww, hh);
}

// Soft round glow
function glow(ctx: CanvasRenderingContext2D, w: number, h: number, fx: number, fy: number, r: number, color: string, fade = "rgba(0,0,0,0)") {
    const R = r * Math.max(w, h);
    const g = ctx.createRadialGradient(fx * w, fy * h, 0, fx * w, fy * h, R);
    g.addColorStop(0, color);
    g.addColorStop(1, fade);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
}
function fill(ctx: CanvasRenderingContext2D, w: number, h: number, color: string) {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
}
function dots(ctx: CanvasRenderingContext2D, w: number, h: number, n: number, rMin: number, rMax: number, color: string, seed: number, region?: [number, number]) {
    const rnd = rng(seed);
    ctx.fillStyle = color;
    const [y0, y1] = region ?? [0, 1];
    for (let i = 0; i < n; i++) {
        ctx.beginPath();
        ctx.arc(rnd() * w, (y0 + rnd() * (y1 - y0)) * h, (rMin + rnd() * (rMax - rMin)) * w, 0, Math.PI * 2);
        ctx.fill();
    }
}
function hill(ctx: CanvasRenderingContext2D, w: number, h: number, y: number, amp: number, phase: number, color: string) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let i = 0; i <= 40; i++) {
        const x = (i / 40) * w;
        ctx.lineTo(x, h * (y + amp * Math.sin((i / 40) * Math.PI * 2 + phase)));
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
}
function rays(ctx: CanvasRenderingContext2D, w: number, h: number, n: number, a: string, b: string) {
    const R = Math.hypot(w, h);
    for (let i = 0; i < n; i++) {
        ctx.fillStyle = i % 2 ? a : b;
        ctx.beginPath();
        ctx.moveTo(w / 2, h / 2);
        ctx.arc(w / 2, h / 2, R, (i / n) * Math.PI * 2, ((i + 1) / n) * Math.PI * 2);
        ctx.closePath();
        ctx.fill();
    }
}
function halftone(ctx: CanvasRenderingContext2D, w: number, h: number, step: number, color: string) {
    ctx.fillStyle = color;
    for (let y = 0, row = 0; y < h + step; y += step, row++) {
        for (let x = (row % 2) * (step / 2); x < w + step; x += step) {
            const k = 1 - Math.hypot(x - w / 2, y - h / 2) / Math.hypot(w / 2, h / 2);
            ctx.beginPath();
            ctx.arc(x, y, Math.max(0.5, step * 0.38 * (1 - k * 0.6)), 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

function border(ctx: CanvasRenderingContext2D, w: number, h: number, inset: number, width: number, color: string) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.strokeRect(w * inset, h * inset, w * (1 - inset * 2), h * (1 - inset * 2));
}
function hexagon(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i + Math.PI / 6;
        ctx.lineTo(x + r * Math.cos(a), y + r * Math.sin(a));
    }
    ctx.closePath();
    ctx.fill();
}
function pillar(ctx: CanvasRenderingContext2D, w: number, h: number, cx: number, top: number, rx: number, body: string, cap: string) {
    const x = cx * w;
    const y = top * h;
    ctx.fillStyle = body;
    ctx.fillRect(x - rx * w, y, rx * 2 * w, h - y);
    ctx.fillStyle = cap;
    ctx.beginPath();
    ctx.ellipse(x, y, rx * w, rx * w * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();
}
export const BACKGROUND_GROUPS: BackgroundGroup[] = [
    {
        title: "Gradient",
        items: [
            { key: "cotton-candy", label: "Cotton candy", paint: (c, w, h) => { linear(c, w, h, 135, [[0, "#f9a8e6"], [1, "#7f9bff"]]); glow(c, w, h, 0.25, 0.3, 0.5, "rgba(255,255,255,0.35)"); } },
            { key: "aurora", label: "Aurora", paint: (c, w, h) => { fill(c, w, h, "#0d1b3d"); glow(c, w, h, 0.2, 0.3, 0.7, "rgba(60,255,170,0.7)"); glow(c, w, h, 0.8, 0.5, 0.7, "rgba(150,80,255,0.7)"); } },
            { key: "candy-floss", label: "Candy floss", paint: (c, w, h) => linear(c, w, h, 180, [[0, "#ff4d5e"], [0.5, "#ff9566"], [1, "#8a3dff"]]) },
            { key: "ocean-deep", label: "Ocean deep", paint: (c, w, h) => linear(c, w, h, 160, [[0, "#0a2f4f"], [1, "#1fb0c0"]]) },
            { key: "citrus", label: "Citrus", paint: (c, w, h) => { fill(c, w, h, "#9bd24a"); glow(c, w, h, 0.3, 0.2, 0.9, "#ffe23a"); glow(c, w, h, 0.9, 1, 0.6, "rgba(255,140,40,0.8)"); } },
            { key: "midnight", label: "Midnight", paint: (c, w, h) => { linear(c, w, h, 200, [[0, "#1b1038"], [1, "#4a2a8a"]]); dots(c, w, h, 40, 0.001, 0.003, "rgba(255,255,255,0.8)", 7); } }
        ]
    },
    {
        title: "Product Showcase",
        items: [
            { key: "studio-peach", label: "Studio peach", paint: (c, w, h) => { linear(c, w, h, 160, [[0, "#f7c9a8"], [1, "#e79b73"]]); linear(c, w, h, 180, [[0, "rgba(255,255,255,0)"], [1, "rgba(255,240,225,0.8)"]], [0, h * 0.7, w, h * 0.3]); } },
            {
                key: "endless-white", label: "Endless white", paint: (c, w, h) => {
                    linear(c, w, h, 180, [[0, "#f6f3ee"], [1, "#d8d2c8"]]);
                    c.strokeStyle = "rgba(120,110,100,0.18)";
                    c.lineWidth = 1;
                    for (let i = -10; i <= 10; i++) { c.beginPath(); c.moveTo(w / 2, h * 0.5); c.lineTo(w / 2 + i * w * 0.2, h); c.stroke(); }
                }
            },
            { key: "teal-stand", label: "Teal stand", paint: (c, w, h) => { linear(c, w, h, 180, [[0, "#7fd0e8"], [1, "#4aa8c8"]]); glow(c, w, h, 0.8, 0.2, 0.25, "rgba(255,255,255,0.8)"); pillar(c, w, h, 0.5, 0.78, 0.3, "#2f8fb0", "#6fd0e6"); } },
            {
                key: "wooden-table", label: "Wooden table", paint: (c, w, h) => {
                    fill(c, w, h, "#1a1410");
                    dots(c, w, h, 14, 0.02, 0.05, "rgba(255,190,100,0.35)", 3, [0.05, 0.55]);
                    linear(c, w, h, 180, [[0, "#6b4a2b"], [1, "#a97b4a"]], [0, h * 0.62, w, h * 0.38]);
                    c.strokeStyle = "rgba(40,25,10,0.35)";
                    for (let i = 1; i < 6; i++) { c.beginPath(); c.moveTo(0, h * (0.62 + i * 0.065)); c.lineTo(w, h * (0.62 + i * 0.065)); c.stroke(); }
                }
            },
            {
                key: "corner-room", label: "Corner room", paint: (c, w, h) => {
                    fill(c, w, h, "#f6d9bd");
                    c.fillStyle = "#ff9d4a";
                    c.beginPath(); c.moveTo(w * 0.55, 0); c.lineTo(w, 0); c.lineTo(w, h * 0.7); c.lineTo(w * 0.55, h * 0.5); c.closePath(); c.fill();
                    linear(c, w, h, 180, [[0, "#fbe6cf"], [1, "#f1c9a2"]], [0, h * 0.6, w, h * 0.4]);
                }
            },
            { key: "spotlight", label: "Spotlight", paint: (c, w, h) => { fill(c, w, h, "#f3c614"); glow(c, w, h, 0.5, 0.4, 0.55, "#fff6b8"); } }
        ]
    },
    {
        title: "Sea",
        items: [
            { key: "shoreline", label: "Shoreline", paint: (c, w, h) => { linear(c, w, h, 90, [[0, "#e9d5b0"], [0.45, "#f4ead6"], [0.55, "#bfeee6"], [1, "#2aa6b8"]]); } },
            { key: "horizon", label: "Horizon", paint: (c, w, h) => { linear(c, w, h, 180, [[0, "#bfe3f5"], [1, "#f1f8fc"]], [0, 0, w, h * 0.45]); linear(c, w, h, 180, [[0, "#2f7fb0"], [1, "#0f4f7a"]], [0, h * 0.45, w, h * 0.55]); } },
            { key: "lagoon", label: "Lagoon", paint: (c, w, h) => { fill(c, w, h, "#0f9bb5"); glow(c, w, h, 0.3, 0.35, 0.6, "#7ff0e0"); glow(c, w, h, 0.85, 0.8, 0.5, "rgba(10,70,140,0.7)"); } },
            { key: "deep-blue", label: "Deep blue", paint: (c, w, h) => { linear(c, w, h, 180, [[0, "#1a78c8"], [1, "#062a5e"]]); hill(c, w, h, 0.4, 0.03, 0, "rgba(255,255,255,0.08)"); hill(c, w, h, 0.65, 0.04, 2, "rgba(255,255,255,0.07)"); } },
            { key: "sunset-bay", label: "Sunset bay", paint: (c, w, h) => { linear(c, w, h, 180, [[0, "#ff8a5c"], [1, "#ffd9a0"]], [0, 0, w, h * 0.55]); linear(c, w, h, 180, [[0, "#ff9f7a"], [1, "#2b3d7a"]], [0, h * 0.55, w, h * 0.45]); } },
            { key: "tide-pool", label: "Tide pool", paint: (c, w, h) => { fill(c, w, h, "#cfe9e4"); glow(c, w, h, 0.5, 0.5, 0.7, "#34b8c4"); dots(c, w, h, 22, 0.01, 0.03, "rgba(255,255,255,0.35)", 11); } }
        ]
    },
    {
        title: "Snow",
        items: [
            { key: "snow-white", label: "Snow white", paint: (c, w, h) => { linear(c, w, h, 160, [[0, "#ffffff"], [1, "#dfe8f0"]]); glow(c, w, h, 0.3, 0.7, 0.5, "rgba(180,200,220,0.5)"); } },
            {
                key: "frozen-pines", label: "Frozen pines", paint: (c, w, h) => {
                    linear(c, w, h, 180, [[0, "#cfe3f1"], [1, "#6c93b5"]]);
                    const r = rng(5);
                    for (let i = 0; i < 16; i++) {
                        const x = r() * w; const y = h * (0.35 + r() * 0.6); const s = w * (0.06 + r() * 0.07);
                        c.fillStyle = `rgba(30,70,90,${0.5 + r() * 0.4})`;
                        c.beginPath(); c.moveTo(x, y - s * 1.6); c.lineTo(x - s, y); c.lineTo(x + s, y); c.closePath(); c.fill();
                    }
                }
            },
            {
                key: "black-winter", label: "Black winter", paint: (c, w, h) => {
                    fill(c, w, h, "#0b1c2c");
                    c.strokeStyle = "rgba(120,180,220,0.45)";
                    c.lineWidth = 1.5;
                    for (let gy = 0; gy < 4; gy++) for (let gx = 0; gx < 4; gx++) {
                        const x = (gx + 0.5) * (w / 4); const y = (gy + 0.5) * (h / 4); const s = w * 0.035;
                        for (let k = 0; k < 3; k++) { const a = (k * Math.PI) / 3; c.beginPath(); c.moveTo(x - s * Math.cos(a), y - s * Math.sin(a)); c.lineTo(x + s * Math.cos(a), y + s * Math.sin(a)); c.stroke(); }
                    }
                }
            },
            { key: "ice-floor", label: "Ice floor", paint: (c, w, h) => { linear(c, w, h, 180, [[0, "#9fd0f0"], [1, "#e6f3fb"]], [0, 0, w, h * 0.6]); linear(c, w, h, 180, [[0, "#f4fafe"], [1, "#b9d9ee"]], [0, h * 0.6, w, h * 0.4]); } },
            { key: "snowfall", label: "Snowfall", paint: (c, w, h) => { linear(c, w, h, 180, [[0, "#5f86b0"], [1, "#c8dcee"]]); dots(c, w, h, 90, 0.002, 0.007, "rgba(255,255,255,0.85)", 21); } },
            { key: "dunes", label: "Snow dunes", paint: (c, w, h) => { linear(c, w, h, 180, [[0, "#b9dcf5"], [1, "#eaf5fc"]]); hill(c, w, h, 0.62, 0.06, 0.5, "#f7fbff"); hill(c, w, h, 0.8, 0.05, 3, "#dcebf6"); dots(c, w, h, 50, 0.002, 0.005, "rgba(255,255,255,0.9)", 4, [0, 0.6]); } }
        ]
    },
    {
        title: "Frame",
        items: [
            { key: "pink-burst", label: "Pink burst", inset: 0.78, paint: (c, w, h) => rays(c, w, h, 28, "#ff3d86", "#ff7ab0") },
            { key: "comic-pop", label: "Comic pop", inset: 0.78, paint: (c, w, h) => { fill(c, w, h, "#ffd21f"); halftone(c, w, h, w * 0.04, "rgba(230,40,40,0.65)"); border(c, w, h, 0.09, w * 0.012, "#111"); } },
            { key: "blossom", label: "Blossom", inset: 0.8, paint: (c, w, h) => { fill(c, w, h, "#fffafb"); glow(c, w, h, 0, 0, 0.35, "rgba(255,150,190,0.75)"); glow(c, w, h, 1, 1, 0.35, "rgba(255,150,190,0.75)"); } },
            { key: "lantern", label: "Lantern glow", inset: 0.76, paint: (c, w, h) => { linear(c, w, h, 160, [[0, "#6b1f5c"], [1, "#b03a68"]]); dots(c, w, h, 24, 0.004, 0.01, "rgba(255,210,110,0.8)", 9); border(c, w, h, 0.1, w * 0.01, "#f1c660"); } },
            { key: "geometric", label: "Geometric", inset: 0.76, paint: (c, w, h) => { fill(c, w, h, "#16161c"); const r = rng(12); const cols = ["#ff4fa0", "#7a4dff", "#2ec4d6", "#ffd23f"]; for (let i = 0; i < 14; i++) hexagon(c, r() * w, r() * h, w * (0.05 + r() * 0.08), cols[i % 4]); border(c, w, h, 0.1, w * 0.012, "#fff"); } },
            { key: "mint-leaf", label: "Mint leaf", inset: 0.8, paint: (c, w, h) => { fill(c, w, h, "#bfe6f5"); border(c, w, h, 0.05, w * 0.05, "#e9e6a8"); glow(c, w, h, 0, 0.1, 0.25, "rgba(90,170,70,0.8)"); } }
        ]
    }
];

const ALL = BACKGROUND_GROUPS.flatMap(g => g.items);
export const findBackground = (key: string) => ALL.find(b => b.key === key);
export function drawChecker(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, size = 10) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.fillStyle = "#54565d";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "#34363b";
    for (let j = 0; j * size < h; j++) for (let i = 0; i * size < w; i++) {
        if ((i + j) % 2) ctx.fillRect(x + i * size, y + j * size, size, size);
    }
    ctx.restore();
}
export interface BlurBackdrop {
    back: HTMLCanvasElement;
    amount: number;
}
const BLUR_MAX = 0.04;
function paintBlurred(ctx: CanvasRenderingContext2D, back: HTMLCanvasElement, w: number, h: number, amount: number) {
    const r = (Math.max(0, Math.min(100, amount)) / 100) * BLUR_MAX * Math.max(w, h);
    if (r < 0.2) {
        ctx.drawImage(back, 0, 0, w, h);
        return;
    }
    const p = Math.ceil(r * 2.5);
    const pad = document.createElement("canvas");
    pad.width = w + p * 2;
    pad.height = h + p * 2;
    const pc = pad.getContext("2d")!;
    pc.imageSmoothingQuality = "high";
    const bw = back.width;
    const bh = back.height;
    pc.drawImage(back, p, p, w, h);
    pc.drawImage(back, 0, 0, 1, bh, 0, p, p, h);
    pc.drawImage(back, bw - 1, 0, 1, bh, p + w, p, p, h);
    pc.drawImage(back, 0, 0, bw, 1, p, 0, w, p);
    pc.drawImage(back, 0, bh - 1, bw, 1, p, p + h, w, p);
    pc.drawImage(back, 0, 0, 1, 1, 0, 0, p, p);
    pc.drawImage(back, bw - 1, 0, 1, 1, p + w, 0, p, p);
    pc.drawImage(back, 0, bh - 1, 1, 1, 0, p + h, p, p);
    pc.drawImage(back, bw - 1, bh - 1, 1, 1, p + w, p + h, p, p);
    ctx.save();
    ctx.filter = `blur(${r}px)`;
    ctx.drawImage(pad, -p, -p);
    ctx.restore();
}

export function withBackground(src: HTMLCanvasElement, key: string, color: string, blur?: BlurBackdrop): HTMLCanvasElement {
    if (key === "none") return src;
    if (key === "blur" && !blur) return src; // still waiting for the cut-out
    const def = key === "color" || key === "blur" ? undefined : findBackground(key);
    if (key !== "color" && key !== "blur" && !def) return src;
    const w = src.width;
    const h = src.height;
    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    const ctx = out.getContext("2d")!;
    if (key === "blur") paintBlurred(ctx, blur!.back, w, h, blur!.amount);
    else if (def) def.paint(ctx, w, h);
    else fill(ctx, w, h, color);
    const k = def?.inset ?? 1;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, (w - w * k) / 2, (h - h * k) / 2, w * k, h * k);
    return out;
}
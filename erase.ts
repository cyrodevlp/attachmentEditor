/*
  Vencord, a Discord client mod
  Copyright (c) 2026 Vendicated and contributors
  SPDX-License-Identifier: GPL-3.0-or-later
 */

import { PluginNative } from "@utils/types";
import { refineCutout } from "./cutout";
import { settings } from "./settings";
const getNative = () => VencordNative.pluginHelpers.AttachmentEditor as PluginNative<typeof import("./native")>;
export interface EraseStatus {
    installed: boolean;
    installing: boolean;
    starting: boolean;
    running: boolean;
    owned: boolean;
    stage: string;
    progress: number;
    error?: string;
}

const cfg = () => settings.store;
const serverUrl = () => `http://127.0.0.1:${cfg().engineServerPort}`;
export const eraseStatus = (): Promise<EraseStatus> => getNative().getStatus(cfg().engineServerPort);
export const eraseInstall = () => getNative().install(cfg().useYourGraphicsCard);
export const eraseStart = () => getNative().ensureStarted(cfg().engineServerPort, cfg().useYourGraphicsCard, cfg().idleTimeout, cfg().allocatedMemory);
export const eraseStop = () => getNative().stop();
export const eraseUninstall = () => getNative().uninstall();
export const ERASE_MIN_SIZE = 1;
export const ERASE_MAX_SIZE = 100;
export interface MaskStroke {
    add: boolean;
    size: number; 
    pts: { x: number; y: number; }[];
}

export function paintMask(ctx: CanvasRenderingContext2D, strokes: MaskStroke[], W: number, color: string) {
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const s of strokes) {
        const pts = s.pts.map(p => ({ x: p.x * W, y: p.y * W }));
        if (!pts.length) continue;
        ctx.globalCompositeOperation = s.add ? "source-over" : "destination-out";
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        const lw = Math.max(1, s.size * W);
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
        ctx.stroke();
        if (pts.length < 2) {
            ctx.beginPath();
            ctx.arc(pts[0].x, pts[0].y, lw / 2, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    ctx.restore();
}
export function buildMask(strokes: MaskStroke[], w: number, h: number): HTMLCanvasElement {
    const layer = document.createElement("canvas");
    layer.width = w;
    layer.height = h;
    paintMask(layer.getContext("2d")!, strokes, w, "#fff");
    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    const ctx = out.getContext("2d")!;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(layer, 0, 0);
    return out;
}

const toBlob = (c: HTMLCanvasElement) =>
    new Promise<Blob>((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error("Could not encode image"))), "image/png"));
const toBase64 = (b: Blob) =>
    new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(",")[1] ?? "");
        r.onerror = () => rej(r.error);
        r.readAsDataURL(b);
    });
export async function inpaint(image: HTMLCanvasElement, strokes: MaskStroke[]): Promise<HTMLCanvasElement> {
    const w = image.width;
    const h = image.height;
    const [img64, mask64] = await Promise.all([
        toBlob(image).then(toBase64),
        toBlob(buildMask(strokes, w, h)).then(toBase64)
    ]);

    const started = await eraseStart();
    if (!started.ok) throw new Error(started.error ?? "The Generative Erase engine could not start.");
    const r = await getNative().inpaint(img64, mask64, cfg().engineServerPort, cfg().idleTimeout, cfg().allocatedMemory);
    if (!r.ok) throw new Error(r.error);
    const bin = atob(r.data);
    const bytes = new Uint8Array(bin.length);
    for (let n = 0; n < bin.length; n++) bytes[n] = bin.charCodeAt(n);
    const blob = new Blob([bytes], { type: r.type });

    const bmp = await createImageBitmap(blob);
    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    out.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
    return out;
}

export async function removeBackground(image: HTMLCanvasElement): Promise<HTMLCanvasElement> {
    const k = Math.min(1, 1536 / Math.max(image.width, image.height));
    let sent = image;
    if (k < 1) {
        sent = document.createElement("canvas");
        sent.width = Math.max(1, Math.round(image.width * k));
        sent.height = Math.max(1, Math.round(image.height * k));
        const sctx = sent.getContext("2d")!;
        sctx.imageSmoothingQuality = "high";
        sctx.drawImage(image, 0, 0, sent.width, sent.height);
    }
    const img64 = await toBlob(sent).then(toBase64);
    const r = await getNative().removeBg(img64, cfg().engineServerPort, cfg().useYourGraphicsCard, cfg().idleTimeout, cfg().allocatedMemory);
    if (!r.ok) throw new Error(r.error);
    const bin = atob(r.data);
    const bytes = new Uint8Array(bin.length);
    for (let n = 0; n < bin.length; n++) bytes[n] = bin.charCodeAt(n);
    const bmp = await createImageBitmap(new Blob([bytes], { type: r.type }));
    const cut = document.createElement("canvas");
    cut.width = sent.width;
    cut.height = sent.height;
    cut.getContext("2d")!.drawImage(bmp, 0, 0, cut.width, cut.height);
    return refineCutout(image, cut);
}

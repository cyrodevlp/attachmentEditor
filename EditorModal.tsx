/*
 * Image Editor Modal:
 * This is the editor modal for the Attachment Editor plugin.
 * It allows users to edit images with various tools and adjustments.
 * 
 * The modal includes features such as cropping, adjusting image properties, 
 * applying filters, marking up images, erasing parts of the image, and changing the background.
 * The modal also provides options for undoing and redoing changes, zooming in and out, 
 * and saving the edited image.
 */

import { Button, TextButton } from "@components/Button";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { Switch } from "@components/Switch";
import { RenderModalProps } from "@vencord/discord-types";
import { Alerts, ColorPicker, Modal, ReactDOM, SearchableSelect, Slider, TextInput, Tooltip, useEffect, useMemo, useRef, useState } from "@webpack/common";
import {
    Adjustments,
    applyAdjustments,
    applyFilter,
    aspectOf,
    canvasToFile,
    deriveView,
    drawBackdrop,
    drawStrokes,
    drawStage,
    EditState,
    Filter,
    FILTER_GROUPS,
    findFilter,
    fitLock,
    Handle,
    hasAdjustments,
    hitTest,
    INITIAL_STATE,
    eraserRadius,
    isTwoPoint,
    loadImage,
    MARK_MAX_SIZE,
    MARK_MIN_SIZE,
    MarkStyle,
    MarkTool,
    makeBase,
    MAX_ZOOM,
    minZoomFor,
    NO_ADJUSTMENTS,
    normalize,
    RatioKey,
    RATIOS,
    renderOutput,
    resizeCrop,
    StageLayout,
    StageLock,
    Stroke,
    strokeHit,
    withRelativeSize
} from "./imageOps";
import { analyzeAuto, applyAuto, AutoParams } from "./autoEnhance";
import { BACKGROUND_GROUPS, drawChecker, findBackground, withBackground } from "./backgrounds";
import { ERASE_MAX_SIZE, ERASE_MIN_SIZE, eraseStart, eraseStatus, EraseStatus, inpaint, MaskStroke, paintMask, removeBackground } from "./erase";
import { settings } from "./settings";
interface Props {
    modalProps: RenderModalProps;
    file: File;
    onSave: (file: File) => void;
}
const STAGE_W = 960;
const STAGE_H = 640;
const CROP_MIN_H = 380;
const CROP_MAX_H = 860;
const CROP_CHROME = 300;
const CURSORS: Record<Handle | "move", string> = {
    n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize",
    nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize",
    move: "move"
};
const RATIO_OPTIONS = RATIOS.map(r => ({ value: r.key, label: r.label }));
const MARK_BAR_H = 76;
const clampSize = (n: number) => Math.min(8000, Math.max(1, Math.round(n || 1)));
const svgProps = {
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const
};
const RotateIcon = () => (
    <svg {...svgProps}><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 3v6h-6" /></svg>
);
const FlipIcon = () => (
    <svg {...svgProps}><path d="M12 3v18" strokeDasharray="2 3" /><path d="M8 7 3 17h5z" /><path d="M16 7l5 10h-5z" /></svg>
);
const FlipVerticalIcon = () => (
    <svg {...svgProps}>
        <g transform="rotate(90 12 12)">
            <path d="M12 3v18" strokeDasharray="2 3" /><path d="M8 7 3 17h5z" /><path d="M16 7l5 10h-5z" />
        </g>
    </svg>
);
const UndoIcon = () => (
    <svg {...svgProps}><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></svg>
);
const RedoIcon = () => (
    <svg {...svgProps}><path d="m15 14 5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></svg>
);
const ZoomOutIcon = () => (
    <svg {...svgProps}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3M8 11h6" /></svg>
);
const ZoomInIcon = () => (
    <svg {...svgProps}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3M8 11h6M11 8v6" /></svg>
);
const WandIcon = () => (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path fillRule="evenodd" d="M3.48 16.92L16.56 3.84A1.7 1.7 0 0 1 18.96 3.84L19.92 4.80A1.7 1.7 0 0 1 19.92 7.20L6.84 20.28A1.7 1.7 0 0 1 4.44 20.28L3.48 19.32A1.7 1.7 0 0 1 3.48 16.92ZM13.04 10.07L17.76 5.36L19.00 6.60L14.28 11.31ZM5.04 2.16C5.28 3.55 6.05 4.32 7.44 4.56C6.05 4.80 5.28 5.57 5.04 6.96C4.80 5.57 4.03 4.80 2.64 4.56C4.03 4.32 4.80 3.55 5.04 2.16ZM11.76 2.40C11.93 3.37 12.47 3.91 13.44 4.08C12.47 4.25 11.93 4.79 11.76 5.76C11.59 4.79 11.05 4.25 10.08 4.08C11.05 3.91 11.59 3.37 11.76 2.40ZM18.48 14.04C18.83 16.06 19.94 17.17 21.96 17.52C19.94 17.87 18.83 18.98 18.48 21.00C18.13 18.98 17.02 17.87 15.00 17.52C17.02 17.17 18.13 16.06 18.48 14.04Z" />
    </svg>
);
const MaterialIcon = ({ d }: { d: string; }) => (
    <svg width={20} height={20} viewBox="0 -960 960 960" fill="currentColor"><path d={d} /></svg>
);
const MarkupTabIcon = () => (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="currentColor">
        <svg x={2.25} y={0} width={19.5} height={19.5} viewBox="2 2 20 20"><path d={PENCIL_GLYPH} /></svg>
        <rect x={2} y={20.8} width={20} height={2.6} />
    </svg>
);
const TABS = [
    { key: "crop", label: "Crop", d: "M695-40v-165H265q-24 0-42-18t-18-42v-430H40v-60h165v-165h60v655h655v60H755v165h-60Zm0-285v-370H325v-60h370q24 0 42 18t18 42v370h-60Z" },
    { key: "adjustment", label: "Adjustment", d: "M300-370h40v-140h-40v50h-60v40h60v50Zm100-50h320v-40H400v40Zm220-110h40v-50h60v-40h-60v-50h-40v140Zm-380-50h320v-40H240v40Zm90 460v-80H140q-24 0-42-18t-18-42v-520q0-24 18-42t42-18h680q24 0 42 18t18 42v520q0 24-18 42t-42 18H630v80H330Z" },
    { key: "filter", label: "Filter", d: "M345-377h391L609-548 506-413l-68-87-93 123Zm-85 177q-24 0-42-18t-18-42v-560q0-24 18-42t42-18h560q24 0 42 18t18 42v560q0 24-18 42t-42 18H260ZM140-80q-24 0-42-18t-18-42v-620h60v620h620v60H140Z" },
    { key: "markup", label: "Mark-up", d: "M80 0v-121h800V0H80Zm80-241v-128l494-494q9-9 20-13t22-4q11 0 22.5 4t19.5 13l44 44q9 8 13.5 19.5T800-777q0 11-4.5 22T782-735L288-241H160Zm538-497 40-40-41-41-40 40 41 41Z" },
    { key: "erase", label: "Erase", d: "M678-220h203v60H618l60-60Zm-499 60-81-84q-18-17-17.5-41.5T97-327l458-498q16-17 40.5-17t41.5 17l205 215q17 17 18 42t-16 42L503-160H179Z" },
    { key: "background", label: "Background", d: "M124-520v-85l235-235h85L124-520Zm-4-166v-85l69-69h85L120-686Zm527-17q-10-11-21-21.5T602-743l97-97h85L647-703ZM220-361l77-77q7 11 14.5 20t16.5 17l-19 5q-23 7-45 16t-44 19Zm478-222q-2-18-6-35t-12-33l160-160v86L698-583ZM469-780l60-60h85l-70 70q-16-5-31.5-7.5T480-780h-11ZM120-345v-85l140-140v10q0 17 2 33t8 31L120-345Zm670 11q-12-11-26-18t-28-13l104-104v85l-50 50Zm-116-54q-11-3-21.5-6.5T631-401q20-17 33.5-39t22.5-47l153-153v86L674-388Zm-194-12q-66 0-113-47t-47-113q0-66 47-113t113-47q66 0 113 47t47 113q0 66-47 113t-113 47ZM160-120v-71q0-34 17-63t47-44q60-30 124.5-46T480-360q67 0 131.5 16T736-298q30 15 47 44t17 63v71H160Z" }
];
const SCROLLBAR_CSS = `
[role="dialog"]:has(.attachment-editor-scroll) {
    width: min(1240px, calc(100vw - 64px)) !important;
    max-width: none !important;
}
[role="dialog"]:has(.attachment-editor-scroll[data-tab="crop"]),
[role="dialog"]:has(.attachment-editor-scroll[data-tab="erase"]) {
    width: min(1560px, calc(100vw - 48px)) !important;
}
.attachment-editor-scroll {
    overflow-y: auto;
    overflow-x: hidden;
}
[role="dialog"]:has(.attachment-editor-scroll) [class*="separator" i],
[role="dialog"]:has(.attachment-editor-scroll) [class*="divider" i] { display: none !important; }
[role="dialog"]:has(.attachment-editor-scroll) [class*="header" i],
[role="dialog"]:has(.attachment-editor-scroll) [class*="footer" i] { box-shadow: none !important; border: none !important; }
[role="dialog"]:has(.attachment-editor-scroll) [class*="header" i]::before,
[role="dialog"]:has(.attachment-editor-scroll) [class*="header" i]::after,
[role="dialog"]:has(.attachment-editor-scroll) [class*="footer" i]::before,
[role="dialog"]:has(.attachment-editor-scroll) [class*="footer" i]::after { display: none !important; }
/* Disabled footer buttons (Finish, Reset): Discord switches their pointer events off, which hides the cursor.
   Turn them back on (a disabled button never fires a click) so the "not allowed" cursor shows. */
[role="dialog"]:has(.attachment-editor-scroll) [class*="footer" i] button:disabled,
[role="dialog"]:has(.attachment-editor-scroll) [class*="footer" i] button[aria-disabled="true"],
[role="dialog"]:has(.attachment-editor-scroll) [class*="footer" i] button[class*="disabled" i] {
    pointer-events: auto !important;
    cursor: not-allowed !important;
}
[data-ae-no-pseudo]::before,
[data-ae-no-pseudo]::after { display: none !important; }
/* Tooltip: flat, borderless, with a centered arrow like the slider bubble */
.ae-tooltip {
    --ae-tip-bg: var(--background-base-low, #1b1b1e);
    --ae-tip-border: #55555d;
    position: relative !important;
    overflow: visible !important;
    background: var(--ae-tip-bg) !important;
    border: 0 !important;
    outline: 0 !important;
    /* hairline ring: a spread under 1px is anti-aliased, so it reads thinner than a real 1px border */
    box-shadow: 0 0 0 0.5px var(--ae-tip-border) !important;
}
.ae-tooltip [class*="pointer" i] { display: none !important; }
/* The arrow is two stacked triangles: a slightly larger one in the border color behind, and the
   fill color on top. The fill one also covers the bubble's ring where the arrow joins it, so the
   outline flows into the arrow without a line across its base. */
.ae-tooltip::before,
.ae-tooltip::after {
    content: "";
    position: absolute;
    top: 100%;
    left: 50%;
    transform: translateX(-50%);
    border: 5px solid transparent;
    border-top-color: var(--ae-tip-bg);
    border-bottom-width: 0;
}
.ae-tooltip::before {
    border-width: 5.8px 5.8px 0;
    border-top-color: var(--ae-tip-border);
}
/* Wrapper around the Auto Adjustments button: shows the blue selected ring like the tiles */
.ae-auto-wrap {
    border: 1px solid transparent;
    border-radius: 8px;
    transition: border-color 0.1s ease-out;
}
.ae-auto-wrap > button { width: 100%; justify-content: center; }
.ae-auto-wrap[data-selected="true"] { border-color: var(--brand-500, #5865f2); }
/* Picker tiles, same construction as Discord's font / effect picker */
.ae-tile {
    position: relative;
    display: block;
    width: 100%;
    aspect-ratio: 4 / 3;
    margin: 0;
    padding: 6px;
    box-sizing: border-box;
    background-color: var(--background-mod-faint, var(--bg-mod-faint, rgba(255, 255, 255, 0.04)));
    border: 1px solid var(--border-subtle, var(--border-faint, rgba(255, 255, 255, 0.08)));
    border-radius: 8px;
    color: var(--text-default, var(--text-normal, inherit));
    cursor: pointer;
    transition: border-color 0.1s ease-out;
}
.ae-tile[aria-pressed="true"] { border-color: var(--brand-500, #5865f2); }
.ae-tile:focus-visible { outline: 2px solid var(--focus-primary, var(--brand-500, #5865f2)); outline-offset: 2px; }
.ae-tile > canvas,
.ae-tile > .ae-tile-none {
    display: block;
    width: 100%;
    height: 100%;
    border-radius: 6px;
    object-fit: cover;
}
.ae-tile-none { display: flex !important; align-items: center; justify-content: center; color: var(--text-muted); }
/* Custom-color tile in the Mark-up popover. We paint the tile ourselves (bigger, rounder) and lay
   Discord's real ColorPicker over it, invisible and stretched to fill, so a click still opens its popout. */
.ae-color-tile {
    position: relative;
    flex: 0 0 80px;
    width: 80px;
    box-sizing: border-box;
    border-radius: 12px;
    overflow: hidden;
    transition: filter 0.1s ease-out;
}
.ae-color-tile:hover { filter: brightness(1.1); }
.ae-color-tile,
.ae-color-tile *,
.ae-color-tile *:focus,
.ae-color-tile *:focus-visible { outline: none !important; box-shadow: none !important; }
.ae-color-tile-icon { position: absolute; top: 7px; right: 7px; pointer-events: none; }
.ae-color-hit { position: absolute; inset: 0; opacity: 0; }
.ae-color-hit,
.ae-color-hit * {
    width: 100% !important;
    height: 100% !important;
    min-width: 0 !important;
    max-width: none !important;
    margin: 0 !important;
    padding: 0 !important;
    box-sizing: border-box !important;
    cursor: pointer !important;
}
/* Danger tool button (Clear all): only the bin itself turns Discord's danger red on hover, and only while enabled */
/* Open / close animation of the "Clear all" popup, like Discord's own modals: backdrop fades, card scales up from slightly smaller */
@keyframes ae-backdrop-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes ae-backdrop-out { from { opacity: 1; } to { opacity: 0; } }
@keyframes ae-card-in { from { opacity: 0; transform: scale(0.9); } to { opacity: 1; transform: scale(1); } }
@keyframes ae-card-out { from { opacity: 1; transform: scale(1); } to { opacity: 0; transform: scale(0.9); } }
/* Checkerboard behind translucent previews: two grays, dark pair in dark themes, light pair in light themes */
.ae-checker {
    --ae-chk-a: #54565d;
    --ae-chk-b: #34363b;
    background: repeating-conic-gradient(var(--ae-chk-a) 0% 25%, var(--ae-chk-b) 0% 50%) 0 0 / 8px 8px;
}
.theme-light .ae-checker { --ae-chk-a: #c4c8ce; --ae-chk-b: #e6e8eb; }
.ae-tool-danger[aria-disabled="false"]:hover { color: var(--status-danger, var(--text-danger, #f23f43)) !important; }
.attachment-editor-scroll::-webkit-scrollbar { width: 16px; height: 16px; }
.attachment-editor-scroll::-webkit-scrollbar-corner { background: transparent; }
.attachment-editor-scroll::-webkit-scrollbar-track {
    background-color: var(--scrollbar-auto-track, var(--scrollbar-thin-track, transparent));
    border: 4px solid transparent;
    background-clip: padding-box;
    border-radius: 8px;
}
.attachment-editor-scroll::-webkit-scrollbar-thumb {
    background-color: var(--scrollbar-auto-thumb, var(--scrollbar-thin-thumb));
    border: 4px solid transparent;
    background-clip: padding-box;
    border-radius: 8px;
    min-height: 40px;
}
`;

// MODEL INTEGRATION
const KEEP = "[data-ae-keep]"; 
function findDialog(from: HTMLElement): HTMLElement | null {
    const dialog = from.closest<HTMLElement>("[role=\"dialog\"], [aria-modal=\"true\"]");
    if (dialog) return dialog;
    // fallback: the highest ancestor that is still smaller than the screen
    let found: HTMLElement | null = null;
    for (let el = from.parentElement, i = 0; el && el !== document.body && i < 12; el = el.parentElement, i++) {
        const r = el.getBoundingClientRect();
        if (r.width < innerWidth * 0.98 && r.height < innerHeight * 0.98) found = el;
    }
    return found;
}

const setNow = (el: HTMLElement, prop: string, value: string) => el.style.setProperty(prop, value, "important");
function scrubSeparators(dialog: HTMLElement) {
    const dr = dialog.getBoundingClientRect();
    if (!dr.width) return;
    for (const el of [dialog, ...dialog.querySelectorAll("*")]) {
        if (!(el instanceof HTMLElement) || el.tagName === "STYLE" || el.closest(KEEP)) continue;
        const cs = getComputedStyle(el);
        if (cs.display === "none") continue;
        const r = el.getBoundingClientRect();
        const wide = el !== dialog && r.width >= dr.width * 0.5;

        if (wide && (el.matches("hr, [role=\"separator\"]") || (r.height <= 2 && !el.firstElementChild))) {
            setNow(el, "display", "none");
            continue;
        }
        if (wide) {
            if (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== "none") setNow(el, "border-top-width", "0");
            if (parseFloat(cs.borderBottomWidth) > 0 && cs.borderBottomStyle !== "none") setNow(el, "border-bottom-width", "0");
            if (cs.boxShadow !== "none" && r.height <= dr.height * 0.6) setNow(el, "box-shadow", "none");
        }
        for (const pseudo of ["::before", "::after"]) {
            const p = getComputedStyle(el, pseudo);
            if (p.content === "none" || p.content === "normal") continue;
            const floating = p.position === "absolute" || p.position === "fixed";
            if (floating && parseFloat(p.width) >= dr.width * 0.5 && parseFloat(p.height) <= 48) el.dataset.aeNoPseudo = "1";
        }
    }
}

const BOTTOM_GAP = 12;
function fitHeight(wrap: HTMLElement, dialog: HTMLElement | null) {
    wrap.style.maxHeight = "";
    const r = wrap.getBoundingClientRect();
    if (!r.width) return;
    const x = r.left + r.width / 2;
    const bottomVisible = () => {
        const b = wrap.getBoundingClientRect().bottom;
        if (b > innerHeight) return false;
        const y = b - 2;
        if (dialog) {
            const d = dialog.getBoundingClientRect();
            if (x < d.left || x > d.right || y < d.top || y > d.bottom) return false; // past the card
        }
        const hit = document.elementsFromPoint(x, y).find(el => !dialog || dialog.contains(el));
        return !!hit && wrap.contains(hit);
    };
    if (bottomVisible()) return;

    let lo = 120;
    let hi = Math.max(lo, Math.floor(Math.min(wrap.scrollHeight, innerHeight - r.top)));
    while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        wrap.style.maxHeight = `${mid}px`;
        if (bottomVisible()) lo = mid; else hi = mid - 1;
    }
    wrap.style.maxHeight = `${Math.max(120, lo - BOTTOM_GAP)}px`;
}
function makeCenterer(dialog: HTMLElement, content: HTMLElement) {
    let applied = 0;
    return {
        run() {
            const r = content.getBoundingClientRect();
            if (!r.width) return;
            const natural = r.left + r.width / 2 - applied;
            const target = document.documentElement.clientWidth / 2 - natural;
            const dx = Math.abs(target) < 1 ? 0 : Math.round(target);
            if (dx === applied) return;
            applied = dx;
            dialog.style.setProperty("translate", dx ? `${dx}px 0` : "none", "important");
        },
        reset() {
            dialog.style.removeProperty("translate");
        }
    };
}

type TabKey = typeof TABS[number]["key"];
function useSyncKey(value: number) {
    const emitted = useRef<number | null>(null);
    const key = useRef(0);
    if (emitted.current === null || Math.abs(value - emitted.current) > 1e-6) {
        key.current++;
        emitted.current = value;
    }
    return [key.current, (v: number) => { emitted.current = v; }] as const;
}

function Field({ title, desc, aside, children, style }: {
    title: string;
    desc?: string;
    aside?: React.ReactNode;
    children: React.ReactNode;
    style?: React.CSSProperties;
}) {
    return (
        <section style={{ minWidth: 0, ...style }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
                <Heading tag="h3" style={{ margin: 0 }}>{title}</Heading>
                {aside}
            </div>
            {desc
                ? <Paragraph style={{ color: "var(--text-muted)", margin: "4px 0 12px" }}>{desc}</Paragraph>
                : <div style={{ height: 12 }} />}
            {children}
        </section>
    );
}

function NumberField({ value, onCommit }: { value: number; onCommit: (n: number) => void; }) {
    const [draft, setDraft] = useState<string | null>(null);
    return (
        <TextInput
            inputMode="numeric"
            value={draft ?? String(value)}
            onChange={v => {
                const digits = v.replace(/\D/g, "").slice(0, 4);
                setDraft(digits);
                if (digits) onCommit(Number(digits));
            }}
            onBlur={() => setDraft(null)}
        />
    );
}

type AdjustKey = keyof Adjustments;
type SliderDef = { key: AdjustKey; label: string; desc: string; min?: number; };
const LIGHT_SLIDERS: SliderDef[] = [
    { key: "brightness", label: "Brightness", desc: "Make the image lighter or darker." },
    { key: "exposure", label: "Exposure", desc: "Amount of light captured." },
    { key: "contrast", label: "Contrast", desc: "Difference between light and dark." },
    { key: "highlights", label: "Highlights", desc: "Adjust the brightest areas." },
    { key: "shadows", label: "Shadows", desc: "Adjust the darkest areas." },
    { key: "vignette", label: "Vignette", desc: "Darken or lighten the edges." }
];

const COLOR_SLIDERS: SliderDef[] = [
    { key: "saturation", label: "Saturation", desc: "Intensity of the colors." },
    { key: "warmth", label: "Warmth", desc: "Cooler or warmer tones." },
    { key: "tint", label: "Tint", desc: "Shift between green and magenta." },
    { key: "sharpness", label: "Sharpness", desc: "Soften or sharpen edges and details." }
];

function AdjustSlider({ label, desc, value, min = -100, max = 100, onChange }: {
    label: string;
    desc: string;
    value: number;
    min?: number;
    max?: number;
    onChange: (v: number) => void;
}) {
    const [key, mark] = useSyncKey(value);
    const change = (v: number) => {
        const r = Math.round(v);
        mark(r);
        onChange(r);
    };
    return (
        <div onDoubleClick={() => onChange(0)}>
            <Field title={label} desc={desc}>
                <div>
                    <Slider
                        key={key}
                        initialValue={value}
                        minValue={min}
                        maxValue={max}
                        keyboardStep={1}
                        asValueChanges={change}
                        onValueChange={change}
                        onValueRender={v => String(Math.round(v))}
                    />
                </div>
            </Field>
        </div>
    );
}

function AdjustGroup({ title, items, adj, onChange }: {
    title: string;
    items: SliderDef[];
    adj: Adjustments;
    onChange: (key: AdjustKey, v: number) => void;
}) {
    return (
        <section>
            <Heading tag="h2" style={{ margin: "0 0 24px", fontSize: 24, lineHeight: "30px", fontWeight: 400, color: "var(--text-strong, var(--header-primary))" }}>{title}</Heading>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {items.map(i => (
                    <AdjustSlider key={i.key} label={i.label} desc={i.desc} min={i.min} value={adj[i.key]} onChange={v => onChange(i.key, v)} />
                ))}
            </div>
        </section>
    );
}
function Tip({ text, enabled = true, children }: {
    text: string;
    enabled?: boolean;
    children: (p: { ref: React.RefObject<any>; props: Record<string, any>; }) => React.ReactElement;
}) {
    const elRef = useRef<any>(null);
    const tipRef = useRef<{ show?: () => void; hide?: () => void; } | null>(null);
    const hoverRef = useRef(false);
    useEffect(() => {
        let timer = 0;
        let suppressed = false;
        const onScroll = (e: Event) => {
            const el = elRef.current as HTMLElement | null;
            const t = e.target;
            if (!el || !hoverRef.current || !(t instanceof Node) || !t.contains(el)) return;
            if (!suppressed) tipRef.current?.hide?.();
            suppressed = true;
            clearTimeout(timer);
            timer = window.setTimeout(() => {
                suppressed = false;
                if ((elRef.current as HTMLElement | null)?.matches(":hover")) tipRef.current?.show?.();
            }, 150);
        };
        window.addEventListener("scroll", onScroll, true);
        return () => {
            window.removeEventListener("scroll", onScroll, true);
            clearTimeout(timer);
        };
    }, []);
    if (!enabled) return children({ ref: elRef, props: {} });
    return (
        <Tooltip text={text} position="top" color={Tooltip.Colors?.PRIMARY} spacing={8} tooltipClassName="ae-tooltip">
            {(tooltipProps: any) => {
                tipRef.current = { show: () => tooltipProps.onMouseEnter?.(), hide: () => tooltipProps.onMouseLeave?.() };
                return children({
                    ref: elRef,
                    props: {
                        ...tooltipProps,
                        onMouseEnter: () => { hoverRef.current = true; tooltipProps.onMouseEnter?.(); },
                        onMouseLeave: () => { hoverRef.current = false; tooltipProps.onMouseLeave?.(); }
                    }
                });
            }}
        </Tooltip>
    );
}
function IconButton({ text, onClick, children }: { text: string; onClick: () => void; children: React.ReactNode; }) {
    return (
        <Tip text={text}>
            {({ ref, props }) => {
                const { "aria-label": _label, ...rest } = props;
                return (
                    <span ref={ref} {...rest} style={{ display: "inline-flex" }}>
                        <Button variant="secondary" size="iconOnly" aria-label={text} onClick={onClick}>
                            {children}
                        </Button>
                    </span>
                );
            }}
        </Tip>
    );
}
function FilterThumb({ src, filter, selected, onPick }: {
    src: HTMLCanvasElement | null;
    filter: Filter;
    selected: boolean;
    onPick: () => void;
}) {
    const ref = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const c = ref.current;
        if (!c || !src || filter.key === "none") return;
        c.width = src.width;
        c.height = src.height;
        c.getContext("2d")!.drawImage(src, 0, 0);
        applyFilter(c, filter);
    }, [src, filter]);
    return (
        <Tip text={filter.label}>
            {({ ref: btnRef, props }) => (
                <button
                    {...props}
                    ref={btnRef}
                    type="button"
                    className="ae-tile"
                    aria-label={filter.label}
                    aria-pressed={selected}
                    onClick={onPick}
                >
                    {filter.key === "none" ? (
                        <div className="ae-tile-none">
                            <svg width={36} height={36} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                                <circle cx="12" cy="12" r="9" /><path d="M5.6 5.6l12.8 12.8" />
                            </svg>
                        </div>
                    ) : (
                        <canvas ref={ref} />
                    )}
                </button>
            )}
        </Tip>
    );
}

// MARK-UP TAB
type MarkButtonId = "pen1" | "pen2" | "highlighter" | "erase";
type PopoverId = "pen1" | "pen2" | "highlighter";
type OpenId = PopoverId | "erase";
type EraserMode = "pixel" | "stroke";
interface EraserSettings { size: number; mode: EraserMode; }
interface PenSettings { color: string; size: number; style: MarkStyle; opacity: number; } // opacity 1..100
type PenSet = Record<PopoverId, PenSettings>;
const DISCORD_BLUE = "#5865F2";
const DISCORD_GRAY = "#80848E";
const PEN_COLORS = [
    "#1ABC9C", "#2ECC71", "#3498DB", "#9B59B6", "#E91E63", "#F1C40F", "#E67E22", "#E74C3C", "#FFFFFF", "#607D8B",
    "#11806A", "#1F8B4C", "#206694", "#71368A", "#AD1457", "#C27C0E", "#A84300", "#992D22", "#979C9F", "#000000"
];
const isLight = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) > 170;
};
const hexToInt = (hex: string) => parseInt(hex.slice(1), 16);
const intToHex = (v: number | null) =>
    v == null ? DISCORD_GRAY : "#" + (v === 0 ? 1 : v).toString(16).padStart(6, "0").toUpperCase();
const toolOf = (id: PopoverId): MarkTool => (id === "highlighter" ? "highlighter" : "pen");
const PEN_STYLES: { key: MarkStyle; label: string; }[] = [
    { key: "free", label: "Freehand line" },
    { key: "free-arrow", label: "Freehand arrow" },
    { key: "free-double", label: "Freehand double arrow" },
    { key: "line", label: "Straight line" },
    { key: "arrow", label: "Arrow" },
    { key: "double", label: "Double arrow" },
    { key: "rect", label: "Rectangle" },
    { key: "ellipse", label: "Ellipse" }
];
const HIGHLIGHTER_STYLES = PEN_STYLES.filter(s => s.key === "free" || s.key === "line");
const toolbarSvg = { ...svgProps, width: 24, height: 24 };
const StyleIcon = ({ style }: { style: MarkStyle; }) => {
    if (style === "rect") return <svg {...toolbarSvg}><rect width="20" height="12" x="2" y="6" rx="2" /></svg>;
    if (style === "ellipse") return <svg {...toolbarSvg}><ellipse cx="12" cy="12" rx="10" ry="6" /></svg>;
    const free = style.startsWith("free");
    const end = style === "arrow" || style === "free-arrow" || style === "double" || style === "free-double";
    const start = style === "double" || style === "free-double";
    return (
        <svg {...toolbarSvg}>
            {free ? <path d="M4 17C6 9 8 9 10 14S14 17 20 7" /> : <path d="M5 19 19 5" />}
            {end && (free ? <path d="M15.2 8.3 20 7l.4 5" /> : <path d="M12 5h7v7" />)}
            {start && (free ? <path d="M8 14.1 4 17l-2.2-4.5" /> : <path d="M12 19H5v-7" />)}
        </svg>
    );
};
const barHeight = (tool: MarkTool, size: number) => (tool === "highlighter" ? 1.5 + size * 0.5 : 0.8 + size * 0.45);
const ColorBar = ({ color, tool, size }: { color: string; tool: MarkTool; size: number; }) => {
    const h = barHeight(tool, size);
    return <rect x="4" y={21.6 - h / 2} width="16" height={h} rx={h / 2} fill={color} stroke="none" />;
};

const ArrowBadge = ({ style }: { style: MarkStyle; }) => {
    const single = style === "arrow" || style === "free-arrow";
    const double = style === "double" || style === "free-double";
    if (!single && !double) return null;
    return (
        <g strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" stroke="currentColor" fill="none">
            <path d={single ? "M1.8 4.2H10" : "M2 4.2H9.8"} />
            <path d="M7.4 1.8 10 4.2 7.4 6.6" transform={double ? "translate(-.2 0)" : undefined} />
            {double && <path d="M4.4 1.8 2 4.2l2.4 2.4" />}
        </g>
    );
};

const PENCIL_GLYPH = "m13.96 5.46 4.58 4.58a1 1 0 0 0 1.42 0l1.38-1.38a2 2 0 0 0 0-2.82l-3.18-3.18a2 2 0 0 0-2.82 0l-1.38 1.38a1 1 0 0 0 0 1.42ZM2.11 20.16l.73-4.22a3 3 0 0 1 .83-1.61l7.87-7.87a1 1 0 0 1 1.42 0l4.58 4.58a1 1 0 0 1 0 1.42l-7.87 7.87a3 3 0 0 1-1.6.83l-4.23.73a1.5 1.5 0 0 1-1.73-1.73Z"; // tight viewBox 2 2 20 20
const HIGHLIGHTER_GLYPH = "m396-564 200 200-212 212q-19 19-52.5 19T279-152l-11-11-43 43H70l120-120-4-4q-22-22-21.5-55.5T187-355l209-209Zm43-43 216-216q17-17 43-17t43 17l112 112q17 17 16.5 45.5T852-620L639-407 439-607Z"; // tight viewBox 70 -840 800 720
const ERASER_GLYPH = "M678-220h203v60H618l60-60Zm-499 60-81-84q-18-17-17.5-41.5T97-327l458-498q16-17 40.5-17t41.5 17l205 215q17 17 18 42t-16 42L503-160H179Z"; // tight viewBox
const BIN_GLYPH = "M14.25 1c.41 0 .75.34.75.75V3h5.25c.41 0 .75.34.75.75v.5c0 .41-.34.75-.75.75H3.75A.75.75 0 0 1 3 4.25v-.5c0-.41.34-.75.75-.75H9V1.75c0-.41.34-.75.75-.75h4.5ZM5.06 7a1 1 0 0 0-1 1.06l.76 12.13a3 3 0 0 0 3 2.81h8.36a3 3 0 0 0 3-2.81l.75-12.13a1 1 0 0 0-1-1.06H5.07ZM11 12a1 1 0 1 0-2 0v6a1 1 0 1 0 2 0v-6Zm3-1a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0v-6a1 1 0 0 1 1-1Z"; 
const Glyph = ({ d, viewBox, x, y, size }: { d: string; viewBox: string; x: number; y: number; size: number; }) => (
    <svg x={x} y={y} width={size} height={size} viewBox={viewBox}><path d={d} fillRule="evenodd" /></svg>
);

const PencilIcon = ({ color, size, style }: { color: string; size: number; style: MarkStyle; }) => {
    const h = barHeight("pen", size) * 0.9;
    return (
        <svg {...toolbarSvg} fill="currentColor" stroke="none">
            <Glyph d={PENCIL_GLYPH} viewBox="2 2 20 20" x={3} y={0.5} size={18} />
            <ArrowBadge style={style} />
            <rect x="3" y={22 - h / 2} width="18" height={h} rx={h / 2} fill={color} />
        </svg>
    );
};
const HighlighterIcon = ({ color, size }: { color: string; size: number; }) => (
    <svg {...toolbarSvg} fill="currentColor" stroke="none">
        <Glyph d={HIGHLIGHTER_GLYPH} viewBox="70 -840 800 720" x={3} y={0.5} size={18} />
        <ColorBar color={color} tool="highlighter" size={size} />
    </svg>
);
const MarkEraserIcon = () => (
    <svg {...toolbarSvg} fill="currentColor" stroke="none">
        <Glyph d={ERASER_GLYPH} viewBox="80 -842 801 682" x={3} y={3} size={19} />
    </svg>
);
const ClearAllIcon = () => (
    <svg {...toolbarSvg} fill="currentColor" stroke="none">
        <Glyph d={BIN_GLYPH} viewBox="3 1 18 22" x={2.5} y={2.5} size={19} />
    </svg>
);
function ToolButton({ text, selected, disabled, danger, size = 44, onClick, children }: {
    text: string;
    selected?: boolean;
    disabled?: boolean;
    danger?: boolean;
    size?: number;
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <Tip text={text} enabled={!disabled}>
            {({ ref, props }) => {
                const { "aria-label": _label, ...rest } = props;
                return (
                    <button
                        {...rest}
                        ref={ref}
                        type="button"
                        className={danger ? "ae-tool-danger" : undefined}
                        aria-label={text}
                        aria-pressed={!!selected}
                        aria-disabled={!!disabled}
                        onClick={() => { if (!disabled) onClick(); }}
                        style={{
                            width: size,
                            height: size,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            padding: 0,
                            border: "none",
                            borderRadius: 8,
                            background: selected ? "rgba(255, 255, 255, 0.1)" : "transparent",
                            color: selected ? "var(--text-strong, #fff)" : "var(--text-muted, #b5bac1)",
                            opacity: disabled ? 0.4 : 1,
                            cursor: disabled ? "default" : "pointer"
                        }}
                    >
                        {children}
                    </button>
                );
            }}
        </Tip>
    );
}
const EraserPreview = ({ size }: { size: number; }) => {
    const d = 8 + size * 7;
    return (
        <div className="ae-checker" style={{ position: "relative", flex: "none", width: 96, height: 60, borderRadius: 6, overflow: "hidden" }}>
            <div style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                width: d,
                height: d,
                transform: "translate(-50%, -50%)",
                boxSizing: "border-box",
                borderRadius: "50%",
                border: "2px solid #fff",
                boxShadow: "0 0 0 1px rgba(0, 0, 0, 0.55), inset 0 0 0 1px rgba(0, 0, 0, 0.55)"
            }} />
        </div>
    );
};

const SizePreview = ({ tool, color, size, opacity }: { tool: MarkTool; color: string; size: number; opacity: number; }) => {
    const h = tool === "highlighter" ? 3 + size * 2.5 : 1 + size * 2.2;
    const tip = 1.5;
    const r = h / 2;
    const outline = (inset: number) => {
        const rr = Math.max(0.1, r - inset);
        const t = Math.max(0, tip - inset * 2);
        const pts = [`0 calc(50% - ${t / 2}px)`];
        for (let i = 0; i <= 16; i++) {
            const a = (-90 + (180 * i) / 16) * (Math.PI / 180);
            pts.push(`calc(100% - ${r}px + ${(rr * Math.cos(a)).toFixed(2)}px) ${(r + rr * Math.sin(a)).toFixed(2)}px`);
        }
        pts.push(`0 calc(50% + ${t / 2}px)`);
        return `polygon(${pts.join(", ")})`;
    };
    return (
        <div style={{ height: 22, display: "flex", alignItems: "center" }}>
            <div style={{ position: "relative", width: "100%", height: h }}>
                <div className="ae-checker" style={{ position: "absolute", inset: 0, clipPath: outline(0.75) }} />
                <div style={{
                    position: "absolute",
                    inset: 0,
                    background: color,
                    clipPath: outline(0),
                    opacity: (tool === "highlighter" ? 0.6 : 1) * (opacity / 100)
                }} />
            </div>
        </div>
    );
};

function ClearConfirm({ onConfirm: confirm, onCancel: cancel }: { onConfirm: () => void; onCancel: () => void; }) {
    const [closing, setClosing] = useState(false);
    const finish = (fn: () => void) => {
        if (closing) return;
        setClosing(true);
        setTimeout(fn, 150);
    };
    const onCancel = () => finish(cancel);
    const onConfirm = () => finish(confirm);
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            e.preventDefault();
            e.stopPropagation();
            onCancel();
        };
        document.addEventListener("keydown", onKey, true);
        return () => document.removeEventListener("keydown", onKey, true);
    }, [closing]);

    const stop = (e: React.SyntheticEvent) => e.stopPropagation();
    const modalProps = { transitionState: 1, onClose: onCancel } as unknown as RenderModalProps;
    return ReactDOM.createPortal(
        <div
            data-ae-keep=""
            onPointerDown={stop}
            onMouseDown={stop}
            onClick={e => { e.stopPropagation(); if (e.target === e.currentTarget) onCancel(); }}
            style={{
                position: "fixed",
                inset: 0,
                zIndex: 10000,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "rgba(0, 0, 0, 0.7)",
                animation: `${closing ? "ae-backdrop-out" : "ae-backdrop-in"} ${closing ? 150 : 200}ms ease-out forwards`
            }}
        >
            <div style={{ animation: `${closing ? "ae-card-out" : "ae-card-in"} ${closing ? 150 : 250}ms cubic-bezier(0.2, 0.9, 0.3, 1.15) forwards` }}>
            <Modal
                {...modalProps}
                size="sm"
                title="Clear all Mark-ups"
                subtitle="Are you sure you want to erase all drawings? This action cannot be undone by pressing undo."
                actions={[
                    { text: "Cancel", variant: "secondary", onClick: onCancel },
                    { text: "Clear", variant: "critical-primary", onClick: onConfirm }
                ]}
            >
            </Modal>
            </div>
        </div>,
        document.body
    );
}

function MarkupBar({ active, open, pens, eraser, hasMarks, onButton, onPens, onEraser, onClear, onClose }: {
    active: MarkButtonId;
    open: OpenId | null;
    pens: PenSet;
    eraser: EraserSettings;
    onEraser: (patch: Partial<EraserSettings>) => void;
    hasMarks: boolean;
    onButton: (id: MarkButtonId) => void;
    onPens: (id: PopoverId, patch: Partial<PenSettings>) => void;
    onClear: () => void;
    onClose: () => void;
}) {
    const wrapRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!open) return;
        const down = (e: PointerEvent) => {
            const t = e.target;
            const wrap = wrapRef.current;
            if (!wrap || !(t instanceof Node) || wrap.contains(t)) return;
            const dialog = findDialog(wrap);
            if (dialog && !dialog.contains(t) && t instanceof HTMLElement) {
                const r = t.getBoundingClientRect();
                if (r.width < innerWidth * 0.9 || r.height < innerHeight * 0.9) return;
            }
            onClose();
        };
        document.addEventListener("pointerdown", down, true);
        return () => document.removeEventListener("pointerdown", down, true);
    }, [open, onClose]);

    const pop = open === "erase" ? null : open;
    const tool = pop ? toolOf(pop) : null;
    const cfg = pop ? pens[pop] : null;
    const styles = tool === "highlighter" ? HIGHLIGHTER_STYLES : PEN_STYLES;

    return (
        <div ref={wrapRef} data-ae-keep="" style={{ position: "relative", display: "flex", justifyContent: "center", flexShrink: 0 }}>
            {open && cfg && tool && (
                <div style={{
                    position: "absolute",
                    bottom: "calc(100% + 12px)",
                    left: "50%",
                    transform: "translateX(-50%)",
                    width: 444,
                    boxSizing: "border-box",
                    padding: 16,
                    borderRadius: 8,
                    background: "var(--background-base-low, #1b1b1e)",
                    boxShadow: "0 8px 24px rgba(0, 0, 0, 0.5), 0 0 0 0.5px #55555d",
                    zIndex: 5
                }}>
                    <SizePreview tool={tool} color={cfg.color} size={cfg.size} opacity={cfg.opacity} />

                    <div style={{ margin: "10px 0 14px", padding: "0 8px" }}>
                        <Slider
                            key={open}
                            initialValue={cfg.size}
                            minValue={MARK_MIN_SIZE}
                            maxValue={MARK_MAX_SIZE}
                            markers={[1, 2, 3, 4, 5, 6]}
                            stickToMarkers={false}
                            keyboardStep={0.1}
                            onMarkerRender={m => <span>{m}</span>}
                            onValueRender={v => String(Math.round(v * 10) / 10)}
                            asValueChanges={v => onPens(pop!, { size: v })}
                            onValueChange={v => onPens(pop!, { size: v })}
                        />
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "0 0 14px" }}>
                        <Paragraph style={{ color: "var(--text-muted)", width: 52, flexShrink: 0 }}>Opacity</Paragraph>
                        <div style={{ flex: 1, padding: "0 8px" }}>
                            <Slider
                                key={`${open}-opacity`}
                                mini
                                initialValue={cfg.opacity}
                                minValue={1}
                                maxValue={100}
                                keyboardStep={1}
                                onValueRender={v => `${Math.round(v)}%`}
                                asValueChanges={v => onPens(pop!, { opacity: Math.round(v) })}
                                onValueChange={v => onPens(pop!, { opacity: Math.round(v) })}
                            />
                        </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "stretch", gap: 12 }}>
                        <Tip text="Custom Color">
                            {({ ref, props }) => {
                                const { "aria-label": _label, ...rest } = props;
                                return (
                                    <div
                                        {...rest}
                                        ref={ref}
                                        className="ae-color-tile"
                                        style={{ minHeight: 56, background: cfg.color, color: isLight(cfg.color) ? "#000" : "#fff" }}
                                    >
                                        <svg className="ae-color-tile-icon" width={15} height={15} viewBox="2 2 20 20" fill="currentColor" aria-hidden="true">
                                            <path d={PENCIL_GLYPH} />
                                        </svg>
                                        <div className="ae-color-hit">
                                            <ColorPicker
                                                color={hexToInt(cfg.color)}
                                                showEyeDropper={false}
                                                onChange={(v: number | null) => onPens(pop!, { color: intToHex(v) })}
                                            />
                                        </div>
                                    </div>
                                );
                            }}
                        </Tip>

                        <div style={{ display: "grid", gridTemplateColumns: "repeat(10, 24px)", gap: 8, alignContent: "center" }}>
                            {PEN_COLORS.map(c => {
                                const selected = cfg.color.toLowerCase() === c.toLowerCase();
                                return (
                                    <button
                                        key={c}
                                        type="button"
                                        aria-label={c}
                                        aria-pressed={selected}
                                        onClick={() => onPens(pop!, { color: c })}
                                        style={{
                                            width: 24,
                                            height: 24,
                                            padding: 0,
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            borderRadius: "50%",
                                            background: c,
                                            border: "none",
                                            boxSizing: "border-box",
                                            color: isLight(c) ? "#000" : "#fff",
                                            cursor: "pointer"
                                        }}
                                    >
                                        {selected && (
                                            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div style={{ height: 1, background: "rgba(255, 255, 255, 0.12)", margin: "14px 0 10px" }} />

                    <div style={{ display: "flex", justifyContent: "center", gap: 8 }}>
                        {styles.map(s => (
                            <ToolButton key={s.key} text={s.label} size={40} selected={cfg.style === s.key} onClick={() => onPens(pop!, { style: s.key })}>
                                <StyleIcon style={s.key} />
                            </ToolButton>
                        ))}
                    </div>
                </div>
            )}

            {open === "erase" && (
                <div style={{
                    position: "absolute",
                    bottom: "calc(100% + 12px)",
                    left: "50%",
                    transform: "translateX(-50%)",
                    width: 444,
                    boxSizing: "border-box",
                    padding: 16,
                    borderRadius: 8,
                    background: "var(--background-base-low, #1b1b1e)",
                    boxShadow: "0 8px 24px rgba(0, 0, 0, 0.5), 0 0 0 0.5px #55555d",
                    zIndex: 5
                }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "0 4px" }}>
                        <div style={{ flex: 1, minWidth: 0, padding: "0 8px" }}>
                            <Slider
                                key="erase-size"
                                initialValue={eraser.size}
                                minValue={MARK_MIN_SIZE}
                                maxValue={MARK_MAX_SIZE}
                                markers={[1, 2, 3, 4, 5, 6]}
                                stickToMarkers={false}
                                keyboardStep={0.1}
                                onMarkerRender={m => <span>{m}</span>}
                                onValueRender={v => String(Math.round(v * 10) / 10)}
                                asValueChanges={v => onEraser({ size: v })}
                                onValueChange={v => onEraser({ size: v })}
                            />
                        </div>
                        <EraserPreview size={eraser.size} />
                    </div>

                    <div style={{ height: 1, background: "rgba(255, 255, 255, 0.12)", margin: "14px 0 12px" }} />

                    <div style={{ display: "flex", gap: 8 }}>
                        {([
                            { id: "pixel", label: "Erase pixel" },
                            { id: "stroke", label: "Erase stroke" }
                        ] as const).map(o => {
                            const selected = eraser.mode === o.id;
                            return (
                                <button
                                    key={o.id}
                                    type="button"
                                    aria-pressed={selected}
                                    onClick={() => onEraser({ mode: o.id })}
                                    style={{
                                        flex: 1,
                                        height: 36,
                                        padding: 0,
                                        border: "none",
                                        borderRadius: 8,
                                        font: "inherit",
                                        fontWeight: 500,
                                        background: selected ? "rgba(255, 255, 255, 0.1)" : "transparent",
                                        color: selected ? "var(--text-strong, #fff)" : "var(--text-muted, #b5bac1)",
                                        cursor: "pointer"
                                    }}
                                >
                                    {o.label}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            <div style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: 8,
                borderRadius: 10,
                background: "var(--background-base-low, #1b1b1e)"
            }}>
                <ToolButton text="Pen" selected={active === "pen1"} onClick={() => onButton("pen1")}><PencilIcon color={pens.pen1.color} size={pens.pen1.size} style={pens.pen1.style} /></ToolButton>
                <ToolButton text="Pen" selected={active === "pen2"} onClick={() => onButton("pen2")}><PencilIcon color={pens.pen2.color} size={pens.pen2.size} style={pens.pen2.style} /></ToolButton>
                <ToolButton text="Highlighter" selected={active === "highlighter"} onClick={() => onButton("highlighter")}><HighlighterIcon color={pens.highlighter.color} size={pens.highlighter.size} /></ToolButton>
                <ToolButton text="Eraser" selected={active === "erase"} onClick={() => onButton("erase")}><MarkEraserIcon /></ToolButton>
                <ToolButton text="Clear all mark-up" danger disabled={!hasMarks} onClick={onClear}><ClearAllIcon /></ToolButton>
            </div>
        </div>
    );
}
interface Cut {
    from: HTMLImageElement | null;
    q: number;
    fh: boolean;
    fv: boolean;
}

interface Snap {
    st: EditState;
    adj: Adjustments;
    filter: string;
    autoAdj: AutoParams | null;
    intensity: number;
    strokes: Stroke[];
    src: HTMLImageElement | null; 
    bg: string;
    bgColor: string;
    blur: number;
    cut: Cut | null;
}

const shallowEq = (a: object, b: object) => {
    if (a === b) return true;
    const ka = Object.keys(a) as (keyof typeof a)[];
    return ka.length === Object.keys(b).length && ka.every(k => a[k] === b[k]);
};
const sameSnap = (a: Snap, b: Snap) =>
    shallowEq(a.st, b.st) && shallowEq(a.adj, b.adj) && a.filter === b.filter &&
    a.autoAdj === b.autoAdj && a.intensity === b.intensity && a.strokes === b.strokes && a.src === b.src &&
    a.bg === b.bg && a.bgColor === b.bgColor && a.blur === b.blur && a.cut === b.cut;

const HISTORY_LIMIT = 100;
function withStrokes(c: HTMLCanvasElement, list: Stroke[]) {
    if (!list.length) return c;
    const out = document.createElement("canvas");
    out.width = c.width;
    out.height = c.height;
    const o = out.getContext("2d")!;
    o.drawImage(c, 0, 0);
    drawStrokes(o, list, out.width);
    return out;
}
function strokeLayer(list: Stroke[], w: number, h: number) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    drawStrokes(c.getContext("2d")!, list, w);
    return c;
}

// ERASE TAB PIECES
function RadioGroup<T extends string>({ value, options, onChange, disabled, label }: {
    value: T;
    options: { id: T; label: string; desc: string; disabled?: boolean; }[];
    onChange: (id: T) => void;
    disabled?: boolean;
    label: string;
}) {
    const refs = useRef<(HTMLDivElement | null)[]>([]);
    const [focusVisible, setFocusVisible] = useState<T | null>(null);
    const selIdx = Math.max(0, options.findIndex(o => o.id === value));
    const move = (to: number, dir: 1 | -1) => {
        let i = (to + options.length) % options.length;
        for (let n = 0; n < options.length && options[i].disabled; n++) i = (i + dir + options.length) % options.length;
        if (options[i].disabled) return;
        onChange(options[i].id);
        refs.current[i]?.focus();
    };
    const onKeyDown = (e: React.KeyboardEvent, i: number) => {
        if (disabled) return;
        switch (e.key) {
            case "ArrowDown": case "ArrowRight": e.preventDefault(); move(i + 1, 1); break;
            case "ArrowUp": case "ArrowLeft": e.preventDefault(); move(i - 1, -1); break;
            case " ": case "Enter": e.preventDefault(); if (!options[i].disabled) onChange(options[i].id); break;
        }
    };
    const brand = "var(--brand-500, var(--brand-experiment, #5865f2))";
    return (
        <div role="radiogroup" aria-label={label} aria-disabled={disabled} style={{ display: "flex", flexDirection: "column", gap: 10, opacity: disabled ? 0.5 : 1 }}>
            <Heading tag="h3" style={{ margin: "0 0 -2px" }}>{label}</Heading>
            {options.map((o, i) => {
                const checked = o.id === value;
                const off = disabled || !!o.disabled;
                return (
                    <div
                        key={o.id}
                        ref={el => { refs.current[i] = el; }}
                        role="radio"
                        aria-checked={checked}
                        aria-disabled={off}
                        tabIndex={off ? -1 : i === selIdx ? 0 : -1}
                        onClick={() => !off && onChange(o.id)}
                        onKeyDown={e => onKeyDown(e, i)}
                        onFocus={e => { if (e.currentTarget.matches(":focus-visible")) setFocusVisible(o.id); }}
                        onBlur={() => setFocusVisible(null)}
                        style={{
                            display: "flex",
                            alignItems: "flex-start",
                            gap: 10,
                            borderRadius: 4,
                            cursor: off ? "not-allowed" : "pointer",
                            opacity: o.disabled && !disabled ? 0.4 : 1,
                            userSelect: "none",
                            outline: focusVisible === o.id ? "2px solid var(--focus-primary, #00a8fc)" : "none",
                            outlineOffset: 4
                        }}
                    >
                        <svg width={20} height={20} viewBox="0 0 24 24" aria-hidden="true" style={{ flexShrink: 0, marginTop: 0 }}>
                            {checked ? (
                                <>
                                    <circle cx="12" cy="12" r="11" fill={brand} />
                                    <circle cx="12" cy="12" r="4.5" fill="#fff" />
                                </>
                            ) : (
                                <circle cx="12" cy="12" r="10" fill="none" stroke="var(--interactive-icon-default, var(--interactive-normal))" strokeWidth={2} />
                            )}
                        </svg>
                        <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                            <span style={{ fontSize: 16, lineHeight: "20px", fontWeight: 500, color: "var(--text-strong, var(--header-primary))" }}>{o.label}</span>
                            <span style={{ fontSize: 14, lineHeight: "18px", marginTop: 2, color: "var(--text-muted)" }}>{o.desc}</span>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

// ENGINE LOADER
const LD_TOP = [246, 247, 249];
const LD_BOTTOM = [118, 121, 130];
function polar(r: (t: number) => number, n: number) {
    let d = "";
    for (let i = 0; i < n; i++) {
        const t = (i / n) * Math.PI * 2;
        d += `${i ? "L" : "M"}${(50 + Math.cos(t) * r(t)).toFixed(2)} ${(50 + Math.sin(t) * r(t)).toFixed(2)}`;
    }
    return d + "Z";
}
const LD_SHAPES = [
    { d: polar(t => 42 / Math.pow(Math.pow(Math.abs(Math.cos(t)), 5) + Math.pow(Math.abs(Math.sin(t)), 5), 1 / 5), 160), w: 0, anim: "ae-ld-a", slabs: 3, sub: 4, depth: 0.5 }, // rounded square
    { d: "M50 17L86 80H14Z", w: 14, anim: "ae-ld-b", slabs: 1, sub: 12, depth: 0.3 }, // rounded triangle
    { d: polar(t => 37 * (1 + 0.13 * Math.cos(7 * t)), 160), w: 0, anim: "ae-ld-c", slabs: 1, sub: 14, depth: 0.34 }, // 7-lobed flower
    { d: polar(t => 38 / Math.pow(Math.pow(Math.abs(Math.cos(t)), 2 / 3) + Math.pow(Math.abs(Math.sin(t)), 2 / 3), 1.5), 240), w: 9, anim: "ae-ld-d", slabs: 1, sub: 14, depth: 0.34 } // four-point star
];
const LOADER_CSS = `
@keyframes ae-ld-a { 0%, 3% { transform: rotateX(0deg) rotateY(0deg) rotateZ(-10deg); } 12% { transform: rotateX(70deg) rotateY(0deg) rotateZ(0deg); } 35% { transform: rotateX(66deg) rotateY(0deg) rotateZ(0deg); } 55% { transform: rotateX(80deg) rotateY(0deg) rotateZ(0deg); } 75% { transform: rotateX(68deg) rotateY(0deg) rotateZ(0deg); } 88% { transform: rotateX(70deg) rotateY(0deg) rotateZ(0deg); } 100% { transform: rotateX(0deg) rotateY(0deg) rotateZ(-10deg); } }
@keyframes ae-ld-b { 0%, 3% { transform: rotateX(0deg) rotateY(0deg) rotateZ(0deg); } 12% { transform: rotateX(30deg) rotateY(-20deg) rotateZ(4deg); } 30% { transform: rotateX(34deg) rotateY(34deg) rotateZ(18deg); } 48% { transform: rotateX(42deg) rotateY(-32deg) rotateZ(-14deg); } 66% { transform: rotateX(24deg) rotateY(30deg) rotateZ(14deg); } 82% { transform: rotateX(34deg) rotateY(-14deg) rotateZ(-4deg); } 100% { transform: rotateX(0deg) rotateY(0deg) rotateZ(0deg); } }
@keyframes ae-ld-c { 0%, 3% { transform: rotateX(0deg) rotateY(0deg) rotateZ(0deg); } 12% { transform: rotateX(0deg) rotateY(-52deg) rotateZ(0deg); } 45% { transform: rotateX(4deg) rotateY(-56deg) rotateZ(0deg); } 75% { transform: rotateX(-3deg) rotateY(-50deg) rotateZ(0deg); } 88% { transform: rotateX(0deg) rotateY(-52deg) rotateZ(0deg); } 100% { transform: rotateX(0deg) rotateY(0deg) rotateZ(0deg); } }
@keyframes ae-ld-d { 0%, 3% { transform: rotateX(0deg) rotateY(0deg) rotateZ(0deg); } 12% { transform: rotateX(76deg) rotateY(4deg) rotateZ(0deg); } 40% { transform: rotateX(72deg) rotateY(6deg) rotateZ(0deg); } 60% { transform: rotateX(82deg) rotateY(2deg) rotateZ(0deg); } 80% { transform: rotateX(74deg) rotateY(6deg) rotateZ(0deg); } 88% { transform: rotateX(76deg) rotateY(4deg) rotateZ(0deg); } 100% { transform: rotateX(0deg) rotateY(0deg) rotateZ(0deg); } }
`;
function EngineLoader({ size = 56 }: { size?: number; }) {
    const cell = size / 2;
    return (
        <div aria-hidden="true" style={{ width: size, height: size, display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", perspective: size * 6 }}>
            {LD_SHAPES.map((sh, i) => {
                // z positions: `slabs` groups of `sub` closely packed layers, with a gap between groups
                const zs: number[] = [];
                const slabH = (cell * sh.depth) / (sh.slabs * 1.6);
                for (let g = 0; g < sh.slabs; g++) {
                    for (let k = 0; k < sh.sub; k++) zs.push((g - (sh.slabs - 1) / 2) * slabH * 1.6 + (k / (sh.sub - 1) - 0.5) * slabH);
                }
                return (
                    <div
                        key={i}
                        style={{ position: "relative", transformStyle: "preserve-3d", animation: `${sh.anim} 3.6s cubic-bezier(0.65, 0, 0.35, 1) infinite` }}
                    >
                        {zs.map((z, k) => {
                            const t = k / (zs.length - 1);
                            const col = `rgb(${LD_TOP.map((v, j) => Math.round(LD_BOTTOM[j] + (v - LD_BOTTOM[j]) * t)).join(",")})`;
                            return (
                                <svg
                                    key={k}
                                    viewBox="0 0 100 100"
                                    style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%", overflow: "visible", transform: `translateZ(${z}px)` }}
                                >
                                    <path d={sh.d} fill={col} stroke={sh.w ? col : "none"} strokeWidth={sh.w} strokeLinejoin="round" />
                                </svg>
                            );
                        })}
                    </div>
                );
            })}
        </div>
    );
}
function EngineOverlay({ bar }: { bar: number | null; }) {
    return (
        <div style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
            background: "rgba(0, 0, 0, 0.35)",
            pointerEvents: "none"
        }}>
            <style>{LOADER_CSS}</style>
            <EngineLoader size={56} />
            {bar !== null && (
                <>
                    <div style={{ width: 200, height: 6, borderRadius: 3, background: "rgba(255, 255, 255, 0.22)", overflow: "hidden" }}>
                        <div style={{ width: `${Math.max(3, Math.min(100, bar))}%`, height: "100%", borderRadius: 3, background: "#f6f7f9", transition: "width 0.6s ease-out" }} />
                    </div>
                    <Paragraph style={{ color: "#fff", fontWeight: 600, margin: 0 }}>Starting the engine...</Paragraph>
                </>
            )}
        </div>
    );
}

// BACKGROUND TAB PIECES
const TILE_GRID: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 };
function BgTile({ label, selected, disabled, onPick, children }: {
    label: string;
    selected: boolean;
    disabled?: boolean;
    onPick: () => void;
    children: React.ReactNode;
}) {
    return (
        <Tip text={label}>
            {({ ref, props }) => (
                <button
                    {...props}
                    ref={ref}
                    type="button"
                    className="ae-tile"
                    aria-label={label}
                    aria-pressed={selected}
                    disabled={disabled}
                    onClick={onPick}
                    style={disabled ? { opacity: 0.55, cursor: "progress" } : undefined}
                >
                    {children}
                </button>
            )}
        </Tip>
    );
}

function BgThumb({ paint }: { paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void; }) {
    const ref = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
        const c = ref.current;
        if (!c) return;
        const ctx = c.getContext("2d")!;
        ctx.clearRect(0, 0, c.width, c.height);
        paint(ctx, c.width, c.height);
    }, [paint]);
    return <canvas ref={ref} width={160} height={120} />;
}

function CutThumb({ src }: { src: HTMLCanvasElement | null; }) {
    const ref = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
        const c = ref.current;
        if (!c) return;
        const ctx = c.getContext("2d")!;
        drawChecker(ctx, 0, 0, c.width, c.height, 8);
        if (!src) return;
        const k = Math.min(c.width / src.width, c.height / src.height);
        const w = src.width * k;
        const h = src.height * k;
        ctx.drawImage(src, (c.width - w) / 2, (c.height - h) / 2, w, h);
    }, [src]);
    return <canvas ref={ref} width={160} height={120} />;
}

function BlurThumb({ src, back }: { src: HTMLCanvasElement | null; back: HTMLCanvasElement | null; }) {
    const ref = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
        const c = ref.current;
        if (!c) return;
        const ctx = c.getContext("2d")!;
        ctx.clearRect(0, 0, c.width, c.height);
        const wide = back ?? src;
        if (!wide) return;
        const k = Math.max(c.width / wide.width, c.height / wide.height) * 1.2; // a little larger so the blur does not fade at the border
        ctx.save();
        ctx.filter = "blur(5px)";
        ctx.drawImage(wide, (c.width - wide.width * k) / 2, (c.height - wide.height * k) / 2, wide.width * k, wide.height * k);
        ctx.restore();
        if (back && src) {
            const f = Math.min(c.width / src.width, c.height / src.height);
            ctx.drawImage(src, (c.width - src.width * f) / 2, (c.height - src.height * f) / 2, src.width * f, src.height * f);
        }
    }, [src, back]);
    return <canvas ref={ref} width={160} height={120} />;
}

function BackgroundPanel({ bg, bgColor, cut, busy, error, thumb, thumbBack, onNone, onTransparent, onPick, onColor }: {
    bg: string;
    bgColor: string;
    cut: boolean;
    busy: boolean;
    error: string | null;
    thumb: HTMLCanvasElement | null;
    thumbBack: HTMLCanvasElement | null;
    onNone: () => void;
    onTransparent: () => void;
    onPick: (key: string) => void;
    onColor: (hex: string) => void;
}) {
    return (
        <>
            <Field title="Color and Transparent">
                <div style={TILE_GRID}>
                    <BgTile label="None" selected={bg === "none" && !cut} disabled={busy} onPick={onNone}>
                        <div className="ae-tile-none">
                            <svg width={36} height={36} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                                <circle cx="12" cy="12" r="9" /><path d="M5.6 5.6l12.8 12.8" />
                            </svg>
                        </div>
                    </BgTile>
                    <BgTile label="Remove background" selected={bg === "none" && cut} disabled={busy} onPick={onTransparent}>
                        <CutThumb src={thumb} />
                    </BgTile>
                    <Tip text="Color">
                        {({ ref, props }) => {
                            const { "aria-label": _label, ...rest } = props;
                            return (
                                <div
                                    {...rest}
                                    ref={ref}
                                    className="ae-tile"
                                    aria-pressed={bg === "color"}
                                    style={{ opacity: busy ? 0.55 : 1, pointerEvents: busy ? "none" : undefined }}
                                >
                                    <div style={{ width: "100%", height: "100%", borderRadius: 6, background: bgColor }} />
                                    <svg className="ae-color-tile-icon" width={15} height={15} viewBox="2 2 20 20" fill="currentColor" aria-hidden="true" style={{ color: isLight(bgColor) ? "#000" : "#fff" }}>
                                        <path d={PENCIL_GLYPH} />
                                    </svg>
                                    <div className="ae-color-hit">
                                        <ColorPicker
                                            color={hexToInt(bgColor)}
                                            showEyeDropper={false}
                                            onChange={(v: number | null) => onColor(intToHex(v))}
                                        />
                                    </div>
                                </div>
                            );
                        }}
                    </Tip>
                    <BgTile label="Blur" selected={bg === "blur"} disabled={busy} onPick={() => onPick("blur")}>
                        <BlurThumb src={thumb} back={thumbBack} />
                    </BgTile>
                </div>
                {error && <Paragraph style={{ color: "var(--text-danger)", margin: "12px 0 0" }}>{error}</Paragraph>}
            </Field>
            {BACKGROUND_GROUPS.map(g => (
                <Field key={g.title} title={g.title}>
                    <div style={TILE_GRID}>
                        {g.items.map(b => (
                            <BgTile key={b.key} label={b.label} selected={bg === b.key} disabled={busy} onPick={() => onPick(b.key)}>
                                <BgThumb paint={b.paint} />
                            </BgTile>
                        ))}
                    </div>
                </Field>
            ))}
        </>
    );
}

export function EditorModal({ modalProps, file, onSave }: Props) {
    const [img, setImg] = useState<HTMLImageElement | null>(null);
    const [eraseSrc, setEraseSrc] = useState<HTMLImageElement | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [tab, setTab] = useState<TabKey>("crop");
    const [adj, setAdj] = useState<Adjustments>(NO_ADJUSTMENTS);
    const [filter, setFilter] = useState("none");
    const [autoAdj, setAutoAdj] = useState<AutoParams | null>(null);
    const [intensity, setIntensity] = useState(100);
    const [bg, setBg] = useState("none");
    const [bgColor, setBgColor] = useState("#5865F2");
    const [blurAmount, setBlurAmount] = useState(50);
    const [cut, setCut] = useState<Cut | null>(null);
    const [bgBusy, setBgBusy] = useState(false);
    const [bgError, setBgError] = useState<string | null>(null);
    const [intensityKey, markIntensity] = useSyncKey(intensity);
    const [blurKey, markBlur] = useSyncKey(blurAmount);
    const previewRef = useRef<HTMLCanvasElement>(null);
    const autoCache = useRef<{ base: HTMLCanvasElement; st: EditState; auto: AutoParams; canvas: HTMLCanvasElement; } | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const syncRef = useRef<(() => void) | null>(null);
    const [st, setSt] = useState<EditState>(INITIAL_STATE);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const layoutRef = useRef<StageLayout | null>(null);
    const dragRef = useRef<{ mode: Handle | "move"; x: number; y: number; start: EditState; } | null>(null);
    const [lock, setLockState] = useState<StageLock | null>(null);
    const lockRef = useRef<StageLock | null>(null);
    const stRef = useRef<EditState>(INITIAL_STATE);
    const animRef = useRef(0);
    const [stage, setStage] = useState({ w: STAGE_W, h: STAGE_H });
    const stageRef = useRef(stage);
    const stageBoxRef = useRef<HTMLDivElement>(null);
    const setLock = (l: StageLock | null) => { lockRef.current = l; setLockState(l); };
    stRef.current = st;
    stageRef.current = stage;
    useEffect(() => () => cancelAnimationFrame(animRef.current), []);
    useEffect(() => {
        const box = stageBoxRef.current;
        if (!box) return;
        const measure = () => {
            const w = Math.floor(box.clientWidth);
            if (w < 200) return; // the tab is hidden
            const h = Math.min(Math.round(w * 0.9), Math.min(CROP_MAX_H, Math.max(CROP_MIN_H, innerHeight - CROP_CHROME)));
            setStage(s => (s.w === w && s.h === h ? s : { w, h }));
        };
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(box);
        window.addEventListener("resize", measure);
        return () => {
            ro.disconnect();
            window.removeEventListener("resize", measure);
        };
    }, []);
    const [zoomKey, markZoom] = useSyncKey(st.zoom);
    const [angleKey, markAngle] = useSyncKey(st.angle);
    const [strokes, setStrokes] = useState<Stroke[]>([]);
    const [draft, setDraft] = useState<Stroke | null>(null);
    const [markTool, setMarkTool] = useState<MarkTool | "eraser">("pen");
    const [markButton, setMarkButton] = useState<MarkButtonId>("pen1");
    const [popover, setPopover] = useState<OpenId | null>(null);
    const [eraser, setEraser] = useState<EraserSettings>({ size: 3, mode: "pixel" });
    const [pens, setPens] = useState<PenSet>({
        pen1: { color: DISCORD_BLUE, size: 3, style: "free", opacity: 100 },
        pen2: { color: DISCORD_GRAY, size: 3, style: "free", opacity: 100 },
        highlighter: { color: "#FFD83A", size: 3, style: "free", opacity: 100 }
    });
    const [markBoxW, setMarkBoxW] = useState(0);
    const [winH, setWinH] = useState(innerHeight);
    const markBoxRef = useRef<HTMLDivElement>(null);
    const markCanvasRef = useRef<HTMLCanvasElement>(null);
    const draftRef = useRef<Stroke | null>(null);
    const markDrag = useRef<"draw" | "erase" | null>(null);
    const [eraseAuto, setEraseAuto] = useState(true);
    const [eraseAdd, setEraseAdd] = useState(true);
    const [eraseSize, setEraseSize] = useState(60);
    const [maskStrokes, setMaskStrokes] = useState<MaskStroke[]>([]);
    const [maskDraft, setMaskDraft] = useState<MaskStroke | null>(null);
    const [eraseBusy, setEraseBusy] = useState(false);
    const [eraseError, setEraseError] = useState<string | null>(null);
    const eraseCanvasRef = useRef<HTMLCanvasElement>(null);
    const eraseDrag = useRef<MaskStroke | null>(null);
    const eraseLayoutRef = useRef({ ox: 0, oy: 0, dw: 1, dh: 1 });
    useEffect(() => {
        const onResize = () => setWinH(innerHeight);
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, []);

    useEffect(() => {
        const box = markBoxRef.current;
        if (!box) return;
        const measure = () => {
            const w = Math.floor(box.clientWidth);
            if (w < 200) return; // the tab is hidden
            setMarkBoxW(m => (m === w ? m : w));
        };
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(box);
        window.addEventListener("resize", measure);
        return () => {
            ro.disconnect();
            window.removeEventListener("resize", measure);
        };
    }, []);

    useEffect(() => {
        const wrap = scrollRef.current;
        if (!wrap) return;
        const dialog = findDialog(wrap);
        const silenced: [HTMLElement, string][] = [];
        const centerer = dialog ? makeCenterer(dialog, wrap) : null;
        for (let el = wrap.parentElement; el && el !== dialog && el !== document.body; el = el.parentElement) {
            const o = getComputedStyle(el).overflowY;
            if (o === "auto" || o === "scroll" || o === "overlay") {
                silenced.push([el, el.style.overflowY]);
                el.style.overflowY = "hidden";
            }
        }

        const sync = () => {
            const top = wrap.scrollTop; 
            if (dialog) scrubSeparators(dialog);
            centerer?.run();
            fitHeight(wrap, dialog);
            wrap.scrollTop = top;
        };
        syncRef.current = sync;
        sync();

        let raf = 0;
        const later = () => {
            cancelAnimationFrame(raf);
            raf = requestAnimationFrame(sync);
        };
        const timers = [120, 350, 800].map(ms => setTimeout(sync, ms));
        const ro = new ResizeObserver(later);
        const mo = new MutationObserver(muts => {
            if (!muts.every(m => wrap.contains(m.target))) later();
        });
        if (dialog) {
            ro.observe(dialog);
            mo.observe(dialog, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "style"] });
        }
        window.addEventListener("resize", later);
        return () => {
            syncRef.current = null;
            cancelAnimationFrame(raf);
            timers.forEach(clearTimeout);
            ro.disconnect();
            mo.disconnect();
            window.removeEventListener("resize", later);
            silenced.forEach(([el, v]) => { el.style.overflowY = v; });
            centerer?.reset();
        };
    }, []);
    useEffect(() => {
        const wrap = scrollRef.current;
        const run = () => syncRef.current?.();
        run();
        let raf = requestAnimationFrame(run);
        const timer = setTimeout(run, 150);
        let queued = 0;
        const ro = new ResizeObserver(() => {
            cancelAnimationFrame(queued);
            queued = requestAnimationFrame(run);
        });
        if (wrap) for (const c of Array.from(wrap.children)) ro.observe(c);
        return () => {
            cancelAnimationFrame(raf);
            cancelAnimationFrame(queued);
            clearTimeout(timer);
            ro.disconnect();
        };
    }, [tab, eraseAuto]);

    useEffect(() => {
        loadImage(file).then(setImg).catch(() => setError("Could not open this image."));
    }, [file]);
    const base = useMemo(
        () => {
            const source = eraseSrc ?? img;
            return source ? makeBase(source, st.quarterTurns, st.flipH, st.flipV) : null;
        },
        [img, eraseSrc, st.quarterTurns, st.flipH, st.flipV]
    );
    const bw = base?.width;
    const bh = base?.height;
    const blurBase = useMemo(() => {
        if (!cut) return null;
        const source = cut.from ?? img;
        return source ? makeBase(source, cut.q, cut.fh, cut.fv) : null;
    }, [cut, img]);
    function blurOpt(stx: EditState) {
        if (bg !== "blur" || !blurBase) return undefined;
        const back = renderOutput(blurBase, stx);
        if (autoAdj) applyAuto(back, autoAdj, intensity / 100);
        else applyFilter(back, findFilter(filter), intensity);
        applyAdjustments(back, adj);
        return { back, amount: blurAmount };
    }
    function framePicture(w: number, h: number, src?: HTMLCanvasElement) {
        const stx = { ...st, outW: w, outH: h };
        const out = renderOutput(base!, stx, src);
        return withStrokes(withBackground(out, bg, bgColor, blurOpt(stx)), strokes);
    }
    const markAreaH = Math.min(840, Math.max(380, winH - 330));

    // Mark-up picture
    const markDims = useMemo(() => {
        if (!base || !markBoxW) return { cssW: 1, cssH: 1, pxW: 1, pxH: 1 };
        const v = deriveView(base.width, base.height, st);
        const aspect = v.W / v.H;
        const maxH = Math.max(200, markAreaH - MARK_BAR_H);
        const cssW = Math.max(1, Math.round(Math.min(markBoxW, maxH * aspect)));
        const cssH = Math.max(1, Math.round(cssW / aspect));
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        return { cssW, cssH, pxW: Math.max(1, Math.round(cssW * dpr)), pxH: Math.max(1, Math.round(cssH * dpr)) };
    }, [base, st, markBoxW, markAreaH]);

    const eraserCursor = useMemo(() => {
        const r = eraserRadius(eraser.size) * markDims.cssW;
        const d = Math.min(120, Math.max(10, Math.round(r * 2) + 4));
        const c = d / 2;
        const rr = Math.max(2, Math.min(c - 2, r));
        const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${d}' height='${d}'>` +
            `<circle cx='${c}' cy='${c}' r='${rr}' fill='none' stroke='black' stroke-opacity='0.55' stroke-width='3'/>` +
            `<circle cx='${c}' cy='${c}' r='${rr}' fill='none' stroke='white' stroke-width='1.5'/></svg>`;
        return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${c} ${c}, crosshair`;
    }, [eraser.size, markDims.cssW]);
    const markBase = useMemo(() => {
        if (tab !== "markup" || !base || markBoxW === 0) return null;
        const { pxW, pxH } = markDims;
        const out = renderOutput(base, { ...st, outW: pxW, outH: pxH });
        if (autoAdj) {
            const enhanced = renderOutput(base, { ...st, outW: pxW, outH: pxH });
            applyAuto(enhanced, autoAdj, 1);
            const octx = out.getContext("2d")!;
            octx.setTransform(1, 0, 0, 1, 0, 0);
            octx.globalAlpha = intensity / 100;
            octx.drawImage(enhanced, 0, 0);
            octx.globalAlpha = 1;
        } else {
            applyFilter(out, findFilter(filter), intensity);
        }
        applyAdjustments(out, adj);
        return withBackground(out, bg, bgColor, blurOpt({ ...st, outW: pxW, outH: pxH }));
    }, [tab, base, st, adj, filter, autoAdj, intensity, markDims, markBoxW, bg, bgColor, blurBase, blurAmount]);
    useEffect(() => {
        const c = markCanvasRef.current;
        if (!c || !markBase) return;
        const ctx = c.getContext("2d")!;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, c.width, c.height);
        ctx.drawImage(markBase, 0, 0);
        drawStrokes(ctx, draft ? [...strokes, draft] : strokes, c.width);
    }, [markBase, strokes, draft]);
    function reset() {
        if (!img) return;
        setAdj(NO_ADJUSTMENTS);
        setFilter("none");
        setAutoAdj(null);
        setIntensity(100);
        setBlurAmount(50);
        setStrokes([]);
        setEraseSrc(null);
        setBg("none");
        setCut(null);
        setBgError(null);
        setMaskStrokes([]);
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        setSt(normalize(w, h, { ...INITIAL_STATE, outW: w, outH: h }));
    }
    useEffect(() => {
        histRef.current = { stack: [], idx: -1 };
        setHistoryLocked(false);
        reset();
    }, [img]);
    const histRef = useRef<{ stack: Snap[]; idx: number; }>({ stack: [], idx: -1 });
    const histTimer = useRef(0);
    const confirmOpen = useRef(false);
    const pointerDown = useRef(false);
    const [canUndo, setCanUndo] = useState(false);
    const [canRedo, setCanRedo] = useState(false);
    const [historyLocked, setHistoryLocked] = useState(false); 
    const snapRef = useRef<Snap>({ st, adj, filter, autoAdj, intensity, strokes, src: eraseSrc, bg, bgColor, blur: blurAmount, cut });
    snapRef.current = { st, adj, filter, autoAdj, intensity, strokes, src: eraseSrc, bg, bgColor, blur: blurAmount, cut };
    function syncHistory() {
        const h = histRef.current;
        setCanUndo(h.idx > 0);
        setCanRedo(h.idx < h.stack.length - 1);
    }
    function commitHistory() {
        const h = histRef.current;
        const snap = snapRef.current;
        const top = h.stack[h.idx];
        if (top && sameSnap(top, snap)) return;
        h.stack = h.stack.slice(0, h.idx + 1);
        h.stack.push(snap);
        if (h.stack.length > HISTORY_LIMIT) h.stack.shift();
        h.idx = h.stack.length - 1;
        syncHistory();
    }
    function applySnap(sn: Snap) {
        cancelAnimationFrame(animRef.current);
        setLock(null);
        dragRef.current = null;
        markDrag.current = null;
        draftRef.current = null;
        setDraft(null);
        setSt(sn.st);
        setAdj(sn.adj);
        setFilter(sn.filter);
        setAutoAdj(sn.autoAdj);
        setIntensity(sn.intensity);
        setStrokes(sn.strokes);
        setEraseSrc(sn.src);
        setBg(sn.bg);
        setBgColor(sn.bgColor);
        setBlurAmount(sn.blur);
        setCut(sn.cut);
        eraseDrag.current = null;
        setMaskStrokes([]);
        setMaskDraft(null);
    }
    function undo() {
        if (historyLocked) return;
        clearTimeout(histTimer.current);
        if (img) commitHistory(); 
        const h = histRef.current;
        if (h.idx <= 0) return;
        h.idx--;
        applySnap(h.stack[h.idx]);
        syncHistory();
    }

    function redo() {
        if (historyLocked) return;
        clearTimeout(histTimer.current);
        if (img) commitHistory();
        const h = histRef.current;
        if (h.idx >= h.stack.length - 1) return;
        h.idx++;
        applySnap(h.stack[h.idx]);
        syncHistory();
    }

    const undoRef = useRef(undo);
    const redoRef = useRef(redo);
    undoRef.current = undo;
    redoRef.current = redo;

    useEffect(() => {
        if (!img) return;
        const h = histRef.current;
        const top = h.stack[h.idx];
        if (top && sameSnap(top, snapRef.current)) return; 
        clearTimeout(histTimer.current);
        const tick = () => {
            if (pointerDown.current) histTimer.current = window.setTimeout(tick, 150);
            else commitHistory();
        };
        histTimer.current = window.setTimeout(tick, 350);
    }, [img, st, adj, filter, autoAdj, intensity, strokes, eraseSrc, bg, bgColor, blurAmount, cut]);

    useEffect(() => {
        const down = () => { pointerDown.current = true; };
        const up = () => { pointerDown.current = false; };
        const onKey = (e: KeyboardEvent) => {
            if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
            if (confirmOpen.current) return;
            const t = e.target as HTMLElement | null;
            // text fields keep their own undo
            if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
            if (e.code === "KeyZ" && !e.shiftKey) undoRef.current();
            else if (e.code === "KeyY" || (e.code === "KeyZ" && e.shiftKey)) redoRef.current();
            else return;
            e.preventDefault();
            e.stopPropagation();
        };
        window.addEventListener("pointerdown", down, true);
        window.addEventListener("pointerup", up, true);
        window.addEventListener("pointercancel", up, true);
        document.addEventListener("keydown", onKey, true);
        return () => {
            window.removeEventListener("pointerdown", down, true);
            window.removeEventListener("pointerup", up, true);
            window.removeEventListener("pointercancel", up, true);
            document.removeEventListener("keydown", onKey, true);
            clearTimeout(histTimer.current);
        };
    }, []);

    const gradedAutoCache = useRef<{ base: HTMLCanvasElement; auto: AutoParams; canvas: HTMLCanvasElement; } | null>(null);
    const graded = useMemo(() => {
        if ((tab !== "crop" && tab !== "erase") || !base) return null;
        if (!autoAdj && filter === "none" && !hasAdjustments(adj)) return null;
        const k = Math.min(1, 1600 / Math.max(base.width, base.height));
        const w = Math.max(1, Math.round(base.width * k));
        const h = Math.max(1, Math.round(base.height * k));
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const cctx = c.getContext("2d")!;
        cctx.imageSmoothingQuality = "high";
        cctx.drawImage(base, 0, 0, w, h);
        if (autoAdj) {
            let cache = gradedAutoCache.current;
            if (!cache || cache.base !== base || cache.auto !== autoAdj || cache.canvas.width !== w || cache.canvas.height !== h) {
                const enhanced = document.createElement("canvas");
                enhanced.width = w;
                enhanced.height = h;
                enhanced.getContext("2d")!.drawImage(c, 0, 0);
                applyAuto(enhanced, autoAdj, 1);
                cache = gradedAutoCache.current = { base, auto: autoAdj, canvas: enhanced };
            }
            cctx.globalAlpha = intensity / 100;
            cctx.drawImage(cache.canvas, 0, 0);
            cctx.globalAlpha = 1;
        } else { applyFilter(c, findFilter(filter), intensity); }
        applyAdjustments(c, adj);
        return c;
    }, [tab, base, filter, autoAdj, intensity, adj]);
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!base || !canvas) return;
        const ctx = canvas.getContext("2d")!;
        const overlay = bg !== "none" || strokes.length
            ? (c: CanvasRenderingContext2D, L: StageLayout) => {
                const w = Math.max(1, Math.round(L.fw));
                const h = Math.max(1, Math.round(L.fh));
                const pic = bg !== "none" ? framePicture(w, h, graded ?? undefined) : strokeLayer(strokes, w, h);
                c.imageSmoothingQuality = "high";
                c.drawImage(pic, L.fx, L.fy, L.fw, L.fh);
            }
            : undefined;
        layoutRef.current = drawStage(ctx, base, deriveView(base.width, base.height, st), stage.w, stage.h, lock ?? undefined, graded ?? undefined, overlay);
    }, [base, st, lock, stage, graded, bg, bgColor, strokes, cut, blurBase, blurAmount, adj, filter, autoAdj, intensity]);
    useEffect(() => {
        const canvas = eraseCanvasRef.current;
        if (tab !== "erase" || !base || !canvas) return;
        const ctx = canvas.getContext("2d")!;
        const M = 36;
        const k = Math.min((stage.w - M * 2) / base.width, (stage.h - M * 2) / base.height);
        const dw = Math.max(1, Math.round(base.width * k));
        const dh = Math.max(1, Math.round(base.height * k));
        const ox = Math.round((stage.w - dw) / 2);
        const oy = Math.round((stage.h - dh) / 2);
        eraseLayoutRef.current = { ox, oy, dw, dh };
        const list = maskDraft ? [...maskStrokes, maskDraft] : maskStrokes;
        let mask: HTMLCanvasElement | null = null;
        let fx: HTMLCanvasElement | null = null;
        let pattern: CanvasPattern | null = null;
        if (list.length) {
            mask = document.createElement("canvas");
            mask.width = dw;
            mask.height = dh;
            paintMask(mask.getContext("2d")!, list, dw, "#fff");
            fx = document.createElement("canvas");
            fx.width = dw;
            fx.height = dh;
            const tile = document.createElement("canvas");
            tile.width = tile.height = 16;
            const t = tile.getContext("2d")!;
            t.strokeStyle = "rgba(255, 255, 255, 0.4)";
            t.lineWidth = 5;
            t.beginPath();
            for (const k of [0, 16, 32]) {
                t.moveTo(-4, k + 4);
                t.lineTo(k + 4, -4);
            }
            t.stroke();
            pattern = fx.getContext("2d")!.createPattern(tile, "repeat");
        }
        const ke = dw / base.width;
        const view = deriveView(base.width, base.height, st);
        let frame: HTMLCanvasElement | null = null;
        if (bg !== "none" || strokes.length) {
            const fw = Math.max(1, Math.round(view.W * ke));
            const fh = Math.max(1, Math.round(view.H * ke));
            frame = bg !== "none" ? framePicture(fw, fh, graded ?? undefined) : strokeLayer(strokes, fw, fh);
        }
        const draw = (time: number) => {
            ctx.fillStyle = "#000";
            ctx.fillRect(0, 0, stage.w, stage.h);
            ctx.imageSmoothingQuality = "high";
            if (cut && bg === "none") drawChecker(ctx, ox, oy, dw, dh);
            ctx.drawImage(graded ?? base, ox, oy, dw, dh);
            if (frame) {
                const th = view.theta;
                const fcx = view.px * Math.cos(th) + view.py * Math.sin(th);
                const fcy = -view.px * Math.sin(th) + view.py * Math.cos(th);
                ctx.save();
                ctx.translate(ox + dw / 2 + fcx * ke, oy + dh / 2 + fcy * ke);
                ctx.rotate(-th);
                ctx.drawImage(frame, (-view.W * ke) / 2, (-view.H * ke) / 2, view.W * ke, view.H * ke);
                ctx.restore();
            }
            if (!mask || !fx || !pattern) return;
            const f = fx.getContext("2d")!;
            f.globalCompositeOperation = "source-over";
            f.clearRect(0, 0, dw, dh);
            f.fillStyle = "rgba(70, 130, 255, 0.38)";
            f.fillRect(0, 0, dw, dh);
            f.save();
            f.translate((time / 80) % 16, 0);
            f.fillStyle = pattern;
            f.fillRect(-16, 0, dw + 16, dh);
            f.restore();
            f.globalCompositeOperation = "destination-in";
            f.drawImage(mask, 0, 0);
            ctx.drawImage(fx, ox, oy);
        };
        let raf = 0;
        if (list.length) {
            const loop = (t: number) => {
                draw(t);
                raf = requestAnimationFrame(loop);
            };
            raf = requestAnimationFrame(loop);
        }
        draw(performance.now());
        return () => cancelAnimationFrame(raf);
    }, [tab, base, stage, maskStrokes, maskDraft, st, graded, bg, bgColor, strokes, cut, blurBase, blurAmount]);
    const eraseRingD = useMemo(
        () => Math.max(4, eraseSize),
        [eraseSize]
    );
    const eraseRingRef = useRef<HTMLDivElement>(null);
    const autoStart = settings.use(["autoStartYourEngineServer"]).autoStartYourEngineServer;
    const [engine, setEngine] = useState<EraseStatus | null>(null);
    const startedOnce = useRef(false);
    useEffect(() => {
        let alive = true;
        let timer = 0;
        const warm = tab === "erase" || tab === "background"; // these tabs warm the engine up
        const poll = async () => {
            try {
                const s = await eraseStatus();
                if (!alive) return;
                setEngine(s);
                if (!s.installed) startedOnce.current = false;
                if (s.installed && !s.running && !s.starting && autoStart && warm && !startedOnce.current) {
                    startedOnce.current = true;
                    eraseStart();
                }
                timer = window.setTimeout(poll, s.installing || s.starting ? 700 : 4000);
            } catch {
                if (alive) timer = window.setTimeout(poll, 4000);
            }
        };
        poll();
        return () => { alive = false; clearTimeout(timer); };
    }, [tab, autoStart]);
    const engineMissing = !!engine && !engine.installed;
    const tabLocked = (k: string) => engineMissing && (k === "erase" || k === "background");
    useEffect(() => {
        if (engineMissing && (tab === "erase" || tab === "background")) setTab("crop");
    }, [engineMissing, tab]);
    const eraseReady = !!engine?.installed;
    const engineStarting = !!engine && engine.starting && engine.startProgress >= 0;
    const [barFull, setBarFull] = useState(false);
    const wasStarting = useRef(false);
    const fullTimer = useRef(0);
    useEffect(() => () => clearTimeout(fullTimer.current), []);
    useEffect(() => {
        if (engineStarting) { wasStarting.current = true; return; }
        if (!wasStarting.current) return;
        wasStarting.current = false;
        if (engine?.running) {
            setBarFull(true);
            clearTimeout(fullTimer.current);
            fullTimer.current = window.setTimeout(() => setBarFull(false), 800);
        }
    }, [engineStarting, engine?.running]);
    const showBar = engineStarting || barFull;
    const barValue = engineStarting ? engine!.startProgress : barFull ? 100 : null;
    const hasMask = maskStrokes.some(s => s.add);
    useEffect(() => {
        if (!hasMask && !eraseAdd) setEraseAdd(true);
    }, [hasMask, eraseAdd]);
    const thumbSrc = useMemo(() => {
        if (!base || (tab !== "filter" && tab !== "background")) return null;
        const v = deriveView(base.width, base.height, st);
        const ratio = v.W / v.H;
        const outW = ratio >= 1 ? 160 : Math.max(1, Math.round(160 * ratio));
        const outH = ratio >= 1 ? Math.max(1, Math.round(160 / ratio)) : 160;
        return renderOutput(base, { ...st, outW, outH });
    }, [base, st, tab]);
    const thumbBack = useMemo(() => {
        if (!blurBase || !thumbSrc || tab !== "background") return null;
        return renderOutput(blurBase, { ...st, outW: thumbSrc.width, outH: thumbSrc.height });
    }, [blurBase, thumbSrc, st, tab]);
    useEffect(() => {
        const canvas = previewRef.current;
        if ((tab !== "adjustment" && tab !== "filter" && tab !== "background") || !base || !canvas) return;
        const ctx = canvas.getContext("2d")!;
        const L = drawBackdrop(ctx, base, deriveView(base.width, base.height, st), STAGE_W, STAGE_H);
        const out = renderOutput(base, { ...st, outW: Math.max(1, Math.round(L.fw)), outH: Math.max(1, Math.round(L.fh)) });
        if (autoAdj) {
            const cw = out.width;
            const ch = out.height;
            let c = autoCache.current;
            if (!c || c.base !== base || c.st !== st || c.auto !== autoAdj || c.canvas.width !== cw || c.canvas.height !== ch) {
                const enhanced = renderOutput(base, { ...st, outW: cw, outH: ch });
                applyAuto(enhanced, autoAdj, 1);
                c = autoCache.current = { base, st, auto: autoAdj, canvas: enhanced };
            }
            const octx = out.getContext("2d")!;
            octx.setTransform(1, 0, 0, 1, 0, 0);
            octx.globalAlpha = intensity / 100;
            octx.drawImage(c.canvas, 0, 0);
            octx.globalAlpha = 1;
        } else {
            applyFilter(out, findFilter(filter), intensity);
        }
        applyAdjustments(out, adj);
        if (cut && bg === "none") drawChecker(ctx, L.fx, L.fy, L.fw, L.fh);
        const blur = blurOpt({ ...st, outW: out.width, outH: out.height });
        ctx.drawImage(withStrokes(withBackground(out, bg, bgColor, blur), strokes), L.fx, L.fy, L.fw, L.fh);
    }, [tab, base, st, adj, filter, autoAdj, intensity, bg, bgColor, blurBase, blurAmount, cut, strokes]);
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !bw || !bh) return;
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08;
            setSt(s => withRelativeSize(bw, bh, s, normalize(bw, bh, { ...s, zoom: s.zoom * factor })));
        };
        canvas.addEventListener("wheel", onWheel, { passive: false });
        return () => canvas.removeEventListener("wheel", onWheel);
    }, [bw, bh]);
    const update = (patch: Partial<EditState>) =>
        setSt(s => {
            let next = { ...s, ...patch };
            if (!bw || !bh) return next;
            if ("angle" in patch && !("zoom" in patch)) {
                const aspect = aspectOf(s, bw, bh);
                const oldMin = minZoomFor(bw, bh, aspect, s.angle);
                const newMin = minZoomFor(bw, bh, aspect, next.angle);
                next = { ...next, zoom: s.zoom * (newMin / oldMin) };
            }

            const n = normalize(bw, bh, next);
            return "zoom" in patch || "angle" in patch ? withRelativeSize(bw, bh, s, n) : n;
        });
    function changeRatio(ratio: RatioKey) {
        if (!bw || !bh) return;
        setSt(s => {
            const n = { ...s, ratio };
            if (ratio !== "free") n.outH = clampSize(n.outW / aspectOf(n, bw, bh));
            return normalize(bw, bh, n);
        });
    }
    function autoAdjust() {
        if (!base) return;
        const v = deriveView(base.width, base.height, st);
        const ratio = v.W / v.H;
        const outW = ratio >= 1 ? 512 : Math.max(1, Math.round(512 * ratio));
        const outH = ratio >= 1 ? Math.max(1, Math.round(512 / ratio)) : 512;
        setAutoAdj(analyzeAuto(renderOutput(base, { ...st, outW, outH })));
        setFilter("none");
        setIntensity(100);
    }

    function turn(d: 1 | -1) {
        if (!bw || !bh) return;
        setSt(s => {
            const q = (s.quarterTurns + (s.flipH !== s.flipV ? -d : d) + 4) % 4;
            const swap = s.ratio === "free" || s.ratio === "original";
            return normalize(bh, bw, {
                ...s,
                quarterTurns: q,
                panX: d === 1 ? -s.panY : s.panY,
                panY: d === 1 ? s.panX : -s.panX,
                outW: swap ? s.outH : s.outW,
                outH: swap ? s.outW : s.outH
            });
        });
    }

    function flip(axis: "h" | "v") {
        setSt(s => {
            const n: EditState = axis === "h"
                ? { ...s, flipH: !s.flipH, angle: -s.angle, panX: -s.panX }
                : { ...s, flipV: !s.flipV, angle: -s.angle, panY: -s.panY };
            return bw && bh ? normalize(bw, bh, n) : n;
        });
    }

    function stagePoint(e: React.PointerEvent<HTMLCanvasElement>) {
        const rect = e.currentTarget.getBoundingClientRect();
        const css = e.currentTarget.width / rect.width;
        return { x: (e.clientX - rect.left) * css, y: (e.clientY - rect.top) * css, css };
    }

    function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
        const layout = layoutRef.current;
        if (!layout || !bw || !bh) return;
        const p = stagePoint(e);
        const mode = hitTest(layout, p.x, p.y);
        if (!mode) return;
        cancelAnimationFrame(animRef.current);
        if (mode !== "move") setLock(lockRef.current ?? fitLock(deriveView(bw, bh, st), stageRef.current.w, stageRef.current.h));
        dragRef.current = { mode, x: e.clientX, y: e.clientY, start: st };
        e.currentTarget.setPointerCapture(e.pointerId);
    }

    function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
        const layout = layoutRef.current;
        const drag = dragRef.current;
        if (!layout || !bw || !bh) return;
        if (!drag) {
            const p = stagePoint(e);
            const hit = hitTest(layout, p.x, p.y);
            e.currentTarget.style.cursor = hit ? CURSORS[hit] : "default";
            return;
        }
        const { css } = stagePoint(e);
        const dx = ((e.clientX - drag.x) * css) / layout.k;
        const dy = ((e.clientY - drag.y) * css) / layout.k;

        if (drag.mode === "move") {
            setSt(normalize(bw, bh, { ...drag.start, panX: drag.start.panX - dx, panY: drag.start.panY - dy }));
        } else {
            setSt(resizeCrop(bw, bh, drag.start, drag.mode, dx, dy));
        }
    }

    function onPointerUp() {
        const drag = dragRef.current;
        dragRef.current = null;
        const from = lockRef.current;
        if (!drag || !from || !bw || !bh) return;
        const t0 = performance.now();
        const DURATION = 220;
        const step = (now: number) => {
            const t = Math.min(1, (now - t0) / DURATION);
            const e = 1 - Math.pow(1 - t, 3);
            const to = fitLock(deriveView(bw, bh, stRef.current), stageRef.current.w, stageRef.current.h);
            if (t >= 1) return setLock(null);
            setLock({
                k: from.k + (to.k - from.k) * e,
                cx: from.cx + (to.cx - from.cx) * e,
                cy: from.cy + (to.cy - from.cy) * e
            });
            animRef.current = requestAnimationFrame(step);
        };
        animRef.current = requestAnimationFrame(step);
    }
    function setWidth(value: number) {
        const w = clampSize(value);
        if (st.ratio === "free" || !base) return update({ outW: w });
        update({ outW: w, outH: clampSize(w / aspectOf(st, base.width, base.height)) });
    }
    function setHeight(value: number) {
        const h = clampSize(value);
        if (st.ratio === "free" || !base) return update({ outH: h });
        update({ outH: h, outW: clampSize(h * aspectOf(st, base.width, base.height)) });
    }

    // MARK-UP HANDLERS
    const [confirmClear, setConfirmClear] = useState(false);
    confirmOpen.current = confirmClear;
    function doClear() {
        const h = histRef.current;
        clearTimeout(histTimer.current);
        const empty = [] as typeof strokes; 
        h.stack = [{ ...snapRef.current, strokes: empty }];
        h.idx = 0;
        syncHistory();
        setStrokes(empty);
        setHistoryLocked(true);
        setConfirmClear(false);
    }
    useEffect(() => {
        if (historyLocked && strokes.length > 0) setHistoryLocked(false);
    }, [strokes, historyLocked]);
    function onMarkButton(id: MarkButtonId) {
        if (markButton === id) {
            setPopover(p => (p === id ? null : id)); 
        } else {
            setMarkTool(id === "erase" ? "eraser" : id === "highlighter" ? "highlighter" : "pen");
            setMarkButton(id);
            setPopover(id);
        }
    }
    function markPoint(e: React.PointerEvent<HTMLCanvasElement>) {
        const r = e.currentTarget.getBoundingClientRect();
        const clamp = (n: number, max: number) => Math.min(max, Math.max(0, n));
        return { x: clamp((e.clientX - r.left) / r.width, 1), y: clamp((e.clientY - r.top) / r.width, r.height / r.width) };
    }
    function eraseAt(p: { x: number; y: number; }) {
        setStrokes(list => {
            const kept = list.filter(s => !strokeHit(s, p, eraserRadius(eraser.size)));
            return kept.length === list.length ? list : kept;
        });
    }
    function onMarkDown(e: React.PointerEvent<HTMLCanvasElement>) {
        if (e.button !== 0) return;
        setPopover(null);
        const p = markPoint(e);
        e.currentTarget.setPointerCapture(e.pointerId);
        if (markTool === "eraser") {
            if (eraser.mode === "stroke") {
                markDrag.current = "erase";
                eraseAt(p);
                return;
            }
            const d: Stroke = { tool: "eraser", color: "#000000", size: eraser.size, style: "free", pts: [p, p] };
            draftRef.current = d;
            markDrag.current = "draw";
            setDraft(d);
            return;
        }
        const cfg = pens[markButton as PopoverId];
        const d: Stroke = { tool: markTool, color: cfg.color, size: cfg.size, style: cfg.style, opacity: cfg.opacity / 100, pts: [p, p] };
        draftRef.current = d;
        markDrag.current = "draw";
        setDraft(d);
    }
    function onMarkMove(e: React.PointerEvent<HTMLCanvasElement>) {
        if (!markDrag.current) return;
        const p = markPoint(e);
        if (markDrag.current === "erase") return eraseAt(p);
        const d = draftRef.current;
        if (!d) return;
        const straight = isTwoPoint(d.style);
        const next = { ...d, pts: straight ? [d.pts[0], p] : [...d.pts, p] };
        draftRef.current = next;
        setDraft(next);
    }
    function onMarkUp() {
        const mode = markDrag.current;
        markDrag.current = null;
        if (mode !== "draw") return;
        const d = draftRef.current;
        draftRef.current = null;
        setDraft(null);
        if (!d) return;
        const straight = isTwoPoint(d.style);
        const [a, b] = [d.pts[0], d.pts[d.pts.length - 1]];
        if (straight && Math.hypot(a.x - b.x, a.y - b.y) < 0.003) return; // a click, not a line
        setStrokes(list => [...list, d]);
    }
    async function runErase(list: MaskStroke[]) {
        if (!base || eraseBusy || !list.some(s => s.add)) return;
        setEraseBusy(true);
        setEraseError(null);
        try {
            const out = await inpaint(base, list);
            const blob = await new Promise<Blob | null>(res => out.toBlob(res, "image/png"));
            if (!blob) throw new Error("Could not encode the result.");
            const next = await loadImage(new File([blob], "erased.png", { type: "image/png" }));
            setEraseSrc(next);
            setSt(s => ({ ...s, quarterTurns: 0, flipH: false, flipV: false }));
            setMaskStrokes([]);
        } catch (e) {
            setEraseError(e instanceof Error ? e.message : "Could not erase that area.");
        } finally {
            setEraseBusy(false);
        }
    }
    function erasePoint(e: React.PointerEvent<HTMLCanvasElement>) {
        const r = e.currentTarget.getBoundingClientRect();
        const css = e.currentTarget.width / r.width;
        const { ox, oy, dw, dh } = eraseLayoutRef.current;
        const x = ((e.clientX - r.left) * css - ox) / dw;
        const y = ((e.clientY - r.top) * css - oy) / dw;
        return { x: Math.min(1, Math.max(0, x)), y: Math.min(dh / dw, Math.max(0, y)) };
    }
    function moveRing(e: React.PointerEvent<HTMLCanvasElement>) {
        const el = eraseRingRef.current;
        if (!el) return;
        const r = e.currentTarget.getBoundingClientRect();
        const css = e.currentTarget.width / r.width;
        const x = (e.clientX - r.left) * css;
        const y = (e.clientY - r.top) * css;
        el.style.display = "block";
        el.style.transform = `translate(${x - eraseRingD / 2}px, ${y - eraseRingD / 2}px)`;
    }
    function onEraseDown(e: React.PointerEvent<HTMLCanvasElement>) {
        if (e.button !== 0 || eraseBusy || !eraseReady) return;
        const p = erasePoint(e);
        const s: MaskStroke = { add: eraseAuto ? true : eraseAdd, size: eraseSize / eraseLayoutRef.current.dw, pts: [p, p] };
        eraseDrag.current = s;
        setMaskDraft(s);
        e.currentTarget.setPointerCapture(e.pointerId);
    }
    function onEraseMove(e: React.PointerEvent<HTMLCanvasElement>) {
        const d = eraseDrag.current;
        if (!d) return;
        const next = { ...d, pts: [...d.pts, erasePoint(e)] };
        eraseDrag.current = next;
        setMaskDraft(next);
    }
    function onEraseUp() {
        const d = eraseDrag.current;
        eraseDrag.current = null;
        setMaskDraft(null);
        if (!d) return;
        if (eraseAuto) runErase([d]);
        else setMaskStrokes(list => [...list, d]);
    }
    async function cutBackground() {
        if (!base || bgBusy || cut) return;
        setBgBusy(true);
        setBgError(null);
        try {
            const out = await removeBackground(base);
            const blob = await new Promise<Blob | null>(res => out.toBlob(res, "image/png"));
            if (!blob) throw new Error("Could not encode the result.");
            const next = await loadImage(new File([blob], "cutout.png", { type: "image/png" }));
            setCut({ from: eraseSrc, q: st.quarterTurns, fh: st.flipH, fv: st.flipV });
            setEraseSrc(next);
            setSt(s => ({ ...s, quarterTurns: 0, flipH: false, flipV: false }));
            setMaskStrokes([]);
        } catch (e) {
            setBgError(e instanceof Error ? e.message : "Could not remove the background.");
            setBg("none");
        } finally {
            setBgBusy(false);
        }
    }

    function restoreBackground() {
        if (!cut) return;
        const c = cut;
        setEraseSrc(c.from);
        setSt(s => ({ ...s, quarterTurns: c.q, flipH: c.fh, flipV: c.fv }));
        setCut(null);
    }

    function pickBackground(key: string) {
        setBgError(null);
        if (key === "none") {
            setBg("none");
            restoreBackground();
            return;
        }
        setBg(key);
        const needsCut = key === "color" || !findBackground(key)?.inset;
        if (needsCut && !cut) void cutBackground();
    }

    function pickTransparent() {
        setBgError(null);
        setBg("none");
        if (!cut) void cutBackground();
    }

    const minZoom = base
        ? minZoomFor(base.width, base.height, aspectOf(st, base.width, base.height), st.angle)
        : 1;

    async function save() {
        if (!base || !changed) return;
        try {
            const out = renderOutput(base, st);
            if (autoAdj) applyAuto(out, autoAdj, intensity / 100);
            else applyFilter(out, findFilter(filter), intensity);
            applyAdjustments(out, adj);
            const fin = withBackground(out, bg, bgColor, blurOpt(st));
            if (strokes.length) {
                const octx = fin.getContext("2d")!;
                octx.setTransform(1, 0, 0, 1, 0, 0);
                drawStrokes(octx, strokes, fin.width);
            }
            const target = cut && bg === "none" ? new File([], file.name.replace(/\.[^.]+$/, "") + ".png", { type: "image/png" }) : file;
            onSave(await canvasToFile(fin, target));
            modalProps.onClose();
        } catch {
            setError("Could not save the edited image.");
        }
    }

    const changed = !!img && (() => {
        const o = normalize(img.naturalWidth, img.naturalHeight, { ...INITIAL_STATE, outW: img.naturalWidth, outH: img.naturalHeight });
        const v0 = deriveView(img.naturalWidth, img.naturalHeight, o);
        const v1 = deriveView(img.naturalWidth, img.naturalHeight, st);
        const geometry =
            st.quarterTurns !== o.quarterTurns || st.angle !== o.angle || st.flipH !== o.flipH || st.flipV !== o.flipV ||
            Math.abs(v1.W - v0.W) > 1 || Math.abs(v1.H - v0.H) > 1 || Math.abs(v1.px - v0.px) > 1 || Math.abs(v1.py - v0.py) > 1 ||
            Math.abs(st.outW - o.outW) > 2 || (st.ratio === "free" && Math.abs(st.outH - o.outH) > 2);
        return geometry || hasAdjustments(adj) || filter !== "none" || !!autoAdj || intensity !== 100 ||
            strokes.length > 0 || !!eraseSrc || bg !== "none" || !!cut;
    })();
    return (
        <Modal
            {...modalProps}
            size="xl"
            title={`Edit ${file.name}`}
            actionBarInput={
                // the wrapper owns the cursor, so a disabled Reset shows the same "not allowed" cursor as a disabled Finish
                <span style={{ display: "inline-flex", cursor: changed ? undefined : "not-allowed" }}>
                    <span style={{ display: "inline-flex", pointerEvents: changed ? undefined : "none" }}>
                        <TextButton variant="link" disabled={!changed} onClick={() => { if (changed) reset(); }}>Reset</TextButton>
                    </span>
                </span>
            }
            actions={[
                { text: "Cancel", variant: "secondary", onClick: modalProps.onClose },
                { text: "Finish", variant: "primary", onClick: save, disabled: !base || !changed }
            ]}
        >
            <div data-ae-keep="" style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 16, borderBottom: "1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))" }}>
                {TABS.map(t => {
                    const active = t.key === tab;
                    const locked = tabLocked(t.key);
                    return (
                        <Tip key={t.key} text="Go to Plugin Settings and Set up IOPaint Engine Server." enabled={locked}>
                            {({ ref, props }) => (
                                <button
                                    {...props}
                                    ref={ref}
                                    type="button"
                                    aria-disabled={locked}
                                    onClick={() => { if (!locked) setTab(t.key); }}
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 6,
                                        padding: "8px 12px",
                                        background: "none",
                                        border: "none",
                                        borderBottom: `2px solid ${active ? "var(--brand-500, #5865f2)" : "transparent"}`,
                                        color: active ? "var(--text-strong, #fff)" : "var(--text-muted)",
                                        opacity: locked ? 0.4 : 1,
                                        cursor: locked ? "not-allowed" : "pointer",
                                        font: "inherit",
                                        fontWeight: 500
                                    }}
                                >
                                    {t.key === "markup" ? <MarkupTabIcon /> : <MaterialIcon d={t.d} />}
                                    {t.label}
                                </button>
                            )}
                        </Tip>
                    );
                })}
                <div style={{ marginLeft: "auto", display: "flex", gap: 4, paddingBottom: 2 }}>
                    <ToolButton text="Undo" size={32} disabled={!canUndo || historyLocked} onClick={undo}><UndoIcon /></ToolButton>
                    <ToolButton text="Redo" size={32} disabled={!canRedo || historyLocked} onClick={redo}><RedoIcon /></ToolButton>
                </div>
            </div>
            <style>{SCROLLBAR_CSS}</style>
            <div ref={scrollRef} data-ae-keep="" data-tab={tab} className="attachment-editor-scroll">
                {(tab === "adjustment" || tab === "filter" || tab === "background") && (
                    <div style={{ display: "flex", alignItems: "flex-start", minHeight: 480 }}>
                        <div style={{
                            flex: 1,
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            justifyContent: "flex-start",
                            gap: 14,
                            minWidth: 0,
                            position: "sticky",
                            top: 0,
                            alignSelf: "flex-start"
                        }}>
                            <div style={{ position: "relative", display: "flex", maxWidth: "100%" }}>
                                <canvas
                                    ref={previewRef}
                                    width={STAGE_W}
                                    height={STAGE_H}
                                    style={{ maxWidth: "100%", height: "auto" }}
                                />
                                {tab === "background" && (bgBusy || showBar) && <EngineOverlay bar={barValue} />}
                            </div>
                            {tab === "background" && bg === "blur" && (
                                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                                    <Paragraph style={{ color: "var(--text-muted)" }}>Blur intensity</Paragraph>
                                    <div style={{ width: 260, padding: "0 6px" }}>
                                        <Slider
                                            key={blurKey}
                                            mini
                                            initialValue={blurAmount}
                                            minValue={0}
                                            maxValue={100}
                                            keyboardStep={1}
                                            asValueChanges={v => { const r = Math.round(v); markBlur(r); setBlurAmount(r); }}
                                            onValueChange={v => { const r = Math.round(v); markBlur(r); setBlurAmount(r); }}
                                            onValueRender={v => String(Math.round(v))}
                                        />
                                    </div>
                                </div>
                            )}
                            {tab === "filter" && (filter !== "none" || autoAdj) && (
                                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                                    <Paragraph style={{ color: "var(--text-muted)" }}>Intensity</Paragraph>
                                    <div style={{ width: 260, padding: "0 6px" }}>
                                        <Slider
                                            key={intensityKey}
                                            mini
                                            initialValue={intensity}
                                            minValue={0}
                                            maxValue={100}
                                            keyboardStep={1}
                                            asValueChanges={v => { const r = Math.round(v); markIntensity(r); setIntensity(r); }}
                                            onValueChange={v => { const r = Math.round(v); markIntensity(r); setIntensity(r); }}
                                            onValueRender={v => String(Math.round(v))}
                                        />
                                    </div>
                                </div>
                            )}
                        </div>
                        <div style={{
                            width: 360,
                            flexShrink: 0,
                            display: "flex",
                            flexDirection: "column",
                            gap: 24,
                            paddingLeft: 20,
                            marginLeft: 20
                        }}>
                            {tab === "adjustment" ? (
                                <>
                                    <AdjustGroup
                                        title="Light"
                                        items={LIGHT_SLIDERS}
                                        adj={adj}
                                        onChange={(key, v) => setAdj(a => ({ ...a, [key]: v }))}
                                    />
                                    <AdjustGroup
                                        title="Color"
                                        items={COLOR_SLIDERS}
                                        adj={adj}
                                        onChange={(key, v) => setAdj(a => ({ ...a, [key]: v }))}
                                    />
                                </>
                            ) : tab === "background" ? (
                                <BackgroundPanel
                                    bg={bg}
                                    bgColor={bgColor}
                                    cut={!!cut}
                                    busy={bgBusy}
                                    error={bgError}
                                    thumb={thumbSrc}
                                    thumbBack={thumbBack}
                                    onNone={() => pickBackground("none")}
                                    onTransparent={pickTransparent}
                                    onPick={pickBackground}
                                    onColor={hex => { setBgColor(hex); if (bg !== "color") pickBackground("color"); }}
                                />
                            ) : (
                                <>
                                    <div className="ae-auto-wrap" data-selected={!!autoAdj}>
                                        <Button variant="secondary" disabled={!base} onClick={autoAdjust}>
                                            <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                                                <WandIcon />
                                                Auto Adjustments
                                            </span>
                                        </Button>
                                    </div>
                                    {FILTER_GROUPS.map(g => (
                                        <Field key={g.title} title={g.title}>
                                            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
                                                {g.filters.map(f => (
                                                    <FilterThumb
                                                        key={f.key}
                                                        src={thumbSrc}
                                                        filter={f}
                                                        selected={f.key === "none" ? filter === "none" && !autoAdj : filter === f.key}
                                                        onPick={() => { setAutoAdj(null); setFilter(f.key); setIntensity(100); }}
                                                    />
                                                ))}
                                            </div>
                                        </Field>
                                    ))}
                                </>
                            )}
                        </div>
                    </div>
                )}
                {tab !== "crop" && tab !== "adjustment" && tab !== "filter" && tab !== "markup" && tab !== "erase" && tab !== "background" && (
                    <div style={{ minHeight: 480, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Paragraph style={{ color: "var(--text-muted)" }}>
                            {TABS.find(t => t.key === tab)?.label} tools are coming soon
                        </Paragraph>
                    </div>
                )}
                <div style={{ display: tab === "markup" ? "flex" : "none", flexDirection: "column", alignItems: "center", gap: 16, height: markAreaH }}>
                    <div ref={markBoxRef} style={{ width: "100%", flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <canvas
                            ref={markCanvasRef}
                            width={markDims.pxW}
                            height={markDims.pxH}
                            style={{
                                display: "block",
                                width: markDims.cssW,
                                height: markDims.cssH,
                                touchAction: "none",
                                cursor: markTool === "eraser" ? eraserCursor : "crosshair"
                            }}
                            onPointerDown={onMarkDown}
                            onPointerMove={onMarkMove}
                            onPointerUp={onMarkUp}
                            onPointerCancel={onMarkUp}
                        />
                    </div>
                    <MarkupBar
                        active={markButton}
                        open={popover}
                        pens={pens}
                        eraser={eraser}
                        onEraser={patch => setEraser(e => ({ ...e, ...patch }))}
                        hasMarks={strokes.length > 0}
                        onButton={onMarkButton}
                        onPens={(t, patch) => setPens(p => ({ ...p, [t]: { ...p[t], ...patch } }))}
                        onClear={() => { setPopover(null); setConfirmClear(true); }}
                        onClose={() => setPopover(null)}
                    />
                    {confirmClear && <ClearConfirm onConfirm={doClear} onCancel={() => setConfirmClear(false)} />}
                </div>
                <div style={{ display: tab === "erase" ? "flex" : "none", alignItems: "flex-start", minHeight: 480 }}>
                    <div style={{ flex: 1, minWidth: 0, display: "flex", justifyContent: "center", position: "sticky", top: 0, alignSelf: "flex-start" }}>
                        <div style={{ position: "relative", width: stage.w, height: stage.h, overflow: "hidden", background: "#000" }}>
                            <canvas
                                ref={eraseCanvasRef}
                                width={stage.w}
                                height={stage.h}
                                style={{
                                    display: "block",
                                    width: stage.w,
                                    height: stage.h,
                                    touchAction: "none",
                                    cursor: eraseBusy ? "progress" : eraseReady ? "none" : "not-allowed"
                                }}
                                onPointerDown={onEraseDown}
                                onPointerMove={e => { moveRing(e); onEraseMove(e); }}
                                onPointerEnter={moveRing}
                                onPointerLeave={() => { if (eraseRingRef.current) eraseRingRef.current.style.display = "none"; }}
                                onPointerUp={onEraseUp}
                                onPointerCancel={onEraseUp}
                            />
                            <div
                                ref={eraseRingRef}
                                aria-hidden="true"
                                style={{
                                    position: "absolute",
                                    left: 0,
                                    top: 0,
                                    width: eraseRingD,
                                    height: eraseRingD,
                                    display: "none",
                                    pointerEvents: "none"
                                }}
                            >
                                <style>{"@keyframes ae-ring-spin { to { transform: rotate(360deg); } }"}</style>
                                <svg
                                    width={eraseRingD}
                                    height={eraseRingD}
                                    style={{ display: "block", animation: "ae-ring-spin 5s linear infinite", opacity: eraseBusy ? 0 : 1 }}
                                >
                                    {(() => {
                                        const r = eraseRingD / 2 - 1.5;
                                        const circ = 2 * Math.PI * r;
                                        const n = Math.max(6, 2 * Math.round(circ / 20));
                                        const dash = `${circ / n} ${circ / n}`;
                                        return (
                                            <>
                                                <circle cx={eraseRingD / 2} cy={eraseRingD / 2} r={r} fill="none" stroke="black" strokeOpacity={0.5} strokeWidth={3.5} strokeDasharray={dash} />
                                                <circle cx={eraseRingD / 2} cy={eraseRingD / 2} r={r} fill="none" stroke="white" strokeWidth={1.75} strokeDasharray={dash} />
                                            </>
                                        );
                                    })()}
                                </svg>
                            </div>
                            {(eraseBusy || showBar) && <EngineOverlay bar={barValue} />}
                        </div>
                    </div>
                    <div style={{ width: 280, flexShrink: 0, display: "flex", flexDirection: "column", gap: 20, paddingLeft: 20, marginLeft: 20 }}>
                        <section>
                            <Heading tag="h2" style={{ margin: "0 0 16px", fontSize: 24, lineHeight: "30px", fontWeight: 400, color: "var(--text-strong, var(--header-primary))" }}>Generative Erase</Heading>
                            <Heading tag="h3" style={{ margin: 0 }}>Remove distractions</Heading>
                            <Paragraph style={{ color: "var(--text-muted)", margin: "4px 0 12px" }}>
                                Brush over the entire area you want removed from your photo. This feature uses AI to infill the removed area.
                            </Paragraph>
                            {/* Discord's own info admonition, measured from the real one (dark theme) */}
                            <div style={{
                                display: "grid",
                                boxSizing: "border-box",
                                padding: 8,
                                borderRadius: 8,
                                border: "1px solid var(--text-feedback-info, oklab(0.77908 -0.026985 -0.0979161))",
                                background: "oklab(0.415484 -0.0299889 -0.114785 / 0.0784314)",
                                color: "var(--text-feedback-info, oklab(0.77908 -0.026985 -0.0979161))"
                            }}>
                                <div style={{ display: "flex" }}>
                                    <div style={{ display: "flex", width: 20, height: 20, flexShrink: 0 }}>
                                        <svg width={20} height={20} viewBox="0 0 24 24" fill="none" aria-hidden="true" role="img" style={{ display: "block", color: "var(--icon-feedback-info, var(--text-feedback-info, #6ea8ff))" }}>
                                            <circle cx="12" cy="12" r="10" fill="transparent" />
                                            <path fill="currentColor" fillRule="evenodd" clipRule="evenodd" d="M23 12a11 11 0 1 1-22 0 11 11 0 0 1 22 0Zm-9.5-4.75a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0Zm-.77 3.96a1 1 0 1 0-1.96-.42l-1.04 4.86a2.77 2.77 0 0 0 4.31 2.83l.24-.17a1 1 0 1 0-1.16-1.62l-.24.17a.77.77 0 0 1-1.2-.79l1.05-4.86Z" />
                                        </svg>
                                    </div>
                                    <div style={{
                                        marginLeft: "var(--space-8, 8px)",
                                        fontFamily: "var(--font-primary)",
                                        fontSize: 14,
                                        lineHeight: "18px",
                                        fontWeight: 500,
                                        color: "var(--text-default, oklab(0.963609 0.000620386 -0.00194622))"
                                    }}>
                                        This feature may not be perfect or what you may expect.
                                    </div>
                                </div>
                            </div>
                        </section>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", opacity: eraseReady ? 1 : 0.5, pointerEvents: eraseReady ? "auto" : "none" }}>
                            <Heading tag="h3" style={{ margin: 0 }}>Auto apply</Heading>
                            <Switch checked={eraseAuto} disabled={eraseBusy} onChange={v => { setEraseAuto(v); setEraseAdd(true); }} />
                        </div>
                        {!eraseAuto && (
                            <RadioGroup
                                label="Mask mode"
                                value={eraseAdd ? "add" : "remove"}
                                disabled={eraseBusy}
                                options={[
                                    { id: "add", label: "Add mask", desc: "Brush over what the AI should remove." },
                                    { id: "remove", label: "Remove mask", desc: "Brush over painted areas to keep them.", disabled: !hasMask }
                                ]}
                                onChange={id => setEraseAdd(id === "add")}
                            />
                        )}
                        <Field title="Brush size">
                            <div>
                                <Slider
                                    mini
                                    initialValue={eraseSize}
                                    minValue={ERASE_MIN_SIZE}
                                    maxValue={ERASE_MAX_SIZE}
                                    keyboardStep={1}
                                    onValueRender={v => String(Math.round(v))}
                                    asValueChanges={v => setEraseSize(Math.round(v))}
                                    onValueChange={v => setEraseSize(Math.round(v))}
                                />
                            </div>
                        </Field>
                        {!eraseAuto && (
                            <div style={{ display: "flex", gap: 8 }}>
                                <Button
                                    variant="primary"
                                    disabled={eraseBusy || !hasMask}
                                    onClick={() => runErase(maskStrokes)}
                                    style={{ flex: 1 }}
                                >
                                    Erase
                                </Button>
                                <Button
                                    variant="secondary"
                                    disabled={eraseBusy || !hasMask}
                                    onClick={() => { setMaskStrokes([]); setEraseAdd(true); }}
                                    style={{ flex: 1 }}
                                >
                                    Clear
                                </Button>
                            </div>
                        )}
                        {eraseError && <Paragraph style={{ color: "var(--text-danger)" }}>{eraseError}</Paragraph>}
                        {engine?.installed && (
                            <Paragraph style={{ color: "var(--text-muted)", margin: 0, fontSize: 12 }}>
                                Engine: {engine.starting ? "Starting the engine…" : engine.running ? "The Engine has started and is ready to respond to requests." : "The Engine is currently at sleep and will start when needed."}
                            </Paragraph>
                        )}
                    </div>
                </div>
                <div style={{ display: tab === "crop" ? "flex" : "none", alignItems: "flex-start", minHeight: 480 }}>
                    <div
                        ref={stageBoxRef}
                        style={{
                            flex: 1,
                            minWidth: 0,
                            display: "flex",
                            justifyContent: "center",
                            position: "sticky",
                            top: 0,
                            alignSelf: "flex-start"
                        }}
                    >
                        <canvas
                            ref={canvasRef}
                            width={stage.w}
                            height={stage.h}
                            style={{ display: "block", width: stage.w, height: stage.h, touchAction: "none" }}
                            onPointerDown={onPointerDown}
                            onPointerMove={onPointerMove}
                            onPointerUp={onPointerUp}
                            onPointerCancel={onPointerUp}
                        />
                    </div>
                    <div style={{
                        width: 280,
                        flexShrink: 0,
                        display: "flex",
                        flexDirection: "column",
                        gap: 20,
                        paddingLeft: 20,
                        marginLeft: 20
                    }}>
                        <Field title="Orientation">
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <IconButton text="Rotate 90°" onClick={() => turn(1)}>
                                    <RotateIcon />
                                </IconButton>
                                <IconButton text="Flip horizontally" onClick={() => flip("h")}>
                                    <FlipIcon />
                                </IconButton>
                                <IconButton text="Flip vertically" onClick={() => flip("v")}>
                                    <FlipVerticalIcon />
                                </IconButton>
                            </div>
                        </Field>
                        <Field title="Aspect ratio" desc="Shape of the cropped image.">
                            <SearchableSelect
                                options={RATIO_OPTIONS}
                                value={st.ratio}
                                placeholder="Select a ratio"
                                maxVisibleItems={5}
                                closeOnSelect={true}
                                onChange={changeRatio}
                            />
                        </Field>
                        <div style={{ display: "flex", gap: 12 }}>
                            <Field title="Width" desc="Pixels." style={{ flex: 1 }}>
                                <NumberField value={Math.round(st.outW)} onCommit={setWidth} />
                            </Field>
                            <Field title="Height" desc="Pixels." style={{ flex: 1 }}>
                                <NumberField value={Math.round(st.outH)} onCommit={setHeight} />
                            </Field>
                        </div>
                        <Field title="Rotation" desc="Fine-tune the angle of the image.">
                            <div>
                                <Slider
                                    key={angleKey}
                                    initialValue={st.angle}
                                    minValue={-45}
                                    maxValue={45}
                                    markers={[-45, -30, -15, 0, 15, 30, 45]}
                                    keyboardStep={1}
                                    onMarkerRender={m => <span style={{ whiteSpace: "nowrap" }}>{m}°</span>}
                                    onValueRender={v => `${Math.round(v)}°`}
                                    asValueChanges={v => {
                                        const r = Math.round(v);
                                        markAngle(r);
                                        update({ angle: r });
                                    }}
                                    onValueChange={v => {
                                        const r = Math.round(v);
                                        markAngle(r);
                                        update({ angle: r });
                                    }}
                                />
                            </div>
                        </Field>
                        <Field title="Zoom" desc="Drag the image to move it, or drag the frame edges to crop.">
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <IconButton text="Zoom out" onClick={() => update({ zoom: st.zoom / 1.2 })}>
                                    <ZoomOutIcon />
                                </IconButton>
                                <div style={{ flex: 1, minWidth: 0, padding: "0 6px" }}>
                                    <Slider
                                        key={zoomKey}
                                        mini
                                        initialValue={st.zoom}
                                        minValue={minZoom}
                                        maxValue={Math.max(MAX_ZOOM, minZoom + 0.01)}
                                        asValueChanges={v => { markZoom(v); update({ zoom: v }); }}
                                        onValueChange={v => { markZoom(v); update({ zoom: v }); }}
                                        onValueRender={v => `${v.toFixed(2)}×`}
                                    />
                                </div>
                                <IconButton text="Zoom in" onClick={() => update({ zoom: st.zoom * 1.2 })}>
                                    <ZoomInIcon />
                                </IconButton>
                            </div>
                        </Field>
                        {error && <Paragraph style={{ color: "var(--text-danger)" }}>{error}</Paragraph>}
                    </div>
                </div>
            </div>
        </Modal>
    );
}
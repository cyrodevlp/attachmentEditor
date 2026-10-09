/*
 * Settings:
 * This is the settings page for the Attachment Editor plugin.
 * It allows users to configure various options related to the plugin's functionality.
 * 
 * The settings include options for the IOPaint engine server, Directory storage usage, and other preferences
 * such as automatic startup, GPU usage, idle timeout, server port, and allocated memory.
 */

import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { Switch } from "@components/Switch";
import { openModal } from "@utils/modal";
import { OptionType, PluginNative } from "@utils/types";
import { Forms, Modal, React, Slider, TextInput, Tooltip, useEffect, useRef, useState } from "@webpack/common";

const getNative = () => VencordNative.pluginHelpers.AttachmentEditor as PluginNative<typeof import("./native")>;
interface EngineState { installed: boolean; installing: boolean; stage: string; progress: number; error?: string; }

const TOOLTIP_CSS = `
.ae-tooltip {
    --ae-tip-bg: var(--background-base-low, #1b1b1e);
    --ae-tip-border: #55555d;
    position: relative !important;
    overflow: visible !important;
    background: var(--ae-tip-bg) !important;
    border: 0 !important;
    outline: 0 !important;
    box-shadow: 0 0 0 0.5px var(--ae-tip-border) !important;
}
.ae-tooltip [class*="pointer" i] { display: none !important; }
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
`;

// OPTION DESCRIPTIONS
function Desc({ children, style }: { children: React.ReactNode; style?: React.CSSProperties; }): React.ReactElement {
    return <Forms.FormText style={{ maxWidth: "none", width: "100%", lineHeight: "18px", ...style }}>{children}</Forms.FormText>;
}
function ToggleRow({ title, description, value, disabled, onChange }: {
    title: string;
    description: string;
    value: boolean;
    disabled?: boolean;
    onChange: (v: boolean) => void;
}): React.ReactElement {
    return (
        <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 8 }}>
                <Forms.FormTitle style={{ margin: 0 }}>{title}</Forms.FormTitle>
                <Switch checked={value} disabled={disabled} onChange={onChange} />
            </div>
            <Desc>{description}</Desc>
        </div>
    );
}

function Locked({ locked, children }: { locked: boolean; children: React.ReactNode; }): React.ReactElement {
    const elRef = useRef<HTMLDivElement>(null);
    const tipRef = useRef<{ show?: () => void; hide?: () => void; } | null>(null);
    const hoverRef = useRef(false);
    useEffect(() => {
        let timer = 0;
        let suppressed = false;
        const onScroll = (e: Event) => {
            const el = elRef.current;
            const t = e.target;
            if (!el || !hoverRef.current || !(t instanceof Node) || !t.contains(el)) return;
            if (!suppressed) tipRef.current?.hide?.();
            suppressed = true;
            clearTimeout(timer);
            timer = window.setTimeout(() => {
                suppressed = false;
                if (elRef.current?.matches(":hover")) tipRef.current?.show?.();
            }, 150);
        };
        window.addEventListener("scroll", onScroll, true);
        return () => {
            window.removeEventListener("scroll", onScroll, true);
            clearTimeout(timer);
        };
    }, []);
    if (!locked) return <div>{children}</div>;
    return (
        <Tooltip text="Set up the IOPaint Engine Server above to enable this option." position="top" color={Tooltip.Colors?.PRIMARY} spacing={8} tooltipClassName="ae-tooltip">
            {(p: any) => {
                tipRef.current = { show: () => p.onMouseEnter?.(), hide: () => p.onMouseLeave?.() };
                return (
                    <div
                        {...p}
                        ref={elRef}
                        onMouseEnter={() => { hoverRef.current = true; p.onMouseEnter?.(); }}
                        onMouseLeave={() => { hoverRef.current = false; p.onMouseLeave?.(); }}
                        style={{ opacity: 0.5, cursor: "not-allowed" }}
                    >
                        <style>{TOOLTIP_CSS}</style>
                        <div style={{ pointerEvents: "none" }} aria-disabled="true">{children}</div>
                    </div>
                );
            }}
        </Tooltip>
    );
}

const useInstalled = () => settings.use(["engineInstalled"]).engineInstalled;
function EngineSetup(): React.ReactElement {
    const { engineInstalled } = settings.use(["engineInstalled"]);
    const [st, setSt] = useState<EngineState | null>(null);
    const [msg, setMsg] = useState<string | null>(null);
    const [info, setInfo] = useState<string | null>(null);
    const refresh = async () => {
        const s = await getNative().getStatus(settings.store.engineServerPort);
        setSt(s);
        if (settings.store.engineInstalled !== s.installed) settings.store.engineInstalled = s.installed;
        return s;
    };
    useEffect(() => {
        let alive = true;
        let timer = 0;
        const poll = async () => {
            let installing = false;
            try {
                const s = await refresh();
                installing = s.installing;
            } catch { /* try again below */ }
            if (alive) timer = window.setTimeout(poll, installing ? 600 : 3000);
        };
        poll();
        return () => { alive = false; clearTimeout(timer); };
    }, []);
    async function setUp() {
        setMsg(null);
        setInfo(null);
        setSt({ installed: false, installing: true, stage: "Starting", progress: 0 });
        const r = await getNative().install(settings.store.useYourGraphicsCard);
        if (!r.ok) setMsg(r.error ?? "Setup failed.");
        refresh().catch(() => { });
    }
    async function remove() {
        const r = await getNative().uninstall();
        setMsg(r.ok ? null : r.error ?? "Could not remove it.");
        setInfo(r.ok ? `Uninstalled. Freed ${fmtBytes(r.freed)}.` : null);
        refresh().catch(() => { });
    }
    function confirmRemove() {
        openModal(props => (
            <Modal
                {...props}
                size="sm"
                title="Uninstall Engine Server"
                subtitle="This deletes the IOPaint engine, its Python environment and the downloaded AI models (about 3-5 GB in total, including the download cache) from your PC. Erase and Background in the editor stop working until you set it up again."
                actions={[
                    { text: "Cancel", variant: "secondary", onClick: props.onClose },
                    { text: "Uninstall", variant: "critical-primary", onClick: () => { props.onClose(); void remove(); } }
                ]}
            >
            </Modal>
        ));
    }
    async function openFolder() {
        const r = await getNative().openFolder();
        if (!r.ok) setMsg(r.error ?? "Could not open the folder.");
    }
    const installed = st ? st.installed : engineInstalled;
    const installing = !!st?.installing;
    const error = msg ?? (!installed && !installing ? st?.error : undefined);
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {installing ? (
                <>
                    <div style={{ height: 6, borderRadius: 3, background: "var(--background-mod-strong, rgba(255,255,255,0.12))", overflow: "hidden" }}>
                        <div style={{ width: `${Math.max(3, st!.progress)}%`, height: "100%", background: "var(--brand-500, #5865f2)", transition: "width 0.6s ease-out" }} />
                    </div>
                    <Forms.FormText>{st!.stage}… {st!.progress}%</Forms.FormText>
                </>
            ) : installed ? (
                <div style={{ display: "flex", gap: 8 }}>
                    <Button variant="secondary" onClick={openFolder} style={{ flex: 1 }}>Open IOPaint Folder</Button>
                    <Button variant="dangerPrimary" onClick={confirmRemove} style={{ flex: 1 }}>Uninstall Engine Server</Button>
                </div>
            ) : (
                <Button variant="primary" onClick={setUp} style={{ width: "100%" }}>Set up and Install IOPaint Engine Server</Button>
            )}
            {!installed && !installing && (
                <Desc>
                    One-time setup. Downloads the AI engine (about 3-5 GB, more with GPU) and runs it on your PC, so your pictures never leave it. It only runs while you use the Erase and Background tabs.
                </Desc>
            )}
            {error && <Forms.FormText style={{ color: "var(--text-danger)" }}>{error}</Forms.FormText>}
            {info && !installed && !installing && <Forms.FormText>{info}</Forms.FormText>}
        </div>
    );
}

function AutoStartSetting(): React.ReactElement {
    const { autoStartYourEngineServer } = settings.use(["autoStartYourEngineServer"]);
    const installed = useInstalled();
    return (
        <Locked locked={!installed}>
            <ToggleRow
                title="Start the Engine automatically"
                description="Start the Engine when you open the Erase or other AI tabs. If off, it stays asleep until you start it manually and your first run is slower."
                value={autoStartYourEngineServer}
                onChange={(v: boolean) => { settings.store.autoStartYourEngineServer = v; }}
            />
        </Locked>
    );
}

function GpuSetting(): React.ReactElement {
    const { useYourGraphicsCard } = settings.use(["useYourGraphicsCard"]);
    const [hasNvidia, setHasNvidia] = useState<boolean | null>(null); // null = still checking
    useEffect(() => {
        getNative().detectNvidia()
            .then(ok => {
                setHasNvidia(ok);
                // a saved "on" is meaningless without an NVIDIA card
                if (!ok && settings.store.useYourGraphicsCard) settings.store.useYourGraphicsCard = false;
            })
            .catch(() => setHasNvidia(false));
    }, []);
    const note =
        hasNvidia === null
            ? "Checking for an NVIDIA graphics card…"
            : hasNvidia
                ? "Much faster processing, but needs extra downloads. To change this later, uninstall the Engine and set it up again."
                : "Turned off: no NVIDIA graphics card found. The Engine will use your CPU instead.";

    return (
        <ToggleRow
            title="Use your own GPU (Graphics Card)"
            description={note}
            value={hasNvidia === true && useYourGraphicsCard}
            disabled={hasNvidia !== true}
            onChange={(v: boolean) => { settings.store.useYourGraphicsCard = v; }}
        />
    );
}

function IdleSetting(): React.ReactElement {
    const { idleTimeout } = settings.use(["idleTimeout"]);
    const installed = useInstalled();
    return (
        <Locked locked={!installed}>
            <div style={{ display: "flex", alignItems: "center", minHeight: 24, marginBottom: 8 }}>
                <Forms.FormTitle style={{ margin: 0 }}>Idle shutdown</Forms.FormTitle>
            </div>
            <Desc>
                How long the Engine can sit unused before it shuts off to free memory and CPU. Slide fully left to keep it running until you close Discord.
            </Desc>
            <div style={{ marginTop: 8 }} />
            <Slider
                initialValue={idleTimeout}
                minValue={0}
                maxValue={60}
                markers={[0, 5, 60]}
                stickToMarkers={false}
                keyboardStep={1}
                onMarkerRender={(v: number) => <span style={{ whiteSpace: "nowrap" }}>{v === 0 ? "∞" : String(v)}</span>}
                onValueRender={(v: number) => {
                    const n = Math.round(v);
                    const text = n === 0 ? "Until Discord closes" : n === 1 ? "1 minute" : `${n} minutes`;
                    return <span style={{ whiteSpace: "nowrap" }}>{text}</span>;
                }}
                asValueChanges={(v: number) => { settings.store.idleTimeout = Math.round(v); }}
                onValueChange={(v: number) => { settings.store.idleTimeout = Math.round(v); }}
            />
        </Locked>
    );
}

function PortSetting(): React.ReactElement {
    const saved = settings.use(["engineServerPort"]).engineServerPort;
    const installed = useInstalled();
    const [text, setText] = useState(String(saved));
    const n = Number(text);
    const valid = text.length === 4 && n >= 1024 && n <= 9999;
    return (
        <Locked locked={!installed}>
            <div style={{ display: "flex", alignItems: "center", minHeight: 24, marginBottom: 8 }}>
                <Forms.FormTitle style={{ margin: 0 }}>AI server Port</Forms.FormTitle>
            </div>
            <Desc>
                The port the Engine runs on. It stays on your PC and is never reachable from the internet. Only change it if port 8080 is already in use.
            </Desc>
            <div style={{ marginTop: 12 }} />
            <TextInput
                value={text}
                maxLength={4}
                placeholder="8080"
                error={valid ? undefined : "The port must be exactly 4 digits (1024 to 9999)."}
                onChange={(v: string) => {
                    const digits = v.replace(/\D/g, "").slice(0, 4);
                    setText(digits);
                    const num = Number(digits);
                    if (digits.length === 4 && num >= 1024 && num <= 9999)
                        settings.store.engineServerPort = num;
                }}
            />
        </Locked>
    );
}

const DEFAULT_MEMORY_MB = 3072;
const MIN_MEMORY_MB = 500;
const fmtMb = (mb: number) => (mb >= 1024 ? `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB` : `${Math.round(mb)} MB`);
const fmtBytes = (b: number) => {
    if (b < 1024) return `${b} B`;
    if (b < 1048576) return `${(b / 1024).toFixed(2)} kB`;
    if (b < 1073741824) return `${(b / 1048576).toFixed(b < 10485760 ? 2 : 0)} MB`;
    return `${(b / 1073741824).toFixed(2)} GB`;
};

function MemorySetting(): React.ReactElement {
    const { allocatedMemory } = settings.use(["allocatedMemory"]);
    const installed = useInstalled();
    const [total, setTotal] = useState<number | null>(null);
    useEffect(() => {
        getNative().getSystemMemory()
            .then(m => setTotal(Math.max(MIN_MEMORY_MB + 256, m.totalMb)))
            .catch(() => setTotal(16384));
    }, []);
    const max = total ?? 16384;
    const value = Math.min(max, Math.max(MIN_MEMORY_MB, allocatedMemory));
    const def = Math.min(DEFAULT_MEMORY_MB, Math.round(max / 2));
    const marks = Array.from(new Set([MIN_MEMORY_MB, def, max]));

    return (
        <Locked locked={!installed}>
            <div style={{ display: "flex", alignItems: "center", minHeight: 24, marginBottom: 8 }}>
                <Forms.FormTitle style={{ margin: 0 }}>Allocated Memory</Forms.FormTitle>
            </div>
            <Desc>
                How much memory the plugin may use for the IOPaint server.
                {total ? ` Your PC has ${fmtMb(total)} in total.` : ""}
            </Desc>
            <div style={{ marginTop: 8 }} />
            {total !== null && (
                <Slider
                    key={total}
                    initialValue={value}
                    minValue={MIN_MEMORY_MB}
                    maxValue={max}
                    markers={marks}
                    stickToMarkers={false}
                    keyboardStep={128}
                    onMarkerRender={(v: number) => <span style={{ whiteSpace: "nowrap" }}>{fmtMb(v)}</span>}
                    onValueRender={(v: number) => <span style={{ whiteSpace: "nowrap" }}>{fmtMb(Math.round(v / 64) * 64)}</span>}
                    asValueChanges={(v: number) => { settings.store.allocatedMemory = Math.round(v / 64) * 64; }}
                    onValueChange={(v: number) => { settings.store.allocatedMemory = Math.round(v / 64) * 64; }}
                />
            )}
        </Locked>
    );
}

interface DiskUsage { total: number; engine: number; models: number; python: number; cache: number; other: number; }
const USAGE_PARTS: { key: keyof Omit<DiskUsage, "total">; label: string; color: string; }[] = [
    { key: "engine", label: "Engine", color: "#5865F2" },
    { key: "models", label: "Models", color: "#23A55A" },
    { key: "python", label: "Python", color: "#00A8FC" },
    { key: "cache", label: "Cache", color: "#F23F43" },
    { key: "other", label: "Other", color: "#F0B232" }
];

// DIRECTORY OVERVIEW
const CX = 130;
const CY = 130;
const R_OUT = 118;
const R_IN = 90;

const polar = (r: number, a: number) => `${(CX + r * Math.cos(a)).toFixed(2)} ${(CY + r * Math.sin(a)).toFixed(2)}`;
function ringPath(ro: number, ri: number, a0: number, a1: number) {
    const large = a1 - a0 > Math.PI ? 1 : 0;
    return `M${polar(ro, a0)}A${ro} ${ro} 0 ${large} 1 ${polar(ro, a1)}L${polar(ri, a1)}A${ri} ${ri} 0 ${large} 0 ${polar(ri, a0)}Z`;
}

const fmtPct = (p: number) => (p <= 0 ? "0%" : p < 1 ? "<1%" : `${Math.round(p)}%`);

const HALO_GAP = 0; 
const HALO_W = 12; 
const LOAD_MS = 1100;
function DonutChart({ usage }: { usage: DiskUsage | null }): React.ReactElement {
    const [hover, setHover] = useState<string | null>(null);
    const [fromLegend, setFromLegend] = useState(false);
    const [pos, setPos] = useState({ x: 0, y: 0, w: 1 });
    const boxRef = useRef<HTMLDivElement>(null);
    const [t, setT] = useState(0);
    const played = useRef(false);
    const items = USAGE_PARTS
        .map(p => ({ ...p, value: usage?.[p.key] ?? 0 }))
        .filter(i => i.value > 0)
        .sort((x, y) => y.value - x.value);
    const total = items.reduce((sum, i) => sum + i.value, 0);
    let angle = -Math.PI / 2;
    const slices = items.map(i => {
        const sweep = Math.min(Math.PI * 2 - 0.001, (i.value / total) * Math.PI * 2);
        const a0 = angle;
        const a1 = angle + sweep;
        angle = a1;
        return { ...i, a0, a1, pct: (i.value / total) * 100 };
    });
    const active = slices.find(sl => sl.key === hover) ?? null;
    const hasData = total > 0;
    useEffect(() => {
        if (!hasData || played.current) return;
        played.current = true;
        const t0 = performance.now();
        let raf = 0;
        const step = (now: number) => {
            const k = Math.min(1, (now - t0) / LOAD_MS);
            setT(1 - Math.pow(1 - k, 3)); // ease-out
            if (k < 1) raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
        return () => cancelAnimationFrame(raf);
    }, [hasData]);
    const ang = (a: number) => -Math.PI / 2 + (a + Math.PI / 2) * t;
    const spin = (1 - t) * -150;
    const ready = t >= 1;
    const legend = [
        ...slices.map(sl => ({ key: sl.key, label: sl.label, color: sl.color, pct: sl.pct })),
        ...USAGE_PARTS.filter(p => !items.some(i => i.key === p.key)).map(p => ({ key: p.key, label: p.label, color: p.color, pct: 0 }))
    ];
    const fade = fromLegend ? hover : null;

    const track = (e: React.MouseEvent) => {
        const r = boxRef.current?.getBoundingClientRect();
        if (r) setPos({ x: e.clientX - r.left, y: e.clientY - r.top, w: r.width });
    };

    return (
        <div
            ref={boxRef}
            onMouseMove={track}
            style={{
                position: "relative",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexWrap: "wrap",
                gap: "16px 48px",
                padding: 24,
                borderRadius: 8,
                background: "var(--background-mod-subtle, var(--background-secondary-alt, rgba(255,255,255,0.05)))"
            }}
        >
            <svg width={260} height={260} viewBox="0 0 260 260" style={{ overflow: "visible", flexShrink: 0 }} role="img" aria-label="Disk space used by the Engine">
                {total === 0 && <path d={ringPath(R_OUT, R_IN, -Math.PI / 2, Math.PI * 1.5 - 0.001)} fill="var(--background-mod-strong, rgba(255,255,255,0.1))" />}
                <g transform={`rotate(${spin} ${CX} ${CY})`}>
                {slices.map(sl => {
                    const on = hover === sl.key;
                    const dim = fade !== null && !on;
                    return (
                        <g key={sl.key}>
                            <path
                                d={ringPath(R_OUT + HALO_GAP + HALO_W, R_OUT + HALO_GAP, ang(sl.a0), ang(sl.a1))}
                                fill={sl.color}
                                style={{ opacity: on ? 0.35 : 0, transition: "opacity 0.15s ease-out", pointerEvents: "none" }}
                            />
                            <path
                                d={ringPath(R_OUT, R_IN, ang(sl.a0), ang(sl.a1))}
                                fill={sl.color}
                                stroke={sl.color}
                                strokeWidth={0.75}
                                style={{ opacity: dim ? 0.25 : 1, cursor: "default", pointerEvents: ready ? "auto" : "none", transition: "opacity 0.15s ease-out" }}
                                onMouseEnter={() => { setFromLegend(false); setHover(sl.key); }}
                                onMouseLeave={() => setHover(null)}
                            />
                        </g>
                    );
                })}
                </g>
                <g style={{ opacity: hasData ? t : 1 }}>
                    <text x={CX} y={CY - 2} textAnchor="middle" fontSize={12} fill="var(--text-muted)">Total</text>
                    <text x={CX} y={CY + 18} textAnchor="middle" fontSize={20} fontWeight={700} fill="var(--text-strong, var(--header-primary))">{fmtBytes(total)}</text>
                </g>
            </svg>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {total === 0 && <span style={{ color: "var(--text-muted)", fontSize: 14 }}>{usage ? "Nothing installed yet" : "Measuring…"}</span>}
                {legend.map(sl => (
                    <div
                        key={sl.key}
                        onMouseEnter={() => { setFromLegend(true); setHover(sl.key); }}
                        onMouseLeave={() => setHover(null)}
                        style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, fontWeight: 600, cursor: "pointer", color: hover === sl.key ? "var(--text-link, #00A8FC)" : "var(--text-strong, var(--header-primary))", opacity: fade && fade !== sl.key ? 0.3 : 1, transition: "opacity 0.15s ease-out, color 0.15s ease-out" }}
                    >
                        <span style={{ width: 14, height: 14, borderRadius: "50%", background: sl.color, flexShrink: 0 }} />
                        {sl.label}: {fmtPct(sl.pct)}
                    </div>
                ))}
            </div>
            {active && !fromLegend && (
                <div style={{
                    position: "absolute",
                    left: pos.x + (pos.x > pos.w * 0.6 ? -14 : 14),
                    top: pos.y + 14,
                    transform: pos.x > pos.w * 0.6 ? "translateX(-100%)" : undefined,
                    pointerEvents: "none",
                    zIndex: 5,
                    fontSize: 13,
                    lineHeight: "18px",
                    whiteSpace: "nowrap",
                    textShadow: "0 1px 3px rgba(0, 0, 0, 0.6)"
                }}>
                    <div style={{ fontWeight: 600, color: "var(--text-link, #00A8FC)" }}>{active.label}</div>
                    {[["Size", fmtBytes(active.value)], ["Share", fmtPct(active.pct)]].map(([k, v]) => (
                        <div key={k} style={{ display: "flex", alignItems: "center", gap: 6, color: "#fff" }}>
                            <span style={{ width: 6, height: 6, borderRadius: "50%", background: active.color }} />
                            {k}: <span style={{ color: "#8ab4ff" }}>{v}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

function DirectoryOverview({ usage }: { usage: DiskUsage | null }): React.ReactElement {
    return (
        <div>
            <div style={{ display: "flex", alignItems: "center", minHeight: 24, marginBottom: 8 }}>
                <Forms.FormTitle style={{ margin: 0 }}>Directory Overview</Forms.FormTitle>
            </div>
            <Desc style={{ marginBottom: 12 }}>
                See how much disk space the Engine folder uses.
                {usage && usage.cache > 0 ? ` ${fmtBytes(usage.cache)} of it can be freed.` : ""}
            </Desc>
            <DonutChart usage={usage} />
        </div>
    );
}

// Start / Stop button with a chevron that opens a menu with Restart option.
function ServerButton(): React.ReactElement {
    const installed = useInstalled();
    const [st, setSt] = useState<{ running: boolean; starting: boolean; owned: boolean; installing: boolean; } | null>(null);
    const [busy, setBusy] = useState(false);
    const [open, setOpen] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const wrapRef = useRef<HTMLDivElement>(null);
    const refresh = () => getNative().getStatus(settings.store.engineServerPort).then(setSt).catch(() => { });
    useEffect(() => {
        refresh();
        const t = window.setInterval(refresh, 1500);
        return () => clearInterval(t);
    }, []);
    useEffect(() => {
        if (!open) return;
        const down = (e: MouseEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setOpen(false); };
        document.addEventListener("mousedown", down, true);
        return () => document.removeEventListener("mousedown", down, true);
    }, [open]);

    const { engineServerPort, useYourGraphicsCard, idleTimeout, allocatedMemory } = settings.store;
    const running = !!st?.running;
    const working = busy || !!st?.starting || !!st?.installing;
    const disabled = !installed || working;
    async function run(fn: () => Promise<{ ok: boolean; error?: string; }>) {
        setErr(null);
        setBusy(true);
        setOpen(false);
        try {
            const r = await fn();
            if (!r.ok) setErr(r.error ?? "Something went wrong.");
        } catch {
            setErr("Something went wrong.");
        }
        await refresh();
        setBusy(false);
    }
    function confirm(title: string, subtitle: string, action: string, variant: "primary" | "critical-primary", fn: () => void) {
        setOpen(false);
        openModal(props => (
            <Modal
                {...props}
                size="sm"
                title={title}
                subtitle={subtitle}
                actions={[
                    { text: "Cancel", variant: "secondary", onClick: props.onClose },
                    { text: action, variant, onClick: () => { props.onClose(); fn(); } }
                ]}
            >
            </Modal>
        ));
    }

    const start = () => run(() => getNative().ensureStarted(engineServerPort, useYourGraphicsCard, idleTimeout, allocatedMemory));
    const stop = () => run(async () => { await getNative().stop(); await new Promise(r => setTimeout(r, 600)); return { ok: true }; });
    const restart = () => run(() => getNative().restart(engineServerPort, useYourGraphicsCard, idleTimeout, allocatedMemory));
    const askStop = () => confirm(
        "Terminate IOPaint Server",
        "This stops the Engine now. Anything it is processing is cancelled, and it starts again by itself the next time you use Erase or Background.",
        "Terminate", "critical-primary", stop
    );
    const askRestart = () => confirm(
        "Restart IOPaint Server",
        "This stops the Engine and starts it again, which takes a moment. Anything it is processing is cancelled.",
        "Restart", "primary", restart
    );
    const label = st?.starting || (busy && !running) ? "Starting…" : running ? "Stop IOPaint Server" : "Start IOPaint Server";
    const canStop = running && st?.owned; // a server the user runs themselves is not ours to stop
    return (
        <div ref={wrapRef} style={{ position: "relative", width: "100%", opacity: installed ? 1 : 0.5 }}>
            <div style={{ display: "flex", alignItems: "stretch", gap: 2 }}>
                <Button
                    variant={running ? "dangerPrimary" : "primary"}
                    disabled={disabled || (running && !canStop)}
                    onClick={running ? askStop : start}
                    style={running ? { flex: 1, borderTopRightRadius: 0, borderBottomRightRadius: 0 } : { flex: 1 }}
                >
                    {label}
                </Button>
                {running && <Button
                    variant="dangerPrimary"
                    aria-label="More server actions"
                    aria-expanded={open}
                    disabled={disabled}
                    onClick={() => setOpen(o => !o)}
                    style={{ width: 40, minWidth: 40, height: "auto", padding: 0, borderTopLeftRadius: 0, borderBottomLeftRadius: 0 }}
                >
                    <svg
                        width={18}
                        height={18}
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2.5}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                        style={{ display: "block", transition: "transform 0.15s ease-out", transform: open ? "rotate(180deg)" : "none" }}
                    >
                        <path d="m6 9 6 6 6-6" />
                    </svg>
                </Button>}
            </div>
            {open && running && (
                <div style={{
                    position: "absolute",
                    top: "calc(100% + 6px)",
                    right: 0,
                    minWidth: 220,
                    padding: 6,
                    borderRadius: 8,
                    background: "var(--background-base-low, #1b1b1e)",
                    boxShadow: "0 8px 24px rgba(0, 0, 0, 0.5), 0 0 0 0.5px #55555d",
                    zIndex: 10
                }}>
                    <button
                        type="button"
                        disabled={running && !st?.owned}
                        onClick={askRestart}
                        style={{
                            width: "100%",
                            padding: "8px 10px",
                            border: "none",
                            borderRadius: 6,
                            background: "transparent",
                            color: "var(--text-default, #fff)",
                            font: "inherit",
                            fontWeight: 500,
                            textAlign: "left",
                            cursor: "pointer"
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; }}
                        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                    >
                        Restart IOPaint Server
                    </button>
                </div>
            )}
            {err && <Forms.FormText style={{ color: "var(--text-danger)", marginTop: 8 }}>{err}</Forms.FormText>}
        </div>
    );
}

function FlashTip({ text, flash, children }: { text: string | null; flash: number; children: React.ReactNode; }): React.ReactElement {
    const tipRef = useRef<{ show?: () => void; hide?: () => void; } | null>(null);

    useEffect(() => {
        if (!flash || !text) return;
        const open = window.setTimeout(() => tipRef.current?.show?.(), 60);
        const close = window.setTimeout(() => tipRef.current?.hide?.(), 2800);
        return () => { clearTimeout(open); clearTimeout(close); };
    }, [flash]);

    if (!text) return <div style={{ display: "flex", flex: 1, minWidth: 0 }}>{children}</div>;
    return (
        <Tooltip text={text} position="top" color={Tooltip.Colors?.PRIMARY} spacing={8} tooltipClassName="ae-tooltip">
            {(p: any) => {
                tipRef.current = { show: () => p.onMouseEnter?.(), hide: () => p.onMouseLeave?.() };
                return (
                    <div {...p} style={{ display: "flex", flex: 1, minWidth: 0 }}>
                        <style>{TOOLTIP_CSS}</style>
                        {children}
                    </div>
                );
            }}
        </Tooltip>
    );
}

function StorageSettings(): React.ReactElement {
    const [usage, setUsage] = useState<DiskUsage | null>(null);
    const [logCount, setLogCount] = useState<number | null>(null);
    const [cacheNote, setCacheNote] = useState<{ text: string; n: number; } | null>(null);
    const [logNote, setLogNote] = useState<{ text: string; n: number; } | null>(null);
    const [busy, setBusy] = useState(false);

    const refresh = () => getNative().getDiskUsage().then(setUsage).catch(() => { });
    const refreshLogs = () => getNative().getLogCount().then(setLogCount).catch(() => { });
    useEffect(() => {
        refresh();
        refreshLogs();
        const a = window.setInterval(refresh, 10000);
        const b = window.setInterval(refreshLogs, 2000);
        return () => { clearInterval(a); clearInterval(b); };
    }, []);
    useEffect(() => { if (logCount) setLogNote(null); }, [logCount]);
    useEffect(() => { if (usage?.cache) setCacheNote(null); }, [usage?.cache]);
    async function clearCache() {
        setBusy(true);
        const r = await getNative().clearCache();
        setCacheNote(n => ({ text: r.ok ? `Freed ${fmtBytes(r.freed)}.` : r.error, n: (n?.n ?? 0) + 1 }));
        await refresh();
        setBusy(false);
    }

    async function clearLogs() {
        await getNative().clearLogs();
        setLogCount(0);
        setLogNote(n => ({ text: "Logs cleared.", n: (n?.n ?? 0) + 1 }));
    }

    const noLogs = logCount === 0;
    const noCache = !!usage && usage.cache === 0;
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            <DirectoryOverview usage={usage} />

            <div>
                <div style={{ display: "flex", alignItems: "center", minHeight: 24, marginBottom: 8 }}>
                    <Forms.FormTitle style={{ margin: 0 }}>Logs</Forms.FormTitle>
                </div>
                <Desc style={{ marginBottom: 12 }}>
                    Browse or clear the live logs of the setup and the Engine server.
                </Desc>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ display: "flex", gap: 8 }}>
                        <Button variant="secondary" onClick={() => getNative().openConsole()} style={{ flex: 1 }}>Open Console</Button>
                        <FlashTip text={logNote?.text ?? null} flash={logNote?.n ?? 0}>
                            <Button variant="dangerPrimary" disabled={noLogs} onClick={clearLogs} style={{ flex: 1 }}>Clear Logs</Button>
                        </FlashTip>
                    </div>
                    <ServerButton />
                </div>
            </div>

            <div>
                <div style={{ display: "flex", alignItems: "center", minHeight: 24, marginBottom: 8 }}>
                    <Forms.FormTitle style={{ margin: 0 }}>Cache</Forms.FormTitle>
                </div>
                <Desc style={{ marginBottom: 12 }}>
                    Delete the installer's download cache. The Engine keeps working, and setting it up again just downloads a bit more.
                </Desc>
                <FlashTip text={cacheNote?.text ?? null} flash={cacheNote?.n ?? 0}>
                    <Button variant="secondary" disabled={busy || !usage || noCache} onClick={clearCache} style={{ width: "100%" }}>
                        {noCache ? "Clear Cache (0 B)" : `Clear Cache${usage ? ` (${fmtBytes(usage.cache)})` : ""}`}
                    </Button>
                </FlashTip>
            </div>
        </div>
    );
}

export const settings = definePluginSettings({
    engineSetup: {
        type: OptionType.COMPONENT,
        component: EngineSetup
    },
    engineInstalled: {
        type: OptionType.BOOLEAN,
        description: "Engine installed",
        default: false,
        hidden: true
    },

    autoStartYourEngineServer: {
        type: OptionType.BOOLEAN,
        description: "Start the Engine automatically",
        default: true,
        hidden: true
    },
    autoStartSwitch: {
        type: OptionType.COMPONENT,
        component: AutoStartSetting
    },
    useYourGraphicsCard: {
        type: OptionType.BOOLEAN,
        description: "Use your own GPU (Graphics Card)",
        default: false,
        hidden: true
    },
    gpuSwitch: {
        type: OptionType.COMPONENT,
        component: GpuSetting
    },

    idleTimeout: {
        type: OptionType.NUMBER,
        description: "Idle shutdown (minutes, 0 = never)",
        default: 5,
        hidden: true
    },
    idleSetting: {
        type: OptionType.COMPONENT,
        component: IdleSetting
    },
    engineServerPort: {
        type: OptionType.NUMBER,
        description: "Engine server port",
        default: 8080,
        hidden: true
    },
    portInput: {
        type: OptionType.COMPONENT,
        component: PortSetting
    },
    allocatedMemory: {
        type: OptionType.NUMBER,
        description: "Allocated memory for the Engine (MB)",
        default: DEFAULT_MEMORY_MB,
        hidden: true
    },
    memoryInput: {
        type: OptionType.COMPONENT,
        component: MemorySetting
    },
    storage: {
        type: OptionType.COMPONENT,
        component: StorageSettings
    }
});
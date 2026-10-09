/* 
   Native Module:
   Runs in Discord's main process (Electron), so it can download, install and start things the
   editor window itself is not allowed to. Everything lives in one folder inside Discord's data
   directory, so "Uninstall" is just deleting that folder.

   Generative Erase engine = IOPaint (LaMa model) in its own Python 3.11 environment, set up with `uv`. 
 */

import { ChildProcess, spawn, execFile } from "child_process";
import { totalmem, freemem } from "os";
import { app, BrowserWindow, IpcMainInvokeEvent, shell } from "electron";
import { chmodSync, createWriteStream, existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { readdir, rm, stat } from "fs/promises";
import { join } from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";

const WIN = process.platform === "win32";
const MAC = process.platform === "darwin";
const root = () => join(app.getPath("userData"), "AttachmentEditorErase");
const uvDir = () => join(root(), "uv");
const envDir = () => join(root(), "env");
const uvExe = () => join(uvDir(), WIN ? "uv.exe" : "uv");
const pyExe = () => join(envDir(), WIN ? "Scripts\\python.exe" : "bin/python");
const ioExe = () => join(envDir(), WIN ? "Scripts\\iopaint.exe" : "bin/iopaint");
const flagFile = () => join(root(), "installed.flag");
const bgFlag = () => join(root(), "removebg2.flag"); 
const bgArgs = (gpu: boolean) => gpu
    ? ["--enable-remove-bg", "--remove-bg-model=briaai/RMBG-1.4", "--remove-bg-device=cuda"]
    : ["--enable-remove-bg", "--remove-bg-model=birefnet-general-lite"];
const isInstalled = () => existsSync(flagFile()) && existsSync(ioExe());

const toolEnv = () => ({
    ...process.env,
    UV_PYTHON_INSTALL_DIR: join(root(), "python"),
    UV_CACHE_DIR: join(root(), "cache"),
    TORCH_HOME: join(root(), "models"),
    HF_HOME: join(root(), "models", "hf"),
    XDG_CACHE_HOME: join(root(), "xdg"),
    U2NET_HOME: join(root(), "models", "u2net"),
    PYTHONUTF8: "1"
});

// STATE
let installing = false;
let stage = "";
let progress = 0;
let lastError: string | undefined;
let child: ChildProcess | null = null;
let childBg = false; 
let starting: Promise<{ ok: boolean; error?: string; }> | null = null;
let startProgress = -1; 
let lastUsed = Date.now();
let idleMs = 0;
let busy = 0;
let memLimitMb = 0; 
const LOG_MAX = 3000;
const logs: string[] = [];
let consoleWin: BrowserWindow | null = null;
let consoleReady = false;

const CONSOLE_HTML = `<!doctype html><meta charset="utf-8"><title>IOPaint Console</title>
<style>html,body{margin:0;height:100%;background:#0c0c0e;color:#d6d8dc;font:12px/1.55 Consolas,Menlo,monospace}
#o{box-sizing:border-box;height:100%;overflow:auto;padding:10px 12px;white-space:pre-wrap;word-break:break-all}
#o div.c{color:#80848e}</style><div id="o"></div>
<script>const o=document.getElementById("o");let stick=true;
o.onscroll=()=>{stick=o.scrollTop+o.clientHeight>=o.scrollHeight-8};
window.__push=t=>{const d=document.createElement("div");if(t.startsWith("[")||t.startsWith(">"))d.className="c";d.textContent=t;o.appendChild(d);
while(o.childElementCount>${LOG_MAX})o.firstChild.remove();if(stick)o.scrollTop=o.scrollHeight};
window.__init=a=>a.forEach(window.__push);</script>`;

function pushLog(text: string) {
    for (const raw of text.split(/[\r\n]+/)) {
        const line = raw.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").trimEnd(); // strip colour codes
        if (!line) continue;
        logs.push(line);
        if (logs.length > LOG_MAX) logs.shift();
        if (consoleWin && !consoleWin.isDestroyed() && consoleReady)
            consoleWin.webContents.executeJavaScript(`window.__push(${JSON.stringify(line)})`).catch(() => { });
    }
}

const url = (port: number, path: string) => `http://127.0.0.1:${port}${path}`;

async function alive(port: number): Promise<boolean> {
    try {
        const r = await fetch(url(port, "/api/v1/server-config"), { signal: AbortSignal.timeout(1500) });
        return r.ok;
    } catch {
        return false;
    }
}

function setStage(text: string, p: number) {
    stage = text;
    progress = p;
    pushLog(`[setup] ${text}`);
}

// Runs a command to the end. `creepTo` makes the progress bar slowly advance while a long step runs.
function run(cmd: string, args: string[], creepTo?: number): Promise<void> {
    return new Promise((resolve, reject) => {
        let tail = "";
        pushLog(`> ${cmd} ${args.join(" ")}`);
        const p = spawn(cmd, args, { env: toolEnv(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
        const keep = (b: Buffer) => { tail = (tail + b.toString()).slice(-700); pushLog(b.toString()); };
        p.stdout.on("data", keep);
        p.stderr.on("data", keep);
        const creep = creepTo === undefined ? 0 : setInterval(() => {
            progress += (creepTo - progress) * 0.03;
        }, 2000);
        const done = () => { if (creep) clearInterval(creep); };
        p.on("error", e => { done(); reject(e); });
        p.on("close", code => {
            done();
            if (code === 0) resolve();
            else reject(new Error(`Setup step failed (code ${code}). ${tail.trim().split("\n").slice(-4).join(" ")}`));
        });
    });
}

async function download(from: string, to: string) {
    const res = await fetch(from);
    if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}) from ${new URL(from).host}`);
    await pipeline(Readable.fromWeb(res.body as any), createWriteStream(to));
}
function uvAsset() {
    const arch = process.arch === "arm64" ? "aarch64" : "x86_64";
    if (WIN) return `uv-${arch}-pc-windows-msvc.zip`;
    if (MAC) return `uv-${arch}-apple-darwin.tar.gz`;
    return `uv-${arch}-unknown-linux-gnu.tar.gz`;
}

// PUBLIC API
export function getStatus(_: IpcMainInvokeEvent, port: number) {
    return alive(port).then(up => ({
        installed: isInstalled(),
        installing,
        starting: !!starting,
        startProgress,
        running: up,
        owned: !!child, 
        stage,
        progress: Math.round(progress),
        error: lastError
    }));
}

export function detectNvidia(_: IpcMainInvokeEvent): Promise<boolean> {
    if (MAC) return Promise.resolve(false); 
    return new Promise(resolve => {
        execFile("nvidia-smi", ["-L"], { timeout: 4000, windowsHide: true }, (err, out) =>
            resolve(!err && /GPU \d+:/.test(String(out))));
    });
}

// Sources: github.com/astral-sh (uv), pypi.org (iopaint, torch), download.pytorch.org (GPU torch), the LaMa model via IOPaint.
export async function install(_: IpcMainInvokeEvent, gpu: boolean) {
    if (installing) return { ok: false, error: "Already installing" };
    installing = true;
    lastError = undefined;
    try {
        mkdirSync(uvDir(), { recursive: true });
        if (!existsSync(uvExe())) {
            setStage("Downloading installer", 3);
            const archive = join(root(), uvAsset());
            await download(`https://github.com/astral-sh/uv/releases/latest/download/${uvAsset()}`, archive);
            // tar ships with Windows 10+, macOS and Linux, and reads both .zip and .tar.gz
            await run("tar", WIN ? ["-xf", archive, "-C", uvDir()] : ["-xzf", archive, "-C", uvDir(), "--strip-components=1"]);
            if (!WIN) chmodSync(uvExe(), 0o755);
            rmSync(archive, { force: true });
        }
        setStage("Setting up Python", 10);
        rmSync(envDir(), { recursive: true, force: true });
        await run(uvExe(), ["venv", "--python", "3.11", envDir()], 25);
        if (gpu && !MAC) {
            setStage("Installing GPU libraries", 25);
            await run(uvExe(), ["pip", "install", "--python", pyExe(), "torch", "torchvision", "--index-url", "https://download.pytorch.org/whl/cu124"], 55);
        }
        setStage("Installing the AI engine", gpu ? 55 : 25);
        await run(uvExe(), ["pip", "install", "--python", pyExe(), "iopaint"], 85);
        setStage("Downloading the AI model", 85);
        await run(ioExe(), ["download", "--model", "lama"], 98);
        setStage("Cleaning up", 99);
        dropCache();
        writeFileSync(flagFile(), new Date().toISOString());
        setStage("Done", 100);
        return { ok: true };
    } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        return { ok: false, error: lastError };
    } finally {
        installing = false;
    }
}
function dropCache() {
    try { rmSync(join(root(), "cache"), { recursive: true, force: true }); } catch { /* in use, "Clear Cache" can do it later */ }
}

function killStray(): Promise<void> {
    return new Promise(resolve => {
        const dir = root();
        if (WIN) {
            const ps = `Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith('${dir.replace(/'/g, "''")}') } | Stop-Process -Force`;
            execFile("powershell", ["-NoProfile", "-Command", ps], { timeout: 10000, windowsHide: true }, () => resolve());
        } else {
            execFile("ps", ["-axo", "pid=,command="], { timeout: 5000, maxBuffer: 8 * 1024 * 1024 }, (err, out) => {
                if (!err) {
                    for (const line of String(out).split("\n")) {
                        const m = line.trim().match(/^(\d+)\s+(.*)$/);
                        if (m && m[2].includes(dir) && Number(m[1]) !== process.pid) {
                            try { process.kill(Number(m[1]), "SIGKILL"); } catch { /* gone */ }
                        }
                    }
                }
                resolve();
            });
        }
    });
}

function killChild() {
    const c = child;
    child = null;
    if (!c || c.pid === undefined) return;
    try {
        // on Windows the iopaint.exe launcher has a Python child of its own, so kill the whole tree
        if (WIN) spawn("taskkill", ["/pid", String(c.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        else c.kill("SIGTERM");
    } catch { /* already gone */ }
}

export async function stop(_: IpcMainInvokeEvent) {
    killChild();
}

// Stops the engine we started, waits until it has really gone, then starts it again
export async function restart(e: IpcMainInvokeEvent, port: number, gpu: boolean, idleMinutes: number, memoryMb = 0) {
    killChild();
    for (let i = 0; i < 40 && await alive(port); i++) await new Promise(r => setTimeout(r, 250));
    if (await alive(port)) return { ok: false as const, error: "The engine is still running (it was not started by this plugin), so it cannot be restarted from here." };
    return ensureStarted(e, port, gpu, idleMinutes, memoryMb);
}

export function ensureStarted(_: IpcMainInvokeEvent, port: number, gpu: boolean, idleMinutes: number, memoryMb = 0) {
    memLimitMb = Math.max(0, memoryMb);
    lastUsed = Date.now();
    idleMs = Math.max(0, idleMinutes) * 60_000;
    if (starting) return starting;
    starting = (async () => {
        try {
            if (await alive(port)) return { ok: true }; // already running (ours or the user's own)
            if (!isInstalled()) return { ok: false, error: "Generative Erase is not set up yet." };
            lastError = undefined;
            const bgOn = existsSync(bgFlag());
            const startArgs = ["start", "--model=lama", `--port=${port}`, "--host=127.0.0.1", `--device=${gpu ? "cuda" : "cpu"}`, ...(bgOn ? bgArgs(gpu) : [])];
            pushLog(`> iopaint ${startArgs.join(" ")}`);
            const c = spawn(ioExe(), startArgs, {
                env: toolEnv(),
                windowsHide: true,
                stdio: ["ignore", "pipe", "pipe"]
            });
            c.stdout?.on("data", (b: Buffer) => pushLog(b.toString()));
            c.stderr?.on("data", (b: Buffer) => pushLog(b.toString()));
            child = c;
            childBg = bgOn;
            startProgress = 0;
            let exited = false;
            c.on("exit", code => { exited = true; if (child === c) child = null; pushLog(`[engine stopped${code === null ? "" : ` (code ${code})`}]`); });
            c.on("error", e => { exited = true; lastError = e.message; pushLog(`[engine error] ${e.message}`); });
            for (let i = 0; i < 360; i++) {
                if (exited) break;
                if (await alive(port)) { startProgress = 100; return { ok: true }; }
                startProgress += (95 - startProgress) * 0.025;
                await new Promise(r => setTimeout(r, 500));
            }
            killChild();
            lastError = "The Generative Erase engine did not start. Check that port " + port + " is free.";
            return { ok: false, error: lastError };
        } finally {
            starting = null;
            startProgress = -1;
        }
    })();
    return starting;
}

// Sends the picture and mask to the local engine from here, so the editor window never has to talk to localhost itself
export async function inpaint(_: IpcMainInvokeEvent, image: string, mask: string, port: number, idleMinutes: number, memoryMb = 0) {
    memLimitMb = Math.max(0, memoryMb);
    lastUsed = Date.now();
    idleMs = Math.max(0, idleMinutes) * 60_000;
    busy++;
    try {
        const lowMem = memLimitMb > 0 && memLimitMb < 2000;
        const res = await fetch(url(port, "/api/v1/inpaint"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                image,
                mask,
                hd_strategy: "Crop",
                hd_strategy_crop_margin: lowMem ? 64 : 128,
                hd_strategy_crop_trigger_size: lowMem ? 640 : 800,
                hd_strategy_resize_limit: lowMem ? 1280 : 2048,
                ldm_steps: 20,
                sd_steps: 20
            })
        });
        if (!res.ok) return { ok: false as const, error: "The local AI could not erase that area." };
        return {
            ok: true as const,
            type: res.headers.get("content-type") || "image/png",
            data: Buffer.from(await res.arrayBuffer()).toString("base64")
        };
    } catch (e) {
        return { ok: false as const, error: "Could not reach the Generative Erase engine." };
    } finally {
        lastUsed = Date.now();
        busy--;
    }
}

export async function removeBg(e: IpcMainInvokeEvent, image: string, port: number, gpu: boolean, idleMinutes: number, memoryMb = 0) {
    memLimitMb = Math.max(0, memoryMb);
    lastUsed = Date.now();
    idleMs = Math.max(0, idleMinutes) * 60_000;
    busy++;
    try {
        if (!isInstalled()) return { ok: false as const, error: "Set up Generative Erase first (in the Erase tab). Removing backgrounds uses the same engine." };
        let restart = !!child && !childBg;
        if (!existsSync(bgFlag())) {
            killChild();
            await killStray();
            for (let i = 0; i < 20 && await alive(port); i++) await new Promise(r => setTimeout(r, 250));
            await new Promise(r => setTimeout(r, 500));
            try {
                await run(uvExe(), ["pip", "install", "--python", pyExe(), "rembg>=2.0.59", "onnxruntime"]);
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                if (/RECORD|Access is denied|os error 5/i.test(msg)) { return { ok: false as const, error: "Adding the background remover failed because the Engine's files were locked or left half-updated. Use Uninstall in the plugin settings, then set the Engine up again." }; }
                throw err;
            }
            dropCache();
            writeFileSync(bgFlag(), new Date().toISOString());
            restart = !!child;
        }
        if (restart) {
            killChild();
            for (let i = 0; i < 20 && await alive(port); i++) await new Promise(r => setTimeout(r, 250));
        }
        const started = await ensureStarted(e, port, gpu, idleMinutes, memoryMb);
        if (!started.ok) return { ok: false as const, error: started.error ?? "The engine could not start." };

        const res = await fetch(url(port, "/api/v1/run_plugin_gen_image"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: "RemoveBG", image, clicks: [], scale: 1 })
        });
        if (!res.ok) return { ok: false as const, error: "The engine could not remove the background. If you run your own IOPaint server, start it with --enable-remove-bg." };
        return {
            ok: true as const,
            type: res.headers.get("content-type") || "image/png",
            data: Buffer.from(await res.arrayBuffer()).toString("base64")
        };
    } catch (err) {
        return { ok: false as const, error: err instanceof Error ? err.message : "Could not remove the background." };
    } finally {
        lastUsed = Date.now();
        busy--;
    }
}

// Deletes the whole engine folder (environment, Python, models, cache, everything) and reports how much was freed
export async function uninstall(_: IpcMainInvokeEvent) {
    if (installing) return { ok: false as const, error: "Wait until the setup has finished." };
    killChild();
    await killStray();
    await new Promise(r => setTimeout(r, 800)); // let the system release the files
    const dir = root();
    const before = await dirSize(dir);
    for (let attempt = 0; attempt < 6 && existsSync(dir); attempt++) {
        try { await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 }); } catch { /* retry below */ }
        if (existsSync(dir)) {
            await killStray();
            await new Promise(r => setTimeout(r, 1000));
        }
    }
    if (existsSync(dir)) {
        const left = await dirSize(dir);
        pushLog(`[uninstall] Could not delete everything, ${left} bytes are left in ${dir}`);
        return { ok: false as const, error: "Some files are still in use. Close Discord and delete this folder yourself: " + dir };
    }
    lastError = undefined;
    stage = "";
    progress = 0;
    pushLog(`[uninstall] Deleted ${dir} (${before} bytes)`);
    return { ok: true as const, freed: before };
}

// Opens the engine's folder in the system file manager
export async function openFolder(_: IpcMainInvokeEvent) {
    try {
        mkdirSync(root(), { recursive: true });
        const err = await shell.openPath(root());
        return err ? { ok: false as const, error: err } : { ok: true as const };
    } catch (e) {
        return { ok: false as const, error: e instanceof Error ? e.message : "Could not open the folder." };
    }
}

// Opens the live console window
export function openConsole(_: IpcMainInvokeEvent) {
    if (consoleWin && !consoleWin.isDestroyed()) {
        if (consoleWin.isMinimized()) consoleWin.restore();
        consoleWin.focus();
        return;
    }
    if (!logs.length) pushLog("[console] Nothing has run yet. Setup and engine output will show up here.");
    consoleReady = false;
    const win = new BrowserWindow({
        width: 900,
        height: 520,
        title: "IOPaint Console",
        backgroundColor: "#0c0c0e",
        autoHideMenuBar: true,
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
    });
    consoleWin = win;
    win.webContents.on("did-finish-load", () => {
        win.webContents.executeJavaScript(`window.__init(${JSON.stringify(logs)})`)
            .then(() => { consoleReady = true; })
            .catch(() => { });
    });
    win.on("closed", () => { if (consoleWin === win) { consoleWin = null; consoleReady = false; } });
    win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(CONSOLE_HTML));
}


// MEMORY
export function getSystemMemory(_: IpcMainInvokeEvent) {
    return { totalMb: Math.floor(totalmem() / 1048576), freeMb: Math.floor(freemem() / 1048576) };
}

function engineMemoryMb(): Promise<number> {
    return new Promise(resolve => {
        const env = envDir();
        if (WIN) {
            const ps = `(Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith('${env.replace(/'/g, "''")}') } | Measure-Object WorkingSet64 -Sum).Sum`;
            execFile("powershell", ["-NoProfile", "-Command", ps], { timeout: 5000, windowsHide: true }, (err, out) =>
                resolve(err ? 0 : Math.round((Number(String(out).trim()) || 0) / 1048576)));
        } else {
            execFile("ps", ["-axo", "rss=,command="], { timeout: 5000, maxBuffer: 8 * 1024 * 1024 }, (err, out) => {
                if (err) return resolve(0);
                let kb = 0;
                for (const line of String(out).split("\n")) {
                    const m = line.trim().match(/^(\d+)\s+(.*)$/);
                    if (m && m[2].includes(env)) kb += Number(m[1]);
                }
                resolve(Math.round(kb / 1024));
            });
        }
    });
}

// DISK USAGE / CLEAN-UP
async function dirSize(path: string): Promise<number> {
    let total = 0;
    let entries;
    try { entries = await readdir(path, { withFileTypes: true }); } catch { return 0; }
    for (const e of entries) {
        const p = join(path, e.name);
        try {
            if (e.isDirectory()) total += await dirSize(p);
            else if (e.isFile()) total += (await stat(p)).size;
        } catch { /* file vanished */ }
    }
    return total;
}

// Sizes in bytes of the engine folder's parts. `cache` is what "Clear Cache" can delete.
export async function getDiskUsage(_: IpcMainInvokeEvent) {
    const r = root();
    if (!existsSync(r)) return { total: 0, engine: 0, models: 0, python: 0, cache: 0, other: 0 };
    const [engine, models, python, cache, uv, total] = await Promise.all([
        dirSize(envDir()), dirSize(join(r, "models")), dirSize(join(r, "python")),
        dirSize(join(r, "cache")), dirSize(uvDir()), dirSize(r)
    ]);
    return { total, engine, models, python, cache, other: Math.max(0, total - engine - models - python - cache - uv) + uv };
}

// Deletes the package download cache (uv). 
export async function clearCache(_: IpcMainInvokeEvent) {
    if (installing) return { ok: false as const, error: "Wait until the setup has finished." };
    try {
        const dir = join(root(), "cache");
        const freed = await dirSize(dir);
        rmSync(dir, { recursive: true, force: true });
        return { ok: true as const, freed };
    } catch {
        return { ok: false as const, error: "Some cache files are in use." };
    }
}

export const getLogCount = (_: IpcMainInvokeEvent) => logs.length;
export function clearLogs(_: IpcMainInvokeEvent) {
    logs.length = 0;
    if (consoleWin && !consoleWin.isDestroyed()) {
        consoleReady = false;
        consoleWin.webContents.executeJavaScript(`document.getElementById("o").replaceChildren()`)
            .then(() => { consoleReady = true; }).catch(() => { consoleReady = true; });
    }
}

setInterval(() => {
    if (child && !busy && !starting && idleMs > 0 && Date.now() - lastUsed > idleMs) killChild();
}, 20_000).unref?.();

let checking = false;
setInterval(async () => {
    if (!child || !memLimitMb || checking) return;
    checking = true;
    try {
        const used = await engineMemoryMb();
        if (used > memLimitMb && child && !busy && !starting) {
            pushLog(`[engine] Using ${used} MB, over the ${memLimitMb} MB limit. Stopping it to free memory.`);
            killChild();
        }
    } finally {
        checking = false;
    }
}, 15_000).unref?.();
app.on("before-quit", killChild);
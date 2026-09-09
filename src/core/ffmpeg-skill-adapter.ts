import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export const FFMPEG_SKILL_VERSION = "0.15.3";
export const FFMPEG_SKILL_COMMIT = "7dfbdc5b30a622dbb3c7029e690280b7ac43615e";
export const FFMPEG_SKILL_REPOSITORY = "https://github.com/kajisho5/ffmpeg-skill.git";

export type FfmpegSkillOperation = "doctor" | "contract" | "render" | "probe" | "check" | "look";

export interface FfmpegSkillStatus {
  installed: boolean;
  usable: boolean;
  version: string;
  expectedCommit: string;
  installedCommit?: string;
  root: string;
  python: string;
  reason?: string;
}

function defaultRoot(): string {
  const explicit = String(process.env.CEO_MEDIA_FFMPEG_SKILL_DIR || "").trim();
  if (explicit) return path.resolve(explicit);
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, "Ceo", "addons", "ffmpeg-skill", FFMPEG_SKILL_VERSION);
  }
  return path.resolve(".ceo", "addons", "ffmpeg-skill", FFMPEG_SKILL_VERSION);
}

function pythonExecutable(): string {
  const explicit = String(process.env.CEO_MEDIA_PYTHON || "").trim();
  if (explicit) return explicit;
  return process.platform === "win32" ? "python" : "python3";
}

function readJsonFile(file: string): Record<string, any> | null {
  try { return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, any>; }
  catch { return null; }
}

export function ffmpegSkillRoot(): string { return defaultRoot(); }

export function ffmpegSkillStatus(): FfmpegSkillStatus {
  const root = defaultRoot();
  const pkg = readJsonFile(path.join(root, "package.json"));
  const source = readJsonFile(path.join(root, ".ceo-source.json"));
  const scriptsReady = ["_contract.py", "render.py", "probe.py", "check.py", "look.py"]
    .every((name) => fs.existsSync(path.join(root, "scripts", name)));
  const installed = Boolean(pkg && scriptsReady);
  const installedCommit = source?.commit ? String(source.commit) : undefined;
  const versionOk = String(pkg?.version || "") === FFMPEG_SKILL_VERSION;
  const commitOk = installedCommit === FFMPEG_SKILL_COMMIT;
  const usable = installed && versionOk && commitOk;
  return {
    installed,
    usable,
    version: String(pkg?.version || FFMPEG_SKILL_VERSION),
    expectedCommit: FFMPEG_SKILL_COMMIT,
    installedCommit,
    root,
    python: pythonExecutable(),
    ...(!usable ? { reason: !installed ? "ffmpeg-skill is not installed" : !versionOk ? `expected ${FFMPEG_SKILL_VERSION}, found ${pkg?.version || "unknown"}` : `source commit mismatch: expected ${FFMPEG_SKILL_COMMIT}, found ${installedCommit || "unknown"}` } : {})
  };
}

function parseJsonOutput(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) return {};
  try { return JSON.parse(trimmed); }
  catch {
    const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      try { return JSON.parse(lines[i]); } catch { /* keep looking */ }
    }
    return { stdout: trimmed };
  }
}

async function runPython(script: string, args: string[], allowNonZero = false): Promise<{ code: number; result: unknown; stderr: string; argv: string[] }> {
  const status = ffmpegSkillStatus();
  if (!status.usable) throw new Error(status.reason || "ffmpeg-skill is not usable");
  const scriptPath = path.join(status.root, "scripts", script);
  const argv = [scriptPath, ...args];
  const outcome = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(status.python, argv, { cwd: status.root, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout = (stdout + String(chunk)).slice(-2_000_000); });
    child.stderr.on("data", (chunk) => { stderr = (stderr + String(chunk)).slice(-200_000); });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code: Number(code ?? 1), stdout, stderr }));
  });
  if (outcome.code !== 0 && !allowNonZero) {
    throw new Error(`ffmpeg-skill ${script} exited ${outcome.code}: ${outcome.stderr.slice(-4000)}`);
  }
  return { code: outcome.code, result: parseJsonOutput(outcome.stdout), stderr: outcome.stderr, argv };
}

export async function runFfmpegSkill(operation: FfmpegSkillOperation, args: Record<string, any> = {}): Promise<unknown> {
  if (operation === "doctor") return (await runPython("_contract.py", ["doctor", "--json"], true)).result;
  if (operation === "contract") return (await runPython("_contract.py", ["--json", ...(args.static ? ["--static"] : [])])).result;
  if (operation === "render") {
    if (!args.project) throw new Error("render requires project");
    return (await runPython("render.py", [path.resolve(String(args.project)), "--json", ...(args.work ? ["--work", path.resolve(String(args.work))] : []), ...(args.keep ? ["--keep"] : []), ...(args.fast ? ["--fast"] : [])])).result;
  }
  if (operation === "probe") {
    if (!args.input) throw new Error("probe requires input");
    return (await runPython("probe.py", [path.resolve(String(args.input)), "--json", ...(args.analyze ? ["--analyze"] : [])])).result;
  }
  if (operation === "check") {
    if (!args.input) throw new Error("check requires input");
    const argv = [path.resolve(String(args.input)), "--json"];
    if (args.platform) argv.push("--platform", String(args.platform));
    if (args.aspect) argv.push("--aspect", String(args.aspect));
    if (args.lufs != null) argv.push("--lufs", String(args.lufs));
    if (args.tp != null) argv.push("--tp", String(args.tp));
    if (args.noLoudness) argv.push("--no-loudness");
    const outcome = await runPython("check.py", argv, true);
    return { exitCode: outcome.code, ...(typeof outcome.result === "object" && outcome.result ? outcome.result as object : { result: outcome.result }) };
  }
  if (operation === "look") {
    if (!args.input) throw new Error("look requires input");
    const argv = [path.resolve(String(args.input)), "--json"];
    if (args.output) argv.push("--output", path.resolve(String(args.output)));
    if (args.tiles) argv.push("--tiles", String(args.tiles));
    if (args.width != null) argv.push("--width", String(args.width));
    if (args.noTimecode) argv.push("--no-timecode");
    return (await runPython("look.py", argv)).result;
  }
  throw new Error(`Unsupported ffmpeg-skill operation: ${operation}`);
}

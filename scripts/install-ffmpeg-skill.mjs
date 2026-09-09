import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const VERSION = "0.15.3";
const COMMIT = "7dfbdc5b30a622dbb3c7029e690280b7ac43615e";
const REPO = "https://github.com/kajisho5/ffmpeg-skill.git";

function destination() {
  if (process.env.CEO_MEDIA_FFMPEG_SKILL_DIR?.trim()) return path.resolve(process.env.CEO_MEDIA_FFMPEG_SKILL_DIR.trim());
  if (process.platform === "win32" && process.env.LOCALAPPDATA) return path.join(process.env.LOCALAPPDATA, "Ceo", "addons", "ffmpeg-skill", VERSION);
  return path.resolve(".ceo", "addons", "ffmpeg-skill", VERSION);
}

function run(executable, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += String(d); });
    child.stderr.on("data", (d) => { stderr += String(d); });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${executable} ${args.join(" ")} exited ${code}: ${stderr.slice(-4000)}`)));
  });
}

async function verify(root) {
  try {
    const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
    const source = JSON.parse(await readFile(path.join(root, ".ceo-source.json"), "utf8"));
    return pkg.version === VERSION && source.commit === COMMIT;
  } catch { return false; }
}

const dest = destination();
if (await verify(dest)) {
  console.log(JSON.stringify({ installed: true, reused: true, version: VERSION, commit: COMMIT, path: dest }, null, 2));
  process.exit(0);
}

const parent = path.dirname(dest);
await mkdir(parent, { recursive: true });
const temp = await mkdtemp(path.join(parent, `.ffmpeg-skill-${VERSION}-`));
try {
  await run("git", ["init", "--quiet"], temp);
  await run("git", ["remote", "add", "origin", REPO], temp);
  await run("git", ["fetch", "--quiet", "--depth", "1", "origin", COMMIT], temp);
  await run("git", ["checkout", "--quiet", "--detach", "FETCH_HEAD"], temp);
  const actual = (await run("git", ["rev-parse", "HEAD"], temp)).stdout.trim();
  if (actual !== COMMIT) throw new Error(`ffmpeg-skill pin mismatch: expected ${COMMIT}, fetched ${actual}`);
  const pkg = JSON.parse(await readFile(path.join(temp, "package.json"), "utf8"));
  if (pkg.version !== VERSION) throw new Error(`ffmpeg-skill version mismatch: expected ${VERSION}, fetched ${pkg.version}`);
  await rm(path.join(temp, ".git"), { recursive: true, force: true });
  await writeFile(path.join(temp, ".ceo-source.json"), JSON.stringify({ repository: REPO, version: VERSION, commit: COMMIT, installedAt: new Date().toISOString() }, null, 2), "utf8");
  await rm(dest, { recursive: true, force: true });
  await rename(temp, dest);
  console.log(JSON.stringify({ installed: true, reused: false, version: VERSION, commit: COMMIT, path: dest }, null, 2));
} catch (error) {
  await rm(temp, { recursive: true, force: true }).catch(() => {});
  throw error;
}

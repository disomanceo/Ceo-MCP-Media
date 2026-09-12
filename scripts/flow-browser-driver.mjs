#!/usr/bin/env node
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";

const FLOW_URL = process.env.CEO_MEDIA_FLOW_URL || "https://flow.google.com/";
const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
const dataRoot = process.env.CEO_MEDIA_DATA_DIR || path.join(localAppData, "Ceo", "media-data");
const stateRoot = process.env.CEO_MEDIA_FLOW_STATE_DIR || path.join(dataRoot, "flow-native");
const profileDir = process.env.CEO_MEDIA_FLOW_PROFILE_DIR || path.join(localAppData, "Ceo", "flow-browser-profile");
const authFile = path.join(stateRoot, "auth-state.json");
const operationDir = path.join(stateRoot, "operations");
const requestDir = path.join(stateRoot, "requests");
const downloadDir = path.join(stateRoot, "downloads");
const AUTH_TTL_MS = Math.max(60_000, Number(process.env.CEO_MEDIA_FLOW_AUTH_TTL_MS || 12 * 60 * 60 * 1000));

function chromeCandidates() {
  return [
    process.env.CEO_MEDIA_FLOW_CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    path.join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
  ].filter(Boolean);
}

function chromePath() {
  return chromeCandidates().find((candidate) => fs.existsSync(candidate)) || "";
}

function nowIso() { return new Date().toISOString(); }
function safeJson(value) { return JSON.stringify(value, null, 2); }
function hash(value) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function operationFile(id) { return path.join(operationDir, `${id}.json`); }
function requestFile(digest) { return path.join(requestDir, `${digest}.json`); }

async function ensureDirs() {
  await Promise.all([stateRoot, operationDir, requestDir, downloadDir, profileDir].map((dir) => fsp.mkdir(dir, { recursive: true })));
}

async function readJson(file) {
  try { return JSON.parse(await fsp.readFile(file, "utf8")); } catch { return null; }
}

async function writeJson(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(temp, safeJson(value), "utf8");
  await fsp.rename(temp, file);
}

async function readInput() {
  if (process.stdin.isTTY) return {};
  let raw = "";
  for await (const chunk of process.stdin) raw += String(chunk);
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

async function authState() {
  const auth = await readJson(authFile);
  const checked = auth?.checkedAt ? Date.parse(auth.checkedAt) : 0;
  return {
    authenticated: auth?.authenticated === true && checked > 0 && Date.now() - checked <= AUTH_TTL_MS,
    checkedAt: auth?.checkedAt || null,
    url: auth?.url || null
  };
}

async function markAuth(authenticated, url, details = {}) {
  const value = { authenticated: authenticated === true, checkedAt: nowIso(), url: String(url || ""), ...details };
  await writeJson(authFile, value);
  return value;
}

async function launchContext({ headed = false } = {}) {
  const executablePath = chromePath();
  if (!executablePath) throw new Error("[BROWSER_NOT_FOUND] Google Chrome or Microsoft Edge was not found");
  await ensureDirs();
  return chromium.launchPersistentContext(profileDir, {
    executablePath,
    headless: !headed,
    acceptDownloads: true,
    viewport: { width: 1440, height: 1000 },
    locale: process.env.CEO_MEDIA_FLOW_LOCALE || "th-TH",
    args: ["--disable-background-timer-throttling", "--disable-renderer-backgrounding"]
  });
}

async function inspectPage(page) {
  const url = page.url();
  const body = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  const lower = body.toLowerCase();
  const captchaCount = await page.locator('iframe[src*="recaptcha"], iframe[title*="reCAPTCHA"], [class*="captcha" i], [id*="captcha" i]').count().catch(() => 0);
  const authRequired = /accounts\.google\.com/i.test(url) || /ลงชื่อเข้าใช้|sign in to|sign in with google|choose an account/i.test(lower);
  const landing = /flow\.google\.com\/about/i.test(url) || /สร้างด้วย google flow|create with google flow|ลองใช้ google flow|try google flow/i.test(lower) && /ราคา|pricing|คำถามที่พบบ่อย|frequently asked/i.test(lower);
  const captcha = captchaCount > 0 || /recaptcha|ยืนยันว่าคุณไม่ใช่โปรแกรมอัตโนมัติ/i.test(lower);
  const app = /flow\.google\.com/i.test(url) && !landing && !authRequired;
  return { url, title: await page.title().catch(() => ""), body: body.slice(0, 20_000), authRequired, landing, captcha, app };
}

async function enterFlow(page) {
  await page.goto(FLOW_URL, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForTimeout(1200);
  let state = await inspectPage(page);
  if (state.landing) {
    const start = page.getByRole("button", { name: /สร้างด้วย Google Flow|ลองใช้ Google Flow|Create with Google Flow|Try Google Flow/i }).first();
    if (await start.isVisible().catch(() => false)) {
      await start.click();
      await page.waitForTimeout(1200);
      state = await inspectPage(page);
    }
  }
  return state;
}

async function authOpen() {
  const executablePath = chromePath();
  if (!executablePath) throw new Error("[BROWSER_NOT_FOUND] Google Chrome or Microsoft Edge was not found");
  await ensureDirs();
  const args = [`--user-data-dir=${profileDir}`, "--no-first-run", "--no-default-browser-check", FLOW_URL];
  const child = spawn(executablePath, args, { detached: true, stdio: "ignore", windowsHide: false });
  child.unref();
  return { opened: true, pid: child.pid, profileDir, url: FLOW_URL, instructions: "Sign in to Google manually in the opened Ceo Flow browser profile, complete any 2FA/CAPTCHA yourself, then close that browser window and run auth.check." };
}

async function authCheck() {
  const context = await launchContext({ headed: false });
  try {
    const page = context.pages()[0] || await context.newPage();
    const state = await enterFlow(page);
    const authenticated = state.app && !state.captcha && !state.authRequired;
    const saved = await markAuth(authenticated, state.url, { captcha: state.captcha, landing: state.landing });
    return { ...saved, profileDir, reason: authenticated ? "Google Flow session is ready" : state.captcha ? "CAPTCHA requires manual completion" : "Google sign-in is required" };
  } finally {
    await context.close().catch(() => {});
  }
}

async function health() {
  await ensureDirs();
  const executablePath = chromePath();
  const auth = await authState();
  return {
    ready: Boolean(executablePath) && auth.authenticated,
    capabilities: ["video"],
    browserPath: executablePath || null,
    profileDir,
    stateRoot,
    authenticated: auth.authenticated,
    authCheckedAt: auth.checkedAt,
    reason: !executablePath ? "Chrome/Edge not found" : auth.authenticated ? "Ceo Flow Browser session ready" : "Run media.flow.local_auth action=open, sign in manually, then action=check"
  };
}

async function loadOperation(id) {
  const state = await readJson(operationFile(id));
  if (!state) throw new Error(`[OPERATION_NOT_FOUND] Flow operation not found: ${id}`);
  return state;
}

async function saveOperation(state) {
  state.updatedAt = nowIso();
  await writeJson(operationFile(state.id), state);
  return state;
}

async function findReusable(requestDigest) {
  const index = await readJson(requestFile(requestDigest));
  if (!index?.operationId) return null;
  const state = await readJson(operationFile(index.operationId));
  if (!state) return null;
  if (["failed", "cancelled"].includes(state.status)) return null;
  return state;
}

async function linkRequest(requestDigest, operationId) {
  await writeJson(requestFile(requestDigest), { operationId, linkedAt: nowIso() });
}

async function choosePromptBox(page) {
  const candidates = page.locator('textarea, [contenteditable="true"], [role="textbox"], input[type="text"]');
  const count = await candidates.count();
  let fallback = null;
  for (let i = count - 1; i >= 0; i--) {
    const item = candidates.nth(i);
    if (!await item.isVisible().catch(() => false)) continue;
    fallback ||= item;
    const label = `${await item.getAttribute("placeholder").catch(() => "") || ""} ${await item.getAttribute("aria-label").catch(() => "") || ""}`.toLowerCase();
    if (/prompt|describe|what.*create|พรอมต์|อธิบาย|อยากสร้าง|สร้างอะไร/.test(label)) return item;
  }
  return fallback;
}

async function uploadReferences(page, references) {
  const existing = references.filter((file) => file && fs.existsSync(file));
  if (!existing.length) return { requested: references.length, uploaded: 0, missing: references.filter((file) => !fs.existsSync(file)) };
  let inputs = page.locator('input[type="file"]');
  if (await inputs.count() === 0) {
    const add = page.getByRole("button", { name: /upload|add (?:media|image|reference|ingredient)|reference|ingredients|อัปโหลด|เพิ่ม(?:รูป|สื่อ|ภาพ)|รูปภาพ/i }).first();
    if (await add.isVisible().catch(() => false)) {
      await add.click().catch(() => {});
      await page.waitForTimeout(500);
      inputs = page.locator('input[type="file"]');
    }
  }
  if (await inputs.count() === 0) return { requested: references.length, uploaded: 0, missing: [], unsupported: true };
  const input = inputs.last();
  const multiple = await input.getAttribute("multiple");
  const files = multiple != null ? existing.slice(0, 3) : existing.slice(0, 1);
  await input.setInputFiles(files);
  await page.waitForTimeout(800);
  return { requested: references.length, uploaded: files.length, missing: references.filter((file) => !fs.existsSync(file)) };
}

async function chooseAspect(page, aspectRatio) {
  if (!aspectRatio || !["16:9", "9:16", "1:1"].includes(aspectRatio)) return { requested: aspectRatio || null, confirmed: false };
  const exact = page.getByText(aspectRatio, { exact: true });
  const count = await exact.count();
  for (let i = 0; i < count; i++) {
    const item = exact.nth(i);
    if (await item.isVisible().catch(() => false)) {
      await item.click().catch(() => {});
      await page.waitForTimeout(300);
      return { requested: aspectRatio, confirmed: true, method: "visible-exact" };
    }
  }
  const trigger = page.getByRole("button", { name: /aspect|ratio|สัดส่วน|แนวตั้ง|แนวนอน/i }).first();
  if (await trigger.isVisible().catch(() => false)) {
    await trigger.click().catch(() => {});
    await page.waitForTimeout(250);
    const option = page.getByText(aspectRatio, { exact: true }).last();
    if (await option.isVisible().catch(() => false)) {
      await option.click();
      return { requested: aspectRatio, confirmed: true, method: "menu" };
    }
  }
  return { requested: aspectRatio, confirmed: false };
}

async function findGenerateButton(page) {
  const regex = /^(?:generate|create|สร้าง|สร้างวิดีโอ|generate video|create video)$/i;
  const buttons = page.getByRole("button");
  const count = await buttons.count();
  for (let i = count - 1; i >= 0; i--) {
    const button = buttons.nth(i);
    if (!await button.isVisible().catch(() => false)) continue;
    const name = (await button.getAttribute("aria-label").catch(() => "")) || (await button.innerText().catch(() => ""));
    if (regex.test(String(name || "").trim())) return button;
  }
  return null;
}

async function prepareVideoPage(page, request) {
  const state = await enterFlow(page);
  if (state.captcha) throw new Error("[CAPTCHA_REQUIRED] Google Flow requires manual CAPTCHA completion in the Ceo Flow browser profile");
  if (state.authRequired || state.landing || !state.app) {
    await markAuth(false, state.url, { captcha: state.captcha, landing: state.landing });
    throw new Error("[AUTH_REQUIRED] Google Flow requires manual sign-in in the Ceo Flow browser profile");
  }
  await markAuth(true, state.url);
  const promptBox = await choosePromptBox(page);
  if (!promptBox) throw new Error("[FLOW_UI_CHANGED] Could not locate the Google Flow prompt editor");
  await promptBox.fill(String(request.prompt || ""));
  const references = await uploadReferences(page, Array.isArray(request.referenceImages) ? request.referenceImages.slice(0, 3) : []);
  if (references.missing?.length) throw new Error(`[REFERENCE_NOT_FOUND] Missing reference file(s): ${references.missing.join(", ")}`);
  if (references.requested > 0 && references.uploaded === 0) throw new Error("[FLOW_UI_CHANGED] Reference images were requested but no compatible upload control was found");
  const aspect = await chooseAspect(page, request.aspectRatio);
  const strict = String(process.env.CEO_MEDIA_FLOW_STRICT_SETTINGS || "false").toLowerCase() === "true";
  if (strict && request.aspectRatio && !aspect.confirmed) throw new Error(`[SETTINGS_NOT_CONFIRMED] Could not confirm aspect ratio ${request.aspectRatio} in current Flow UI`);
  return { pageState: state, references, aspect, warnings: aspect.confirmed ? [] : [`Aspect ratio ${request.aspectRatio || "default"} was not positively confirmed; Flow UI default will be used.`] };
}

async function videoStart(request) {
  await ensureDirs();
  const requestDigest = hash({ type: "video", prompt: request.prompt, aspectRatio: request.aspectRatio, resolution: request.resolution, durationSec: request.durationSec, referenceImages: request.referenceImages || [], firstFrame: request.firstFrame || null, lastFrame: request.lastFrame || null, outputPath: request.outputPath || null });
  const reusable = await findReusable(requestDigest);
  if (reusable) return { operationId: reusable.id, reused: true, status: reusable.status };

  const auth = await authState();
  if (!auth.authenticated) throw new Error("[AUTH_REQUIRED] Ceo Flow Browser is not authenticated; run media.flow.local_auth action=open then action=check");

  const id = `flow-${crypto.randomUUID()}`;
  const state = { id, requestDigest, status: "preparing", request, createdAt: nowIso(), updatedAt: nowIso(), pageUrl: FLOW_URL, warnings: [] };
  await saveOperation(state);
  await linkRequest(requestDigest, id);

  const context = await launchContext({ headed: String(process.env.CEO_MEDIA_FLOW_HEADLESS || "true").toLowerCase() !== "true" });
  try {
    const page = context.pages()[0] || await context.newPage();
    const prepared = await prepareVideoPage(page, request);
    state.warnings = prepared.warnings;
    state.referenceUpload = prepared.references;
    state.aspect = prepared.aspect;
    state.pageUrl = page.url();
    state.status = "ready";
    await saveOperation(state);

    const generate = await findGenerateButton(page);
    if (!generate) throw new Error("[FLOW_UI_CHANGED] Could not locate the Google Flow Generate/Create button");
    state.status = "submitting";
    await saveOperation(state); // exact-once guard immediately before the credit-spending click
    await generate.click();
    await page.waitForTimeout(1500);
    state.status = "submitted";
    state.submittedAt = nowIso();
    state.pageUrl = page.url();
    await saveOperation(state);
    return { operationId: id, status: state.status, warnings: state.warnings };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // If the spend click may already have happened, never mark this automatically retryable.
    if (state.status === "submitting") {
      state.status = "submission-uncertain";
      state.error = message;
    } else {
      state.status = "failed";
      state.error = message;
    }
    await saveOperation(state);
    throw error;
  } finally {
    await context.close().catch(() => {});
  }
}

async function tryDownload(page, operationId) {
  const output = path.join(downloadDir, `${operationId}.mp4`);
  const buttons = page.getByRole("button", { name: /download|ดาวน์โหลด/i });
  const links = page.getByRole("link", { name: /download|ดาวน์โหลด/i });
  for (const group of [buttons, links]) {
    const count = await group.count();
    for (let i = count - 1; i >= 0; i--) {
      const item = group.nth(i);
      if (!await item.isVisible().catch(() => false)) continue;
      try {
        const downloadPromise = page.waitForEvent("download", { timeout: 5000 });
        await item.click();
        const download = await downloadPromise;
        await download.saveAs(output);
        if ((await fsp.stat(output)).size > 1024) return output;
      } catch {}
    }
  }

  const videos = page.locator("video");
  const count = await videos.count();
  for (let i = count - 1; i >= 0; i--) {
    const video = videos.nth(i);
    if (!await video.isVisible().catch(() => false)) continue;
    const src = await video.getAttribute("src").catch(() => "");
    if (!src || !/^https?:/i.test(src)) continue;
    try {
      const response = await page.context().request.get(src, { timeout: 30_000 });
      if (!response.ok()) continue;
      const body = await response.body();
      if (body.length < 1024) continue;
      await fsp.writeFile(output, body);
      return output;
    } catch {}
  }
  return "";
}

async function videoPoll(operationId) {
  const state = await loadOperation(operationId);
  if (state.status === "completed" && state.downloadPath && fs.existsSync(state.downloadPath)) return { done: true, downloadUri: state.downloadPath };
  if (state.status === "failed") return { done: true, error: state.error || "Google Flow generation failed", errorCode: "FLOW_GENERATION_FAILED", retryable: false };
  if (state.status === "submission-uncertain") return { done: true, error: "Submission state is uncertain. The bridge will not resubmit automatically because that could spend credits twice. Open the Ceo Flow browser profile and verify the existing generation.", errorCode: "SUBMISSION_UNCERTAIN", retryable: false };

  const context = await launchContext({ headed: String(process.env.CEO_MEDIA_FLOW_HEADLESS || "true").toLowerCase() !== "true" });
  try {
    const page = context.pages()[0] || await context.newPage();
    await page.goto(state.pageUrl || FLOW_URL, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(1500);
    const pageState = await inspectPage(page);
    if (pageState.captcha) return { done: false, retryAfterMs: 30_000, errorCode: "CAPTCHA_REQUIRED" };
    if (pageState.authRequired || pageState.landing) {
      await markAuth(false, pageState.url, { captcha: pageState.captcha, landing: pageState.landing });
      return { done: false, retryAfterMs: 30_000, errorCode: "AUTH_REQUIRED" };
    }
    await markAuth(true, pageState.url);
    state.status = "processing";
    state.pageUrl = page.url();
    await saveOperation(state);

    const downloaded = await tryDownload(page, operationId);
    if (downloaded) {
      state.status = "completed";
      state.completedAt = nowIso();
      state.downloadPath = downloaded;
      await saveOperation(state);
      return { done: true, downloadUri: downloaded };
    }

    const lower = pageState.body.toLowerCase();
    if (/generation failed|couldn.?t generate|unable to generate|สร้างไม่สำเร็จ|สร้างวิดีโอไม่ได้/.test(lower)) {
      state.status = "failed";
      state.error = "Google Flow reported that generation failed";
      await saveOperation(state);
      return { done: true, error: state.error, errorCode: "FLOW_GENERATION_FAILED", retryable: false };
    }
    return { done: false, retryAfterMs: Math.max(5000, Number(process.env.CEO_MEDIA_FLOW_POLL_MS || 15_000)) };
  } finally {
    await context.close().catch(() => {});
  }
}

async function videoDownload(input) {
  const source = String(input.downloadUri || "");
  const outputPath = path.resolve(String(input.outputPath || ""));
  if (!source || !outputPath) throw new Error("[INVALID_INPUT] video.download requires downloadUri and outputPath");
  if (!fs.existsSync(source)) throw new Error(`[DOWNLOAD_NOT_FOUND] Downloaded Flow media is missing: ${source}`);
  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  await fsp.copyFile(source, outputPath);
  return { outputPath };
}

async function status(input) {
  if (input.operationId) return loadOperation(String(input.operationId));
  return health();
}

async function main() {
  await ensureDirs();
  const operation = String(process.argv[2] || "health");
  const input = ["health", "auth.open", "auth.check"].includes(operation) ? {} : await readInput();
  let result;
  if (operation === "health") result = await health();
  else if (operation === "auth.open") result = await authOpen();
  else if (operation === "auth.check") result = await authCheck();
  else if (operation === "status") result = await status(input);
  else if (operation === "image.generate") throw new Error("[UNSUPPORTED_IMAGE] Ceo Flow Browser native driver currently exposes video generation only; image/anchor remains on AI Studio Web or Gemini API");
  else if (operation === "video.start") result = await videoStart(input);
  else if (operation === "video.poll") result = await videoPoll(String(input.operationId || ""));
  else if (operation === "video.download") result = await videoDownload(input);
  else throw new Error(`[UNSUPPORTED_OPERATION] ${operation}`);
  process.stdout.write(JSON.stringify(result));
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

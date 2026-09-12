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
const INTERACTIVE_CDP_PORT = Math.max(1024, Number(process.env.CEO_MEDIA_FLOW_CDP_PORT || 9223));
const INTERACTIVE_CDP_URL = `http://127.0.0.1:${INTERACTIVE_CDP_PORT}`;
let externalSessionUsed = false;

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
  const options = {
    executablePath,
    headless: !headed,
    acceptDownloads: true,
    viewport: { width: 1440, height: 1000 },
    locale: process.env.CEO_MEDIA_FLOW_LOCALE || "th-TH",
    args: ["--disable-background-timer-throttling", "--disable-renderer-backgrounding"]
  };
  try {
    return await chromium.launchPersistentContext(profileDir, options);
  } catch (error) {
    if (headed) throw error;
    return chromium.launchPersistentContext(profileDir, { ...options, headless: false });
  }
}

async function cdpReady() {
  try {
    const response = await fetch(`${INTERACTIVE_CDP_URL}/json/version`, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForCdp(timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cdpReady()) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function launchInteractiveSession() {
  const executablePath = chromePath();
  if (!executablePath) throw new Error("[BROWSER_NOT_FOUND] Google Chrome or Microsoft Edge was not found");
  await ensureDirs();
  if (!await cdpReady()) {
    const args = [
      `--user-data-dir=${profileDir}`,
      `--remote-debugging-port=${INTERACTIVE_CDP_PORT}`,
      "--no-first-run",
      "--no-default-browser-check",
      FLOW_URL
    ];
    const child = spawn(executablePath, args, { detached: true, stdio: "ignore", windowsHide: false });
    child.unref();
    if (!await waitForCdp()) {
      throw new Error("[FLOW_PROFILE_BUSY] Could not start the visible Ceo Flow browser session. Close any Ceo Flow profile window and retry.");
    }
  }
  const browser = await chromium.connectOverCDP(INTERACTIVE_CDP_URL);
  const context = browser.contexts()[0];
  if (!context) throw new Error("[FLOW_SESSION_UNAVAILABLE] Visible Ceo Flow browser has no usable context");
  externalSessionUsed = true;
  return { context, browser, external: true, mode: "interactive-cdp" };
}

async function acquireFlowSession({ interactive = false } = {}) {
  if (interactive) return launchInteractiveSession();
  const context = await launchContext({ headed: false });
  return { context, browser: null, external: false, mode: "persistent-context" };
}

async function releaseFlowSession(session) {
  if (!session || session.external) return;
  await session.context?.close().catch(() => {});
}

function extractFlowProgress(body) {
  const matches = [...String(body || "").matchAll(/(?:^|\n)(\d{1,3})%(?=\n|$)/gm)];
  if (!matches.length) return null;
  return Math.max(...matches.map((match) => Number(match[1])).filter(Number.isFinite));
}

function classifyFlowBlocker(body) {
  const text = String(body || "");
  const lower = text.toLowerCase();
  const notCharged = /ระบบไม่ได้เรียกเก็บเงิน|not (?:be )?charged|won.t be charged|no charge/i.test(text);
  if (/กิจกรรมที่ผิดปกติ|unusual activity|suspicious activity/i.test(lower)) {
    return { code: "FLOW_UNUSUAL_ACTIVITY", message: "Google Flow rejected the generation because it detected unusual activity", retryable: false, charged: !notCharged };
  }
  if (/บุคคลที่มีชื่อเสียง|famous person|prominent person|public figure/i.test(lower)) {
    return { code: "FLOW_PERSON_POLICY", message: "Google Flow rejected the prompt under its person-generation policy", retryable: false, charged: !notCharged };
  }
  if (/generation failed|couldn.?t generate|unable to generate|สร้างไม่สำเร็จ|สร้างวิดีโอไม่ได้|ล้มเหลว|\bfailed\b/i.test(lower)) {
    return { code: "FLOW_GENERATION_FAILED", message: "Google Flow reported that generation failed", retryable: false, charged: !notCharged };
  }
  return null;
}

function flowBlockerError(blocker) {
  const error = new Error(`[${blocker.code}] ${blocker.message}`);
  error.flowBlocker = blocker;
  return error;
}

async function inspectPage(page) {
  const url = page.url();
  const body = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  const lower = body.toLowerCase();
  const captchaNodes = page.locator('iframe[src*="recaptcha"], iframe[title*="reCAPTCHA"], [class*="captcha" i], [id*="captcha" i]');
  const captchaCount = await captchaNodes.count().catch(() => 0);
  let visibleCaptchaCount = 0;
  for (let i = 0; i < captchaCount; i++) {
    if (await captchaNodes.nth(i).isVisible().catch(() => false)) visibleCaptchaCount += 1;
  }
  const authRequired = /accounts\.google\.com/i.test(url) || /ลงชื่อเข้าใช้|sign in to|sign in with google|choose an account/i.test(lower);
  const landing = /flow\.google\.com\/about/i.test(url) || /สร้างด้วย google flow|create with google flow|ลองใช้ google flow|try google flow/i.test(lower) && /ราคา|pricing|คำถามที่พบบ่อย|frequently asked/i.test(lower);
  const captcha = visibleCaptchaCount > 0 || /verify (?:that )?you(?:\'re| are) not a robot/i.test(lower);
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
  if (await cdpReady()) {
    return { opened: true, reused: true, pid: null, profileDir, url: FLOW_URL, cdpUrl: INTERACTIVE_CDP_URL, instructions: "Use the already-open Ceo Flow browser session to sign in or complete any manual verification, then run auth.check." };
  }
  const args = [`--user-data-dir=${profileDir}`, `--remote-debugging-port=${INTERACTIVE_CDP_PORT}`, "--no-first-run", "--no-default-browser-check", FLOW_URL];
  const child = spawn(executablePath, args, { detached: true, stdio: "ignore", windowsHide: false });
  child.unref();
  const ready = await waitForCdp();
  return { opened: true, reused: false, pid: child.pid, profileDir, url: FLOW_URL, cdpUrl: INTERACTIVE_CDP_URL, ready, instructions: "Sign in to Google manually in the opened Ceo Flow browser profile and complete any 2FA/CAPTCHA yourself, then run auth.check. Leave this Ceo Flow browser open while media jobs are running." };
}

async function authCheck() {
  const session = await acquireFlowSession({ interactive: true });
  const context = session.context;
  try {
    const page = context.pages()[0] || await context.newPage();
    const state = await enterFlow(page);
    const authenticated = state.app && !state.captcha && !state.authRequired;
    const saved = await markAuth(authenticated, state.url, { captcha: state.captcha, landing: state.landing });
    return { ...saved, profileDir, cdpUrl: INTERACTIVE_CDP_URL, reason: authenticated ? "Google Flow visible browser session is ready" : state.captcha ? "CAPTCHA requires manual completion" : "Google sign-in is required" };
  } finally {
    await releaseFlowSession(session);
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
  const reusableStatuses = new Set(["submitting", "submission-uncertain", "submitted", "processing", "verification-required", "completed"]);
  if (!reusableStatuses.has(state.status)) return null;
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

async function ensureProjectPage(page, { forceNewProject = false } = {}) {
  let promptBox = await choosePromptBox(page);
  if (promptBox && !forceNewProject) return promptBox;

  if (forceNewProject && /\/project\//i.test(page.url())) {
    const home = page.getByRole("button", { name: /หน้าแรก|home/i }).first();
    if (await home.isVisible().catch(() => false)) {
      await home.click();
      await page.waitForTimeout(900);
    } else {
      await page.goto(FLOW_URL, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.waitForTimeout(900);
    }
  }

  const create = page.getByRole("button", { name: /โปรเจ็กต์ใหม่|new project/i }).last();
  if (await create.isVisible().catch(() => false)) {
    await create.click();
    await page.waitForURL(/flow\.google\.com\/project\//i, { timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(1800);
    promptBox = await choosePromptBox(page);
  }
  return promptBox;
}

async function uploadReferences(page, references) {
  const existing = references.filter((file) => file && fs.existsSync(file)).slice(0, 3);
  const missing = references.filter((file) => !file || !fs.existsSync(file));
  if (!existing.length) return { requested: references.length, uploaded: 0, missing };

  let inputs = page.locator('input[type="file"]');
  if (await inputs.count() > 0) {
    const input = inputs.last();
    const multiple = await input.getAttribute("multiple");
    const files = multiple != null ? existing : existing.slice(0, 1);
    await input.setInputFiles(files);
    await page.waitForTimeout(1200);
    return { requested: references.length, uploaded: files.length, missing, method: "direct-input" };
  }

  let uploaded = 0;
  for (const file of existing) {
    const addElement = page.getByRole("button", { name: /\u0e40\u0e1e\u0e34\u0e48\u0e21\u0e2d\u0e07\u0e04\u0e4c\u0e1b\u0e23\u0e30\u0e01\u0e2d\u0e1a\u0e25\u0e07\u0e43\u0e19\u0e0a\u0e48\u0e2d\u0e07\u0e1e\u0e23\u0e2d\u0e21\u0e15\u0e4c|add.*(?:element|media|image|reference).*prompt|add.*prompt/i }).first();
    if (!await addElement.isVisible().catch(() => false)) break;
    await addElement.click();
    await page.waitForTimeout(350);
    const upload = page.getByRole("button", { name: /\u0e2d\u0e31\u0e1b\u0e42\u0e2b\u0e25\u0e14\u0e2a\u0e37\u0e48\u0e2d|upload media|upload/i }).last();
    if (!await upload.isVisible().catch(() => false)) break;
    const chooserPromise = page.waitForEvent("filechooser", { timeout: 5000 });
    await upload.click();
    const chooser = await chooserPromise;
    await chooser.setFiles(file);

    const addToPrompt = page.getByRole("button", { name: /\u0e40\u0e1e\u0e34\u0e48\u0e21\u0e44\u0e1b\u0e22\u0e31\u0e07\u0e1e\u0e23\u0e2d\u0e21\u0e15\u0e4c|add to prompt/i }).first();
    await addToPrompt.waitFor({ state: "visible", timeout: 30_000 }).catch(() => {});
    if (!await addToPrompt.isVisible().catch(() => false)) break;
    await addToPrompt.click();
    await page.waitForTimeout(700);
    uploaded += 1;
  }
  return { requested: references.length, uploaded, missing, method: "media-picker" };
}

async function ensureProjectAssetUploaded(page, file) {
  if (!file || !fs.existsSync(file)) throw new Error(`[REFERENCE_NOT_FOUND] Missing reference file: ${file}`);
  const name = path.basename(file);
  const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, (ch) => `\\${ch}`);
  let asset = page.locator("flow-grid-tile-container").filter({ hasText: new RegExp(escaped, "i") }).first();
  if (!await asset.isVisible().catch(() => false)) {
    const addMedia = page.getByRole("button", { name: /เมนูเพิ่มสื่อ|add media/i }).first();
    if (!await addMedia.isVisible().catch(() => false)) throw new Error("[FLOW_UI_CHANGED] Project media upload menu was not found");
    await addMedia.click();
    await page.waitForTimeout(250);
    const upload = page.locator("button").filter({ hasText: /อัปโหลด|upload/i }).last();
    if (!await upload.isVisible().catch(() => false)) throw new Error("[FLOW_UI_CHANGED] Project media upload action was not found");
    const chooserPromise = page.waitForEvent("filechooser", { timeout: 5000 });
    await upload.click();
    const chooser = await chooserPromise;
    await chooser.setFiles(file);
  }

  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    asset = page.locator("flow-grid-tile-container").filter({ hasText: new RegExp(escaped, "i") }).first();
    const visible = await asset.isVisible().catch(() => false);
    const text = visible ? await asset.innerText().catch(() => "") : "";
    const bodyTail = (await page.locator("body").innerText().catch(() => "")).slice(-3500);
    const stillUploading = /กำลังอัปโหลด|uploading|(?:^|\s)\d{1,3}%\s*(?:$|\n)/im.test(`${text}\n${bodyTail}`);
    if (visible && !stillUploading) return { file, name, uploaded: true, complete: true };
    await page.waitForTimeout(500);
  }
  throw new Error(`[UPLOAD_TIMEOUT] Project library upload did not reach 100% for ${name}`);
}

async function uploadProjectReferences(page, references) {
  const unique = [...new Set((references || []).filter(Boolean))].slice(0, 3);
  const results = [];
  for (const file of unique) results.push(await ensureProjectAssetUploaded(page, file));
  return { requested: unique.length, uploaded: results.length, complete: results.every((x) => x.complete), method: "project-library", files: results };
}

async function selectStartFrame(page, file) {
  if (!file) return { requested: false, confirmed: false };
  await ensureProjectAssetUploaded(page, file);
  const start = page.getByRole("button", { name: /^เริ่ม$|^start$/i }).first();
  if (!await start.isVisible().catch(() => false)) throw new Error("[FLOW_UI_CHANGED] Start Frame slot was not found");
  await start.click();
  await page.waitForTimeout(450);
  const escaped = String(path.basename(file)).replace(/[.*+?^${}()|[\]\\]/g, (ch) => `\\${ch}`);
  const overlay = page.locator(".cdk-overlay-container");
  const asset = overlay.getByRole("option", { name: new RegExp(escaped, "i") }).first();
  await asset.waitFor({ state: "visible", timeout: 15_000 }).catch(() => {});
  if (!await asset.isVisible().catch(() => false)) throw new Error(`[FLOW_UI_CHANGED] Uploaded Start Frame asset was not selectable: ${path.basename(file)}`);
  if (await asset.getAttribute("aria-selected") !== "true") await asset.click();
  const add = overlay.locator("button").filter({ hasText: /เพิ่มไปยังพรอมต์|add to prompt/i }).last();
  await add.waitFor({ state: "visible", timeout: 15_000 }).catch(() => {});
  if (!await add.isVisible().catch(() => false) || !await add.isEnabled().catch(() => false)) throw new Error("[FLOW_UI_CHANGED] Add-to-prompt action for Start Frame was unavailable");
  await add.click();
  await page.waitForTimeout(800);
  return { requested: true, confirmed: true, file };
}

async function configureVideoSettings(page, request) {
  const warnings = [];
  const agent = page.getByRole("button", { name: /^Agent$/i }).first();
  if (await agent.isVisible().catch(() => false) && await agent.getAttribute("aria-pressed") === "true") {
    await agent.click();
    await page.waitForTimeout(400);
  }

  const trigger = page.locator('button[aria-label="\u0e17\u0e23\u0e34\u0e01\u0e40\u0e01\u0e2d\u0e23\u0e4c\u0e01\u0e32\u0e23\u0e15\u0e31\u0e49\u0e07\u0e04\u0e48\u0e32"], button[aria-label*="generation settings" i]').first();
  if (!await trigger.isVisible().catch(() => false)) {
    return { confirmed: false, aspectConfirmed: false, warnings: ["Flow manual generation settings are unavailable; current defaults will be used."] };
  }
  await trigger.click();
  await page.waitForTimeout(350);

  const video = page.getByRole("radio", { name: /\u0e27\u0e34\u0e14\u0e35\u0e42\u0e2d|video/i }).first();
  let videoConfirmed = false;
  if (await video.isVisible().catch(() => false)) {
    if (await video.getAttribute("aria-checked") !== "true") await video.click();
    await page.waitForTimeout(350);
    videoConfirmed = true;
  } else warnings.push("Video mode was not positively confirmed.");

  let framesConfirmed = false;
  const frames = page.getByRole("radio", { name: /เฟรม|frames?/i }).first();
  if (await frames.isVisible().catch(() => false)) {
    if (await frames.getAttribute("aria-checked") !== "true") await frames.click();
    await page.waitForTimeout(250);
    framesConfirmed = true;
  } else warnings.push("Frames mode was not positively confirmed.");

  let aspectConfirmed = false;
  if (request.aspectRatio) {
    const aspect = page.getByRole("radio", { name: new RegExp(String(request.aspectRatio).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).first();
    if (await aspect.isVisible().catch(() => false)) {
      await aspect.click();
      await page.waitForTimeout(200);
      aspectConfirmed = true;
    } else warnings.push(`Aspect ratio ${request.aspectRatio} was not positively confirmed.`);
  }

  let selectedResolution = null;
  if (request.resolution) {
    const exactResolution = page.getByRole("radio", { name: new RegExp(`^${String(request.resolution).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") }).first();
    if (await exactResolution.isVisible().catch(() => false)) {
      await exactResolution.click();
      selectedResolution = String(request.resolution);
    } else if (["1080p", "4k"].includes(String(request.resolution).toLowerCase())) {
      const fallback720 = page.getByRole("radio", { name: /^720p$/i }).first();
      if (await fallback720.isVisible().catch(() => false)) {
        await fallback720.click();
        selectedResolution = "720p";
        warnings.push(`Requested ${request.resolution}; current Flow UI exposes 720p as the highest selectable resolution, so 720p was selected.`);
      }
    }
  }

  let durationConfirmed = false;
  const duration = Number(request.durationSec || 0);
  if (duration > 0) {
    const durationRadio = page.getByRole("radio", { name: new RegExp(`^${duration}\\s*(?:\u0e27\u0e34\u0e19\u0e32\u0e17\u0e35|seconds?|sec)`, "i") }).first();
    if (await durationRadio.isVisible().catch(() => false)) {
      await durationRadio.click();
      durationConfirmed = true;
    } else warnings.push(`Duration ${duration}s was not positively confirmed.`);
  }

  const x1 = page.getByRole("radio", { name: /^x1$/i }).first();
  let countConfirmed = false;
  if (await x1.isVisible().catch(() => false)) {
    await x1.click();
    countConfirmed = true;
  }

  const configuredModel = String(process.env.CEO_MEDIA_FLOW_VIDEO_MODEL || "").trim();
  let selectedModel = null;
  if (configuredModel) {
    const modelTrigger = page.getByRole("button", { name: /\u0e40\u0e25\u0e37\u0e2d\u0e01\u0e01\u0e25\u0e38\u0e48\u0e21\u0e1c\u0e25\u0e34\u0e15\u0e20\u0e31\u0e13\u0e11\u0e4c\u0e42\u0e21\u0e40\u0e14\u0e25|select.*model|model family/i }).first();
    if (await modelTrigger.isVisible().catch(() => false)) {
      await modelTrigger.click();
      await page.waitForTimeout(250);
      const escaped = configuredModel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const model = page.getByRole("menuitem", { name: new RegExp(escaped, "i") }).first();
      if (await model.isVisible().catch(() => false)) {
        await model.click();
        selectedModel = configuredModel;
      } else warnings.push(`Configured Flow video model ${configuredModel} is not available in the current account UI.`);
    }
  }

  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(200);
  return { confirmed: videoConfirmed, framesConfirmed, aspectConfirmed, selectedResolution, durationConfirmed, countConfirmed, selectedModel, warnings };
}

async function findGenerateButton(page) {
  const regex = /^(?:generate|create|start creating|\u0e40\u0e23\u0e34\u0e48\u0e21\u0e2a\u0e23\u0e49\u0e32\u0e07|\u0e2a\u0e23\u0e49\u0e32\u0e07|\u0e2a\u0e23\u0e49\u0e32\u0e07\u0e27\u0e34\u0e14\u0e35\u0e42\u0e2d|generate video|create video)$/i;
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
  const promptBox = await ensureProjectPage(page, { forceNewProject: request.forceNewProject === true });
  if (!promptBox) throw new Error("[FLOW_UI_CHANGED] Could not locate the Google Flow prompt editor after opening a project");
  const settings = await configureVideoSettings(page, request);
  const requestedReferences = Array.isArray(request.referenceImages) ? request.referenceImages.slice(0, 3) : [];
  const libraryFiles = [...new Set([...requestedReferences, request.firstFrame].filter(Boolean))];
  const references = await uploadProjectReferences(page, libraryFiles);
  if (references.requested > 0 && (!references.complete || references.uploaded !== references.requested)) throw new Error("[UPLOAD_INCOMPLETE] Reference upload did not complete at 100%");
  const firstFrame = await selectStartFrame(page, request.firstFrame);
  const expectedPrompt = String(request.prompt || "");
  await promptBox.fill(expectedPrompt);
  await page.waitForTimeout(500);
  const actualPrompt = await promptBox.innerText().catch(async () => promptBox.inputValue().catch(() => ""));
  if (expectedPrompt && (!actualPrompt || !String(actualPrompt).includes(expectedPrompt.slice(0, Math.min(120, expectedPrompt.length))))) {
    throw new Error("[PROMPT_NOT_COMMITTED] Flow prompt editor did not retain the requested prompt before submission");
  }
  const strict = String(process.env.CEO_MEDIA_FLOW_STRICT_SETTINGS || "false").toLowerCase() === "true";
  if (strict && !settings.confirmed) throw new Error("[SETTINGS_NOT_CONFIRMED] Could not confirm Video mode in current Flow UI");
  if (strict && !settings.framesConfirmed) throw new Error("[SETTINGS_NOT_CONFIRMED] Could not confirm Frames mode in current Flow UI");
  if (strict && request.aspectRatio && !settings.aspectConfirmed) throw new Error(`[SETTINGS_NOT_CONFIRMED] Could not confirm aspect ratio ${request.aspectRatio} in current Flow UI`);
  if (strict && request.resolution && settings.selectedResolution !== String(request.resolution)) throw new Error(`[SETTINGS_NOT_CONFIRMED] Could not confirm resolution ${request.resolution} in current Flow UI`);
  if (strict && request.durationSec && !settings.durationConfirmed) throw new Error(`[SETTINGS_NOT_CONFIRMED] Could not confirm duration ${request.durationSec}s in current Flow UI`);
  if (strict && !settings.countConfirmed) throw new Error("[SETTINGS_NOT_CONFIRMED] Could not confirm x1 generation count in current Flow UI");
  if (request.firstFrame && !firstFrame.confirmed) throw new Error("[START_FRAME_NOT_CONFIRMED] Could not confirm the requested Start Frame");
  return {
    pageState: state,
    references,
    firstFrame,
    projectUrl: page.url(),
    aspect: { requested: request.aspectRatio || null, confirmed: settings.aspectConfirmed },
    settings,
    warnings: settings.warnings || []
  };
}

async function videoStart(request) {
  await ensureDirs();
  const requestDigest = hash({ type: "video", prompt: request.prompt, aspectRatio: request.aspectRatio, resolution: request.resolution, durationSec: request.durationSec, referenceImages: request.referenceImages || [], firstFrame: request.firstFrame || null, lastFrame: request.lastFrame || null, outputPath: request.outputPath || null, forceNewProject: request.forceNewProject === true });
  const reusable = await findReusable(requestDigest);
  if (reusable) return { operationId: reusable.id, reused: true, status: reusable.status };

  const auth = await authState();
  if (!auth.authenticated) throw new Error("[AUTH_REQUIRED] Ceo Flow Browser is not authenticated; run media.flow.local_auth action=open then action=check");

  const id = `flow-${crypto.randomUUID()}`;
  const state = { id, requestDigest, status: "preparing", request, createdAt: nowIso(), updatedAt: nowIso(), pageUrl: FLOW_URL, warnings: [] };
  await saveOperation(state);
  await linkRequest(requestDigest, id);

  let session;
  try {
    session = await acquireFlowSession({ interactive: true });
    state.sessionMode = session.mode;
    const context = session.context;
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
    if (!await generate.isEnabled().catch(() => false)) throw new Error("[FLOW_UI_NOT_READY] Generate/Create is disabled after settings, upload and Start Frame selection");

    const beforeBody = await page.locator("body").innerText().catch(() => "");
    const beforeTileCount = await page.locator("flow-grid-tile-container").count().catch(() => 0);
    let networkSignal = null;
    const onResponse = (response) => {
      try {
        const req = response.request();
        const url = response.url();
        if (req.method() === "POST" && response.status() >= 200 && response.status() < 400 && /flow\.google\.com/i.test(url)) {
          networkSignal = { url, status: response.status(), method: req.method() };
        }
      } catch {}
    };
    page.on("response", onResponse);

    state.status = "submitting";
    state.firstFrame = prepared.firstFrame;
    state.settings = prepared.settings;
    state.pageUrl = page.url();
    await saveOperation(state);
    await generate.click();

    let uiAccepted = false;
    let acceptanceEvidence = null;
    const acceptDeadline = Date.now() + Math.max(15_000, Number(process.env.CEO_MEDIA_FLOW_ACCEPT_TIMEOUT_MS || 60_000));
    while (Date.now() < acceptDeadline) {
      const body = await page.locator("body").innerText().catch(() => "");
      const blocker = classifyFlowBlocker(body);
      if (blocker) throw flowBlockerError(blocker);
      const tileCount = await page.locator("flow-grid-tile-container").count().catch(() => 0);
      const progress = extractFlowProgress(body);
      const processingText = /กำลังสร้าง|กำลังประมวลผล|อยู่ในคิว|generating|creating video|processing|queued/i.test(body);
      uiAccepted = tileCount > beforeTileCount || progress !== null || processingText;
      if (uiAccepted) {
        acceptanceEvidence = { tileCount, beforeTileCount, progress, processingText };
        break;
      }
      await page.waitForTimeout(500);
    }
    page.off("response", onResponse);
    if (!uiAccepted) {
      state.networkSignal = networkSignal;
      throw new Error("[SUBMISSION_UNCONFIRMED] Generate was clicked but Flow did not expose a durable generation tile, progress, queue or processing state; automatic resubmission is blocked");
    }

    state.status = "submitted";
    state.submittedAt = nowIso();
    state.backendAcceptedAt = nowIso();
    state.backendAcceptance = { ui: acceptanceEvidence, network: networkSignal };
    state.pageUrl = page.url();
    await saveOperation(state);
    return { operationId: id, status: state.status, backendAccepted: true, projectUrl: state.pageUrl, warnings: state.warnings };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const blocker = error?.flowBlocker || null;
    if (blocker) {
      state.status = "failed";
      state.error = blocker.message;
      state.errorCode = blocker.code;
      state.retryable = blocker.retryable;
      state.charged = blocker.charged;
    } else if (state.status === "submitting") {
      state.status = "submission-uncertain";
      state.error = message;
      state.errorCode = "SUBMISSION_UNCERTAIN";
      state.retryable = false;
    } else {
      state.status = "failed";
      state.error = message;
      state.retryable = false;
    }
    await saveOperation(state);
    throw error;
  } finally {
    await releaseFlowSession(session);
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
  if (state.status === "failed") return { done: true, error: state.error || "Google Flow generation failed", errorCode: state.errorCode || "FLOW_GENERATION_FAILED", retryable: state.retryable === true, charged: state.charged };
  if (state.status === "submission-uncertain") return { done: true, error: "Submission state is uncertain. The bridge will not resubmit automatically because that could spend credits twice. Verify the existing Flow project before retrying.", errorCode: "SUBMISSION_UNCERTAIN", retryable: false };
  if (state.status === "verification-required") return { done: true, error: state.error || "Flow generation record is missing and requires verification before retrying.", errorCode: state.errorCode || "FLOW_GENERATION_RECORD_MISSING", retryable: false };

  const session = await acquireFlowSession({ interactive: true });
  const context = session.context;
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

    const body = await page.locator("body").innerText().catch(() => pageState.body || "");
    const blocker = classifyFlowBlocker(body);
    if (blocker) {
      state.status = "failed";
      state.error = blocker.message;
      state.errorCode = blocker.code;
      state.retryable = blocker.retryable;
      state.charged = blocker.charged;
      await saveOperation(state);
      return { done: true, error: state.error, errorCode: blocker.code, retryable: blocker.retryable, charged: blocker.charged };
    }

    const progress = extractFlowProgress(body);
    const tileCount = await page.locator("flow-grid-tile-container").count().catch(() => 0);
    const referenceCount = Number(state.referenceUpload?.uploaded || 0);
    state.lastProgress = progress;
    state.lastTileCount = tileCount;
    if (progress === null && tileCount <= referenceCount) {
      state.missingGenerationPolls = Number(state.missingGenerationPolls || 0) + 1;
    } else {
      state.missingGenerationPolls = 0;
    }
    if (state.missingGenerationPolls >= 6) {
      state.status = "verification-required";
      state.error = "Flow accepted a submission signal earlier, but no durable generation record is visible after repeated polls";
      state.errorCode = "FLOW_GENERATION_RECORD_MISSING";
      state.retryable = false;
      await saveOperation(state);
      return { done: true, error: state.error, errorCode: state.errorCode, retryable: false };
    }
    await saveOperation(state);
    return { done: false, progress, retryAfterMs: Math.max(5000, Number(process.env.CEO_MEDIA_FLOW_POLL_MS || 15_000)) };
  } finally {
    await releaseFlowSession(session);
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
  process.stdout.write(JSON.stringify(result), () => { if (externalSessionUsed) process.exit(0); });
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`, () => { if (externalSessionUsed) process.exit(1); });
  process.exitCode = 1;
});

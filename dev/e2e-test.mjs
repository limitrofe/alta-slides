import { spawn } from "node:child_process";
import { readFileSync, readdirSync, rmSync, statSync, realpathSync, mkdirSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const extensionPath = realpathSync(resolve(import.meta.dirname, ".."));
const pdfBase64 = readFileSync(resolve(extensionPath, "test/fixtures/alta-sample.pdf")).toString("base64");
const profile = "/tmp/alta-e2e-profile";
const downloadDir = "/tmp/alta-e2e-downloads";
const extractDir = "/tmp/alta-e2e-extracted";
const port = 9446;

rmSync(profile, { recursive: true, force: true });
rmSync(downloadDir, { recursive: true, force: true });
rmSync(extractDir, { recursive: true, force: true });
mkdirSync(downloadDir, { recursive: true });

const chrome = spawn(
  chromePath,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--window-size=1440,1200",
    "about:blank",
  ],
  { stdio: "ignore" },
);

try {
  let browserWebSocketUrl = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      const version = await response.json();
      browserWebSocketUrl = version.webSocketDebuggerUrl;
      if (browserWebSocketUrl) break;
    } catch {}
    await delay(250);
  }
  if (!browserWebSocketUrl) throw new Error("Chrome não abriu a depuração.");

  const socket = new WebSocket(browserWebSocketUrl);
  await new Promise((ok, bad) => {
    socket.addEventListener("open", ok, { once: true });
    socket.addEventListener("error", bad, { once: true });
  });

  let nextId = 1;
  const pending = new Map();
  let rendererSession = null;
  let fulfilled = 0;

  const send = (method, params = {}, sessionId) =>
    new Promise((done, reject) => {
      const id = nextId++;
      pending.set(id, { resolve: done, reject });
      const payload = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      socket.send(JSON.stringify(payload));
    });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve: done, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else done(message.result);
      return;
    }
    if (message.method === "Fetch.requestPaused" && message.sessionId === rendererSession) {
      fulfilled += 1;
      send(
        "Fetch.fulfillRequest",
        {
          requestId: message.params.requestId,
          responseCode: 200,
          responseHeaders: [
            { name: "Content-Type", value: "application/pdf" },
            { name: "Access-Control-Allow-Origin", value: "*" },
          ],
          body: pdfBase64,
        },
        message.sessionId,
      ).catch((error) => console.error("fulfill:", error.message));
    }
  });

  const loaded = await send("Extensions.loadUnpacked", { path: extensionPath });
  const extensionId = loaded.id;

  const { targetId } = await send("Target.createTarget", {
    url: `chrome-extension://${extensionId}/popup.html`,
  });
  const attached = await send("Target.attachToTarget", { targetId, flatten: true });
  const sessionId = attached.sessionId;
  rendererSession = sessionId;

  await send("Page.enable", {}, sessionId);
  await send("Runtime.enable", {}, sessionId);
  await send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloadDir });

  const evaluate = async (expression) => {
    const result = await send(
      "Runtime.evaluate",
      { expression, awaitPromise: true, returnByValue: true },
      sessionId,
    );
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };

  await send("Fetch.enable", { patterns: [{ urlPattern: "*google.com/presentation/*/export/pdf*", requestStage: "Request" }] }, sessionId);

  const job = {
    id: "e2e",
    docId: "fixture",
    authUser: null,
    tabId: null,
    title: "Teste E2E",
    settings: {
      dpi: 300,
      scale: 2,
      format: process.argv[2] === "jpg" ? "jpg" : "png",
      zip: true,
    },
    createdAt: Date.now(),
  };

  await delay(800);
  await evaluate(`chrome.storage.session.set({ "job:e2e": ${JSON.stringify(job)} })`);
  await send("Page.navigate", { url: `chrome-extension://${extensionId}/renderer.html?job=e2e` }, sessionId);

  let state = "boot";
  for (let attempt = 0; attempt < 160; attempt += 1) {
    const snapshot = await evaluate(`({
      state: document.body?.dataset.state || 'boot',
      status: document.getElementById('statusText')?.textContent || '',
      ready: document.querySelectorAll('.slide.is-ready').length,
      dims: document.getElementById('specDims')?.textContent || '',
      note: document.getElementById('specNote')?.textContent || '',
      detail: document.getElementById('statusDetail')?.textContent || ''
    })`).catch(() => null);
    if (snapshot) {
      state = snapshot.state;
      if (["done", "error", "cancelled"].includes(state)) {
        console.log("final UI:", JSON.stringify(snapshot));
        break;
      }
    }
    await delay(500);
  }

  let files = [];
  for (let attempt = 0; attempt < 40; attempt += 1) {
    files = readdirSync(downloadDir).filter((file) => !file.endsWith(".crdownload"));
    if (files.length) break;
    await delay(500);
  }
  if (!files.length) throw new Error(`Nenhum download em ${downloadDir}.`);

  const zipFile = files.find((file) => file.endsWith(".zip")) || files[0];
  const zipPath = resolve(downloadDir, zipFile);
  execFileSync("unzip", ["-q", zipPath, "-d", extractDir]);
  const extracted = execFileSync("find", [extractDir, "-type", "f"], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);

  const python = `
from PIL import Image
import json, sys
out = []
for path in sys.argv[1:]:
    image = Image.open(path)
    out.append({"file": path.split("/")[-1], "size": image.size, "dpi": image.info.get("dpi")})
print(json.dumps(out))
`;
  const images = execFileSync("python3", ["-c", python, ...extracted], { encoding: "utf8" });
  const downloadInfo = await evaluate(`chrome.downloads.search({}).then(items => items.map(item => ({ filename: item.filename, state: item.state, error: item.error || null })))`);

  console.log(
    JSON.stringify(
      {
        state,
        fulfilled,
        zipFile,
        zipBytes: statSync(zipPath).size,
        extracted,
        images: JSON.parse(images),
        downloadInfo,
      },
      null,
      2,
    ),
  );
  socket.close();
} finally {
  chrome.kill("SIGTERM");
}

import { spawn } from "node:child_process";
import { realpathSync, rmSync, readdirSync, existsSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { resolve } from "node:path";

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const extensionPath = realpathSync(resolve(process.argv[2] || resolve(import.meta.dirname, "..")));
const profile = "/tmp/alta-extension-profile";
const port = 9444;

rmSync(profile, { recursive: true, force: true });

const chrome = spawn(
  chromePath,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--hide-scrollbars",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--window-size=1440,2200",
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
    } catch {
      // subindo
    }
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
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve: done, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else done(message.result);
    }
  });

  const send = (method, params = {}, sessionId) =>
    new Promise((done, reject) => {
      const id = nextId++;
      pending.set(id, { resolve: done, reject });
      const payload = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      socket.send(JSON.stringify(payload));
    });

  const loaded = await send("Extensions.loadUnpacked", { path: extensionPath });
  const extensionId = loaded.id;

  const { targetId } = await send("Target.createTarget", {
    url: `chrome-extension://${extensionId}/popup.html`,
  });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });

  await send("Page.enable", {}, sessionId);
  await send("Runtime.enable", {}, sessionId);
  await send("Browser.setDownloadBehavior", { behavior: "deny" });

  const evaluate = async (expression) => {
    const result = await send(
      "Runtime.evaluate",
      { expression, awaitPromise: true, returnByValue: true },
      sessionId,
    );
    if (result.exceptionDetails) {
      return { exception: result.exceptionDetails.text, details: result.exceptionDetails };
    }
    return result.result.value;
  };

  await delay(1200);
  const popupInfo = await evaluate(`({
    href: location.href,
    title: document.title,
    runtimeId: globalThis.chrome?.runtime?.id || null,
    hasStorage: Boolean(globalThis.chrome?.storage?.session),
    text: document.body?.innerText?.slice(0, 180) || ''
  })`);

  const job = {
    id: "test",
    docId: "1Qu5IYblanKSFpWzVOdaXJ7fJrTeYkp6jUbE6IX6_A_g",
    authUser: null,
    tabId: null,
    title: "Girls In STEM Lesson 3",
    settings: { dpi: 150, scale: 1, format: "png", zip: true },
    createdAt: Date.now(),
  };

  const fetchTest = await evaluate(`(async () => {
    const url = "https://docs.google.com/presentation/d/1Qu5IYblanKSFpWzVOdaXJ7fJrTeYkp6jUbE6IX6_A_g/export/pdf?id=1Qu5IYblanKSFpWzVOdaXJ7fJrTeYkp6jUbE6IX6_A_g";
    const out = {};
    for (const credentials of ["include", "omit"]) {
      try {
        const response = await fetch(url, { credentials, cache: "no-store", redirect: "follow" });
        const buffer = await response.arrayBuffer();
        out[credentials] = {
          ok: response.ok,
          status: response.status,
          url: response.url,
          type: response.type,
          contentType: response.headers.get("content-type"),
          bytes: buffer.byteLength
        };
      } catch (error) {
        out[credentials] = { error: String(error), name: error.name, message: error.message };
      }
    }
    return out;
  })()`);
  const storage = await evaluate(
    `chrome.storage.session.set({ "job:test": ${JSON.stringify(job)} }).then(() => chrome.storage.session.get("job:test")).then(v => Object.keys(v))`,
  );

  await send("Page.navigate", { url: `chrome-extension://${extensionId}/renderer.html?job=test` }, sessionId);

  const states = [];
  let cancelClicked = false;
  for (let attempt = 0; attempt < 160; attempt += 1) {
    const state = await evaluate(`({
      state: document.body?.dataset.state || 'boot',
      status: document.getElementById('statusText')?.textContent || '',
      count: document.getElementById('progressCount')?.textContent || '',
      cards: document.querySelectorAll('.slide').length,
      ready: document.querySelectorAll('.slide.is-ready').length,
      dims: document.getElementById('specDims')?.textContent || '',
      pages: document.getElementById('specPages')?.textContent || '',
      kicker: document.getElementById('kicker')?.textContent || '',
      actions: [...document.querySelectorAll('#actions button')].map(b => b.textContent)
    })`).catch((error) => ({ exception: String(error) }));

    if (state && !state.exception) {
      if (!states.length || JSON.stringify(states[states.length - 1]) !== JSON.stringify(state)) {
        states.push(state);
      }
      if (["done", "error", "cancelled", "idle"].includes(state.state)) break;
      if (state.state === "rendering" && state.ready >= 1 && !cancelClicked) {
        cancelClicked = true;
        await evaluate(`document.getElementById('actions').querySelector('button')?.click()`);
        states.push({ ...state, cancelClicked: true });
      }
    }
    await delay(500);
  }

  await delay(1000);
  const final = await evaluate(`({
    state: document.body.dataset.state,
    status: document.getElementById('statusText').textContent,
    detail: document.getElementById('statusDetail').textContent,
    kicker: document.getElementById('kicker').textContent,
    cards: document.querySelectorAll('.slide').length,
    ready: document.querySelectorAll('.slide.is-ready').length,
    dims: document.getElementById('specDims').textContent,
    pages: document.getElementById('specPages').textContent,
    specNote: document.getElementById('specNote').textContent,
    actions: [...document.querySelectorAll('#actions button')].map((button) => button.textContent)
  })`);

  const downloadDir = "/tmp/alta-downloads";
  rmSync(downloadDir, { recursive: true, force: true });
  await send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloadDir });
  const downloadTest = await evaluate(`(async () => {
    const run = async (filename) => {
      const blob = new Blob(["teste"], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const id = await chrome.downloads.download({
        url,
        filename,
        conflictAction: "uniquify",
        saveAs: false
      });
      return await new Promise((resolve) => {
        const started = Date.now();
        const timer = setInterval(async () => {
          const [item] = await chrome.downloads.search({ id });
          if (item && item.state !== "in_progress") {
            clearInterval(timer);
            resolve({ id, state: item.state, filename: item.filename, error: item.error || null });
          } else if (Date.now() - started > 8000) {
            clearInterval(timer);
            resolve({ id, timeout: true, item });
          }
        }, 100);
      });
    };
    return {
      simple: await run("teste-simples.txt"),
      nested: await run("Alta teste/ação.txt")
    };
  })()`);
  await delay(1000);
  const downloadedFiles = existsSync(downloadDir) ? readdirSync(downloadDir, { recursive: true }) : [];

  console.log(
    JSON.stringify(
      { extensionId, popupInfo, fetchTest, storage, states, final, downloadTest, downloadedFiles },
      null,
      2,
    ),
  );
  socket.close();
} finally {
  chrome.kill("SIGTERM");
}

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const url = process.argv[2] || "http://127.0.0.1:8765/dev/preview-renderer.html?job=preview";
const out = process.argv[3] || "/tmp/alta-desktop.png";
const profile = "/tmp/alta-cdp-profile";
const port = 9333;

rmSync(profile, { recursive: true, force: true });
mkdirSync("/tmp", { recursive: true });

const chrome = spawn(
  chromePath,
  [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=1440,2200",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

try {
  let targets = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json`);
      targets = await response.json();
      if (targets.length) break;
    } catch {
      // Chrome ainda está subindo.
    }
    await delay(250);
  }
  if (!targets?.length) throw new Error("Chrome não abriu o endpoint de depuração.");

  const target = targets.find((item) => item.type === "page");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  let nextId = 1;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
    }
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send("Page.navigate", { url });

  let state = "";
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const result = await send("Runtime.evaluate", {
      expression: "document.body?.dataset.state || 'boot'",
      returnByValue: true,
    });
    state = result.result.value;
    if (state === "done" || state === "error" || state === "idle") break;
    await delay(500);
  }

  const metrics = await send("Page.getLayoutMetrics");
  const height = Math.ceil(metrics.cssContentSize.height);
  const width = Math.ceil(metrics.cssContentSize.width);
  const screenshot = await send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width, height, scale: 1 },
  });
  writeFileSync(out, Buffer.from(screenshot.data, "base64"));

  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await delay(500);
  const mobileMetrics = await send("Page.getLayoutMetrics");
  const mobile = await send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
    clip: {
      x: 0,
      y: 0,
      width: 390,
      height: Math.ceil(mobileMetrics.cssContentSize.height),
      scale: 1,
    },
  });
  writeFileSync(out.replace(/\.png$/, "-mobile.png"), Buffer.from(mobile.data, "base64"));

  console.log(JSON.stringify({ state, width, height, out, mobile: out.replace(/\.png$/, "-mobile.png") }, null, 2));
  socket.close();
} finally {
  chrome.kill("SIGTERM");
}

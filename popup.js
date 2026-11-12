import { stripSlidesSuffix } from "./lib/format.js";

const DPI_VALUES = [150, 300, 600];
const SCALE_VALUES = [1, 2, 3];
const FORMAT_VALUES = ["png", "jpg"];
const DEFAULTS = { dpi: 300, scale: 2, format: "png", zip: true };

const el = {
  deck: document.getElementById("deck"),
  deckTitle: document.getElementById("deckTitle"),
  empty: document.getElementById("empty"),
  emptyTitle: document.getElementById("emptyTitle"),
  emptyText: document.getElementById("emptyText"),
  emptyCta: document.getElementById("emptyCta"),
  form: document.getElementById("exportForm"),
  estimate: document.getElementById("estimate"),
  formError: document.getElementById("formError"),
  exportBtn: document.getElementById("exportBtn"),
  zipToggle: document.getElementById("zipToggle"),
};

const state = {
  tab: null,
  docId: null,
  authUser: null,
  submitting: false,
};

init();

async function init() {
  bindEvents();
  applySettings(await loadSettings());

  let tab = null;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch {
    // A popup sem acesso à aba mostra o estado vazio.
  }

  state.tab = tab || null;
  const parsed = parseSlidesUrl(tab?.url);

  if (parsed?.kind === "doc") {
    showReady(tab, parsed.docId, parsed.authUser);
  } else if (parsed?.kind === "published") {
    showEmpty(
      "Apresentação publicada",
      "Para exportar em alta resolução, abra o arquivo original no editor do Google Slides.",
    );
  } else {
    showEmpty(
      "Abra uma apresentação",
      "Entre em um deck no editor do Google Slides e clique no ícone da Alta para começar.",
    );
  }
}

function bindEvents() {
  el.form.addEventListener("change", () => {
    clearError();
    updateEstimate();
    saveSettings(readSettings());
  });

  el.form.addEventListener("submit", (event) => {
    event.preventDefault();
    startExport();
  });
}

async function loadSettings() {
  try {
    const stored = await chrome.storage.local.get("settings");
    const settings = stored?.settings || {};
    return {
      dpi: DPI_VALUES.includes(Number(settings.dpi)) ? Number(settings.dpi) : DEFAULTS.dpi,
      scale: SCALE_VALUES.includes(Number(settings.scale)) ? Number(settings.scale) : DEFAULTS.scale,
      format: FORMAT_VALUES.includes(settings.format) ? settings.format : DEFAULTS.format,
      zip: typeof settings.zip === "boolean" ? settings.zip : DEFAULTS.zip,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function applySettings(settings) {
  for (const input of el.form.querySelectorAll('input[name="dpi"]')) {
    input.checked = Number(input.value) === settings.dpi;
  }
  for (const input of el.form.querySelectorAll('input[name="scale"]')) {
    input.checked = Number(input.value) === settings.scale;
  }
  for (const input of el.form.querySelectorAll('input[name="format"]')) {
    input.checked = input.value === settings.format;
  }
  el.zipToggle.checked = settings.zip;
  updateEstimate();
}

function readSettings() {
  const dpi = Number(el.form.querySelector('input[name="dpi"]:checked')?.value);
  const scale = Number(el.form.querySelector('input[name="scale"]:checked')?.value);
  const format = el.form.querySelector('input[name="format"]:checked')?.value;
  return {
    dpi: DPI_VALUES.includes(dpi) ? dpi : DEFAULTS.dpi,
    scale: SCALE_VALUES.includes(scale) ? scale : DEFAULTS.scale,
    format: FORMAT_VALUES.includes(format) ? format : DEFAULTS.format,
    zip: el.zipToggle.checked,
  };
}

async function saveSettings(settings) {
  try {
    await chrome.storage.local.set({ settings });
  } catch {
    // Preferências são um extra; não bloqueiam a exportação.
  }
}

function updateEstimate() {
  const settings = readSettings();
  const format = settings.format === "png" ? "PNG sem perdas" : "JPG mais leve";
  const delivery = settings.zip ? "em um ZIP" : "em arquivos separados";
  el.estimate.replaceChildren();
  el.estimate.append("Cada slide em ");
  el.estimate.append(strong(`${settings.dpi} dpi`));
  el.estimate.append(", ");
  el.estimate.append(strong(`${settings.scale}× o tamanho original`));
  el.estimate.append(` · ${format} ${delivery}.`);}

function strong(text) {
  const node = document.createElement("strong");
  node.textContent = text;
  return node;
}

function showReady(tab, docId, authUser) {
  state.docId = docId;
  state.authUser = authUser || null;
  const title = stripSlidesSuffix(tab?.title) || "Apresentação sem título";
  el.deckTitle.textContent = title;
  el.deck.hidden = false;
  el.empty.hidden = true;
  el.form.hidden = false;
  document.title = `${title} — Alta`;
}

function showEmpty(title, text) {
  el.emptyTitle.textContent = title;
  el.emptyText.textContent = text;
  el.empty.hidden = false;
  el.deck.hidden = true;
  el.form.hidden = true;
  el.emptyCta.textContent = "Abrir Google Slides";
  el.emptyCta.href = "https://slides.google.com";
}

async function startExport() {
  if (state.submitting) return;

  clearError();

  let tab = state.tab;
  let docId = state.docId;
  let authUser = state.authUser;

  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const parsed = parseSlidesUrl(tab?.url);
    if (parsed?.kind === "doc") {
      docId = parsed.docId;
      authUser = parsed.authUser;
      state.tab = tab;
      state.docId = docId;
      state.authUser = authUser;
    }
  } catch {
    // Usa os dados carregados na abertura do popup.
  }

  if (!tab || !docId) {
    showError("A aba atual não é uma apresentação editável do Google Slides.");
    return;
  }

  state.submitting = true;
  el.exportBtn.disabled = true;
  el.exportBtn.textContent = "Abrindo exportação…";

  const settings = readSettings();
  const jobId = crypto.randomUUID();
  const job = {
    id: jobId,
    docId,
    authUser: authUser || null,
    tabId: tab.id,
    title: stripSlidesSuffix(tab.title) || "Apresentação sem título",
    settings,
    createdAt: Date.now(),
  };

  try {
    await saveSettings(settings);
    await chrome.storage.session.set({ [`job:${jobId}`]: job });
    await chrome.tabs.create({ url: chrome.runtime.getURL(`renderer.html?job=${encodeURIComponent(jobId)}`) });
    window.close();
  } catch (error) {
    state.submitting = false;
    el.exportBtn.disabled = false;
    el.exportBtn.textContent = "Exportar apresentação";
    showError("Não foi possível abrir a tela de exportação. Tente fechar e abrir o popup novamente.");
    console.error("[Alta] Falha ao iniciar a exportação:", error);
  }
}

function showError(message) {
  el.formError.textContent = message;
  el.formError.hidden = false;
}

function clearError() {
  el.formError.hidden = true;
  el.formError.textContent = "";
}

function parseSlidesUrl(rawUrl) {
  if (!rawUrl) return null;

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (url.hostname !== "docs.google.com") return null;

  const match = url.pathname.match(/^\/presentation\/(?:u\/(\d+)\/)?d\/([^/]+)/);
  if (!match) return null;

  const authParam = match[1] || url.searchParams.get("authuser");
  const authUser = authParam && /^\d+$/.test(authParam) ? authParam : null;
  const candidate = match[2];
  if (candidate === "e") return { kind: "published" };
  if (!/^[A-Za-z0-9_-]+$/.test(candidate)) return null;

  return { kind: "doc", docId: candidate, authUser };
}

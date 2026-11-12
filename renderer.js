import { makeZipEntry, createZipBlob } from "./lib/zip.js";
import { setPngDpi } from "./lib/png-dpi.js";
import { setJpegDpi } from "./lib/jpeg-dpi.js";
import { fileBaseName, formatInteger, formatDecimal } from "./lib/format.js";

const MAX_CANVAS_DIMENSION = 16000;
const MAX_CANVAS_AREA = 120_000_000;
const JPEG_QUALITY = 0.92;

const el = {
  body: document.body,
  kicker: document.getElementById("kicker"),
  deckTitle: document.getElementById("deckTitle"),
  statusText: document.getElementById("statusText"),
  statusDetail: document.getElementById("statusDetail"),
  progressCount: document.getElementById("progressCount"),
  barWrap: document.getElementById("barWrap"),
  bar: document.getElementById("bar"),
  actions: document.getElementById("actions"),
  tabNote: document.getElementById("tabNote"),
  spec: document.getElementById("spec"),
  specDpi: document.getElementById("specDpi"),
  specScale: document.getElementById("specScale"),
  specDims: document.getElementById("specDims"),
  specPrint: document.getElementById("specPrint"),
  specPages: document.getElementById("specPages"),
  specFormat: document.getElementById("specFormat"),
  specNote: document.getElementById("specNote"),
  preview: document.getElementById("preview"),
  sheetMeta: document.getElementById("sheetMeta"),
  grid: document.getElementById("grid"),
  footNote: document.getElementById("footNote"),
  toast: document.getElementById("toast"),
  renderCanvas: document.getElementById("renderCanvas"),
};

const state = {
  job: null,
  pdf: null,
  dims: null,
  pageCount: 0,
  cards: [],
  files: [],
  zipBlob: null,
  progress: 0,
  downloadedCount: 0,
  working: false,
  active: false,
  cancelled: false,
  usedTabFallback: false,
  abortController: null,
  renderTask: null,
  loadingTask: null,
  baseName: "Apresentação",
  thumbCanvas: null,
  toastTimer: 0,
  redownloading: false,
};

class ExportError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ExportError";
    this.code = code;
  }
}

boot();

async function boot() {
  if (!window.pdfjsLib) {
    showNoJob("A biblioteca de renderização não foi carregada. Reinstale a extensão e tente de novo.");
    return;
  }

  window.pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("vendor/pdf.worker.min.js");

  const jobId = new URLSearchParams(location.search).get("job");
  if (!jobId) {
    showNoJob();
    return;
  }

  let job = null;
  try {
    const key = `job:${jobId}`;
    const stored = await chrome.storage.session.get(key);
    job = stored?.[key];
    if (job) await chrome.storage.session.remove(key);
  } catch (error) {
    console.error("[Alta] Falha ao recuperar a exportação:", error);
    showNoJob("Não foi possível recuperar esta exportação. Abra o popup da Alta e comece de novo.");
    return;
  }

  if (!job?.docId) {
    showNoJob();
    return;
  }

  state.job = job;
  state.baseName = fileBaseName(job.title);
  applyJob();
  run();
}

function applyJob() {
  const { dpi, scale, format, zip } = normalizedSettings();

  el.deckTitle.textContent = state.job.title || "Apresentação sem título";
  el.deckTitle.title = state.job.title || "";
  el.specDpi.textContent = `${dpi} dpi`;
  el.specScale.textContent = `${scale}×`;
  el.specFormat.textContent = `${format.toUpperCase()} · ${zip ? "ZIP" : "individual"}`;
  el.footNote.textContent = `${dpi} dpi · ${scale}× · ${format.toUpperCase()}`;
  document.title = `${state.job.title || "Apresentação"} — Alta`;
}

function normalizedSettings() {
  const settings = state.job?.settings || {};
  const dpi = Number(settings.dpi);
  const scale = Number(settings.scale);
  const format = settings.format === "jpg" ? "jpg" : "png";
  return {
    dpi: Number.isFinite(dpi) ? Math.min(600, Math.max(72, Math.round(dpi))) : 300,
    scale: Number.isFinite(scale) ? Math.min(4, Math.max(1, Math.round(scale))) : 2,
    format,
    zip: settings.zip !== false,
  };
}

async function run(options = {}) {
  if (state.working || !state.job) return;

  state.working = true;
  state.active = true;
  state.cancelled = false;
  state.usedTabFallback = Boolean(options.viaTab);
  state.progress = 0;
  state.downloadedCount = 0;
  state.files = [];
  state.zipBlob = null;
  state.pageCount = 0;
  state.dims = null;
  state.cards = [];
  state.abortController = null;
  state.renderTask = null;
  state.loadingTask = null;

  try {
    if (state.pdf) {
      try {
        await state.pdf.destroy();
      } catch {
        // O PDF anterior já pode ter sido descarregado.
      }
      state.pdf = null;
    }

    el.grid.replaceChildren();
    el.grid.style.removeProperty("--slide-aspect");
    el.preview.hidden = true;
    el.sheetMeta.textContent = "As imagens aparecem aqui conforme são renderizadas.";
    el.specDims.textContent = "—";
    el.specPrint.textContent = "—";
    el.specPages.textContent = "—";
    el.specNote.hidden = true;
    el.spec.hidden = false;
    el.progressCount.textContent = "";
    el.statusDetail.hidden = true;
    el.statusDetail.textContent = "";
    el.tabNote.hidden = false;
    el.bar.style.width = "0%";
    el.body.dataset.state = "loading";
    setKicker("Preparando");
    setStatus(
      options.viaTab ? "Buscando o PDF pela aba do Slides…" : "Buscando o PDF da apresentação…",
      "",
    );
    setDetail("O Google monta um PDF com todos os slides. Isso pode levar alguns segundos.");
    setIndeterminate(true);
    setActions([{ label: "Cancelar", variant: "ghost", onClick: cancel }]);
    applyJob();
    await nextPaint();

    const pdfBytes = options.viaTab ? await fetchPdfFromTab() : await fetchPdf();

    setStatus("Abrindo a apresentação…");
    setDetail("");
    setIndeterminate(true);

    let pdf;
    try {
      state.loadingTask = window.pdfjsLib.getDocument({
        data: pdfBytes,
        cMapUrl: chrome.runtime.getURL("vendor/cmaps/"),
        cMapPacked: true,
        standardFontDataUrl: chrome.runtime.getURL("vendor/standard_fonts/"),
        isEvalSupported: false,
      });
      pdf = await state.loadingTask.promise;
      state.loadingTask = null;
    } catch (error) {
      state.loadingTask = null;
      if (error?.name === "PasswordException") {
        throw new ExportError("PDF", "A apresentação está protegida por senha.");
      }
      throw new ExportError("PDF", "O PDF retornado pelo Google não pôde ser aberto.");
    }

    if (state.cancelled) {
      showCancelled();
      return;
    }

    state.pdf = pdf;
    state.pageCount = pdf.numPages;
    if (!state.pageCount) throw new ExportError("PDF", "A apresentação não tem slides para exportar.");

    setStatus("Medindo os slides…");
    const dims = await measurePdf(pdf);
    if (state.cancelled) {
      showCancelled();
      return;
    }
    state.dims = dims;

    el.specDims.textContent = `${formatInteger(dims.pxW)} × ${formatInteger(dims.pxH)} px`;
    el.specPrint.textContent = `${formatDecimal(dims.printWidthCm)} × ${formatDecimal(dims.printHeightCm)} cm`;
    el.specPages.textContent = String(state.pageCount);
    if (dims.capped) {
      el.specNote.hidden = false;
      el.specNote.textContent = `O Chrome limita o tamanho do canvas. A imagem foi reduzida para ${dims.effectiveDpi} dpi.`;
    }

    buildGrid(dims, state.pageCount);
    el.preview.hidden = false;
    el.sheetMeta.textContent = `${state.pageCount} ${state.pageCount === 1 ? "slide" : "slides"} · ${normalizedSettings().format.toUpperCase()} · ${normalizedSettings().dpi} dpi`;
    el.body.dataset.state = "rendering";
    setKicker("Exportando");
    setIndeterminate(false);
    setProgress(0);
    await nextPaint();

    await renderAll();
    if (state.cancelled) {
      showCancelled();
      return;
    }
    await finish();
  } catch (error) {
    if (state.cancelled || isCancellation(error)) {
      showCancelled();
      return;
    }
    console.error("[Alta] Exportação interrompida:", error);
    showError(error);
  } finally {
    state.working = false;
    state.active = false;
    state.renderTask = null;
    state.loadingTask = null;
    state.abortController = null;
    el.barWrap.classList.remove("is-indeterminate");
  }
}

async function fetchPdf() {
  const { docId, authUser } = state.job;
  const url = new URL(`https://docs.google.com/presentation/d/${encodeURIComponent(docId)}/export/pdf`);
  url.searchParams.set("id", docId);
  if (authUser != null && /^\d+$/.test(String(authUser))) {
    url.searchParams.set("authuser", String(authUser));
  }
  const controller = new AbortController();
  state.abortController = controller;

  let response;
  try {
    response = await fetch(url.href, {
      credentials: "include",
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
    });
  } catch (error) {
    if (isCancellation(error)) throw error;
    throw new ExportError("FETCH", "Não foi possível conectar ao Google Slides.");
  }

  if (!response.ok) {
    if ([401, 403, 404].includes(response.status)) {
      throw new ExportError("AUTH", "O Google não liberou o arquivo desta apresentação.");
    }
    throw new ExportError("FETCH", `O Google respondeu com o código ${response.status}.`);
  }

  const contentType = response.headers.get("content-type") || "";
  let buffer;
  try {
    buffer = await response.arrayBuffer();
  } catch (error) {
    if (isCancellation(error)) throw error;
    throw new ExportError("FETCH", "A conexão caiu antes de o PDF chegar.");
  }

  if (!looksLikePdf(buffer)) {
    if (contentType.includes("text/html")) {
      throw new ExportError("AUTH", "O Google pediu login em vez de enviar o PDF.");
    }
    throw new ExportError("PDF", "O arquivo retornado pelo Google não é um PDF válido.");
  }

  return buffer;
}

async function fetchPdfFromTab() {
  if (!state.job.tabId) {
    throw new ExportError("TAB", "A aba original da apresentação não está disponível.");
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: state.job.tabId },
      files: ["content.js"],
    });
  } catch {
    // Se o content script já existir, a injeção duplicada é ignorada por ele.
  }

  let response;
  try {
    response = await chrome.tabs.sendMessage(state.job.tabId, {
      type: "ALTA_FETCH_PDF",
      docId: state.job.docId,
      authUser: state.job.authUser,
    });
  } catch {
    throw new ExportError(
      "TAB",
      "A aba da apresentação não respondeu. Abra a apresentação novamente e recarregue a página.",
    );
  }

  if (!response?.ok) {
    throw new ExportError("FETCH", response?.error || "A aba da apresentação não conseguiu baixar o PDF.");
  }

  const buffer = base64ToBuffer(response.base64);
  if (!looksLikePdf(buffer)) {
    throw new ExportError("PDF", "O arquivo recebido da aba da apresentação não é um PDF válido.");
  }
  return buffer;
}

async function measurePdf(pdf) {
  const page = await pdf.getPage(1);
  const baseViewport = page.getViewport({ scale: 1 });
  const widthPt = baseViewport.width;
  const heightPt = baseViewport.height;
  const widthIn = widthPt / 72;
  const heightIn = heightPt / 72;
  page.cleanup();

  const { dpi: requestedDpi, scale } = normalizedSettings();
  // O slide será impresso em `scale` vezes o tamanho original. Para manter o
  // arquivo marcado com `requestedDpi`, renderizamos requestedDpi × scale
  // pixels por polegada da página do PDF.
  let renderScale = (requestedDpi / 72) * scale;
  let pxW = Math.max(1, Math.round(widthPt * renderScale));
  let pxH = Math.max(1, Math.round(heightPt * renderScale));
  let capped = false;

  if (pxW > MAX_CANVAS_DIMENSION || pxH > MAX_CANVAS_DIMENSION || pxW * pxH > MAX_CANVAS_AREA) {
    const factor = Math.min(
      MAX_CANVAS_DIMENSION / pxW,
      MAX_CANVAS_DIMENSION / pxH,
      Math.sqrt(MAX_CANVAS_AREA / (pxW * pxH)),
    );
    renderScale *= factor * 0.995;
    pxW = Math.max(1, Math.floor(widthPt * renderScale));
    pxH = Math.max(1, Math.floor(heightPt * renderScale));
    capped = true;
  }

  const printWidthCm = widthIn * scale * 2.54;
  const printHeightCm = heightIn * scale * 2.54;
  const effectiveDpi = Math.max(1, Math.round(pxW / (widthIn * scale)));

  return {
    widthPt,
    heightPt,
    widthIn,
    heightIn,
    renderScale,
    pxW,
    pxH,
    printWidthCm,
    printHeightCm,
    effectiveDpi,
    capped,
    aspect: widthPt / heightPt,
  };
}

function buildGrid(dims, total) {
  const fragment = document.createDocumentFragment();
  const digits = Math.max(2, String(total).length);
  const format = normalizedSettings().format.toUpperCase();

  el.grid.style.setProperty("--slide-aspect", `${dims.widthPt} / ${dims.heightPt}`);
  el.grid.replaceChildren();
  state.cards = [];

  for (let index = 1; index <= total; index += 1) {
    const figure = document.createElement("figure");
    figure.className = "slide";
    figure.dataset.page = String(index);

    const frame = document.createElement("div");
    frame.className = "slide__frame";

    const image = document.createElement("img");
    image.alt = `Slide ${index}`;
    image.decoding = "async";
    frame.append(image);

    const caption = document.createElement("figcaption");
    caption.className = "slide__caption";
    const number = document.createElement("span");
    number.className = "slide__num";
    number.textContent = String(index).padStart(digits, "0");
    const label = document.createElement("span");
    label.className = "slide__fmt";
    label.textContent = format;
    caption.append(number, label);

    figure.append(frame, caption);
    fragment.append(figure);
    state.cards.push({ figure, image });
  }

  el.grid.append(fragment);
}

async function renderAll() {
  const canvas = el.renderCanvas;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) {
    throw new ExportError("CANVAS", "O navegador não conseguiu preparar o canvas de renderização.");
  }

  const total = state.pageCount;

  for (let pageNumber = 1; pageNumber <= total; pageNumber += 1) {
    if (state.cancelled) return;

    setStatus(`Renderizando o slide ${pageNumber} de ${total}…`, `${pageNumber} / ${total}`);
    await nextPaint();

    const page = await state.pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: state.dims.renderScale });
    const width = Math.max(1, Math.round(viewport.width));
    const height = Math.max(1, Math.round(viewport.height));

    canvas.width = width;
    canvas.height = height;
    if (canvas.width !== width || canvas.height !== height) {
      throw new ExportError("CANVAS", "O navegador não conseguiu criar uma imagem deste tamanho.");
    }

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);

    state.renderTask = page.render({
      canvasContext: context,
      viewport,
      background: "#ffffff",
    });
    await state.renderTask.promise;
    state.renderTask = null;
    page.cleanup();

    if (state.cancelled) return;

    markCard(pageNumber, makeThumbnail(canvas));

    const entry = await encodePage(canvas, pageNumber);
    if (state.cancelled) return;

    state.files.push(entry);
    if (!normalizedSettings().zip) {
      await downloadEntryIndividually(entry);
      state.downloadedCount += 1;
    }

    const percent = Math.round((pageNumber / total) * 100);
    setProgress(percent);
    if (state.cancelled) return;
    setStatus(`Renderizando o slide ${pageNumber} de ${total}…`, `${pageNumber} / ${total}`);
    await nextPaint();
  }
}

function makeThumbnail(source) {
  const width = 520;
  const height = Math.max(1, Math.round((width * source.height) / source.width));
  const canvas = state.thumbCanvas || (state.thumbCanvas = document.createElement("canvas"));
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d", { alpha: false });
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(source, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", 0.76);
}

function markCard(pageNumber, dataUrl) {
  const card = state.cards[pageNumber - 1];
  if (!card) return;

  card.image.addEventListener(
    "load",
    () => {
      card.figure.classList.add("is-ready");
    },
    { once: true },
  );
  card.image.src = dataUrl;
}

async function encodePage(canvas, pageNumber) {
  const { format } = normalizedSettings();
  const mime = format === "jpg" ? "image/jpeg" : "image/png";
  const blob = await canvasToBlob(canvas, mime, format === "jpg" ? JPEG_QUALITY : undefined);

  let bytes = new Uint8Array(await blob.arrayBuffer());
  bytes = format === "jpg" ? setJpegDpi(bytes, state.dims.effectiveDpi) : setPngDpi(bytes, state.dims.effectiveDpi);

  const fileName = pageFileName(pageNumber);
  const entry = makeZipEntry(`${state.baseName}/${fileName}`, bytes, mime);
  entry.fileName = fileName;
  return entry;
}

function canvasToBlob(canvas, mime, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new ExportError("CANVAS", "Não foi possível converter o slide em imagem."));
      },
      mime,
      quality,
    );
  });
}

async function finish() {
  const settings = normalizedSettings();
  const total = state.pageCount;

  if (settings.zip) {
    el.body.dataset.state = "zipping";
    setKicker("Finalizando");
    setStatus("Compactando os slides em um ZIP…", "");
    setDetail("As imagens estão prontas. O download começa em seguida.");
    setIndeterminate(true);
    setActions([]);
    await nextPaint();

    const zip = createZipBlob(state.files);
    state.zipBlob = zip;

    try {
      await downloadBlob(zip, zipFileName());
      showDone({ downloadStarted: true });
    } catch (error) {
      console.error("[Alta] Falha ao iniciar o download do ZIP:", error);
      showDone({ downloadStarted: false });
    }
    return;
  }

  showDone({ downloadStarted: true });
}

function showDone({ downloadStarted }) {
  state.active = false;
  state.progress = 100;

  const settings = normalizedSettings();
  const dims = state.dims;
  const total = state.pageCount;
  const noun = total === 1 ? "imagem" : "imagens";
  const ready = total === 1 ? "pronta" : "prontas";
  const sent = total === 1 ? "enviada" : "enviadas";

  el.body.dataset.state = "done";
  setKicker("Concluído");
  el.tabNote.hidden = true;
  setIndeterminate(false);
  setProgress(100);
  setStatus(
    downloadStarted
      ? settings.zip
        ? `ZIP com ${total} ${noun} pronto. Download iniciado.`
        : `${total} ${noun} ${sent} para Downloads.`
      : total === 1
        ? "A imagem está pronta, mas o download não iniciou."
        : `As ${total} imagens estão prontas, mas o download não iniciou.`,
    `${total} / ${total}`,
  );
  setDetail(
    downloadStarted
      ? `${settings.format.toUpperCase()} · ${settings.dpi} dpi · ${settings.scale}× · ${formatInteger(dims.pxW)} × ${formatInteger(dims.pxH)} px`
      : `Clique em “Baixar ZIP novamente” para tentar de novo. As imagens continuam nesta aba.`,
  );
  el.sheetMeta.textContent = `${total} ${noun} ${ready}`;

  const actions = [
    { label: "Abrir pasta de downloads", variant: "primary", onClick: openDownloadsFolder },
  ];

  if (settings.zip) {
    actions.push({ label: "Baixar ZIP novamente", variant: "ghost", onClick: downloadZipAgain });
  } else {
    actions.push({ label: "Salvar novamente", variant: "ghost", onClick: downloadIndividualAgain });
  }
  actions.push({ label: "Voltar à apresentação", variant: "quiet", onClick: returnToSource });
  setActions(actions);

  if (downloadStarted) {
    showToast(settings.zip ? "Download do ZIP iniciado." : `${total} ${noun} ${sent} para Downloads.`);
  }
}

function showError(error) {
  const info = describeError(error);
  const settings = normalizedSettings();
  const allRendered = state.pageCount > 0 && state.files.length === state.pageCount;

  el.body.dataset.state = "error";
  setKicker("Não concluído");
  el.tabNote.hidden = true;
  setIndeterminate(false);
  setProgress(state.progress);
  setStatus(info.title, state.progress > 0 ? `${state.progress}%` : "");
  setDetail(
    state.downloadedCount > 0
      ? `${info.detail} ${
          state.downloadedCount === 1
            ? "A imagem já salva continua em Downloads."
            : `As ${state.downloadedCount} imagens já salvas continuam em Downloads.`
        }`
      : info.detail,
  );

  const actions = [];

  if (allRendered && settings.zip) {
    actions.push({
      label: "Baixar imagens separadas",
      variant: "primary",
      onClick: downloadReadyFilesIndividually,
    });
  } else if (["AUTH", "FETCH", "PDF", "TAB"].includes(error?.code) && state.job?.tabId && !state.usedTabFallback) {
    actions.push({
      label: "Buscar pela aba do Slides",
      variant: "primary",
      onClick: () => run({ viaTab: true }),
    });
  }

  actions.push({
    label: "Tentar novamente",
    variant: actions.length ? "ghost" : "primary",
    onClick: () => run(),
  });

  if (state.job?.tabId) {
    actions.push({ label: "Voltar à apresentação", variant: "quiet", onClick: returnToSource });
  }

  setActions(actions);
}

function showCancelled() {
  state.active = false;
  el.body.dataset.state = "cancelled";
  setKicker("Cancelado");
  el.tabNote.hidden = true;
  setIndeterminate(false);
  setProgress(state.progress);
  setStatus(
    "Exportação interrompida.",
    state.pageCount > 0 ? `${state.files.length} / ${state.pageCount}` : "",
  );

  if (state.downloadedCount > 0) {
    setDetail(
      state.downloadedCount === 1
        ? "A imagem já salva continua em Downloads."
        : `As ${state.downloadedCount} imagens já salvas continuam em Downloads.`,
    );
  } else if (state.files.length > 0) {
    const rendered = state.files.length;
    if (rendered === state.pageCount) {
      setDetail(
        state.pageCount === 1
          ? "A imagem foi renderizada, mas o download não começou."
          : "As imagens foram renderizadas, mas o download não começou.",
      );
    } else {
      setDetail(
        rendered === 1
          ? "A imagem renderizada até aqui não foi baixada."
          : `As ${rendered} imagens renderizadas até aqui não foram baixadas.`,
      );
    }
  } else {
    setDetail("Nada foi baixado.");
  }

  const actions = [];
  if (state.files.length > 0 && state.files.length === state.pageCount) {
    actions.push({
      label: state.pageCount === 1 ? "Baixar imagem pronta" : "Baixar imagens prontas",
      variant: "primary",
      onClick: downloadReadyFilesIndividually,
    });
  }
  actions.push({
    label: "Começar de novo",
    variant: actions.length ? "ghost" : "primary",
    onClick: () => run(),
  });
  if (state.job?.tabId) {
    actions.push({ label: "Voltar à apresentação", variant: "quiet", onClick: returnToSource });
  }
  setActions(actions);
}

function cancel() {
  if (!state.active || state.cancelled) return;
  state.cancelled = true;
  setKicker("Cancelando");
  setStatus("Interrompendo a exportação…");
  setDetail("");
  setActions([]);
  try {
    state.abortController?.abort();
  } catch {
    // O fetch já pode ter terminado.
  }
  try {
    state.renderTask?.cancel();
  } catch {
    // A renderização já pode ter terminado.
  }
  try {
    state.loadingTask?.destroy();
  } catch {
    // O PDF já pode ter sido aberto.
  }
}

async function downloadEntryIndividually(entry) {
  await downloadBlob(entry.blob, `${folderName()}/${entry.fileName}`);
}

async function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  try {
    const id = await chrome.downloads.download({
      url,
      filename,
      conflictAction: "uniquify",
      saveAs: false,
    });
    window.setTimeout(() => URL.revokeObjectURL(url), 300000);
    return id;
  } catch (error) {
    URL.revokeObjectURL(url);
    throw new ExportError("DOWNLOAD", "O Chrome não conseguiu salvar o arquivo em Downloads.");
  }
}

async function downloadZipAgain() {
  if (!state.zipBlob || state.redownloading) return;
  state.redownloading = true;
  try {
    await downloadBlob(state.zipBlob, zipFileName());
    showToast("Download do ZIP iniciado.");
  } catch (error) {
    showToast("O Chrome não iniciou o download. Verifique as permissões de download.");
  } finally {
    state.redownloading = false;
  }
}

async function downloadIndividualAgain() {
  if (!state.files.length || state.redownloading) return;
  state.redownloading = true;
  showToast("Salvando as imagens novamente…");
  try {
    for (const entry of state.files) {
      await downloadEntryIndividually(entry);
    }
    showToast(`${state.files.length} imagens salvas em Downloads.`);
  } catch (error) {
    showToast("O Chrome não iniciou todos os downloads.");
  } finally {
    state.redownloading = false;
  }
}

async function downloadReadyFilesIndividually() {
  if (!state.files.length || state.redownloading) return;
  state.redownloading = true;
  state.active = true;
  setStatus("Salvando as imagens em Downloads…", `0 / ${state.files.length}`);
  setDetail("As imagens já estão renderizadas; falta apenas salvar os arquivos.");
  setActions([]);
  try {
    let saved = 0;
    for (const entry of state.files) {
      await downloadEntryIndividually(entry);
      saved += 1;
      setStatus("Salvando as imagens em Downloads…", `${saved} / ${state.files.length}`);
    }
    state.job.settings.zip = false;
    showDone({ downloadStarted: true });
  } catch (error) {
    showError(error);
  } finally {
    state.redownloading = false;
    state.active = false;
  }
}

function zipFileName() {
  const { dpi, scale } = normalizedSettings();
  return `${state.baseName} - ${state.dims?.effectiveDpi || dpi}dpi ${scale}x.zip`;
}

function folderName() {
  const { dpi, scale } = normalizedSettings();
  return `${state.baseName} - ${state.dims?.effectiveDpi || dpi}dpi ${scale}x`;
}

function pageFileName(pageNumber) {
  const { format } = normalizedSettings();
  const digits = Math.max(2, String(state.pageCount).length);
  return `slide-${String(pageNumber).padStart(digits, "0")}.${format}`;
}

async function openDownloadsFolder() {
  try {
    chrome.downloads.showDefaultFolder();
  } catch {
    showToast("Abra a pasta Downloads do seu computador.");
  }
}

async function returnToSource() {
  const tabId = state.job?.tabId;
  if (tabId) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab?.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
      await chrome.tabs.update(tabId, { active: true });
    } catch {
      showToast("A apresentação original não está mais aberta.");
      return;
    }
  }
  await closeCurrentTab();
}

async function closeCurrentTab() {
  try {
    const tab = await chrome.tabs.getCurrent();
    if (tab?.id) await chrome.tabs.remove(tab.id);
  } catch {
    // Em testes, a API de abas pode não existir.
  }
}

function showNoJob(message) {
  el.body.dataset.state = "idle";
  el.deckTitle.textContent = "Nenhuma exportação em andamento";
  el.kicker.textContent = "Alta";
  el.statusText.textContent =
    message || "Abra o Google Slides, entre em uma apresentação e clique no ícone da Alta.";
  el.progressCount.textContent = "";
  el.statusDetail.hidden = false;
  el.statusDetail.textContent =
    "A exportação é iniciada pelo popup da extensão, na aba da apresentação.";
  el.barWrap.classList.remove("is-indeterminate");
  el.bar.style.width = "0%";
  el.barWrap.setAttribute("aria-valuenow", "0");
  el.preview.hidden = true;
  el.spec.hidden = true;
  el.tabNote.hidden = true;
  el.footNote.textContent = "300 dpi · 2×";
  setActions([
    {
      label: "Abrir Google Slides",
      variant: "primary",
      onClick: () => chrome.tabs.create({ url: "https://slides.google.com" }),
    },
    { label: "Fechar", variant: "ghost", onClick: closeCurrentTab },
  ]);
}

function setKicker(text) {
  el.kicker.textContent = text;
}

function setStatus(text, count) {
  el.statusText.textContent = text;
  if (typeof count === "string") el.progressCount.textContent = count;
}

function setDetail(text) {
  if (text) {
    el.statusDetail.textContent = text;
    el.statusDetail.hidden = false;
  } else {
    el.statusDetail.textContent = "";
    el.statusDetail.hidden = true;
  }
}

function setProgress(value) {
  const percent = Math.max(0, Math.min(100, Math.round(value)));
  state.progress = percent;
  el.barWrap.classList.remove("is-indeterminate");
  el.bar.style.width = `${percent}%`;
  el.barWrap.setAttribute("aria-valuenow", String(percent));
  el.barWrap.setAttribute("aria-valuetext", `${percent}%`);
}

function setIndeterminate(active) {
  if (active) {
    el.barWrap.classList.add("is-indeterminate");
    el.bar.style.width = "32%";
    el.barWrap.removeAttribute("aria-valuenow");
    el.barWrap.setAttribute("aria-valuetext", "Em andamento");
  } else {
    el.barWrap.classList.remove("is-indeterminate");
    el.bar.style.width = `${state.progress}%`;
    el.barWrap.setAttribute("aria-valuenow", String(state.progress));
    el.barWrap.setAttribute("aria-valuetext", `${state.progress}%`);
  }
}

function setActions(actions) {
  el.actions.replaceChildren();
  if (!actions.length) {
    el.actions.hidden = true;
    return;
  }
  el.actions.hidden = false;

  for (const action of actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `btn btn--${action.variant || "ghost"}`;
    button.textContent = action.label;
    button.addEventListener("click", action.onClick);
    el.actions.append(button);
  }
}

function showToast(message) {
  window.clearTimeout(state.toastTimer);
  el.toast.textContent = message;
  el.toast.classList.add("is-on");
  state.toastTimer = window.setTimeout(() => {
    el.toast.classList.remove("is-on");
  }, 4500);
}

function describeError(error) {
  switch (error?.code) {
    case "AUTH":
      return {
        title: "O Google não liberou o arquivo.",
        detail:
          "Sua sessão pode ter expirado ou a apresentação não está acessível por este navegador. Tente buscar o PDF pela aba do Slides.",
      };
    case "FETCH":
      return {
        title: "Não foi possível baixar o PDF.",
        detail:
          "Confira sua conexão e tente novamente. Se o problema continuar, use a opção de buscar pela aba do Slides.",
      };
    case "PDF":
      return {
        title: "O PDF não pôde ser aberto.",
        detail: "O arquivo pode ter chegado incompleto. Tente exportar novamente em alguns instantes.",
      };
    case "TAB":
      return {
        title: "A aba da apresentação não respondeu.",
        detail: "Abra a apresentação novamente no Google Slides e recarregue a página antes de tentar.",
      };
    case "CANVAS":
      return {
        title: "A imagem ficou grande demais.",
        detail:
          "O Chrome não conseguiu criar o canvas neste tamanho. Volte ao popup e reduza a resolução ou o tamanho do slide.",
      };
    case "DOWNLOAD":
      return {
        title: "O download não iniciou.",
        detail:
          "Verifique se o Chrome está permitindo downloads. As imagens continuam prontas nesta aba.",
      };
    case "ZIP_LIMIT":
      return {
        title: "O ZIP ficou grande demais.",
        detail: "Baixe as imagens separadamente para não esbarrar no limite de 4 GB do formato ZIP.",
      };
    default:
      return {
        title: "A exportação parou.",
        detail: "Algo inesperado aconteceu. Tente novamente. Se o erro persistir, recarregue a aba do Slides.",
      };
  }
}

function isCancellation(error) {
  return (
    state.cancelled ||
    error?.name === "AbortError" ||
    error?.name === "RenderingCancelledException" ||
    error?.code === "CANCELLED"
  );
}

function looksLikePdf(buffer) {
  if (!buffer || buffer.byteLength < 5) return false;
  const bytes = new Uint8Array(buffer, 0, 5);
  return (
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  );
}

function base64ToBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

function nextPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}

window.addEventListener("beforeunload", (event) => {
  if (state.active) {
    event.preventDefault();
    event.returnValue = "";
  }
});

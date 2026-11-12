(() => {
  if (window.__ALTA_CONTENT_SCRIPT__) return;
  window.__ALTA_CONTENT_SCRIPT__ = true;

  const MAX_FALLBACK_BYTES = 32 * 1024 * 1024;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== "object") return undefined;

    if (message.type === "ALTA_PING") {
      sendResponse({ ok: true });
      return undefined;
    }

    if (message.type === "ALTA_FETCH_PDF") {
      fetchPdf(message.docId, message.authUser)
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
      return true;
    }

    return undefined;
  });

  async function fetchPdf(docId, authUser) {
    if (!/^[A-Za-z0-9_-]+$/.test(String(docId || ""))) {
      throw new Error("Identificador de apresentação inválido.");
    }

    const url = new URL(`/presentation/d/${docId}/export/pdf`, location.origin);
    url.searchParams.set("id", docId);
    if (authUser != null && /^\d+$/.test(String(authUser))) {
      url.searchParams.set("authuser", String(authUser));
    }

    let bytes = null;

    try {
      const response = await fetch(url.href, {
        credentials: "include",
        cache: "no-store",
        redirect: "follow",
      });
      if (response.ok) {
        const candidate = new Uint8Array(await response.arrayBuffer());
        if (looksLikePdf(candidate)) bytes = candidate;
      }
    } catch {
      // O Google redireciona o PDF para googleusercontent.com. Numa página
      // comum, o redirect entre origens com credenciais pode ser bloqueado
      // pelo CORS; a segunda tentativa sem credenciais resolve decks públicos.
    }

    if (!bytes) {
      const publicResponse = await fetch(url.href, {
        credentials: "omit",
        cache: "no-store",
        redirect: "follow",
      });
      if (!publicResponse.ok) {
        throw new Error(`O Google respondeu com o código ${publicResponse.status}.`);
      }
      const candidate = new Uint8Array(await publicResponse.arrayBuffer());
      if (looksLikePdf(candidate)) bytes = candidate;
    }

    if (!bytes) {
      throw new Error("O Google não retornou um PDF. Verifique se você ainda está conectado à apresentação.");
    }

    if (bytes.length > MAX_FALLBACK_BYTES) {
      throw new Error(
        "O PDF desta apresentação tem mais de 32 MB e é grande demais para o modo alternativo. Baixe o PDF pelo menu Arquivo > Fazer download do Google Slides e tente abrir a apresentação novamente.",
      );
    }

    return {
      base64: bytesToBase64(bytes),
      byteLength: bytes.length,
    };
  }

  function looksLikePdf(bytes) {
    if (!bytes || bytes.length < 5) return false;
    return (
      bytes[0] === 0x25 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x44 &&
      bytes[3] === 0x46 &&
      bytes[4] === 0x2d
    );
  }

  function bytesToBase64(bytes) {
    const chunkSize = 0x8000;
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
  }
})();

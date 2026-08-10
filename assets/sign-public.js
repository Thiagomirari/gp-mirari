(function () {
  "use strict";
  const panels = ["loading-panel", "identity-panel", "otp-panel", "document-panel", "complete-panel"];
  const storageKey = "gp_mirari_signature_public_v1";
  const state = { token: "", challengeId: "", sessionToken: "", signerType: "person", consentVersion: "", documentCode: "", completed: false, documents: [], viewedDocumentVersionIds: [] };
  const byId = (id) => document.getElementById(id);
  const timezone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo"; } catch (_) { return "America/Sao_Paulo"; } };
  function endpoint() { const url = String(window.GP_MIRARI_SUPABASE?.url || "").replace(/\/+$/, ""); return `${url}/functions/v1/gp-v2-sign-public`; }
  function showPanel(id, step) { panels.forEach((panel) => byId(panel).classList.toggle("hidden", panel !== id)); document.querySelectorAll("[data-step]").forEach((item) => item.classList.toggle("active", Number(item.dataset.step) <= step)); }
  function message(text, kind) { const box = byId("message"); box.textContent = text || ""; box.className = text ? (kind === "success" ? "success" : "error") : "hidden"; }
  function busy(form, value) { form.querySelectorAll("button,input").forEach((control) => { control.disabled = value; }); }
  function readTransientState() { try { return JSON.parse(sessionStorage.getItem(storageKey) || "{}"); } catch (_) { return {}; } }
  function saveTransientState() { try { sessionStorage.setItem(storageKey, JSON.stringify({ token: state.token || "", challengeId: state.challengeId || "", sessionToken: state.sessionToken || "" })); } catch (_) {} }
  function clearTransientState() { try { sessionStorage.removeItem(storageKey); } catch (_) {} }
  function clearAccessFragment() { if (window.location.hash) history.replaceState(null, "", window.location.pathname + window.location.search); }
  async function call(action, body) {
    const response = await fetch(endpoint(), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, timezone: timezone(), ...body }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Não foi possível concluir esta etapa.");
    return data;
  }
  function friendly(error) {
    const code = String(error?.message || error || "");
    const messages = { signature_access_unavailable: "Este link está inválido, expirado ou indisponível.", identity_could_not_be_confirmed: "Não foi possível confirmar os dados informados.", otp_invalid_or_expired: "O código está incorreto, expirado ou bloqueado.", temporarily_unavailable: "Muitas tentativas foram realizadas. Aguarde e tente novamente.", rate_limit_service_unavailable: "A validação de segurança está temporariamente indisponível. Aguarde alguns instantes e tente novamente.", session_invalid_or_expired: "Sua sessão expirou. Abra novamente o link recebido por e-mail.", express_consent_required: "Leia o documento e marque as duas confirmações para assinar.", signature_process_closed: "Este processo já foi encerrado.", final_bundle_too_large: "A pasta é grande demais para um ZIP único. Baixe os documentos individualmente." };
    return messages[code] || "Não foi possível concluir esta etapa. Tente novamente.";
  }
  async function inspect() {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const persisted = readTransientState();
    state.token = hash.get("t") || persisted.token || "";
    state.challengeId = persisted.challengeId || "";
    state.sessionToken = persisted.sessionToken || "";
    if (state.sessionToken) {
      try {
        const resumed = await call("get_document", { sessionToken: state.sessionToken });
        presentDocument(resumed);
        return;
      } catch (_) {
        state.sessionToken = "";
        saveTransientState();
      }
    }
    if (!state.token) throw new Error("signature_access_unavailable");
    saveTransientState();
    const data = await call("inspect", { accessToken: state.token });
    state.signerType = data.signerType; state.documentCode = data.documentCode; state.completed = !!data.completed;
    byId("document-title").textContent = data.title; byId("document-code").textContent = `Código do documento: ${data.documentCode}`; byId("signer-name").textContent = data.signerName;
    byId("company-fields").classList.toggle("hidden", data.signerType !== "company_representative");
    byId("verify-link").href = `./verificar-assinatura.html?codigo=${encodeURIComponent(data.documentCode)}`;
    showPanel("identity-panel", 1);
  }
  function presentDocument(data) {
    state.consentVersion = data.consentText.version;
    state.documents = Array.isArray(data.documents) && data.documents.length ? data.documents : [{ title:data.title, signedUrl:data.documentUrl, sha256:data.originalSha256, documentVersionId:"", required:true }];
    state.viewedDocumentVersionIds = [];
    const list = byId("document-list");
    function showDocument(index) {
      const item = state.documents[index];
      byId("document-frame").onload = () => { if (item.documentVersionId && !state.viewedDocumentVersionIds.includes(item.documentVersionId)) state.viewedDocumentVersionIds.push(item.documentVersionId); };
      byId("document-frame").src = item.signedUrl; byId("original-hash").textContent = item.sha256 || data.originalSha256;
      [...list.querySelectorAll("button")].forEach((button, position) => button.classList.toggle("active", position === index));
    }
    list.replaceChildren(...state.documents.map((item, index) => { const button = document.createElement("button"); button.type = "button"; button.textContent = `Documento ${index + 1}: ${item.title}`; button.onclick = () => showDocument(index); return button; }));
    showDocument(0); byId("privacy-notice").textContent = `${data.privacyNotice.title}\n\n${data.privacyNotice.content}`; byId("consent-text").textContent = data.consentText.content;
    if (data.status === "signed") { byId("download-final").classList.remove("hidden"); byId("download-final-bundle").classList.toggle("hidden", state.documents.length < 2); byId("complete-message").textContent = "O documento foi concluído. Você pode baixar a cópia final idêntica à disponibilizada às demais partes."; showPanel("complete-panel", 4); }
    else showPanel("document-panel", 3);
  }
  async function sendOtp() {
    const data = await call("request_otp", { accessToken: state.token });
    if (!data.challengeId) throw new Error("Não foi possível enviar o código.");
    state.challengeId = data.challengeId; saveTransientState(); byId("masked-email").textContent = data.maskedEmail; showPanel("otp-panel", 2); message("Código enviado. Verifique também a pasta de spam.", "success");
  }
  byId("identity-form").addEventListener("submit", async (event) => {
    event.preventDefault(); message(""); busy(event.currentTarget, true);
    try { await call("confirm_identity", { accessToken: state.token, cpf: byId("cpf").value, cnpj: byId("cnpj").value, representationDeclared: byId("representation").checked }); await sendOtp(); } catch (error) { message(friendly(error)); } finally { busy(event.currentTarget, false); }
  });
  byId("resend-otp").addEventListener("click", async () => { message(""); try { await sendOtp(); } catch (error) { message(friendly(error)); } });
  byId("otp-form").addEventListener("submit", async (event) => {
    event.preventDefault(); message(""); busy(event.currentTarget, true);
    try {
      const result = await call("verify_otp", { accessToken: state.token, challengeId: state.challengeId, code: byId("otp").value }); state.sessionToken = result.sessionToken; state.token = ""; state.challengeId = ""; saveTransientState(); clearAccessFragment();
      presentDocument(await call("get_document", { sessionToken: state.sessionToken }));
      message("");
    } catch (error) { message(friendly(error)); } finally { busy(event.currentTarget, false); }
  });
  byId("consent-form").addEventListener("submit", async (event) => {
    event.preventDefault(); message(""); if (!byId("read-confirmation").checked || !byId("express-consent").checked) return message(friendly("express_consent_required"));
    busy(event.currentTarget, true);
    try {
      const required = state.documents.filter((item) => item.required !== false).map((item) => item.documentVersionId).filter(Boolean);
      if (required.some((id) => !state.viewedDocumentVersionIds.includes(id))) return message("Abra e visualize todos os documentos obrigatórios antes de assinar.");
      await call("accept_consent", { sessionToken: state.sessionToken, accepted: true, consentVersion: state.consentVersion, viewedDocumentVersionIds: state.viewedDocumentVersionIds });
      const result = await call("sign", { sessionToken: state.sessionToken });
      byId("complete-message").textContent = result.status === "finalizing" ? "Sua assinatura foi registrada. O documento final está sendo preparado." : result.status === "completed" ? "Todas as assinaturas foram concluídas. O documento final foi gerado e enviado às partes." : "Sua assinatura foi registrada. O processo aguarda as demais partes.";
      byId("download-final").classList.toggle("hidden", result.status !== "completed"); byId("download-final-bundle").classList.toggle("hidden", result.status !== "completed" || state.documents.length < 2); showPanel("complete-panel", 4); clearTransientState(); message("Assinatura registrada com sucesso.", "success");
    } catch (error) { message(friendly(error)); } finally { busy(event.currentTarget, false); }
  });
  byId("decline-button").addEventListener("click", async () => {
    const reason = window.prompt("Se desejar, informe o motivo da recusa:", ""); if (reason === null) return;
    try { await call("decline", { sessionToken: state.sessionToken, reason }); clearTransientState(); byId("complete-message").textContent = "O documento foi recusado e o processo foi encerrado."; showPanel("complete-panel", 4); } catch (error) { message(friendly(error)); }
  });
  byId("download-final").addEventListener("click", async () => { try { const data = await call("download_final", { sessionToken: state.sessionToken }); window.location.assign(data.signedUrl); } catch (error) { message(friendly(error)); } });
  byId("download-final-bundle").addEventListener("click", async () => { try { const response = await fetch(endpoint(), { method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({ action:"download_final_bundle", timezone:timezone(), sessionToken:state.sessionToken }) }); if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || "final_document_unavailable"); } const blob = await response.blob(), url = URL.createObjectURL(blob), link = document.createElement("a"); link.href = url; link.download = "documentos-assinados.zip"; document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url); } catch (error) { message(friendly(error)); } });
  inspect().catch((error) => { byId("document-title").textContent = "Acesso indisponível"; showPanel("loading-panel", 1); byId("loading-panel").textContent = friendly(error); message(friendly(error)); });
})();

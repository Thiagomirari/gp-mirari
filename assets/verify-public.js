(function () {
  "use strict";
  const form = document.getElementById("verify-form"), code = document.getElementById("code"), message = document.getElementById("message"), result = document.getElementById("result"), list = document.getElementById("result-list");
  const preset = new URLSearchParams(location.search).get("codigo") || ""; code.value = preset;
  const endpoint = () => `${String(window.GP_MIRARI_SUPABASE?.url || "").replace(/\/+$/, "")}/functions/v1/gp-v2-sign-public`;
  function showMessage(text, ok) { message.textContent = text; message.className = ok ? "success" : "error"; }
  function add(label, value) { const dt = document.createElement("dt"), dd = document.createElement("dd"); dt.textContent = label; dd.textContent = value || "Não disponível"; list.append(dt, dd); }
  form.addEventListener("submit", async (event) => {
    event.preventDefault(); result.classList.add("hidden"); message.className = "hidden"; list.replaceChildren();
    try {
      const response = await fetch(endpoint(), { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ action:"verify_document", code:code.value }) }); const data = await response.json(); if (!response.ok) throw new Error();
      add("Código", data.documentCode); add("Documento", data.title); add("Estado", data.status); add("Criado em", data.createdAt); add("Concluído em", data.completedAt); add("Hash SHA-256 original", data.originalSha256); add("Hash SHA-256 final", data.finalSha256); add("Modalidade", data.signatureLevel === "advanced" ? "Assinatura eletrônica avançada" : data.signatureLevel); add("Provedor", data.provider === "internal" ? "GP Mirari — provedor interno" : data.provider); add("Sistema", data.system); result.classList.remove("hidden"); showMessage("Documento localizado no registro de integridade do sistema.", true);
    } catch (_) { showMessage("Documento não localizado ou código inválido.", false); }
  });
  if (preset) form.requestSubmit();
})();

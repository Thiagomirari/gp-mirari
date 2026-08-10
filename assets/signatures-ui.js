/* GP Mirari V02 - Administrative interface for the document-signature module. */
(function () {
  "use strict";
  let client, organizationId = "", role = "", documents = [], notices = [], policies = [], initialized = false, pdfjsPromise = null;
  const statusText = { draft:"Rascunho", awaiting_send:"Aguardando envio", ready:"Aguardando envio", preparing:"Preparando", awaiting_signature:"Aguardando assinaturas", partially_signed:"Parcialmente assinado", finalizing:"Finalizando", signed:"Concluído", declined:"Recusado", expired:"Expirado", cancelled:"Cancelado", failed:"Falha", delivery_failed:"E-mail não entregue", superseded:"Substituído por nova versão" };
  const kindText = { contract:"Contrato", proposal:"Proposta", addendum:"Aditivo", executive_project:"Projeto executivo", acceptance_term:"Termo de aceite", other:"Outro" };
  const roleText = { contracting_party:"Contratante", contracted_party:"Contratado", legal_representative:"Representante legal", witness:"Testemunha", guarantor:"Fiador", avalist:"Avalista", approver:"Aprovador", signer:"Signatário" };
  const legalText = { contract_execution:"Execução de contrato", pre_contract:"Procedimentos preliminares", legal_obligation:"Obrigação legal", regular_exercise_rights:"Exercício regular de direitos", legitimate_interest:"Legítimo interesse", consent:"Consentimento específico", other:"Outra base validada" };
  const root = () => document.getElementById("tab-signatures");
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
  const dateBr = (value) => value ? new Intl.DateTimeFormat("pt-BR", { dateStyle:"short", timeStyle:"short" }).format(new Date(value)) : "—";
  const timezone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (_) { return "America/Sao_Paulo"; } };

  async function pdfjs() {
    if (!pdfjsPromise) pdfjsPromise = import("./vendor/pdfjs-4.10.38/pdf.min.js").then((module) => { module.GlobalWorkerOptions.workerSrc = "./assets/vendor/pdfjs-4.10.38/pdf.worker.min.js"; return module; });
    return pdfjsPromise;
  }

  function addStyles() {
    if (document.getElementById("signature-ui-style")) return;
    const style = document.createElement("style"); style.id = "signature-ui-style";
    style.textContent = `.sig-actions{display:flex;gap:10px;flex-wrap:wrap}.sig-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:16px 0}.sig-stat{padding:15px;border:1px solid var(--line,#ddd);border-radius:12px;background:#fff}.sig-stat strong{display:block;font-size:24px;color:#285f52}.sig-table-wrap{overflow:auto}.sig-table{width:100%;border-collapse:collapse}.sig-table th,.sig-table td{padding:12px 10px;text-align:left;border-bottom:1px solid var(--line,#ddd);vertical-align:top}.sig-badge{display:inline-flex;padding:5px 9px;border-radius:999px;background:#f0ece7;font-size:12px;font-weight:700}.sig-badge.signed{background:#e6f5ec;color:#17603d}.sig-badge.failed,.sig-badge.declined,.sig-badge.cancelled{background:#fdeaea;color:#983737}.sig-form{display:grid;gap:14px;margin-top:16px}.sig-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.sig-form label{display:grid;gap:6px;font-weight:700;font-size:13px}.sig-form input,.sig-form select,.sig-form textarea{padding:11px;border:1px solid var(--line,#ddd);border-radius:9px;background:#fff}.sig-form textarea{min-height:120px}.sig-panel{margin-top:16px}.sig-signer{padding:14px;border:1px solid var(--line,#ddd);border-radius:12px;margin-bottom:10px}.sig-help{padding:12px 14px;border-left:4px solid #285f52;background:#f5f1ec;font-size:13px}.sig-error{color:#9f3434}.sig-success{color:#17603d}.sig-empty{padding:28px;text-align:center;color:#6b6864}.sig-hash{max-width:250px;overflow-wrap:anywhere;font-family:monospace;font-size:11px}.sig-field-editor{margin:20px 0;padding:16px;border:1px solid var(--line,#ddd);border-radius:12px;background:#fff}.sig-pdf-preview{display:block;width:100%;max-height:620px;overflow:auto;border:1px solid var(--line,#ddd);border-radius:8px;margin:12px 0;padding:12px;background:#f6f1ec}.sig-pdf-page{position:relative;width:max-content;max-width:100%;margin:0 auto 18px;box-shadow:0 2px 8px #0002}.sig-pdf-canvas{display:block;max-width:100%;height:auto}.sig-pdf-field{position:absolute;z-index:2;border:2px solid #285f52;border-radius:4px;background:#e6f5ecd9;color:#173c32;font-weight:700;font-size:11px;overflow:hidden;touch-action:none;cursor:move}@media(max-width:850px){.sig-summary{grid-template-columns:repeat(2,1fr)}.sig-grid,.sig-signer-grid{grid-template-columns:1fr}.sig-pdf-preview{max-height:440px}}`;
    document.head.appendChild(style);
  }

  function getClient() {
    if (client) return client;
    const config = window.GP_MIRARI_SUPABASE || {};
    if (!window.supabase || !config.url || !config.anonKey) return null;
    client = window.supabase.createClient(config.url, config.anonKey);
    return client;
  }

  async function session() {
    const sb = getClient(); if (!sb) throw new Error("Supabase não configurado.");
    const { data } = await sb.auth.getSession(); if (!data.session) throw new Error("Faça login novamente."); return data.session;
  }

  async function invoke(body) {
    const auth = await session();
    const { data, error } = await getClient().functions.invoke("gp-v2-signatures", { body: { organizationId, timezone: timezone(), ...body }, headers: { "idempotency-key": crypto.randomUUID() } });
    if (error) { let message = error.message; try { const parsed = await error.context?.json(); message = parsed?.error || message; if (parsed?.error === "compliance_configuration_invalid" && Array.isArray(parsed.invalidFields)) message = `Revise: ${parsed.invalidFields.join(", ")}.`; } catch (_) {} throw new Error(message); }
    return data;
  }

  async function invokeUpload(formData) {
    const auth = await session(); const config = window.GP_MIRARI_SUPABASE;
    const response = await fetch(`${config.url}/functions/v1/gp-v2-signatures`, { method:"POST", headers:{ Authorization:`Bearer ${auth.access_token}`, apikey:config.anonKey, "idempotency-key":crypto.randomUUID() }, body:formData });
    const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || "Falha ao enviar documento."); return data;
  }

  async function invokePublicAdmin(body) {
    const auth = await session(); const config = window.GP_MIRARI_SUPABASE;
    const response = await fetch(`${config.url}/functions/v1/gp-v2-sign-public`, { method:"POST", headers:{ Authorization:`Bearer ${auth.access_token}`, apikey:config.anonKey, "Content-Type":"application/json" }, body:JSON.stringify({ organizationId, timezone:timezone(), ...body }) });
    const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || "Não foi possível retomar a finalização."); return data;
  }

  async function loadContext() {
    const auth = await session();
    const { data, error } = await getClient().from("gp_v2_memberships").select("organization_id,role,status").eq("user_id", auth.user.id).eq("status", "active").limit(1).maybeSingle();
    if (error || !data) throw new Error("Seu usuário não possui uma organização ativa."); organizationId = data.organization_id; role = data.role;
  }

  async function loadData() {
    const [docResult, noticeResult, policyResult] = await Promise.all([
      getClient().from("gp_v2_documents").select("id,title,document_kind,status,signature_level,verification_code,created_at,completed_at,current_version_id,gp_v2_signature_envelopes(id,status,provider,expires_at,completed_at)").eq("organization_id", organizationId).is("archived_at", null).order("created_at", { ascending:false }).limit(100),
      getClient().from("gp_v2_signature_privacy_notices").select("version,title,active,published_at").eq("organization_id", organizationId).eq("active", true),
      getClient().from("gp_v2_signature_retention_policies").select("version,name,document_kind,retention_months,evidence_retention_months,legal_basis,purpose,active").eq("organization_id", organizationId).eq("active", true),
    ]);
    if (docResult.error) throw docResult.error; documents = docResult.data || []; notices = noticeResult.data || []; policies = policyResult.data || [];
  }

  function summary() {
    const count = (statuses) => documents.filter((item) => statuses.includes(item.status)).length;
    return `<div class="sig-summary"><div class="sig-stat"><span>Aguardando</span><strong>${count(["ready","awaiting_send","awaiting_signature"])}</strong></div><div class="sig-stat"><span>Parciais</span><strong>${count(["partially_signed"])}</strong></div><div class="sig-stat"><span>Concluídos</span><strong>${count(["signed"])}</strong></div><div class="sig-stat"><span>Interrompidos</span><strong>${count(["declined","expired","cancelled","failed"])}</strong></div></div>`;
  }

  function documentRows() {
    if (!documents.length) return `<div class="sig-empty">Nenhum documento cadastrado. Use “Novo documento” para começar.</div>`;
    return `<div class="sig-table-wrap"><table class="sig-table"><thead><tr><th>Documento</th><th>Tipo</th><th>Estado</th><th>Código</th><th>Criado</th><th>Ações</th></tr></thead><tbody>${documents.map((doc) => {
      const envelopes = Array.isArray(doc.gp_v2_signature_envelopes) ? doc.gp_v2_signature_envelopes : []; const envelope = envelopes[0];
      return `<tr><td><strong>${esc(doc.title)}</strong><div class="muted">${doc.signature_level === "qualified_icp_brasil" ? "ICP-Brasil (opcional)" : "Eletrônica com evidências"}</div></td><td>${esc(kindText[doc.document_kind] || doc.document_kind)}</td><td><span class="sig-badge ${esc(doc.status)}">${esc(statusText[doc.status] || doc.status)}</span></td><td>${esc(doc.verification_code || "—")}</td><td>${dateBr(doc.created_at)}</td><td><div class="sig-actions">${["ready","failed","awaiting_signature"].includes(doc.status) ? `<button class="secondary" data-replace="${doc.id}" type="button">Substituir PDF</button>` : ""}${["ready","failed"].includes(doc.status) ? `<button class="secondary" data-send="${doc.id}" type="button">Enviar para assinatura</button>` : ""}${envelope ? `<button class="secondary" data-details="${envelope.id}" type="button">Detalhes</button>` : ""}${envelope && ["awaiting_signature","partially_signed","finalizing"].includes(envelope.status) ? `<button class="danger" data-cancel="${envelope.id}" type="button">Cancelar</button>` : ""}${envelope && doc.status === "signed" ? `<button class="secondary" data-download="${envelope.id}" type="button">Baixar final</button>` : ""}</div></td></tr>`;
    }).join("")}</tbody></table></div>`;
  }

  function dashboard() {
    return `<article class="panel"><div class="panel-header"><div><p class="eyebrow">Documentos e assinaturas</p><h2>Central de documentos</h2><p class="muted">Envie contratos, propostas, aditivos, projetos executivos e outros documentos para assinatura eletrônica.</p></div><div class="sig-actions"><button class="primary" id="sig-new" type="button">Novo documento</button>${["owner","admin"].includes(role) ? `<button class="secondary" id="sig-compliance" type="button">Privacidade e retenção</button>` : ""}<a class="secondary" href="./verificar-assinatura.html" target="_blank" rel="noopener">Verificar documento</a></div></div><p class="sig-help">O padrão é assinatura eletrônica com identificação, OTP por e-mail, aceite expresso, hashes e trilha de evidências. ICP-Brasil permanece opcional para situações específicas.</p>${summary()}<div id="sig-workspace"></div>${documentRows()}</article>`;
  }

  function newDocumentForm() {
    const notice = notices[0];
    if (!notice || !policies.length) return `<div class="sig-panel sig-error">Antes do primeiro documento, um administrador precisa publicar o aviso de privacidade e a política de retenção.</div>`;
    return `<div class="sig-panel form-box"><h3>Novo documento</h3><form id="sig-document-form" class="sig-form"><div class="sig-grid"><label>Título<input id="sig-title" required maxlength="180" /></label><label>Tipo<select id="sig-kind">${Object.entries(kindText).map(([key,value]) => `<option value="${key}">${value}</option>`).join("")}</select></label></div><label>Arquivo PDF<input id="sig-file" type="file" accept="application/pdf" required /></label><div class="sig-grid"><label>Finalidade<input id="sig-purpose" required maxlength="500" placeholder="Ex.: formalização do contrato de móveis planejados" /></label><label>Base legal<select id="sig-legal">${Object.entries(legalText).map(([key,value]) => `<option value="${key}">${value}</option>`).join("")}</select></label></div><div class="sig-grid"><label>Política de retenção<select id="sig-policy"></select></label><label>Manter até<input id="sig-retention-until" type="date" required /></label></div><input id="sig-privacy-version" type="hidden" value="${esc(notice.version)}" /><div class="sig-actions"><button class="primary" type="submit">Salvar documento</button><button class="secondary" data-close-workspace type="button">Cancelar</button></div><p id="sig-form-message"></p></form></div>`;
  }

  function complianceForm() {
    const stamp = new Date().toISOString().slice(0,10).replace(/-/g,"");
    return `<div class="sig-panel form-box"><h3>Privacidade e retenção</h3><p class="sig-help">Cada publicação cria uma versão imutável. O conteúdo deve ser revisado pelo responsável jurídico ou de proteção de dados da empresa.</p><form id="sig-compliance-form" class="sig-form"><div class="sig-grid"><label>Versão do aviso<input id="sig-privacy-version-new" value="privacidade-${stamp}" required /></label><label>Título<input id="sig-privacy-title" value="Aviso de privacidade — assinaturas eletrônicas" required /></label></div><label>Texto completo do aviso de privacidade<textarea id="sig-privacy-content" required placeholder="Informe controlador, finalidades, dados coletados, base legal, compartilhamentos, retenção, direitos do titular e canal de contato."></textarea></label><div class="sig-grid"><label>Versão da retenção<input id="sig-retention-version-new" value="retencao-${stamp}" required /></label><label>Nome da política<input id="sig-retention-name" value="Retenção de documentos assinados" required /></label><label>Tipo de documento<select id="sig-retention-kind">${Object.entries(kindText).map(([key,value]) => `<option value="${key}">${value}</option>`).join("")}</select></label><label>Base legal<select id="sig-retention-legal">${Object.entries(legalText).map(([key,value]) => `<option value="${key}">${value}</option>`).join("")}</select></label><label>Retenção do documento (meses)<input id="sig-retention-months" type="number" min="1" max="600" value="120" required /></label><label>Retenção das evidências (meses)<input id="sig-evidence-months" type="number" min="1" max="600" value="120" required /></label></div><label>Finalidade do tratamento<input id="sig-retention-purpose" required placeholder="Finalidade específica deste tipo de documento" /></label><label>Responsável pela aprovação<input id="sig-approved-by" required placeholder="Nome e função" /></label><label><input id="sig-legal-confirm" type="checkbox" required /> Confirmo que o conteúdo e os prazos foram revisados e aprovados pelo responsável competente.</label><div class="sig-actions"><button class="primary" type="submit">Publicar nova versão</button><button class="secondary" data-close-workspace type="button">Cancelar</button></div><p id="sig-form-message"></p></form></div>`;
  }

  function signerRow(index) {
    return `<div class="sig-signer" data-signer-row><div class="sig-signer-grid"><label>Nome completo<input data-signer-name required /></label><label>E-mail<input data-signer-email type="email" required /></label><label>CPF<input data-signer-cpf inputmode="numeric" required /></label><label>Papel<select data-signer-role>${Object.entries(roleText).map(([key,value]) => `<option value="${key}">${value}</option>`).join("")}</select></label></div><div class="sig-actions"><label><input data-signer-company type="checkbox" /> Representa pessoa jurídica</label>${index ? `<button class="danger" data-remove-signer type="button">Remover</button>` : ""}</div><div class="sig-grid hidden" data-company-fields><label>Razão social<input data-company-name /></label><label>CNPJ<input data-company-document /></label><label>Cargo ou função<input data-company-job /></label></div></div>`;
  }

  function sendForm(documentId) {
    const doc = documents.find((item) => item.id === documentId);
    const additional = documents.filter((item) => item.id !== documentId && ["ready","failed"].includes(item.status));
    return `<div class="sig-panel form-box"><h3>Enviar “${esc(doc?.title || "Documento")}”</h3><p class="sig-help">Cada pessoa receberá um link individual. O CPF/CNPJ será usado apenas para confirmação e armazenado por hash.</p><form id="sig-send-form" class="sig-form" data-document-id="${documentId}"><label>Outros documentos nesta pasta (opcional)<select id="sig-additional-documents" multiple size="${Math.min(5, Math.max(2, additional.length || 2))}">${additional.map((item) => `<option value="${item.id}">${esc(item.title)} — ${esc(kindText[item.document_kind] || item.document_kind)}</option>`).join("")}</select></label><p class="muted">Use Ctrl/Cmd para selecionar vários PDFs. Todos ficam vinculados ao mesmo processo e à mesma trilha de evidências.</p><div id="sig-signers">${signerRow(0)}</div><button class="secondary" id="sig-add-signer" type="button">Adicionar signatário</button><div class="sig-grid"><label>Validade do convite (horas)<input id="sig-expires" type="number" min="1" max="720" value="168" /></label></div><div class="sig-actions"><button class="primary" type="submit">Enviar convites</button><button class="secondary" data-close-workspace type="button">Cancelar</button></div><p id="sig-form-message"></p></form></div>`;
  }

  function replaceDocumentForm(documentId) {
    const doc = documents.find((item) => item.id === documentId);
    return `<div class="sig-panel form-box"><h3>Substituir PDF</h3><p class="sig-help">A troca cria uma nova versão com novo hash SHA-256. Se ainda não houve assinatura, os convites ativos são revogados e o processo anterior é cancelado; depois, envie a nova versão.</p><form id="sig-replace-form" class="sig-form" data-document-id="${documentId}"><label>Novo arquivo PDF<input id="sig-replace-file" type="file" accept="application/pdf" required /></label><div class="sig-actions"><button class="primary" type="submit">Criar nova versão de “${esc(doc?.title || "documento")}”</button><button class="secondary" data-close-workspace type="button">Cancelar</button></div><p id="sig-form-message"></p></form></div>`;
  }

  function bindWorkspaceClose() { root().querySelectorAll("[data-close-workspace]").forEach((button) => button.onclick = () => { document.getElementById("sig-workspace").replaceChildren(); }); }
  function setFormMessage(text, ok) { const node = document.getElementById("sig-form-message"); if (node) { node.textContent = text; node.className = ok ? "sig-success" : "sig-error"; } }

  function bindDashboard() {
    document.getElementById("sig-new")?.addEventListener("click", () => { document.getElementById("sig-workspace").innerHTML = newDocumentForm(); bindDocumentForm(); bindWorkspaceClose(); });
    document.getElementById("sig-compliance")?.addEventListener("click", () => { document.getElementById("sig-workspace").innerHTML = complianceForm(); bindComplianceForm(); bindWorkspaceClose(); });
    root().querySelectorAll("[data-send]").forEach((button) => button.onclick = () => { document.getElementById("sig-workspace").innerHTML = sendForm(button.dataset.send); bindSendForm(); bindWorkspaceClose(); });
    root().querySelectorAll("[data-replace]").forEach((button) => button.onclick = () => { document.getElementById("sig-workspace").innerHTML = replaceDocumentForm(button.dataset.replace); bindReplaceDocumentForm(); bindWorkspaceClose(); });
    root().querySelectorAll("[data-cancel]").forEach((button) => button.onclick = async () => { const reason = prompt("Informe o motivo do cancelamento:", ""); if (reason === null) return; if (!confirm("Cancelar este processo? Os links serão revogados e as assinaturas não poderão ser reutilizadas.")) return; try { await invoke({ action:"cancel_envelope", envelopeId:button.dataset.cancel, reason }); await refresh(); } catch (error) { alert(error.message); } });
    root().querySelectorAll("[data-download]").forEach((button) => button.onclick = async () => { try { const data = await invoke({ action:"download_artifact", envelopeId:button.dataset.download, artifactKind:"signed_pdf" }); location.assign(data.signedUrl); } catch (error) { alert(error.message); } });
    root().querySelectorAll("[data-details]").forEach((button) => button.onclick = () => showDetails(button.dataset.details));
  }

  function bindDocumentForm() {
    {
      const kind = document.getElementById("sig-kind");
      ["sig-purpose", "sig-legal", "sig-policy", "sig-retention-until"].forEach((id) => { const field = document.getElementById(id); field?.closest("label")?.classList.add("hidden"); if (field) field.required = false; });
      document.getElementById("sig-document-form").onsubmit = async (event) => {
        event.preventDefault();
        const file = document.getElementById("sig-file").files[0];
        if (!file || file.type !== "application/pdf") return setFormMessage("Selecione um arquivo PDF.");
        const form = new FormData();
        form.set("file", file);
        form.set("metadata", JSON.stringify({ organizationId, title:document.getElementById("sig-title").value, documentKind:kind.value, sourceType:"manual", signatureLevel:"advanced" }));
        try { setFormMessage("Enviando e calculando o hash…", true); await invokeUpload(form); await refresh(); } catch (error) { setFormMessage(error.message); }
      };
      return;
    }
    const kind = document.getElementById("sig-kind"), policy = document.getElementById("sig-policy"), retention = document.getElementById("sig-retention-until");
    function updatePolicies() { const matches = policies.filter((item) => item.document_kind === kind.value); policy.innerHTML = matches.map((item) => `<option value="${esc(item.version)}" data-months="${item.retention_months}" data-legal="${item.legal_basis}">${esc(item.name)} — ${item.retention_months} meses</option>`).join(""); if (matches[0]) { document.getElementById("sig-legal").value = matches[0].legal_basis; const date = new Date(); date.setMonth(date.getMonth() + Number(matches[0].retention_months)); retention.value = date.toISOString().slice(0,10); } }
    kind.onchange = updatePolicies; policy.onchange = () => { const selected = policy.selectedOptions[0]; if (!selected) return; document.getElementById("sig-legal").value = selected.dataset.legal; const date = new Date(); date.setMonth(date.getMonth() + Number(selected.dataset.months)); retention.value = date.toISOString().slice(0,10); }; updatePolicies();
    document.getElementById("sig-document-form").onsubmit = async (event) => { event.preventDefault(); const file = document.getElementById("sig-file").files[0]; if (!file || file.type !== "application/pdf") return setFormMessage("Selecione um arquivo PDF."); if (!policy.value) return setFormMessage("Não existe política ativa para este tipo de documento."); const form = new FormData(); form.set("file", file); form.set("metadata", JSON.stringify({ organizationId, title:document.getElementById("sig-title").value, documentKind:kind.value, sourceType:"manual", signatureLevel:"advanced", purpose:document.getElementById("sig-purpose").value, legalBasis:document.getElementById("sig-legal").value, privacyNoticeVersion:document.getElementById("sig-privacy-version").value, retentionPolicyVersion:policy.value, retentionUntil:retention.value })); try { setFormMessage("Enviando e calculando o hash…", true); await invokeUpload(form); await refresh(); } catch (error) { setFormMessage(error.message); } };
  }

  function bindComplianceForm() {
    document.getElementById("sig-compliance-form").onsubmit = async (event) => { event.preventDefault(); try { setFormMessage("Publicando versões…", true); await invoke({ action:"save_compliance_configuration", legalReviewConfirmed:document.getElementById("sig-legal-confirm").checked, privacy:{ version:document.getElementById("sig-privacy-version-new").value, title:document.getElementById("sig-privacy-title").value, content:document.getElementById("sig-privacy-content").value }, retention:{ version:document.getElementById("sig-retention-version-new").value, name:document.getElementById("sig-retention-name").value, documentKind:document.getElementById("sig-retention-kind").value, legalBasis:document.getElementById("sig-retention-legal").value, retentionMonths:Number(document.getElementById("sig-retention-months").value), evidenceRetentionMonths:Number(document.getElementById("sig-evidence-months").value), purpose:document.getElementById("sig-retention-purpose").value, approvedBy:document.getElementById("sig-approved-by").value } }); await refresh(); } catch (error) { setFormMessage(error.message); } };
  }

  function bindSendForm() {
    const holder = document.getElementById("sig-signers");
    function bindRows() { holder.querySelectorAll("[data-signer-company]").forEach((box) => box.onchange = () => box.closest("[data-signer-row]").querySelector("[data-company-fields]").classList.toggle("hidden", !box.checked)); holder.querySelectorAll("[data-remove-signer]").forEach((button) => button.onclick = () => button.closest("[data-signer-row]").remove()); }
    bindRows(); document.getElementById("sig-add-signer").onclick = () => { holder.insertAdjacentHTML("beforeend", signerRow(holder.children.length)); bindRows(); };
    document.getElementById("sig-send-form").onsubmit = async (event) => { event.preventDefault(); const signers = [...holder.querySelectorAll("[data-signer-row]")].map((row) => { const company = row.querySelector("[data-signer-company]").checked; return { name:row.querySelector("[data-signer-name]").value, email:row.querySelector("[data-signer-email]").value, cpf:row.querySelector("[data-signer-cpf]").value, role:row.querySelector("[data-signer-role]").value, signerType:company ? "company_representative" : "person", companyLegalName:company ? row.querySelector("[data-company-name]").value : "", companyDocument:company ? row.querySelector("[data-company-document]").value : "", jobTitle:company ? row.querySelector("[data-company-job]").value : "" }; }); try { setFormMessage("Criando links individuais e enviando convites…", true); const documentIds = [...document.getElementById("sig-additional-documents").selectedOptions].map((item) => item.value); const data = await invoke({ action:"send_document", provider:"internal", documentId:event.currentTarget.dataset.documentId, documentIds, expiresInHours:Number(document.getElementById("sig-expires").value), signers }); setFormMessage(`${data.invitationsDelivered} convite(s) enviado(s) para ${data.documentCount || 1} documento(s).`, true); setTimeout(refresh, 700); } catch (error) { setFormMessage(error.message); } };
  }

  function bindReplaceDocumentForm() {
    document.getElementById("sig-replace-form").onsubmit = async (event) => { event.preventDefault(); const file = document.getElementById("sig-replace-file").files[0]; if (!file || file.type !== "application/pdf") return setFormMessage("Selecione um arquivo PDF."); const form = new FormData(); form.set("file", file); form.set("metadata", JSON.stringify({ organizationId, replaceDocumentId:event.currentTarget.dataset.documentId, timezone:timezone() })); try { setFormMessage("Enviando nova versão e revogando os convites sem assinatura…", true); const data = await invokeUpload(form); setFormMessage(data.cancelledEnvelopeCount ? "Nova versão criada. Os convites anteriores foram revogados; envie a nova versão para assinatura." : "Nova versão criada. Envie-a para assinatura.", true); setTimeout(refresh, 900); } catch (error) { setFormMessage(error.message); } };
  }

  function bindFieldsEditor(envelope, envelopeDocuments, signers, savedFields) {
    if (!["preparing", "awaiting_send", "awaiting_signature", "failed"].includes(envelope?.status) || !envelopeDocuments.length || !signers.length) return;
    let fields = (savedFields || []).map((item) => ({ envelopeDocumentId:item.envelope_document_id, documentVersionId:item.document_version_id, signerId:item.signer_id, fieldType:item.field_type, pageNumber:Number(item.page_number), xRatio:Number(item.x_ratio), yRatio:Number(item.y_ratio), widthRatio:Number(item.width_ratio), heightRatio:Number(item.height_ratio), pageRotation:Number(item.page_rotation || 0), required:item.required !== false }));
    const message = document.getElementById("sig-field-message"), list = document.getElementById("sig-field-list"), value = (id) => document.getElementById(id).value;
    const render = () => { list.innerHTML = fields.length ? `<div class="sig-table-wrap"><table class="sig-table"><thead><tr><th>Documento</th><th>Signatario</th><th>Campo</th><th>Posicao</th><th></th></tr></thead><tbody>${fields.map((field, index) => { const documentItem = envelopeDocuments.find((item) => item.id === field.envelopeDocumentId), signer = signers.find((item) => item.id === field.signerId); return `<tr><td>${esc(documentItem?.gp_v2_documents?.title || documentItem?.gp_v2_document_versions?.file_name || "Documento")}</td><td>${esc(signer?.name || "")}</td><td>${esc(field.fieldType)}</td><td>p.${field.pageNumber} - x ${field.xRatio}, y ${field.yRatio}, ${field.widthRatio} x ${field.heightRatio}</td><td><button class="danger" data-remove-field="${index}" type="button">Remover</button></td></tr>`; }).join("")}</tbody></table></div>` : `<p class="muted">Nenhum campo configurado. A assinatura continuara registrada no relatorio, sem marca visual no PDF.</p>`; list.querySelectorAll("[data-remove-field]").forEach((button) => button.onclick = () => { fields.splice(Number(button.dataset.removeField), 1); render(); }); };
    let previewUrl = "", previewDocumentId = "";
    const renderPdf = async () => {
      const host = document.getElementById("sig-field-preview-frame"); if (!previewUrl || !host) return;
      host.hidden = false; host.replaceChildren();
      const bytes = new Uint8Array(await (await fetch(previewUrl, { credentials:"omit" })).arrayBuffer());
      const pdf = await (await pdfjs()).getDocument({ data:bytes }).promise;
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber), viewport = page.getViewport({ scale:1.35 }), canvas = document.createElement("canvas"), stage = document.createElement("div"), context = canvas.getContext("2d");
        canvas.width = viewport.width; canvas.height = viewport.height; canvas.className = "sig-pdf-canvas"; stage.className = "sig-pdf-page"; stage.dataset.page = String(pageNumber); stage.append(canvas); host.append(stage);
        await page.render({ canvasContext:context, viewport }).promise;
        const paint = () => fields.filter((field) => field.envelopeDocumentId === previewDocumentId && field.pageNumber === pageNumber).forEach((field) => { const index = fields.indexOf(field), marker = document.createElement("button"); marker.type = "button"; marker.className = "sig-pdf-field"; marker.textContent = field.fieldType === "signature" ? "Assinatura" : field.fieldType; marker.style.left = `${field.xRatio * 100}%`; marker.style.top = `${field.yRatio * 100}%`; marker.style.width = `${field.widthRatio * 100}%`; marker.style.height = `${field.heightRatio * 100}%`; marker.setAttribute("aria-label", `Mover campo ${field.fieldType} na pagina ${pageNumber}`); marker.onpointerdown = (event) => { event.preventDefault(); event.stopPropagation(); marker.setPointerCapture(event.pointerId); const move = (moveEvent) => { const rect = stage.getBoundingClientRect(); field.xRatio = Math.max(0, Math.min(1 - field.widthRatio, (moveEvent.clientX - rect.left - marker.offsetWidth / 2) / rect.width)); field.yRatio = Math.max(0, Math.min(1 - field.heightRatio, (moveEvent.clientY - rect.top - marker.offsetHeight / 2) / rect.height)); marker.style.left = `${field.xRatio * 100}%`; marker.style.top = `${field.yRatio * 100}%`; }; marker.onpointermove = move; marker.onpointerup = () => { marker.onpointermove = null; render(); message.textContent = "Campo movido. Salve os campos para persistir."; message.className = "sig-success"; }; }; stage.append(marker); });
        paint();
        stage.onclick = (event) => { if (event.target !== canvas) return; const rect = stage.getBoundingClientRect(), documentSelect = document.getElementById("sig-field-document"), width = Number(value("sig-field-width")), height = Number(value("sig-field-height")), x = Math.max(0, Math.min(1 - width, (event.clientX - rect.left) / rect.width)), y = Math.max(0, Math.min(1 - height, (event.clientY - rect.top) / rect.height)); fields.push({ envelopeDocumentId:documentSelect.value, documentVersionId:documentSelect.selectedOptions[0].dataset.version, signerId:value("sig-field-signer"), fieldType:value("sig-field-type"), pageNumber, xRatio:x, yRatio:y, widthRatio:width, heightRatio:height, pageRotation:0, required:true }); render(); renderPdf(); message.textContent = "Campo criado no ponto selecionado. Arraste-o para ajustar e salve ao concluir."; message.className = "sig-success"; };
      }
    };
    render();
    document.getElementById("sig-field-preview").onclick = async () => { try { message.textContent = "Gerando previa temporaria..."; message.className = "sig-success"; previewDocumentId = value("sig-field-document"); const data = await invoke({ action:"preview_envelope_document", envelopeId:envelope.id, envelopeDocumentId:previewDocumentId }); previewUrl = data.signedUrl; await renderPdf(); message.textContent = "Previa carregada. Clique para criar ou arraste um campo para mover."; } catch (error) { message.textContent = error.message; message.className = "sig-error"; } };
    document.getElementById("sig-field-add").onclick = () => { const documentSelect = document.getElementById("sig-field-document"), x = Number(value("sig-field-x")), y = Number(value("sig-field-y")), width = Number(value("sig-field-width")), height = Number(value("sig-field-height")), page = Number(value("sig-field-page")); if (!Number.isInteger(page) || page < 1 || ![x,y,width,height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1 || y + height > 1) { message.textContent = "Informe coordenadas validas, entre 0 e 1, sem ultrapassar a pagina."; message.className = "sig-error"; return; } fields.push({ envelopeDocumentId:documentSelect.value, documentVersionId:documentSelect.selectedOptions[0].dataset.version, signerId:value("sig-field-signer"), fieldType:value("sig-field-type"), pageNumber:page, xRatio:x, yRatio:y, widthRatio:width, heightRatio:height, pageRotation:0, required:true }); render(); message.textContent = "Campo adicionado. Salve os campos para persistir."; message.className = "sig-success"; };
    document.getElementById("sig-field-save").onclick = async () => { try { message.textContent = "Salvando campos..."; message.className = "sig-success"; const response = await invoke({ action:"save_signature_fields", envelopeId:envelope.id, fields }); message.textContent = `${response.fieldCount} campo(s) salvo(s).`; await showDetails(envelope.id); } catch (error) { message.textContent = error.message; message.className = "sig-error"; } };
  }

  async function showDetails(envelopeId) {
    const [{ data: envelope }, { data: signers }, { data: events }, { data: envelopeDocuments }, { data: fields }] = await Promise.all([
      getClient().from("gp_v2_signature_envelopes").select("id,status,provider,expires_at,completed_at,last_error_code").eq("organization_id", organizationId).eq("id", envelopeId).maybeSingle(),
      getClient().from("gp_v2_signature_signers").select("id,name,email,signer_role,status,signed_at,viewed_at").eq("organization_id", organizationId).eq("envelope_id", envelopeId).order("signing_order"),
      getClient().from("gp_v2_signature_events").select("sequence_number,event_type,occurred_at,result").eq("organization_id", organizationId).eq("envelope_id", envelopeId).order("sequence_number"),
      getClient().from("gp_v2_signature_envelope_documents").select("id,document_version_id,display_order,required,gp_v2_documents(title),gp_v2_document_versions(file_name,sha256)").eq("organization_id", organizationId).eq("envelope_id", envelopeId).order("display_order"),
      getClient().from("gp_v2_signature_fields").select("envelope_document_id,document_version_id,signer_id,field_type,page_number,x_ratio,y_ratio,width_ratio,height_ratio,page_rotation,required").eq("organization_id", organizationId).eq("envelope_id", envelopeId).order("created_at"),
    ]);
    const docs = envelopeDocuments || [], signerRows = signers || [];
    document.getElementById("sig-workspace").innerHTML = `<div class="sig-panel form-box"><div class="panel-header"><div><h3>Detalhes do processo</h3><p class="muted">Estado: ${esc(statusText[envelope?.status] || envelope?.status)} · expira: ${dateBr(envelope?.expires_at)}</p></div><div class="sig-actions">${envelope?.status === "finalizing" ? `<button class="primary" data-retry-finalization="${envelope.id}" type="button">Retomar finalização</button>` : ""}<button class="secondary" data-close-workspace type="button">Fechar</button></div></div><h4>Signatários</h4><div class="sig-table-wrap"><table class="sig-table"><tbody>${(signers || []).map((item) => `<tr><td><strong>${esc(item.name)}</strong><br>${esc(item.email)}</td><td>${esc(roleText[item.signer_role] || item.signer_role)}</td><td><span class="sig-badge ${esc(item.status)}">${esc(statusText[item.status] || item.status)}</span></td><td>${dateBr(item.signed_at)}</td><td>${!["signed","declined"].includes(item.status) && envelope?.status !== "signed" ? `<button class="secondary" data-resend="${item.id}" type="button">Reenviar</button><button class="secondary" data-correct-signer="${item.id}" data-signer-name="${esc(item.name)}" data-signer-email="${esc(item.email)}" type="button">Corrigir e reenviar</button>` : ""}</td></tr>`).join("")}</tbody></table></div><h4>Trilha cronológica</h4><div class="sig-table-wrap"><table class="sig-table"><tbody>${(events || []).map((item) => `<tr><td>#${item.sequence_number}</td><td>${esc(item.event_type)}</td><td>${dateBr(item.occurred_at)}</td><td>${esc(item.result)}</td></tr>`).join("")}</tbody></table></div></div>`;
    bindWorkspaceClose();
    if (["preparing", "awaiting_send", "awaiting_signature", "failed"].includes(envelope?.status) && docs.length && signerRows.length) {
      const editor = `<section class="sig-field-editor"><h4>Campos de assinatura</h4><p class="sig-help">Editor visual: abra a previa, clique na pagina para criar o campo e arraste para reposicionar. Coordenadas numericas permanecem disponiveis como alternativa acessivel. A configuracao e bloqueada apos a primeira acao do signatario.</p><div class="sig-grid"><label>Documento<select id="sig-field-document">${docs.map((item) => `<option value="${item.id}" data-version="${item.document_version_id}">${esc(item.gp_v2_documents?.title || item.gp_v2_document_versions?.file_name || "Documento")}</option>`).join("")}</select></label><label>Signatario<select id="sig-field-signer">${signerRows.map((item) => `<option value="${item.id}">${esc(item.name)} - ${esc(item.email)}</option>`).join("")}</select></label><label>Tipo<select id="sig-field-type"><option value="signature">Assinatura</option><option value="initial">Rubrica</option><option value="signer_name">Nome</option><option value="signed_at">Data e hora</option></select></label><label>Pagina<input id="sig-field-page" type="number" min="1" value="1" required /></label></div><div class="sig-grid"><label>X<input id="sig-field-x" type="number" min="0" max="1" step="0.001" value="0.10" required /></label><label>Y<input id="sig-field-y" type="number" min="0" max="1" step="0.001" value="0.80" required /></label><label>Largura<input id="sig-field-width" type="number" min="0.001" max="1" step="0.001" value="0.30" required /></label><label>Altura<input id="sig-field-height" type="number" min="0.001" max="1" step="0.001" value="0.08" required /></label></div><div class="sig-actions"><button class="secondary" id="sig-field-preview" type="button">Abrir previa</button><button class="secondary" id="sig-field-add" type="button">Adicionar campo</button><button class="primary" id="sig-field-save" type="button">Salvar campos</button></div><p id="sig-field-message"></p><div id="sig-field-preview-frame" class="sig-pdf-preview" hidden aria-live="polite"></div><div id="sig-field-list"></div></section>`;
      document.getElementById("sig-workspace").querySelector(".panel-header")?.insertAdjacentHTML("afterend", editor);
      bindFieldsEditor(envelope, docs, signerRows, fields || []);
    }
    root().querySelectorAll("[data-resend]").forEach((button) => button.onclick = async () => { try { await invoke({ action:"resend_invitation", signerId:button.dataset.resend }); alert("Novo convite enviado e link anterior revogado."); } catch (error) { alert(error.message); } });
    root().querySelectorAll("[data-correct-signer]").forEach((button) => button.onclick = async () => { const name = prompt("Nome do signatário:", button.dataset.signerName || ""); if (name === null) return; const email = prompt("E-mail correto para envio:", button.dataset.signerEmail || ""); if (email === null) return; try { await invoke({ action:"correct_signer_and_resend", signerId:button.dataset.correctSigner, name, email }); alert("Dados corrigidos. O link anterior foi revogado e um novo convite foi enviado."); await showDetails(envelopeId); } catch (error) { alert(error.message); } });
    root().querySelectorAll("[data-retry-finalization]").forEach((button) => button.onclick = async () => { try { button.disabled = true; button.textContent = "Finalizando…"; await invokePublicAdmin({ action:"retry_finalization", envelopeId:button.dataset.retryFinalization }); await refresh(); } catch (error) { alert(error.message); button.disabled = false; button.textContent = "Retomar finalização"; } });
  }

  async function refresh() { await loadData(); root().innerHTML = dashboard(); bindDashboard(); }
  async function render() {
    if (!root() || root().classList.contains("hidden")) return;
    addStyles(); root().innerHTML = `<article class="panel"><p>Carregando documentos…</p></article>`;
    try { if (!organizationId) await loadContext(); await refresh(); initialized = true; } catch (error) { root().innerHTML = `<article class="panel"><p class="sig-error">${esc(error.message)}</p></article>`; }
  }
  window.GP_SIGNATURES_UI = { render };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => { if (!root()?.classList.contains("hidden")) render(); }); else if (!root()?.classList.contains("hidden")) render();
})();

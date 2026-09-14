/* GP Mirari V02 - Administrative interface for the document-signature module. */
(function () {
  "use strict";
  let client, organizationId = "", role = "", documents = [], notices = [], policies = [], pdfjsPromise = null, renderSequence = 0;
  const statusText = { draft:"Rascunho", awaiting_send:"Aguardando envio", ready:"Aguardando envio", preparing:"Preparando", awaiting_signature:"Aguardando assinaturas", partially_signed:"Parcialmente assinado", finalizing:"Finalizando", signed:"Concluído", declined:"Recusado", expired:"Expirado", cancelled:"Cancelado", failed:"Falha", delivery_failed:"E-mail não entregue", superseded:"Substituído por nova versão" };
  const kindText = { contract:"Contrato", proposal:"Proposta", addendum:"Aditivo", executive_project:"Projeto executivo", acceptance_term:"Termo de aceite", other:"Outro" };
  const roleText = { contracting_party:"Contratante", contracted_party:"Contratado", legal_representative:"Representante legal", witness:"Testemunha", guarantor:"Fiador", avalist:"Avalista", approver:"Aprovador", signer:"Signatário" };
  const legalText = { contract_execution:"Execução de contrato", pre_contract:"Procedimentos preliminares", legal_obligation:"Obrigação legal", regular_exercise_rights:"Exercício regular de direitos", legitimate_interest:"Legítimo interesse", consent:"Consentimento específico", other:"Outra base validada" };
  const root = () => document.getElementById("tab-signatures");
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
  const dateBr = (value) => value ? new Intl.DateTimeFormat("pt-BR", { dateStyle:"short", timeStyle:"short" }).format(new Date(value)) : "—";
  const timezone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (_) { return "America/Sao_Paulo"; } };
  const errorText = {
    active_compliance_configuration_required:"A configuração padrão de privacidade e retenção ainda não foi publicada para este tipo de documento.",
    document_upload_failed:"Não foi possível enviar o arquivo. Verifique a conexão e tente novamente.",
    document_create_failed:"Não foi possível cadastrar o documento.",
    envelope_documents_not_ready:"Um dos documentos selecionados não está pronto para assinatura.",
    internal_signature_provider_not_configured:"O envio de assinaturas ainda não está configurado no servidor.",
    signature_fields_required:"Posicione ao menos uma assinatura para cada destinatário antes de enviar.",
    signature_fields_locked:"Os campos não podem mais ser alterados porque o processo já foi iniciado.",
    signers_invalid:"Revise nome, e-mail e CPF dos destinatários.",
    company_representative_invalid:"Revise razão social, CNPJ e cargo do representante.",
  };
  function friendlyError(error, fallback = "Não foi possível concluir a operação.") {
    const raw = String(error?.message || error || "").trim();
    if (errorText[raw]) return errorText[raw];
    if (/timeout|timed out|tempo limite/i.test(raw)) return "O servidor demorou para responder. Tente novamente; nenhum dado foi perdido.";
    return raw || fallback;
  }
  function withTimeout(promise, milliseconds = 15000) {
    let timer;
    return Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("request_timeout")), milliseconds); }),
    ]).finally(() => clearTimeout(timer));
  }
  function projectRows() {
    try { return typeof state !== "undefined" && Array.isArray(state.projects) ? state.projects.filter((item) => item && item.id) : []; } catch (_) { return []; }
  }
  function projectName(id) { const item = projectRows().find((row) => String(row.id) === String(id)); return item ? `${item.name || "Projeto"}${item.client ? ` · ${item.client}` : ""}` : "Projeto vinculado"; }
  function inferredKind(fileName) {
    const name = String(fileName || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    if (/contrato/.test(name)) return "contract";
    if (/proposta|orcamento/.test(name)) return "proposal";
    if (/aditivo/.test(name)) return "addendum";
    if (/projeto.*executivo|executivo/.test(name)) return "executive_project";
    if (/termo|aceite/.test(name)) return "acceptance_term";
    return "other";
  }
  function titleFromFile(fileName) { return String(fileName || "Documento").replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 180) || "Documento"; }

  async function pdfjs() {
    if (!pdfjsPromise) pdfjsPromise = import("./vendor/pdfjs-4.10.38/pdf.min.js").then((module) => { module.GlobalWorkerOptions.workerSrc = "./assets/vendor/pdfjs-4.10.38/pdf.worker.min.js"; return module; });
    return pdfjsPromise;
  }

  function addStyles() {
    if (document.getElementById("signature-ui-style")) return;
    const style = document.createElement("style"); style.id = "signature-ui-style";
    style.textContent = `.sig-actions{display:flex;gap:10px;flex-wrap:wrap}.sig-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:16px 0}.sig-stat{padding:15px;border:1px solid var(--line,#ddd);border-radius:12px;background:#fff}.sig-stat strong{display:block;font-size:24px;color:#285f52}.sig-table-wrap{overflow:auto}.sig-table{width:100%;border-collapse:collapse}.sig-table th,.sig-table td{padding:12px 10px;text-align:left;border-bottom:1px solid var(--line,#ddd);vertical-align:top}.sig-badge{display:inline-flex;padding:5px 9px;border-radius:999px;background:#f0ece7;font-size:12px;font-weight:700}.sig-badge.signed{background:#e6f5ec;color:#17603d}.sig-badge.failed,.sig-badge.declined,.sig-badge.cancelled,.sig-badge.delivery_failed{background:#fdeaea;color:#983737}.sig-form{display:grid;gap:14px;margin-top:16px}.sig-grid,.sig-signer-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.sig-form label{display:grid;gap:6px;font-weight:700;font-size:13px}.sig-form input,.sig-form select,.sig-form textarea{padding:11px;border:1px solid var(--line,#ddd);border-radius:9px;background:#fff}.sig-form textarea{min-height:120px}.sig-panel{margin-top:16px}.sig-signer{padding:14px;border:1px solid var(--line,#ddd);border-radius:12px;margin-bottom:10px}.sig-help{padding:12px 14px;border-left:4px solid #285f52;background:#f5f1ec;font-size:13px}.sig-error{color:#9f3434}.sig-success{color:#17603d}.sig-empty{padding:28px;text-align:center;color:#6b6864}.sig-hash{max-width:250px;overflow-wrap:anywhere;font-family:monospace;font-size:11px}.sig-loader{display:grid;place-items:center;gap:12px;min-height:180px;color:#6b6864}.sig-spinner{width:30px;height:30px;border:3px solid #d9d2cb;border-top-color:#285f52;border-radius:50%;animation:sig-spin .8s linear infinite}@keyframes sig-spin{to{transform:rotate(360deg)}}.sig-upload{display:grid;place-items:center;gap:8px;padding:30px 18px;border:2px dashed #cfc5bb;border-radius:14px;background:#fbfaf8;text-align:center;cursor:pointer}.sig-upload:hover,.sig-upload.is-dragging{border-color:#285f52;background:#f2f7f5}.sig-upload input{position:absolute;width:1px;height:1px;opacity:0}.sig-file-name{font-weight:800;color:#285f52}.sig-steps{display:flex;gap:8px;align-items:center;margin:0 0 16px}.sig-step{display:flex;align-items:center;gap:7px;color:#6b6864;font-size:13px;font-weight:700}.sig-step b{display:grid;place-items:center;width:24px;height:24px;border-radius:50%;background:#ece6df}.sig-step.active{color:#285f52}.sig-step.active b{color:#fff;background:#285f52}.sig-field-editor{margin:20px 0;padding:0;border:1px solid var(--line,#ddd);border-radius:14px;background:#fff;overflow:hidden}.sig-editor-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;padding:16px 18px;border-bottom:1px solid var(--line,#ddd)}.sig-editor-shell{display:grid;grid-template-columns:260px minmax(0,1fr);min-height:620px}.sig-editor-tools{padding:16px;border-right:1px solid var(--line,#ddd);background:#faf8f5}.sig-editor-tools label{display:grid;gap:6px;margin-bottom:14px;font-size:12px;font-weight:800}.sig-editor-tools select{width:100%;padding:10px;border:1px solid var(--line,#ddd);border-radius:8px;background:#fff}.sig-tool-title{margin:20px 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#6b6864}.sig-field-tool{display:flex;align-items:center;gap:9px;width:100%;margin:7px 0;padding:11px 12px;border:1px solid #d4ccc4;border-radius:9px;background:#fff;color:#173f37;font-weight:800;cursor:grab}.sig-field-tool:hover,.sig-field-tool.active{border-color:#285f52;box-shadow:0 0 0 2px #285f5218}.sig-tool-dot{width:10px;height:10px;border-radius:50%;background:var(--signer-color,#285f52)}.sig-editor-main{min-width:0;background:#eee9e3}.sig-pdf-status{padding:10px 14px;border-bottom:1px solid var(--line,#ddd);background:#fff;color:#6b6864;font-size:13px}.sig-pdf-preview{display:block;width:100%;height:680px;overflow:auto;padding:22px;background:#e9e5e0}.sig-pdf-page{position:relative;width:max-content;max-width:100%;margin:0 auto 22px;background:#fff;box-shadow:0 3px 14px #0002}.sig-pdf-canvas{display:block;max-width:100%;height:auto}.sig-pdf-field{position:absolute;z-index:2;display:flex;align-items:center;padding:5px 9px;border:2px solid var(--signer-color,#285f52);border-radius:5px;background:color-mix(in srgb,var(--signer-color,#285f52) 15%,white);color:#222;font-weight:800;font-size:11px;overflow:visible;touch-action:none;cursor:move;text-align:left}.sig-pdf-field:focus{outline:3px solid #0002}.sig-field-remove{position:absolute;right:-9px;top:-9px;width:20px;height:20px;padding:0;border:0;border-radius:50%;background:#9f3434;color:#fff;font-size:13px;line-height:20px;cursor:pointer}.sig-field-resize{position:absolute;right:-5px;bottom:-5px;width:11px;height:11px;border:2px solid #fff;border-radius:2px;background:var(--signer-color,#285f52);cursor:nwse-resize}.sig-field-count{margin-top:14px;padding-top:12px;border-top:1px solid #e1dbd4;font-size:12px;color:#6b6864}.sig-project{display:block;margin-top:4px;color:#6b6864;font-size:12px}@media(max-width:900px){.sig-summary{grid-template-columns:repeat(2,1fr)}.sig-grid,.sig-signer-grid{grid-template-columns:1fr}.sig-editor-shell{grid-template-columns:1fr}.sig-editor-tools{border-right:0;border-bottom:1px solid var(--line,#ddd)}.sig-pdf-preview{height:520px;padding:10px}}`;
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
    const { data } = await withTimeout(sb.auth.getSession(), 10000); if (!data.session) throw new Error("Faça login novamente."); return data.session;
  }

  async function invoke(body) {
    await session();
    const { data, error } = await withTimeout(getClient().functions.invoke("gp-v2-signatures", { body: { organizationId, timezone: timezone(), ...body }, headers: { "idempotency-key": crypto.randomUUID() } }), 30000);
    if (error) { let message = error.message; try { const parsed = await error.context?.json(); message = parsed?.error || message; if (parsed?.error === "compliance_configuration_invalid" && Array.isArray(parsed.invalidFields)) message = `Revise: ${parsed.invalidFields.join(", ")}.`; } catch (_) {} throw new Error(friendlyError(message)); }
    return data;
  }

  async function invokeUpload(formData) {
    const auth = await session(); const config = window.GP_MIRARI_SUPABASE; const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 45000);
    try {
      const response = await fetch(`${config.url}/functions/v1/gp-v2-signatures`, { method:"POST", headers:{ Authorization:`Bearer ${auth.access_token}`, apikey:config.anonKey, "idempotency-key":crypto.randomUUID() }, body:formData, signal:controller.signal });
      const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(friendlyError(data.error, "Falha ao enviar documento.")); return data;
    } catch (error) { if (error?.name === "AbortError") throw new Error("request_timeout"); throw error; } finally { clearTimeout(timer); }
  }

  async function invokePublicAdmin(body) {
    const auth = await session(); const config = window.GP_MIRARI_SUPABASE; const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(`${config.url}/functions/v1/gp-v2-sign-public`, { method:"POST", headers:{ Authorization:`Bearer ${auth.access_token}`, apikey:config.anonKey, "Content-Type":"application/json" }, body:JSON.stringify({ organizationId, timezone:timezone(), ...body }), signal:controller.signal });
      const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(friendlyError(data.error, "Não foi possível retomar a finalização.")); return data;
    } finally { clearTimeout(timer); }
  }

  async function loadContext() {
    const auth = await session();
    const { data, error } = await withTimeout(getClient().from("gp_v2_memberships").select("organization_id,role,status").eq("user_id", auth.user.id).eq("status", "active").limit(1).maybeSingle(), 12000);
    if (error || !data) throw new Error("Seu usuário não possui uma organização ativa."); organizationId = data.organization_id; role = data.role;
  }

  async function loadData() {
    const docResult = await withTimeout(getClient().from("gp_v2_documents").select("id,title,document_kind,status,signature_level,verification_code,created_at,completed_at,current_version_id,gp_v2_document_links(entity_type,entity_ref,link_role),gp_v2_signature_envelopes(id,status,provider,expires_at,completed_at,created_at)").eq("organization_id", organizationId).is("archived_at", null).order("created_at", { ascending:false }).limit(100), 15000);
    if (docResult.error) throw docResult.error;
    documents = docResult.data || [];
    if (["owner","admin"].includes(role)) {
      const [noticeResult, policyResult] = await Promise.allSettled([
        withTimeout(getClient().from("gp_v2_signature_privacy_notices").select("version,title,active,published_at").eq("organization_id", organizationId).eq("active", true), 8000),
        withTimeout(getClient().from("gp_v2_signature_retention_policies").select("version,name,document_kind,retention_months,evidence_retention_months,legal_basis,purpose,active").eq("organization_id", organizationId).eq("active", true), 8000),
      ]);
      notices = noticeResult.status === "fulfilled" && !noticeResult.value.error ? noticeResult.value.data || [] : [];
      policies = policyResult.status === "fulfilled" && !policyResult.value.error ? policyResult.value.data || [] : [];
    }
  }

  function summary() {
    const count = (statuses) => documents.filter((item) => statuses.includes(item.status)).length;
    return `<div class="sig-summary"><div class="sig-stat"><span>Aguardando</span><strong>${count(["ready","awaiting_send","awaiting_signature"])}</strong></div><div class="sig-stat"><span>Parciais</span><strong>${count(["partially_signed"])}</strong></div><div class="sig-stat"><span>Concluídos</span><strong>${count(["signed"])}</strong></div><div class="sig-stat"><span>Interrompidos</span><strong>${count(["declined","expired","cancelled","failed"])}</strong></div></div>`;
  }

  function documentRows() {
    if (!documents.length) return `<div class="sig-empty">Nenhum documento cadastrado. Use “Novo documento” para começar.</div>`;
    return `<div class="sig-table-wrap"><table class="sig-table"><thead><tr><th>Documento</th><th>Tipo</th><th>Estado</th><th>Código</th><th>Criado</th><th>Ações</th></tr></thead><tbody>${documents.map((doc) => {
      const envelopes = (Array.isArray(doc.gp_v2_signature_envelopes) ? doc.gp_v2_signature_envelopes : []).slice().sort((a,b) => String(b.created_at || "").localeCompare(String(a.created_at || ""))); const envelope = envelopes[0];
      const projectLink = (Array.isArray(doc.gp_v2_document_links) ? doc.gp_v2_document_links : []).find((item) => item.entity_type === "project");
      const prepareAction = ["ready","failed"].includes(doc.status) ? `<button class="primary" data-send="${doc.id}" type="button">Preparar assinatura</button>` : envelope && ["preparing","awaiting_send","failed"].includes(envelope.status) ? `<button class="primary" data-details="${envelope.id}" type="button">Continuar preparação</button>` : "";
      return `<tr><td><strong>${esc(doc.title)}</strong>${projectLink ? `<span class="sig-project">${esc(projectName(projectLink.entity_ref))}</span>` : `<span class="sig-project">Sem projeto vinculado</span>`}</td><td>${esc(kindText[doc.document_kind] || doc.document_kind)}</td><td><span class="sig-badge ${esc(doc.status)}">${esc(statusText[doc.status] || doc.status)}</span></td><td>${esc(doc.verification_code || "—")}</td><td>${dateBr(doc.created_at)}</td><td><div class="sig-actions">${prepareAction}${["ready","failed","preparing"].includes(doc.status) ? `<button class="secondary" data-replace="${doc.id}" type="button">Trocar arquivo</button>` : ""}${envelope && !["preparing","awaiting_send","failed"].includes(envelope.status) ? `<button class="secondary" data-details="${envelope.id}" type="button">Detalhes</button>` : ""}${envelope && ["awaiting_signature","partially_signed","finalizing"].includes(envelope.status) ? `<button class="danger" data-cancel="${envelope.id}" type="button">Cancelar</button>` : ""}${envelope && doc.status === "signed" ? `<button class="secondary" data-download="${envelope.id}" type="button">Baixar final</button>` : ""}</div></td></tr>`;
    }).join("")}</tbody></table></div>`;
  }

  function dashboard() {
    return `<article class="panel"><div class="panel-header"><div><p class="eyebrow">Documentos e assinaturas</p><h2>Central de documentos</h2><p class="muted">Envie contratos, propostas, aditivos, projetos executivos e outros documentos para assinatura eletrônica.</p></div><div class="sig-actions"><button class="primary" id="sig-new" type="button">Novo documento</button>${["owner","admin"].includes(role) ? `<button class="secondary" id="sig-compliance" type="button">Privacidade e retenção</button>` : ""}<a class="secondary" href="./verificar-assinatura.html" target="_blank" rel="noopener">Verificar documento</a></div></div><p class="sig-help">O padrão é assinatura eletrônica com identificação, OTP por e-mail, aceite expresso, hashes e trilha de evidências. ICP-Brasil permanece opcional para situações específicas.</p>${summary()}<div id="sig-workspace"></div>${documentRows()}</article>`;
  }

  function newDocumentForm() {
    const projects = projectRows().slice().sort((a,b) => String(a.name || "").localeCompare(String(b.name || ""), "pt-BR"));
    return `<div class="sig-panel form-box"><div class="sig-steps"><span class="sig-step active"><b>1</b> Documento</span><span class="sig-step"><b>2</b> Destinatários</span><span class="sig-step"><b>3</b> Campos</span><span class="sig-step"><b>4</b> Envio</span></div><h3>Adicionar documento</h3><p class="muted">Envie um PDF e, se desejar, vincule-o a um projeto. As regras de privacidade, finalidade e retenção são aplicadas automaticamente.</p><form id="sig-document-form" class="sig-form"><label class="sig-upload" id="sig-upload-drop"><input id="sig-file" type="file" accept="application/pdf" required /><strong>Arraste o PDF aqui ou clique para selecionar</strong><span class="muted">PDF de até 20 MB</span><span class="sig-file-name" id="sig-file-name"></span></label><label>Vincular a um projeto (opcional)<select id="sig-project"><option value="">Nenhum projeto</option>${projects.map((item) => `<option value="${esc(item.id)}">${esc(item.name || "Projeto")}${item.client ? ` · ${esc(item.client)}` : ""}</option>`).join("")}</select></label><input id="sig-purpose" type="hidden" value="padronizado" /><div class="sig-actions"><button class="primary" type="submit">Adicionar documento</button><button class="secondary" data-close-workspace type="button">Cancelar</button></div><p id="sig-form-message" aria-live="polite"></p></form></div>`;
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
    return `<div class="sig-panel form-box"><div class="sig-steps"><span class="sig-step"><b>1</b> Documento</span><span class="sig-step active"><b>2</b> Destinatários</span><span class="sig-step"><b>3</b> Campos</span><span class="sig-step"><b>4</b> Envio</span></div><h3>Quem precisa assinar?</h3><p class="sig-help">Cadastre cada destinatário. Nenhum convite será enviado antes de você posicionar e revisar os campos no documento.</p><form id="sig-send-form" class="sig-form" data-document-id="${documentId}">${additional.length ? `<label>Adicionar outros documentos à mesma pasta (opcional)<select id="sig-additional-documents" multiple size="${Math.min(5, Math.max(2, additional.length))}">${additional.map((item) => `<option value="${item.id}">${esc(item.title)}</option>`).join("")}</select></label><p class="muted">Use Ctrl/Cmd para selecionar vários PDFs.</p>` : `<select id="sig-additional-documents" multiple hidden></select>`}<div id="sig-signers">${signerRow(0)}</div><button class="secondary" id="sig-add-signer" type="button">Adicionar destinatário</button><div class="sig-grid"><label>Validade do convite após o envio (horas)<input id="sig-expires" type="number" min="1" max="720" value="168" /></label></div><div class="sig-actions"><button class="primary" type="submit">Continuar para posicionar campos</button><button class="secondary" data-close-workspace type="button">Cancelar</button></div><p id="sig-form-message" aria-live="polite"></p></form></div>`;
  }

  function replaceDocumentForm(documentId) {
    const doc = documents.find((item) => item.id === documentId);
    return `<div class="sig-panel form-box"><h3>Substituir PDF</h3><p class="sig-help">A troca cria uma nova versão com novo hash SHA-256. Se ainda não houve assinatura, os convites ativos são revogados e o processo anterior é cancelado; depois, envie a nova versão.</p><form id="sig-replace-form" class="sig-form" data-document-id="${documentId}"><label>Novo arquivo PDF<input id="sig-replace-file" type="file" accept="application/pdf" required /></label><div class="sig-actions"><button class="primary" type="submit">Criar nova versão de “${esc(doc?.title || "documento")}”</button><button class="secondary" data-close-workspace type="button">Cancelar</button></div><p id="sig-form-message"></p></form></div>`;
  }

  function editSignerForm(envelopeId, signer, preparing = false) {
    const company = signer.signer_type === "company_representative";
    return `<div class="sig-panel form-box"><h3>Editar destinatário</h3><p class="sig-help">${preparing ? "Os dados serão atualizados sem enviar o convite. Por segurança, informe novamente o CPF." : "Por segurança, informe novamente o CPF. Salvar revoga o acesso anterior e envia um novo convite."}</p><form id="sig-edit-signer-form" class="sig-form" data-envelope-id="${envelopeId}" data-signer-id="${signer.id}" data-preparing="${preparing}"><div class="sig-grid"><label>Nome completo<input id="sig-edit-signer-name" value="${esc(signer.name)}" required /></label><label>E-mail<input id="sig-edit-signer-email" type="email" value="${esc(signer.email)}" required /></label><label>CPF<input id="sig-edit-signer-cpf" inputmode="numeric" required placeholder="Digite novamente" /></label><label>Papel<select id="sig-edit-signer-role">${Object.entries(roleText).map(([key,value]) => `<option value="${key}" ${signer.signer_role === key ? "selected" : ""}>${value}</option>`).join("")}</select></label></div><label><input id="sig-edit-signer-company" type="checkbox" ${company ? "checked" : ""} /> Representa pessoa jurídica</label><div id="sig-edit-company-fields" class="sig-grid ${company ? "" : "hidden"}"><label>Razão social<input id="sig-edit-company-name" value="${esc(signer.company_legal_name || "")}" /></label><label>CNPJ<input id="sig-edit-company-document" inputmode="numeric" placeholder="Digite novamente" /></label><label>Cargo ou função<input id="sig-edit-company-job" value="${esc(signer.job_title || "")}" /></label></div><div class="sig-actions"><button class="primary" type="submit">${preparing ? "Salvar destinatário" : "Salvar e reenviar convite"}</button><button class="secondary" data-close-workspace type="button">Cancelar</button></div><p id="sig-form-message"></p></form></div>`;
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
    const input = document.getElementById("sig-file"), drop = document.getElementById("sig-upload-drop"), fileName = document.getElementById("sig-file-name");
    const showFile = () => { const file = input.files?.[0]; fileName.textContent = file ? file.name : ""; };
    input.onchange = showFile;
    ["dragenter","dragover"].forEach((name) => drop.addEventListener(name, (event) => { event.preventDefault(); drop.classList.add("is-dragging"); }));
    ["dragleave","drop"].forEach((name) => drop.addEventListener(name, (event) => { event.preventDefault(); drop.classList.remove("is-dragging"); }));
    drop.addEventListener("drop", (event) => { const file = event.dataTransfer?.files?.[0]; if (!file) return; const transfer = new DataTransfer(); transfer.items.add(file); input.files = transfer.files; showFile(); });
    document.getElementById("sig-document-form").onsubmit = async (event) => {
      event.preventDefault();
      const file = input.files?.[0];
      if (!file || file.type !== "application/pdf") return setFormMessage("Selecione um arquivo PDF válido.");
      const projectId = document.getElementById("sig-project").value;
      const links = projectId ? [{ entityType:"project", entityRef:projectId, linkRole:"primary" }] : [];
      const project = projectRows().find((item) => String(item.id) === projectId);
      const form = new FormData(); form.set("file", file);
      form.set("metadata", JSON.stringify({ organizationId, title:titleFromFile(file.name), documentKind:inferredKind(file.name), sourceType:"manual", signatureLevel:"advanced", links, context:project ? { projectName:project.name || "", projectClient:project.client || "" } : {} }));
      const button = event.currentTarget.querySelector("button[type=submit]");
      try { button.disabled = true; setFormMessage("Enviando o PDF e protegendo a versão original…", true); await invokeUpload(form); await refresh(); }
      catch (error) { setFormMessage(friendlyError(error)); button.disabled = false; }
    };
  }

  function bindComplianceForm() {
    document.getElementById("sig-compliance-form").onsubmit = async (event) => { event.preventDefault(); try { setFormMessage("Publicando versões…", true); await invoke({ action:"save_compliance_configuration", legalReviewConfirmed:document.getElementById("sig-legal-confirm").checked, privacy:{ version:document.getElementById("sig-privacy-version-new").value, title:document.getElementById("sig-privacy-title").value, content:document.getElementById("sig-privacy-content").value }, retention:{ version:document.getElementById("sig-retention-version-new").value, name:document.getElementById("sig-retention-name").value, documentKind:document.getElementById("sig-retention-kind").value, legalBasis:document.getElementById("sig-retention-legal").value, retentionMonths:Number(document.getElementById("sig-retention-months").value), evidenceRetentionMonths:Number(document.getElementById("sig-evidence-months").value), purpose:document.getElementById("sig-retention-purpose").value, approvedBy:document.getElementById("sig-approved-by").value } }); await refresh(); } catch (error) { setFormMessage(error.message); } };
  }

  function bindSendForm() {
    const holder = document.getElementById("sig-signers");
    function bindRows() { holder.querySelectorAll("[data-signer-company]").forEach((box) => box.onchange = () => box.closest("[data-signer-row]").querySelector("[data-company-fields]").classList.toggle("hidden", !box.checked)); holder.querySelectorAll("[data-remove-signer]").forEach((button) => button.onclick = () => button.closest("[data-signer-row]").remove()); }
    bindRows(); document.getElementById("sig-add-signer").onclick = () => { holder.insertAdjacentHTML("beforeend", signerRow(holder.children.length)); bindRows(); };
    document.getElementById("sig-send-form").onsubmit = async (event) => { event.preventDefault(); const signers = [...holder.querySelectorAll("[data-signer-row]")].map((row) => { const company = row.querySelector("[data-signer-company]").checked; return { name:row.querySelector("[data-signer-name]").value, email:row.querySelector("[data-signer-email]").value, cpf:row.querySelector("[data-signer-cpf]").value, role:row.querySelector("[data-signer-role]").value, signerType:company ? "company_representative" : "person", companyLegalName:company ? row.querySelector("[data-company-name]").value : "", companyDocument:company ? row.querySelector("[data-company-document]").value : "", jobTitle:company ? row.querySelector("[data-company-job]").value : "" }; }); const button = event.currentTarget.querySelector("button[type=submit]"); try { button.disabled = true; setFormMessage("Salvando destinatários. Nenhum convite será enviado ainda…", true); const documentIds = [...document.getElementById("sig-additional-documents").selectedOptions].map((item) => item.value); const data = await invoke({ action:"send_document", provider:"internal", prepareOnly:true, documentId:event.currentTarget.dataset.documentId, documentIds, expiresInHours:Number(document.getElementById("sig-expires").value), signers }); await showDetails(data.envelopeId); } catch (error) { setFormMessage(friendlyError(error)); button.disabled = false; } };
  }

  function bindReplaceDocumentForm() {
    document.getElementById("sig-replace-form").onsubmit = async (event) => { event.preventDefault(); const file = document.getElementById("sig-replace-file").files[0]; if (!file || file.type !== "application/pdf") return setFormMessage("Selecione um arquivo PDF."); const form = new FormData(); form.set("file", file); form.set("metadata", JSON.stringify({ organizationId, replaceDocumentId:event.currentTarget.dataset.documentId, timezone:timezone() })); try { setFormMessage("Enviando nova versão e revogando os convites sem assinatura…", true); const data = await invokeUpload(form); setFormMessage(data.cancelledEnvelopeCount ? "Nova versão criada. Os convites anteriores foram revogados; envie a nova versão para assinatura." : "Nova versão criada. Envie-a para assinatura.", true); setTimeout(refresh, 900); } catch (error) { setFormMessage(error.message); } };
  }

  function bindEditSignerForm() {
    const company = document.getElementById("sig-edit-signer-company"), companyFields = document.getElementById("sig-edit-company-fields"); company.onchange = () => companyFields.classList.toggle("hidden", !company.checked);
    document.getElementById("sig-edit-signer-form").onsubmit = async (event) => { event.preventDefault(); const isCompany = company.checked, preparing = event.currentTarget.dataset.preparing === "true"; const signer = { name:document.getElementById("sig-edit-signer-name").value, email:document.getElementById("sig-edit-signer-email").value, cpf:document.getElementById("sig-edit-signer-cpf").value, role:document.getElementById("sig-edit-signer-role").value, signerType:isCompany ? "company_representative" : "person", companyLegalName:isCompany ? document.getElementById("sig-edit-company-name").value : "", companyDocument:isCompany ? document.getElementById("sig-edit-company-document").value : "", jobTitle:isCompany ? document.getElementById("sig-edit-company-job").value : "" }; try { setFormMessage(preparing ? "Salvando destinatário…" : "Salvando e reemitindo o convite…", true); await invoke({ action:"update_signer_and_resend", signerId:event.currentTarget.dataset.signerId, signer }); setFormMessage(preparing ? "Destinatário atualizado." : "Dados atualizados e novo convite enviado.", true); setTimeout(() => showDetails(event.currentTarget.dataset.envelopeId), 500); } catch (error) { setFormMessage(friendlyError(error)); } };
  }

  function bindFieldsEditor(envelope, envelopeDocuments, signers, savedFields) {
    if (!["preparing", "awaiting_send", "failed"].includes(envelope?.status) || !envelopeDocuments.length || !signers.length) return;
    const colors = ["#285f52", "#b87535", "#4f67a5", "#8a4f88", "#77752e", "#a34747"];
    const labels = { signature:"Assinatura", initial:"Rubrica", signer_name:"Nome", signed_at:"Data da assinatura" };
    const sizes = { signature:[0.30,0.075], initial:[0.15,0.06], signer_name:[0.24,0.05], signed_at:[0.22,0.05] };
    let fields = (savedFields || []).map((item) => ({ envelopeDocumentId:item.envelope_document_id, documentVersionId:item.document_version_id, signerId:item.signer_id, fieldType:item.field_type, pageNumber:Number(item.page_number), xRatio:Number(item.x_ratio), yRatio:Number(item.y_ratio), widthRatio:Number(item.width_ratio), heightRatio:Number(item.height_ratio), pageRotation:Number(item.page_rotation || 0), required:item.required !== false }));
    let activeType = "signature", previewDocumentId = envelopeDocuments[0].id, renderToken = 0, dirty = false;
    const message = document.getElementById("sig-field-message"), list = document.getElementById("sig-field-list"), host = document.getElementById("sig-field-preview-frame"), status = document.getElementById("sig-pdf-status"), documentSelect = document.getElementById("sig-field-document"), signerSelect = document.getElementById("sig-field-signer");
    const signerColor = (id) => colors[Math.max(0, signers.findIndex((item) => item.id === id)) % colors.length];
    const selectedDocument = () => envelopeDocuments.find((item) => item.id === documentSelect.value) || envelopeDocuments[0];
    const markDirty = (text = "Alteração pendente. Salve os campos antes de enviar.") => { dirty = true; message.textContent = text; message.className = "sig-success"; renderSummary(); };
    function renderSummary() {
      const counts = signers.map((signer) => ({ signer, signatures:fields.filter((field) => field.signerId === signer.id && field.fieldType === "signature").length, initials:fields.filter((field) => field.signerId === signer.id && field.fieldType === "initial").length }));
      list.innerHTML = `<div class="sig-field-count"><strong>${fields.length} campo(s) posicionado(s)</strong>${counts.map((item) => `<div><span class="sig-tool-dot" style="--signer-color:${signerColor(item.signer.id)};display:inline-block;margin-right:6px"></span>${esc(item.signer.name)}: ${item.signatures} assinatura(s), ${item.initials} rubrica(s)</div>`).join("")}</div>`;
    }
    function removeField(index) { fields.splice(index, 1); markDirty("Campo removido. Salve para confirmar."); paintAllFields(); }
    function paintField(stage, field) {
      const index = fields.indexOf(field), marker = document.createElement("div"), signer = signers.find((item) => item.id === field.signerId);
      marker.className = "sig-pdf-field"; marker.tabIndex = 0; marker.style.setProperty("--signer-color", signerColor(field.signerId)); marker.style.left = `${field.xRatio * 100}%`; marker.style.top = `${field.yRatio * 100}%`; marker.style.width = `${field.widthRatio * 100}%`; marker.style.height = `${field.heightRatio * 100}%`; marker.innerHTML = `<span>${esc(labels[field.fieldType] || field.fieldType)} · ${esc(signer?.name || "Destinatário")}</span><button class="sig-field-remove" type="button" title="Remover campo" aria-label="Remover campo">×</button><span class="sig-field-resize" title="Redimensionar"></span>`;
      const updateStyle = () => { marker.style.left = `${field.xRatio * 100}%`; marker.style.top = `${field.yRatio * 100}%`; marker.style.width = `${field.widthRatio * 100}%`; marker.style.height = `${field.heightRatio * 100}%`; };
      marker.querySelector(".sig-field-remove").onclick = (event) => { event.stopPropagation(); removeField(index); };
      marker.querySelector(".sig-field-resize").onpointerdown = (event) => { event.preventDefault(); event.stopPropagation(); const rect = stage.getBoundingClientRect(), startX = event.clientX, startY = event.clientY, startW = field.widthRatio, startH = field.heightRatio; event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.onpointermove = (move) => { field.widthRatio = Math.max(0.07, Math.min(1 - field.xRatio, startW + (move.clientX - startX) / rect.width)); field.heightRatio = Math.max(0.035, Math.min(1 - field.yRatio, startH + (move.clientY - startY) / rect.height)); updateStyle(); }; event.currentTarget.onpointerup = (up) => { up.currentTarget.onpointermove = null; markDirty("Tamanho ajustado. Salve os campos antes de enviar."); }; };
      marker.onpointerdown = (event) => { if (event.target.closest("button,.sig-field-resize")) return; event.preventDefault(); event.stopPropagation(); const rect = stage.getBoundingClientRect(), startX = event.clientX, startY = event.clientY, originX = field.xRatio, originY = field.yRatio; marker.setPointerCapture(event.pointerId); marker.onpointermove = (move) => { field.xRatio = Math.max(0, Math.min(1 - field.widthRatio, originX + (move.clientX - startX) / rect.width)); field.yRatio = Math.max(0, Math.min(1 - field.heightRatio, originY + (move.clientY - startY) / rect.height)); updateStyle(); }; marker.onpointerup = () => { marker.onpointermove = null; markDirty("Campo reposicionado. Salve os campos antes de enviar."); }; };
      marker.onkeydown = (event) => { const step = event.shiftKey ? 0.02 : 0.005; if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); removeField(index); return; } if (!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(event.key)) return; event.preventDefault(); if (event.key === "ArrowLeft") field.xRatio = Math.max(0, field.xRatio - step); if (event.key === "ArrowRight") field.xRatio = Math.min(1 - field.widthRatio, field.xRatio + step); if (event.key === "ArrowUp") field.yRatio = Math.max(0, field.yRatio - step); if (event.key === "ArrowDown") field.yRatio = Math.min(1 - field.heightRatio, field.yRatio + step); updateStyle(); markDirty(); };
      stage.append(marker);
    }
    function paintAllFields() { host.querySelectorAll(".sig-pdf-page").forEach((stage) => { stage.querySelectorAll(".sig-pdf-field").forEach((node) => node.remove()); fields.filter((field) => field.envelopeDocumentId === previewDocumentId && field.pageNumber === Number(stage.dataset.page)).forEach((field) => paintField(stage, field)); }); renderSummary(); }
    function addField(stage, clientX, clientY, fieldType = activeType) {
      const item = selectedDocument(), rect = stage.getBoundingClientRect(), [width,height] = sizes[fieldType] || sizes.signature;
      const x = Math.max(0, Math.min(1 - width, (clientX - rect.left) / rect.width - width / 2)), y = Math.max(0, Math.min(1 - height, (clientY - rect.top) / rect.height - height / 2));
      fields.push({ envelopeDocumentId:item.id, documentVersionId:item.document_version_id, signerId:signerSelect.value, fieldType, pageNumber:Number(stage.dataset.page), xRatio:x, yRatio:y, widthRatio:width, heightRatio:height, pageRotation:0, required:true });
      paintAllFields(); markDirty(`${labels[fieldType]} adicionada. Arraste para mover ou use a alça para redimensionar.`);
    }
    async function loadPreview() {
      const token = ++renderToken; previewDocumentId = documentSelect.value; host.replaceChildren(); status.textContent = "Carregando PDF…"; host.setAttribute("aria-busy", "true");
      try {
        const data = await invoke({ action:"preview_envelope_document", envelopeId:envelope.id, envelopeDocumentId:previewDocumentId });
        const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 30000);
        let response; try { response = await fetch(data.signedUrl, { credentials:"omit", signal:controller.signal }); } finally { clearTimeout(timer); }
        if (!response.ok) throw new Error("Não foi possível abrir a prévia protegida.");
        const bytes = new Uint8Array(await response.arrayBuffer()), library = await pdfjs(), pdf = await library.getDocument({ data:bytes }).promise;
        if (token !== renderToken) return;
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          if (token !== renderToken) return;
          const page = await pdf.getPage(pageNumber), viewport = page.getViewport({ scale:1.35 }), canvas = document.createElement("canvas"), stage = document.createElement("div"), context = canvas.getContext("2d");
          canvas.width = viewport.width; canvas.height = viewport.height; canvas.className = "sig-pdf-canvas"; stage.className = "sig-pdf-page"; stage.dataset.page = String(pageNumber); stage.append(canvas); host.append(stage);
          stage.ondragover = (event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; };
          stage.ondrop = (event) => { event.preventDefault(); const type = event.dataTransfer.getData("text/signature-field") || activeType; addField(stage, event.clientX, event.clientY, type); };
          stage.onclick = (event) => { if (event.target !== canvas) return; addField(stage, event.clientX, event.clientY); };
          await page.render({ canvasContext:context, viewport }).promise;
        }
        paintAllFields(); status.textContent = `${pdf.numPages} página(s). Selecione um campo e clique no PDF ou arraste o campo para a posição desejada.`;
      } catch (error) { if (token === renderToken) { status.innerHTML = `<span class="sig-error">${esc(friendlyError(error, "Não foi possível abrir o PDF."))}</span> <button class="secondary" id="sig-preview-retry" type="button">Tentar novamente</button>`; document.getElementById("sig-preview-retry")?.addEventListener("click", loadPreview); } }
      finally { if (token === renderToken) host.removeAttribute("aria-busy"); }
    }
    async function saveFields() { message.textContent = "Salvando campos…"; message.className = "sig-success"; const response = await invoke({ action:"save_signature_fields", envelopeId:envelope.id, fields }); dirty = false; message.textContent = `${response.fieldCount} campo(s) salvo(s).`; renderSummary(); return response; }
    document.querySelectorAll("[data-field-tool]").forEach((button) => { button.onclick = () => { activeType = button.dataset.fieldTool; document.querySelectorAll("[data-field-tool]").forEach((item) => item.classList.toggle("active", item === button)); }; button.ondragstart = (event) => { activeType = button.dataset.fieldTool; event.dataTransfer.setData("text/signature-field", activeType); event.dataTransfer.effectAllowed = "copy"; }; });
    documentSelect.onchange = loadPreview;
    document.getElementById("sig-field-save").onclick = async () => { try { await saveFields(); } catch (error) { message.textContent = friendlyError(error); message.className = "sig-error"; } };
    document.getElementById("sig-field-send").onclick = async (event) => { if (!confirm("Revisou os destinatários e todos os campos? Após o envio, os convites serão liberados.")) return; try { event.currentTarget.disabled = true; if (dirty || fields.length) await saveFields(); message.textContent = "Enviando convites individuais…"; const response = await invoke({ action:"send_prepared_envelope", envelopeId:envelope.id }); alert(`${response.invitationsDelivered} convite(s) enviado(s).`); await refresh(); } catch (error) { message.textContent = friendlyError(error); message.className = "sig-error"; event.currentTarget.disabled = false; } };
    renderSummary(); loadPreview();
  }

  async function showDetails(envelopeId) {
    const workspace = document.getElementById("sig-workspace");
    workspace.innerHTML = `<div class="sig-loader"><span class="sig-spinner" aria-hidden="true"></span><span>Carregando processo de assinatura…</span></div>`;
    try {
      const results = await withTimeout(Promise.all([
        getClient().from("gp_v2_signature_envelopes").select("id,status,provider,expires_at,completed_at,last_error_code").eq("organization_id", organizationId).eq("id", envelopeId).maybeSingle(),
        getClient().from("gp_v2_signature_signers").select("id,name,email,signer_role,signer_type,company_legal_name,job_title,status,signed_at,viewed_at").eq("organization_id", organizationId).eq("envelope_id", envelopeId).order("signing_order"),
        getClient().from("gp_v2_signature_events").select("sequence_number,event_type,occurred_at,result").eq("organization_id", organizationId).eq("envelope_id", envelopeId).order("sequence_number"),
        getClient().from("gp_v2_signature_envelope_documents").select("id,document_version_id,display_order,required,gp_v2_documents(title),gp_v2_document_versions(file_name,sha256)").eq("organization_id", organizationId).eq("envelope_id", envelopeId).order("display_order"),
        getClient().from("gp_v2_signature_fields").select("envelope_document_id,document_version_id,signer_id,field_type,page_number,x_ratio,y_ratio,width_ratio,height_ratio,page_rotation,required").eq("organization_id", organizationId).eq("envelope_id", envelopeId).order("created_at"),
      ]), 18000);
      const firstError = results.find((item) => item.error)?.error; if (firstError) throw firstError;
      const [envelope, signers, events, envelopeDocuments, fields] = results.map((item) => item.data);
      if (!envelope) throw new Error("Processo não encontrado.");
      const docs = envelopeDocuments || [], signerRows = signers || [], preparing = ["preparing","awaiting_send","failed"].includes(envelope.status);
      workspace.innerHTML = `<div class="sig-panel form-box"><div class="panel-header"><div><h3>${preparing ? "Revisão antes do envio" : "Detalhes do processo"}</h3><p class="muted">Estado: ${esc(statusText[envelope.status] || envelope.status)} · expira: ${dateBr(envelope.expires_at)}</p></div><div class="sig-actions">${envelope.status === "finalizing" ? `<button class="primary" data-retry-finalization="${envelope.id}" type="button">Retomar finalização</button>` : ""}<button class="secondary" data-close-workspace type="button">Fechar</button></div></div><h4>Destinatários</h4><div class="sig-table-wrap"><table class="sig-table"><tbody>${signerRows.map((item) => `<tr><td><strong>${esc(item.name)}</strong><br>${esc(item.email)}</td><td>${esc(roleText[item.signer_role] || item.signer_role)}</td><td><span class="sig-badge ${esc(item.status)}">${esc(statusText[item.status] || item.status)}</span></td><td>${dateBr(item.signed_at)}</td><td>${preparing ? `<button class="secondary" data-edit-signer="${item.id}" type="button">Editar dados</button>` : !["signed","declined"].includes(item.status) && envelope.status !== "signed" ? `<button class="secondary" data-resend="${item.id}" type="button">Reenviar</button><button class="secondary" data-correct-signer="${item.id}" data-signer-name="${esc(item.name)}" data-signer-email="${esc(item.email)}" type="button">Corrigir e reenviar</button>` : ""}</td></tr>`).join("")}</tbody></table></div>${events?.length ? `<h4>Trilha cronológica</h4><div class="sig-table-wrap"><table class="sig-table"><tbody>${events.map((item) => `<tr><td>#${item.sequence_number}</td><td>${esc(item.event_type)}</td><td>${dateBr(item.occurred_at)}</td><td>${esc(item.result)}</td></tr>`).join("")}</tbody></table></div>` : ""}</div>`;
      bindWorkspaceClose();
      if (preparing && docs.length && signerRows.length) {
        const editor = `<section class="sig-field-editor"><div class="sig-editor-head"><div><div class="sig-steps"><span class="sig-step"><b>1</b> Documento</span><span class="sig-step"><b>2</b> Destinatários</span><span class="sig-step active"><b>3</b> Campos</span><span class="sig-step"><b>4</b> Envio</span></div><h4>Posicione assinaturas e rubricas</h4><p class="muted">Escolha o destinatário e arraste um campo para o PDF. Não é necessário informar coordenadas.</p></div><div class="sig-actions"><button class="secondary" id="sig-field-save" type="button">Salvar posições</button><button class="primary" id="sig-field-send" type="button">Revisar e enviar convites</button></div></div><div class="sig-editor-shell"><aside class="sig-editor-tools"><label>Documento<select id="sig-field-document">${docs.map((item) => `<option value="${item.id}">${esc(item.gp_v2_documents?.title || item.gp_v2_document_versions?.file_name || "Documento")}</option>`).join("")}</select></label><label>Destinatário<select id="sig-field-signer">${signerRows.map((item) => `<option value="${item.id}">${esc(item.name)} · ${esc(item.email)}</option>`).join("")}</select></label><p class="sig-tool-title">Campos principais</p><button class="sig-field-tool active" draggable="true" data-field-tool="signature" type="button"><span class="sig-tool-dot"></span>Assinatura</button><button class="sig-field-tool" draggable="true" data-field-tool="initial" type="button"><span class="sig-tool-dot"></span>Rubrica</button><p class="sig-tool-title">Informações automáticas</p><button class="sig-field-tool" draggable="true" data-field-tool="signer_name" type="button"><span class="sig-tool-dot"></span>Nome</button><button class="sig-field-tool" draggable="true" data-field-tool="signed_at" type="button"><span class="sig-tool-dot"></span>Data da assinatura</button><div id="sig-field-list"></div></aside><main class="sig-editor-main"><div id="sig-pdf-status" class="sig-pdf-status">Preparando visualização…</div><div id="sig-field-preview-frame" class="sig-pdf-preview" aria-live="polite"></div></main></div><p id="sig-field-message" style="padding:0 18px 14px" aria-live="polite"></p></section>`;
        workspace.insertAdjacentHTML("afterbegin", editor); bindFieldsEditor(envelope, docs, signerRows, fields || []);
      }
      root().querySelectorAll("[data-resend]").forEach((button) => button.onclick = async () => { try { await invoke({ action:"resend_invitation", signerId:button.dataset.resend }); alert("Novo convite enviado e link anterior revogado."); } catch (error) { alert(friendlyError(error)); } });
      root().querySelectorAll("[data-correct-signer]").forEach((button) => button.onclick = async () => { const name = prompt("Nome do signatário:", button.dataset.signerName || ""); if (name === null) return; const email = prompt("E-mail correto para envio:", button.dataset.signerEmail || ""); if (email === null) return; try { await invoke({ action:"correct_signer_and_resend", signerId:button.dataset.correctSigner, name, email }); alert("Dados corrigidos. O link anterior foi revogado e um novo convite foi enviado."); await showDetails(envelopeId); } catch (error) { alert(friendlyError(error)); } });
      root().querySelectorAll("[data-edit-signer]").forEach((button) => button.onclick = () => { const signer = signerRows.find((item) => item.id === button.dataset.editSigner); if (!signer) return; workspace.innerHTML = editSignerForm(envelopeId, signer, preparing); bindEditSignerForm(); bindWorkspaceClose(); });
      root().querySelectorAll("[data-retry-finalization]").forEach((button) => button.onclick = async () => { try { button.disabled = true; button.textContent = "Finalizando…"; await invokePublicAdmin({ action:"retry_finalization", envelopeId:button.dataset.retryFinalization }); await refresh(); } catch (error) { alert(friendlyError(error)); button.disabled = false; button.textContent = "Retomar finalização"; } });
    } catch (error) { workspace.innerHTML = `<div class="sig-panel form-box"><p class="sig-error">${esc(friendlyError(error, "Não foi possível abrir este processo."))}</p><div class="sig-actions"><button class="primary" data-retry-details type="button">Tentar novamente</button><button class="secondary" data-close-workspace type="button">Fechar</button></div></div>`; workspace.querySelector("[data-retry-details]").onclick = () => showDetails(envelopeId); bindWorkspaceClose(); }
  }

  async function refresh() { await loadData(); if (!root() || root().classList.contains("hidden")) return; root().innerHTML = dashboard(); bindDashboard(); }
  async function render() {
    if (!root() || root().classList.contains("hidden")) return;
    const sequence = ++renderSequence; addStyles(); root().innerHTML = `<article class="panel"><div class="sig-loader"><span class="sig-spinner" aria-hidden="true"></span><span>Carregando documentos…</span></div></article>`;
    try { if (!organizationId) await loadContext(); await loadData(); if (sequence !== renderSequence || !root() || root().classList.contains("hidden")) return; root().innerHTML = dashboard(); bindDashboard(); }
    catch (error) { if (sequence !== renderSequence || !root()) return; root().innerHTML = `<article class="panel"><div class="sig-empty"><p class="sig-error">${esc(friendlyError(error, "Não foi possível carregar os documentos."))}</p><button class="primary" data-retry-signatures type="button">Tentar novamente</button></div></article>`; root().querySelector("[data-retry-signatures]").onclick = render; }
  }
  window.GP_SIGNATURES_UI = { render };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => { if (!root()?.classList.contains("hidden")) render(); }); else if (!root()?.classList.contains("hidden")) render();
})();

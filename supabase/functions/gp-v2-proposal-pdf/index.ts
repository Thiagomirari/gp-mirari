// GP Mirari V02 SaaS PDF generator. Deploy only after migrations 002, 004 and 005.
// It validates the caller, writes a private Storage path and never exposes service role to the browser.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

const cors = { "Access-Control-Allow-Origin": "https://gp.mirari.com.br", "Access-Control-Allow-Headers": "authorization, content-type", "Content-Type": "application/json" };
const reply = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers: cors });
const brl = (amount: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(amount || 0);

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return reply(405, { error: "method_not_allowed" });

  const payload = await request.json().catch(() => ({}));
  const organizationId = String(payload.organizationId || "");
  const proposalVersionId = String(payload.proposalVersionId || "");
  if (!organizationId || !proposalVersionId) return reply(400, { error: "organization_and_version_required" });

  const url = Deno.env.get("SUPABASE_URL") || "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !anon || !service) return reply(500, { error: "supabase_environment_missing" });

  const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") || "";
  const requester = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: { user } } = await requester.auth.getUser();
  if (!user) return reply(401, { error: "unauthenticated" });

  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: member } = await admin.from("gp_v2_memberships").select("status,role").eq("organization_id", organizationId).eq("user_id", user.id).maybeSingle();
  if (member?.status !== "active" || !["owner", "admin", "manager", "sales"].includes(member.role)) return reply(403, { error: "proposal_role_required" });

  const { data: version, error: versionError } = await admin.from("gp_v2_proposal_versions").select("*, gp_v2_proposals!inner(id,proposal_number,organization_id)").eq("id", proposalVersionId).eq("organization_id", organizationId).single();
  if (versionError || !version) return reply(404, { error: "proposal_version_not_found" });
  const { data: items, error: itemsError } = await admin.from("gp_v2_proposal_items").select("*").eq("proposal_version_id", proposalVersionId).eq("organization_id", organizationId).order("position");
  if (itemsError) return reply(400, { error: itemsError.message });

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([595, 842]);
  let y = 790;
  const draw = (value: string, size = 10, strong = false) => {
    const words = String(value || "").replace(/\s+/g, " ").trim().split(" ");
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (candidate.length > 92 && line) { lines.push(line); line = word; } else line = candidate;
    }
    if (line) lines.push(line);
    for (const current of lines.length ? lines : [""]) {
      if (y < 62) { page = pdf.addPage([595, 842]); y = 790; }
      page.drawText(current, { x: 48, y, size, font: strong ? bold : font, color: rgb(0.18, 0.18, 0.18) });
      y -= size + 7;
    }
  };

  draw("MIRARI", 22, true);
  draw(`PROPOSTA ${version.gp_v2_proposals.proposal_number} - V${version.version_number}`, 12, true);
  draw(version.client_name_snapshot || "Cliente a definir");
  draw(`Validade: ${version.valid_until || "A definir"}`);
  y -= 8;
  draw("ITENS", 11, true);
  for (const item of items || []) draw(`${item.quantity} ${item.unit_code_snapshot} - ${item.name_snapshot} - ${brl(Number(item.net_amount))}`);
  y -= 8;
  draw(`Subtotal: ${brl(Number(version.subtotal_amount))}`);
  draw(`Descontos: ${brl(Number(version.item_discount_amount) + Number(version.global_discount_amount))}`);
  draw(`Impostos: ${brl(Number(version.tax_amount))}`);
  draw(`TOTAL: ${brl(Number(version.total_amount))}`, 13, true);
  y -= 8;
  draw("CONDICOES COMERCIAIS", 11, true);
  draw(version.payment_terms_snapshot || "A definir");
  draw(version.delivery_terms_snapshot || "Prazo de entrega a definir");
  draw("Documento gerado pelo GP Mirari. Valores e condicoes desta versao permanecem rastreaveis.", 8);

  const bytes = await pdf.save();
  const proposal = version.gp_v2_proposals;
  const path = `${organizationId}/proposals/${proposal.id}/v${version.version_number}/proposta-${Date.now()}.pdf`;
  const bucket = admin.storage.from("gp-v2-proposal-files");
  const { error: uploadError } = await bucket.upload(path, bytes, { contentType: "application/pdf", upsert: false });
  if (uploadError) return reply(400, { error: uploadError.message });

  const { error: fileError } = await admin.from("gp_v2_proposal_files").insert({ organization_id: organizationId, proposal_id: proposal.id, proposal_version_id: proposalVersionId, file_kind: "pdf_final", storage_path: path, generated_at: new Date().toISOString(), created_by: user.id });
  if (fileError) { await bucket.remove([path]); return reply(400, { error: fileError.message }); }

  const { error: eventError } = await admin.from("gp_v2_proposal_events").insert({ organization_id: organizationId, proposal_id: proposal.id, proposal_version_id: proposalVersionId, event_type: "pdf_generated", actor_id: user.id, note: "PDF final gerado." });
  if (eventError) {
    await admin.from("gp_v2_proposal_files").delete().eq("organization_id", organizationId).eq("storage_path", path);
    await bucket.remove([path]);
    return reply(400, { error: eventError.message });
  }

  const { data: signed, error: signedError } = await bucket.createSignedUrl(path, 900);
  if (signedError) return reply(200, { ok: true, storagePath: path, signedUrl: "" });
  return reply(200, { ok: true, storagePath: path, signedUrl: signed?.signedUrl || "" });
});

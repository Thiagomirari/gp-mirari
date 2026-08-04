# TDD - Relatorios e KPIs do GP Mirari

Status: especificacao para implementacao futura  
Data: 2026-08-03  
Fonte funcional: `outputs/gp-mirari-deploy`  
Executor previsto: agente Terra  
Escopo: arquitetura, dados, contratos, UX tecnica e roadmap  
Fora do escopo: codigo de aplicacao, execucao de SQL e deploy

## 1. Objetivo e principios

Este documento especifica a Tela de Relatorios e KPIs do CRM Mirari. O modulo deve transformar eventos comerciais e operacionais em indicadores confiaveis, comparaveis e auditaveis, sem alterar as regras atuais de CRM, propostas, projetos, precificacao ou autenticacao.

Principios obrigatorios:

- Toda informacao de negocio e isolada por `organization_id`.
- Nenhuma metrica oficial depende apenas do estado atual; mudancas de etapa possuem historico temporal.
- O frontend nao calcula KPIs oficiais, apenas apresenta contratos da camada analitica.
- Dinheiro usa `numeric` no PostgreSQL e string decimal nos contratos, nunca ponto flutuante.
- Datas sao persistidas em `timestamptz` UTC e exibidas na timezone da organizacao.
- O legado em `gp_app_settings/app_state` permanece preservado durante a transicao.
- Toda metrica informa periodo, base temporal, numerador, denominador e amostra quando aplicavel.
- RLS e membership protegem todas as consultas; nao existe acesso publico.
- Service role e permitida apenas em jobs/Edge Functions internos, nunca no navegador.
- A implementacao e incremental, protegida por feature flag e reversivel sem apagar dados.

## 2. Diagnostico da arquitetura atual

O GP Mirari atual e uma aplicacao web estatica publicada no cPanel. A experiencia principal esta em `index.html`, `assets/saas-core.*` e `assets/saas-extension.js`. O estado compartilhado permanece majoritariamente em `gp_app_settings/app_state`.

O CRM em JSON ja possui funis, etapas e probabilidades, oportunidades, responsaveis, origem textual, valor estimado, etiquetas, datas comerciais, eventos, historico, tarefas, clientes/especificadores em evolucao e propostas vinculadas. Existem migracoes preparatorias para organizacoes, memberships, CRM relacional basico, propostas, auditoria e documentos privados.

Limitacoes atuais:

- JSON nao e adequado para consultas analiticas historicas e concorrentes.
- `gp_v2_crm_events` nao representa de forma canonica cada permanencia em etapa.
- Origem ainda e texto livre e pode gerar categorias duplicadas.
- Cliente, parceiro, projetista, proposta, venda e projeto ainda nao formam uma cadeia relacional completa.
- Nao existem entidades normalizadas para assistencia, avaria e NPS.
- Indicadores atuais calculados no navegador nao devem ser fonte oficial.
- Unidade/filial ainda nao possui dimensao propria.

Decisao arquitetural:

```text
Eventos transacionais
  -> tabelas relacionais por organizacao
  -> views canonicas e RPCs analiticas
  -> agregados diarios para consultas pesadas
  -> Edge Function gp-v2-reports
  -> Tela de Relatorios
```

O JSON e uma fonte temporaria somente ate a migracao assistida de cada dominio. O relatorio oficial le fatos normalizados ou snapshots reconciliados.

## 3. Dicionario oficial de KPIs

Esta secao e normativa. O Terra nao deve criar formulas alternativas sem alterar este documento.

### 3.1 Periodo e comparacao

- `period_start`: inclusivo, inicio do dia na timezone da organizacao.
- `period_end`: limite exclusivo no servidor; a UI recebe o ultimo dia inclusivo.
- Padrao: mes corrente.
- MoM: periodo anterior com igual numero de dias. Para mes civil completo, mes civil anterior completo.
- Se o periodo anterior for zero, `change_percent = null` e `comparison_status = "no_baseline"`.
- Filtros de filial, canal e projetista sao aplicados antes da agregacao.

### 3.2 Atracao e topo de funil

| KPI | Definicao oficial |
| --- | --- |
| Total de leads | `count(distinct opportunity_id)` com `created_at` no periodo |
| MoM | `((atual - anterior) / anterior) * 100` |
| Distribuicao por canal | leads criados no periodo por canal normalizado; vazio vira `Nao informado` |
| Taxa de agendamento | leads da coorte com atividade `appointment` concluida / leads criados |
| Taxa de qualificacao | leads da coorte que atingiram etapa `counts_as_qualified` / leads criados |

### 3.3 Desempenho comercial e funil

| KPI | Definicao oficial |
| --- | --- |
| Ticket medio de orcamentos | media do total da primeira versao enviada de cada proposta no periodo |
| Ticket medio de vendas | media de `gross_amount` das vendas fechadas no periodo |
| Conversao | `won / (won + lost) * 100`; abertas nao entram; base `closed_in_period` |
| Tempo de fechamento | media, mediana e amostra de `closed_at - first_contact_at` para ganhas |
| Pipeline nominal | soma do valor estimado das oportunidades abertas atuais |
| Pipeline ponderado | soma de `estimated_value * stage_probability / 100` |
| Motivos de perda | perdidas no periodo por motivo, com quantidade, percentual e valor potencial |

Funil operacional por etapa:

- oportunidades abertas atuais;
- valor nominal e ponderado;
- tempo medio atual na etapa.

Funil de conversao por etapa:

- entradas unicas no periodo;
- avancos para a etapa seguinte;
- taxa de passagem;
- media e mediana de permanencia.

Motivos canonicos iniciais: `price`, `deadline`, `financial`, `competition`, `project`, `timing`, `no_response`, `other`.

Comparativo por canal: leads, qualificados, propostas enviadas, vendas, conversao, receita, ticket, ciclo medio e pipeline ponderado aberto.

### 3.4 Produtividade e parceiros

Performance por projetista:

- projetos atribuidos e concluidos;
- vendas ganhas e conversao das oportunidades fechadas sob sua responsabilidade;
- ticket medio;
- taxa de refazimento: projetos com ao menos uma revisao marcada `counts_as_rework` / projetos trabalhados;
- media de revisoes;
- lead time de projeto entre inicio e aprovacao.

Performance por especificador/arquiteto:

- oportunidades indicadas;
- vendas, receita, conversao e ticket;
- RT/comissao gerada, paga e pendente;
- Top 5 por receita, desempate por numero de vendas.

### 3.5 Operacao e pos-venda

| KPI | Definicao oficial |
| --- | --- |
| Assistencia/avaria | entregas com ao menos um chamado / entregas totais da coorte |
| Lead time total | `installation_completed_at - sale.closed_at`; media, mediana e P90 |
| NPS | `% promotores - % detratores`; 9-10 promotor, 7-8 neutro, 0-6 detrator |

Um projeto com varios chamados conta uma vez no numerador da taxa, mas todos os chamados aparecem no detalhamento. NPS com menos de 5 respostas retorna `low_sample = true` e sempre mostra taxa de resposta.

## 4. Modelo de dados

### 4.1 Padrao de todas as tabelas

- `id uuid primary key default gen_random_uuid()`;
- `organization_id uuid not null` referenciando `gp_v2_organizations`;
- `created_at`, `updated_at`, `created_by`, `updated_by` quando aplicavel;
- `archived_at` para entidades mestre;
- `unique (id, organization_id)` para FKs compostas por tenant;
- RLS habilitada e nenhum grant para `anon`;
- fatos historicos nao usam exclusao fisica.

### 4.2 Entidades atuais a evoluir

#### `gp_v2_organizations`

Adicionar `timezone text default 'America/Sao_Paulo'` e `currency_code char(3) default 'BRL'`.

#### `gp_v2_memberships`

Reutilizar como identidade e permissao. Nao depender de `gp_profiles` para autorizar relatorios.

#### `gp_v2_crm_stages`

Adicionar:

- `stage_type`: `open`, `won`, `lost`;
- `counts_as_contacted boolean`;
- `counts_as_scheduled boolean`;
- `counts_as_qualified boolean`;
- `counts_as_proposal boolean`.

Essas flags impedem que o sistema infira significado pelo nome editavel da etapa.

#### `gp_v2_crm_opportunities`

Adicionar:

- `client_id`, `branch_id`, `acquisition_channel_id`, `specifier_id`, `designer_id`;
- `first_contact_at`, `qualified_at`, `closed_at`, `last_activity_at`;
- `lost_reason_id`, `lost_comment`;
- `estimated_value numeric(14,2)`;
- `stage_entered_at`;
- manter `legacy_ref`.

`value_amount` pode coexistir apenas durante migracao controlada. Depois, `estimated_value` se torna a unica fonte.

#### Propostas e versoes

Reutilizar tabelas existentes. A versao precisa expor para analise:

- `first_sent_at`, `accepted_at`, `rejected_at`;
- `subtotal_amount`, `discount_amount`, `tax_amount`, `rt_amount`;
- `financial_fee_amount`, `total_amount`, `currency_code`.

Versoes bloqueadas continuam imutaveis.

### 4.3 Novas dimensoes

| Tabela | Finalidade | Campos essenciais |
| --- | --- | --- |
| `gp_v2_branches` | unidades/filiais | `code`, `name`, `timezone`, `active`, `archived_at` |
| `gp_v2_acquisition_channels` | canais normalizados | `code`, `name`, `channel_group`, `active`, `sort_order` |
| `gp_v2_clients` | base universal | `legacy_ref`, `name`, `email`, `phone`, `city`, `state_code`, `default_specifier_id`, `status` |
| `gp_v2_partners` | especificadores/arquitetos | `partner_type`, `name`, `email`, `phone`, `birth_date`, `default_rt_percent`, `status`, `legacy_ref` |
| `gp_v2_loss_reasons` | catalogo de perdas | `code`, `name`, `active`, `sort_order` |

`code` e estavel para analise; nomes podem ser editados. Canais iniciais podem incluir Instagram organico, Instagram Ads, Google, indicacao, arquiteto, loja fisica, evento e outro.

### 4.4 Novos fatos

#### `gp_v2_crm_stage_history`

Fonte canonica de permanencia em etapa:

- `opportunity_id`, `funnel_id`, `stage_id`;
- `entered_at`, `exited_at`, `duration_seconds`;
- `entered_by`, `exited_by`, `transition_event_id`;
- `is_current`.

Regras: uma linha atual por oportunidade; `exited_at >= entered_at`; retorno abre nova permanencia; historico anterior nao e reescrito.

#### `gp_v2_crm_activities`

Atividades comerciais normalizadas:

- `opportunity_id`;
- `activity_type`: `task`, `call`, `message`, `appointment`, `briefing`, `presentation`, `follow_up`, `other`;
- `title`, `owner_id`, `scheduled_at`, `completed_at`;
- `status`: `pending`, `completed`, `cancelled`;
- `automatic`, `required`, `source_ref`.

#### `gp_v2_opportunity_assignments`

Relaciona oportunidade e colaborador com `assignment_role`: `owner`, `designer`, `seller`, `manager`, `other`, alem de `assigned_at` e `unassigned_at`. Nao inferir projetista pela funcao textual do usuario.

#### `gp_v2_sales`

Fato criado quando o negocio e ganho:

- `opportunity_id`, `proposal_id`, `proposal_version_id`;
- `client_id`, `branch_id`, `specifier_id`, `designer_id`;
- `closed_at`;
- `gross_amount`, `discount_amount`, `net_amount`;
- `rt_amount`, `commission_amount`, `financial_fee_amount`;
- `status`: `confirmed`, `cancelled`;
- `legacy_project_ref`.

Uma oportunidade possui no maximo uma venda ativa. Cancelamento preserva a linha e gera evento compensatorio.

#### `gp_v2_sale_partner_commissions`

- `sale_id`, `partner_id`;
- `commission_type`: `rt`, `referral`, `other`;
- `base_amount`, `percentage`, `amount`;
- `status`: `accrued`, `approved`, `paid`, `cancelled`;
- `paid_at`.

#### `gp_v2_projects_relational`

Espelho relacional futuro dos projetos do JSON:

- `legacy_ref`, `sale_id`, `client_id`, `branch_id`, `designer_id`, `status`;
- `started_at`, `design_started_at`, `design_approved_at`;
- `production_started_at`, `installation_started_at`, `installation_completed_at`, `delivered_at`;
- `revision_count`, `rework_count`, `source_updated_at`, `synced_at`.

#### `gp_v2_project_revisions`

- `project_id`, `designer_id`;
- `revision_type`: `client_change`, `technical_adjustment`, `internal_error`, `scope_change`, `other`;
- `counts_as_rework`, `reason`, `requested_at`, `completed_at`, `source_ref`.

#### `gp_v2_service_cases`

- `project_id`, `sale_id`, `client_id`;
- `case_type`: `technical_assistance`, `damage`, `missing_item`, `installation_adjustment`, `other`;
- `origin`, `severity`, `status`;
- `opened_at`, `resolved_at`, `is_recurrence`, `parent_case_id`;
- `cost_amount numeric(14,2)` protegido para ADM.

#### `gp_v2_nps_surveys` e `gp_v2_nps_responses`

Survey: `project_id`, `sale_id`, `client_id`, `sent_at`, `expires_at`, `channel`, `token_hash`, `status`.  
Response: `survey_id unique`, `score smallint 0..10`, `comment`, `answered_at`, `consent_version`.

### 4.5 Agregados

#### `gp_v2_report_daily_metrics`

Grao: `organization_id + metric_date + branch_id + channel_id + designer_id`.

Armazenar numeradores/somas, nunca percentuais prontos:

- leads, qualificados, agendamentos e propostas;
- valor de propostas, ganhos, perdas e receita;
- pipeline ponderado;
- soma e amostra do tempo de fechamento;
- chamados, entregas e projetos com assistencia;
- promotores, neutros, detratores e respostas NPS;
- `refreshed_at`.

#### `gp_v2_report_refresh_log`

Audita `job_name`, periodo, status, linhas afetadas, inicio, fim, erro e `request_id`.

## 5. Integridade e relacionamentos

```text
organization
  -> branches, memberships, channels, clients, partners
  -> funnels -> stages
  -> opportunities
       -> stage_history, activities, assignments
       -> proposals -> versions
       -> sale -> partner_commissions
       -> project -> revisions, service_cases, nps_surveys -> responses
```

Regras obrigatorias:

- Toda FK de negocio impede cruzamento entre organizacoes.
- Mestre usa arquivamento; fatos nao sao apagados.
- Venda confirmada referencia oportunidade ganha.
- Perdida exige motivo; ganha nao aceita motivo de perda.
- Dinheiro nao pode ser negativo; percentual fica entre 0 e 100.
- Uma resposta NPS por pesquisa.
- Comissao paga nao excede a aprovada.

## 6. Indices obrigatorios

Todos iniciam por `organization_id`:

- oportunidades: `(created_at desc)`, `(branch_id, created_at desc)`, `(acquisition_channel_id, created_at desc)`, `(stage_id, status)`, `(closed_at desc) where closed_at is not null`, `(designer_id, closed_at desc)`;
- stage history: `(opportunity_id, entered_at)`, `(stage_id, entered_at desc)` e unico parcial `(opportunity_id) where is_current`;
- activities: `(opportunity_id, scheduled_at desc)` e `(activity_type, status, completed_at desc)`;
- proposal versions: `(first_sent_at desc)` e `(status, first_sent_at desc)`;
- sales: `(closed_at desc)`, `(branch_id, closed_at desc)`, `(designer_id, closed_at desc)`, `(specifier_id, closed_at desc)`;
- commissions: `(partner_id, status, paid_at desc)`;
- projects: `(delivered_at desc)` e `(designer_id, started_at desc)`;
- revisions: `(project_id, requested_at desc)`;
- service cases: `(project_id, opened_at desc)` e `(status, opened_at desc)`;
- NPS responses: `(answered_at desc)`;
- agregado: chave unica no grao e indices por data + cada dimensao.

Validar com `EXPLAIN (ANALYZE, BUFFERS)` em homologacao. Evitar indices isolados que nao iniciem por tenant.

## 7. Tempo real e pre-computacao

Calcular em tempo real para periodos curtos: resumo, pipeline atual, motivos, tickets, conversao, ranking Top 5, filtros e tabelas paginadas.

Criar views canonicas `security_invoker`:

- `gp_v2_report_opportunity_facts_v`;
- `gp_v2_report_proposal_facts_v`;
- `gp_v2_report_sales_facts_v`;
- `gp_v2_report_stage_duration_v`;
- `gp_v2_report_designer_facts_v`;
- `gp_v2_report_partner_facts_v`;
- `gp_v2_report_operations_facts_v`.

Usar agregado diario para series acima de 90 dias, MoM/YoY repetitivo, conversao longa, evolucao de NPS e coortes operacionais.

Job recomendado:

- incremental a cada 15 minutos para hoje e ontem;
- reconciliacao noturna dos ultimos 90 dias;
- idempotente por organizacao/intervalo;
- advisory lock por organizacao;
- log de refresh e recomputacao apos importacao.

Materialized views nao sao expostas diretamente. Sao consumidas por RPC/Edge com membership validada.

Limiar para tornar agregado fonte primaria: 100 mil oportunidades por organizacao, P95 acima de 800 ms, periodo padrao acima de 12 meses ou mais de 20 usuarios simultaneos.

## 8. Seguranca

- `owner` e `admin`: toda a organizacao, inclusive RT/comissoes/custos.
- `manager`: relatorios gerenciais, sem custos privados se a politica definir.
- `sales` e `operational`: primeira entrega pode negar o modulo; acesso futuro exige politica explicita.
- Comentarios NPS e PII possuem permissao adicional.
- Reutilizar `gp_v2_is_active_member` e `gp_v2_has_role`.

A Edge Function `gp-v2-reports` deve validar JWT, membership, role, filtros, limites e CORS. Consultas normais usam o JWT do usuario e RLS. Service role fica restrita ao job de refresh. Logs nao registram PII.

## 9. API e contratos

Endpoint logico: `/api/v1/reports/*`.  
Implementacao atual: `https://<project-ref>.supabase.co/functions/v1/gp-v2-reports/*`.

Headers:

```text
Authorization: Bearer <Supabase JWT>
X-Organization-Id: <uuid>
X-Request-Id: <uuid opcional>
```

Query params globais:

| Parametro | Tipo | Regra |
| --- | --- | --- |
| `period_start`, `period_end` | `YYYY-MM-DD` | obrigatorios |
| `timezone` | IANA | padrao da organizacao |
| `branch_id`, `designer_id`, `channel_id` | UUID ou CSV | somente IDs autorizados |
| `funnel_id` | UUID | funil ativo padrao |
| `compare` | enum | `previous_period`, `previous_month`, `none` |
| `page`, `page_size` | integer | 1..100 linhas |
| `sort`, `order` | whitelist | por endpoint |

Parametros desconhecidos retornam `400`.

Envelope:

```json
{
  "data": {},
  "meta": {
    "organization_id": "uuid",
    "period": { "start": "2026-08-01", "end": "2026-08-31", "timezone": "America/Sao_Paulo" },
    "filters": { "branch_ids": [], "designer_ids": [], "channel_ids": [], "funnel_id": null },
    "generated_at": "2026-08-03T15:00:00Z",
    "freshness": { "mode": "realtime", "last_refreshed_at": null },
    "request_id": "uuid"
  }
}
```

Erro:

```json
{
  "error": {
    "code": "invalid_period",
    "message": "O periodo informado e invalido.",
    "details": {},
    "request_id": "uuid"
  }
}
```

### 9.1 `GET /reports/filter-options`

Retorna filiais, projetistas, canais, funis e cobertura temporal autorizados.

```json
{
  "data": {
    "branches": [{ "id": "uuid", "name": "Loja principal" }],
    "designers": [{ "id": "uuid", "name": "Lais", "active": true }],
    "channels": [{ "id": "uuid", "name": "Instagram", "group": "organic" }],
    "funnels": [{ "id": "uuid", "name": "Funil padrao Mirari" }],
    "min_available_date": "2025-01-01",
    "max_available_date": "2026-08-03"
  },
  "meta": {}
}
```

### 9.2 `GET /reports/summary`

```json
{
  "data": {
    "leads": { "value": 84, "previous_value": 71, "change_percent": 18.31, "comparison_status": "ok" },
    "scheduled_rate": { "value_percent": 61.9, "numerator": 52, "denominator": 84 },
    "qualification_rate": { "value_percent": 48.81, "numerator": 41, "denominator": 84 },
    "pipeline": { "open_count": 37, "nominal_amount": "2850000.00", "weighted_amount": "1787000.00" },
    "average_quote_ticket": { "amount": "82422.51", "sample_size": 18 },
    "average_sale_ticket": { "amount": "96350.00", "sample_size": 9 },
    "conversion": { "value_percent": 34.62, "won": 9, "lost": 17, "metric_basis": "closed_in_period" },
    "average_close_time": { "days": 21.4, "median_days": 18.0, "sample_size": 9 },
    "assistance_rate": { "value_percent": 8.33, "projects_with_case": 2, "delivered_projects": 24 },
    "delivery_lead_time": { "average_days": 63.8, "median_days": 59.0, "p90_days": 91.0, "sample_size": 21 },
    "nps": { "score": 72, "responses": 18, "response_rate_percent": 64.29, "low_sample": false }
  },
  "meta": {}
}
```

### 9.3 `GET /reports/acquisition`

```json
{
  "data": {
    "channels": [{
      "channel_id": "uuid",
      "channel_name": "Instagram",
      "channel_group": "organic",
      "lead_count": 32,
      "share_percent": 38.10,
      "qualified_count": 15,
      "qualification_rate_percent": 46.88
    }],
    "total_leads": 84
  },
  "meta": {}
}
```

### 9.4 `GET /reports/funnel`

```json
{
  "data": {
    "stages": [{
      "stage_id": "uuid",
      "name": "Briefing comercial",
      "position": 3,
      "color": "#8B8585",
      "current_open_count": 12,
      "current_nominal_amount": "840000.00",
      "current_weighted_amount": "378000.00",
      "entered_count": 28,
      "advanced_count": 17,
      "pass_through_rate_percent": 60.71,
      "average_duration_days": 5.4,
      "median_duration_days": 4.0
    }],
    "cohort": { "metric_basis": "stage_entries_in_period" }
  },
  "meta": {}
}
```

### 9.5 `GET /reports/losses`

```json
{
  "data": {
    "total_lost": 17,
    "total_lost_amount": "1175000.00",
    "reasons": [{
      "reason_id": "uuid",
      "code": "price",
      "name": "Preco",
      "count": 6,
      "share_percent": 35.29,
      "potential_amount": "480000.00"
    }]
  },
  "meta": {}
}
```

### 9.6 `GET /reports/channels`

```json
{
  "data": {
    "rows": [{
      "channel_id": "uuid",
      "channel_name": "Indicacao de arquiteto",
      "leads": 21,
      "qualified_leads": 14,
      "proposals_sent": 11,
      "won_sales": 6,
      "conversion_rate_percent": 46.15,
      "closed_revenue": "720000.00",
      "average_ticket": "120000.00",
      "average_close_days": 18.7,
      "open_weighted_pipeline": "540000.00"
    }],
    "page": 1,
    "page_size": 25,
    "total_rows": 8
  },
  "meta": {}
}
```

### 9.7 `GET /reports/designers`

```json
{
  "data": {
    "rows": [{
      "designer_id": "uuid",
      "name": "Lais",
      "assigned_projects": 14,
      "completed_projects": 9,
      "won_sales": 7,
      "conversion_rate_percent": 41.18,
      "average_ticket": "98500.00",
      "projects_with_rework": 2,
      "rework_rate_percent": 14.29,
      "average_revision_count": 1.6,
      "average_design_lead_time_days": 9.4
    }],
    "page": 1,
    "page_size": 25,
    "total_rows": 4
  },
  "meta": {}
}
```

### 9.8 `GET /reports/partners`

```json
{
  "data": {
    "top_five": [{
      "partner_id": "uuid",
      "name": "Paula Nunes",
      "partner_type": "architect",
      "opportunities": 12,
      "won_sales": 5,
      "conversion_rate_percent": 45.45,
      "closed_revenue": "680000.00",
      "average_ticket": "136000.00",
      "commission_accrued": "34000.00",
      "commission_paid": "25000.00",
      "commission_pending": "9000.00",
      "rank": 1
    }],
    "rows": [],
    "page": 1,
    "page_size": 25,
    "total_rows": 12
  },
  "meta": {}
}
```

### 9.9 `GET /reports/operations`

```json
{
  "data": {
    "assistance": {
      "rate_percent": 8.33,
      "delivered_projects": 24,
      "projects_with_cases": 2,
      "case_count": 3,
      "damage_count": 1,
      "recurrence_count": 0
    },
    "lead_time": {
      "average_days": 63.8,
      "median_days": 59.0,
      "p90_days": 91.0,
      "sample_size": 21
    },
    "nps": {
      "score": 72,
      "promoters": 15,
      "passives": 2,
      "detractors": 1,
      "responses": 18,
      "sent_surveys": 28,
      "response_rate_percent": 64.29,
      "low_sample": false
    }
  },
  "meta": {}
}
```

### 9.10 `POST /reports/export`

```json
{
  "report": "executive_dashboard",
  "format": "pdf",
  "period_start": "2026-08-01",
  "period_end": "2026-08-31",
  "filters": { "branch_ids": [], "designer_ids": [], "channel_ids": [] },
  "sections": ["summary", "funnel", "channels", "designers", "partners", "operations"]
}
```

Resposta assincrona: `export_id` e `status = queued`. Arquivo em bucket privado, banco guarda apenas path e a entrega usa URL assinada temporaria.

## 10. Frontend e estado

Arvore proposta:

```text
ReportsPage
  ReportsHeader -> Title, FreshnessBadge, ExportMenu
  GlobalReportFilters -> Period, Branch, Designer, Channel, Funnel, Apply, Clear
  ReportStateBoundary -> Skeleton, Error, Empty
  AttractionSection -> KPIs, AcquisitionChart
  CommercialSection -> KPIs, FunnelChart, LossChart, ChannelTable
  ProductivitySection -> DesignerTable, PartnerRanking
  OperationsSection -> OperationsKPIs, LeadTimeTrend, NpsPanel
  ReportMethodologyDrawer
```

Mesmo no HTML atual, cada componente deve ser uma funcao isolada e sem estado global implicito.

Estado:

- `draftFilters`: edicao ainda nao aplicada;
- `appliedFilters`: filtros das consultas;
- `filterOptions`: dimensoes autorizadas;
- `reportData`: cache por endpoint/chave;
- `uiState`: secoes, paginacao, ordenacao e exportacao.

O botao `Aplicar filtros` dispara a atualizacao atomica. Query string pode guardar filtros compartilháveis; dados analiticos sensiveis nao ficam em `localStorage`.

Cache:

- options: 10 minutos;
- resumo/graficos: 60 segundos;
- tabelas: 2 minutos;
- manter dados anteriores durante refetch;
- cancelar requests obsoletos com `AbortController`;
- deduplicar e limitar a 4 requests concorrentes;
- retry apenas para 429/5xx, duas vezes com backoff;
- 401 aciona sessao sem loop; 403 informa falta de permissao.

Carregamento: options, filtros padrao, primeiro viewport em paralelo; tabelas e operacao depois. Falha em uma secao nao derruba as outras.

UX obrigatoria:

- Design System Mirari atual;
- cards estaveis e skeletons sem layout shift;
- moeda pt-BR e percentuais com ate duas casas;
- tooltip com formula, periodo e amostra;
- `Sem dados` em vez de zero enganoso;
- graficos com alternativa textual, sem depender apenas de cor;
- tabelas ordenaveis/paginadas;
- responsivo e WCAG AA.

## 11. Performance e observabilidade

Metas:

- API P50 < 300 ms e P95 < 800 ms para 90 dias;
- primeiro bloco visivel em ate 1,5 s;
- payload inicial comprimido < 250 KB;
- ate 100 linhas por pagina;
- exportacao assincrona se superar 5 segundos.

Registrar endpoint, request_id, duracao, tempo SQL, cache hit/miss, linhas retornadas, status e frescor. Nao registrar PII. Alertar P95 > 1,5 s, job sem sucesso por 30 minutos, divergencia de reconciliacao e exportacao travada por 10 minutos.

## 12. Qualidade e migracao do legado

Invariantes:

- etapa atual corresponde a uma unica permanencia `is_current`;
- ganha/perdida possui `closed_at`, com motivo apenas para perdida;
- venda confirmada aponta para oportunidade ganha;
- venda reconcilia com proposta aceita ou registra override justificado;
- projeto entregue possui conclusao de instalacao ou excecao;
- resposta NPS e unica;
- comissao paga nao excede aprovada.

Backfill do JSON, somente quando autorizado:

1. exportar snapshot e hash;
2. importar em staging;
3. mapear IDs textuais para UUIDs;
4. normalizar moedas e datas;
5. produzir rejeicoes;
6. reconciliar contagens/somas;
7. promover por organizacao em transacao;
8. manter `legacy_ref` e `data_coverage_start`.

Nao inventar historico ausente.

## 13. Roadmap atomico para o Terra

Cada task deve ter commit, testes e validacao antes da seguinte. Nenhuma task autoriza deploy automatico.

### Fase 0 - Baseline

#### Task 0.1 - Inventario

- Ler TDD/checkpoint, confirmar HEAD, worktree e testes.
- Inventariar banco de homologacao e comparar com migrations.
- Nao alterar producao.

#### Task 0.2 - Feature flag

- Criar `reports_v1_enabled` por organizacao, padrao `false`.
- Documentar rollback pela flag.

### Fase 1 - Database/Migrations

#### Task 1.1 - Dimensoes

- Filiais, canais, clientes relacionais, parceiros e motivos.
- RLS deny-by-default e seeds idempotentes de motivos.

#### Task 1.2 - Historico comercial

- Stage history, activities e assignments.
- Transacao atomica fecha permanencia anterior e abre nova.

#### Task 1.3 - Vendas e comissoes

- Vendas e comissoes de parceiros.
- Uma venda ativa por oportunidade; custos privados separados.

#### Task 1.4 - Operacao e NPS

- Projetos relacionais, revisoes, assistencias, pesquisas e respostas.

#### Task 1.5 - Analitica

- Agregado diario, refresh log, views e RPCs tipadas.

Aceite: migration idempotente, isolamento com duas organizacoes, roles, constraints, EXPLAIN e rollback documentado.

### Fase 2 - Backend Services/Aggregators

#### Task 2.1 - Filtros

- Periodo `[start,end)`, timezone, UUIDs, paginacao, sort e autorizacao.

#### Task 2.2 - KPIs

- Implementar dicionario oficial com amostra, numerador, denominador e base.

#### Task 2.3 - Funil

- Funil atual, passagem, retorno de etapa, media, mediana e P90.

#### Task 2.4 - Dominios

- Canais, projetistas, parceiros, operacao e NPS.

#### Task 2.5 - Job

- Refresh incremental idempotente, cron em homologacao e reconciliacao.

### Fase 3 - API Layer

#### Task 3.1 - Edge Function

- Rotas, JWT, membership, role, CORS, limites e erros seguros.

#### Task 3.2 - Contratos

- Schemas de request/response e testes para todos os contratos.

#### Task 3.3 - Cache HTTP

- ETag e `Cache-Control: private`; nunca cache publico.

### Fase 4 - Frontend

#### Task 4.1 - Shell

- Navegacao protegida, pagina, filtros e estados, sem alterar modulos atuais.

#### Task 4.2 - Cliente API

- Adaptador isolado, cache, cancelamento, retry e erro; sem formulas locais.

#### Tasks 4.3 a 4.6 - Blocos

- 4.3: Atracao;
- 4.4: Comercial/funil;
- 4.5: Projetistas/parceiros;
- 4.6: Operacao/NPS.

#### Task 4.7 - Responsividade/A11y

- Desktop a celular, teclado, leitor de tela, contraste e tabelas acessiveis.

### Fase 5 - Integracao/Polish

#### Task 5.1 - Filtros globais

- Aplicacao atomica, query string, limpar e sem resultados.

#### Task 5.2 - Exportacao

- CSV e PDF assincrono em bucket privado.

#### Task 5.3 - Observabilidade

- Logs, request IDs, tempos, frescor e alertas.

#### Task 5.4 - Homologacao

- Duas organizacoes, formulas conferidas em planilha, API/banco/UI reconciliados, roles e navegadores.

#### Task 5.5 - Liberacao gradual

- Homologacao, 7 dias de monitoramento, Mirari e rollback por flag.

## 14. Matriz de testes

Banco:

- isolamento de tenant;
- retorno de etapa;
- ganho/perda e constraints;
- agregado idempotente e refresh concorrente.

Metricas:

- periodo vazio e baseline zero;
- retorno de etapa;
- varias versoes de proposta;
- venda cancelada;
- multiplas atribuicoes;
- comissao parcial;
- varios chamados no mesmo projeto;
- NPS com baixa amostra;
- virada de dia/timezone.

API:

- JWT, membership e role;
- periodo/UUID/paginacao/sort invalidos;
- schema, timeout e cancelamento.

Frontend:

- aplicar/limpar filtros;
- loading/erro/vazio por secao;
- moeda/data/percentual;
- mobile, teclado e leitor de tela;
- exportacao com os filtros aplicados.

## 15. Riscos e mitigacoes

| Risco | Mitigacao |
| --- | --- |
| Historico incompleto | informar cobertura e nao inventar eventos |
| Divergencia JSON/SQL | fonte por dominio, `legacy_ref`, idempotencia e reconciliacao |
| Denominadores diferentes | dicionario, `metric_basis` e tooltip |
| Materialized view furar RLS | nao expor diretamente; usar RPC/Edge autorizada |
| Join fan-out duplicar valores | grao declarado, pre-agregacao e testes de soma |
| Percentis caros | agregado/materialized view quando necessario |
| PII em logs/exportacoes | role, bucket privado, URL curta e logs sem PII |

## 16. Revisao critica

- Calcular no cliente seria mais rapido para um prototipo, mas duplicaria regras e nao ofereceria auditoria/RLS.
- Uma unica tabela de KPIs e inadequada: percentuais nao podem ser somados; guardar numeradores e denominadores preserva a matematica.
- Events nao substituem stage history: permanencias exigem pares claros de entrada/saida e retornos de etapa.
- Uma venda e necessaria porque oportunidade ganha e proposta aceita nao sao sempre o mesmo fato financeiro.
- BI externo pode complementar, mas nao elimina a necessidade de fatos, historico e dicionario.
- PostgREST/RPC sem Edge e possivel, mas a Edge fornece contrato versionado, validacao, observabilidade e exportacao.
- Projetista deve ser atribuicao explicita, nao inferencia por cargo.
- Canal precisa ser normalizado; texto legado e mapeado para codigo canonico.

Fora da primeira entrega: IA preditiva, atribuicao automatica, gamificacao, integracao de midia paga, CAC/ROAS sem investimento confiavel, dashboard publico e migracao automatica do JSON.

## 17. Definition of Done

O modulo esta pronto quando:

1. formulas possuem testes com massa conhecida;
2. duas organizacoes nao vazam dados;
3. filtros geram totais coerentes entre blocos;
4. retornos de etapa sao tratados;
5. propostas e vendas reconciliam;
6. KPIs exibem amostra e base temporal;
7. P95 atende a meta;
8. desktop e mobile foram homologados;
9. exportacao respeita roles/filtros;
10. feature flag faz rollback imediato;
11. dicionario e operacao estao documentados;
12. CRM, projetos, propostas, auth e deploy permanecem sem regressao.

## 18. Instrucao final ao Terra

O Terra deve usar este TDD como contrato. Antes de cada fase, deve confirmar a fonte atual, verificar o worktree, criar backup dos arquivos alterados e executar os testes existentes. Deve implementar somente a task autorizada, produzir migration aditiva/idempotente, testes e documentacao correspondente, e parar se encontrar divergencia entre o banco real e este inventario.

Nenhuma migration deve ser executada em producao durante o desenvolvimento inicial. Nenhuma feature deve ser exposta sem RLS, membership, feature flag e homologacao com duas organizacoes.

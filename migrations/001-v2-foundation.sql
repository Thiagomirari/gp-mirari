-- GP Mirari V02 SaaS - Etapa 1: fundacao relacional.
-- Execute antes das migrations 002 a 006, em um projeto Supabase de homologacao.
-- Esta migration cria somente estruturas novas; nao le nem altera gp_app_settings/app_state.

begin;

create table if not exists public.gp_v2_organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(trim(name)) > 0),
  check (slug = lower(trim(slug)))
);

create table if not exists public.gp_v2_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.gp_v2_organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'manager', 'sales', 'operational', 'viewer')),
  status text not null default 'invited' check (status in ('invited', 'active', 'suspended')),
  invited_by uuid,
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id),
  unique (id, organization_id)
);

create table if not exists public.gp_v2_product_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.gp_v2_organizations(id) on delete restrict,
  name text not null,
  code text not null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code),
  unique (id, organization_id)
);

create table if not exists public.gp_v2_products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.gp_v2_organizations(id) on delete restrict,
  category_id uuid,
  code text not null,
  name text not null,
  description text not null default '',
  active boolean not null default true,
  archived_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code),
  unique (id, organization_id),
  foreign key (category_id, organization_id) references public.gp_v2_product_categories(id, organization_id) on delete restrict
);

create table if not exists public.gp_v2_product_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.gp_v2_organizations(id) on delete restrict,
  product_id uuid not null,
  version_number integer not null check (version_number > 0),
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  scope_snapshot jsonb not null default '{}'::jsonb,
  tax_percent numeric(5,2) not null default 0 check (tax_percent between 0 and 100),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, product_id, version_number),
  unique (id, organization_id),
  foreign key (product_id, organization_id) references public.gp_v2_products(id, organization_id) on delete restrict
);

create table if not exists public.gp_v2_price_books (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.gp_v2_organizations(id) on delete restrict,
  code text not null,
  name text not null,
  currency_code text not null default 'BRL',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code),
  unique (id, organization_id)
);

create table if not exists public.gp_v2_product_prices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.gp_v2_organizations(id) on delete restrict,
  product_version_id uuid not null,
  price_book_id uuid not null,
  amount numeric(14,2) not null check (amount >= 0),
  valid_from date,
  valid_until date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (product_version_id, organization_id) references public.gp_v2_product_versions(id, organization_id) on delete restrict,
  foreign key (price_book_id, organization_id) references public.gp_v2_price_books(id, organization_id) on delete restrict,
  check (valid_until is null or valid_from is null or valid_until >= valid_from)
);

create table if not exists public.gp_v2_product_costs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.gp_v2_organizations(id) on delete restrict,
  product_version_id uuid not null,
  cost_type text not null default 'production',
  amount numeric(14,2) not null check (amount >= 0),
  valid_from date,
  valid_until date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (product_version_id, organization_id) references public.gp_v2_product_versions(id, organization_id) on delete restrict,
  check (valid_until is null or valid_from is null or valid_until >= valid_from)
);

create table if not exists public.gp_v2_product_images (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.gp_v2_organizations(id) on delete restrict,
  product_id uuid not null,
  storage_path text not null,
  alt_text text not null default '',
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  unique (organization_id, storage_path),
  unique (id, organization_id),
  foreign key (product_id, organization_id) references public.gp_v2_products(id, organization_id) on delete restrict
);

create table if not exists public.gp_v2_proposals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.gp_v2_organizations(id) on delete restrict,
  proposal_number text not null,
  opportunity_ref text not null default '',
  project_ref text not null default '',
  status text not null default 'draft' check (status in ('draft', 'negotiation', 'internal_review', 'approved', 'sent', 'accepted', 'rejected', 'expired', 'cancelled')),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, proposal_number),
  unique (id, organization_id)
);

create table if not exists public.gp_v2_proposal_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.gp_v2_organizations(id) on delete restrict,
  proposal_id uuid not null,
  version_number integer not null check (version_number > 0),
  status text not null default 'draft' check (status in ('draft', 'negotiation', 'internal_review', 'approved', 'sent', 'accepted', 'rejected', 'expired', 'cancelled', 'superseded')),
  is_locked boolean not null default false,
  client_name_snapshot text not null default '',
  scope_snapshot jsonb not null default '{}'::jsonb,
  payment_terms_snapshot text not null default '',
  delivery_terms_snapshot text not null default '',
  valid_until date,
  subtotal_amount numeric(14,2) not null default 0 check (subtotal_amount >= 0),
  item_discount_amount numeric(14,2) not null default 0 check (item_discount_amount >= 0),
  global_discount_amount numeric(14,2) not null default 0 check (global_discount_amount >= 0),
  tax_amount numeric(14,2) not null default 0 check (tax_amount >= 0),
  total_amount numeric(14,2) not null default 0 check (total_amount >= 0),
  sent_at timestamptz,
  accepted_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, proposal_id, version_number),
  unique (id, organization_id),
  foreign key (proposal_id, organization_id) references public.gp_v2_proposals(id, organization_id) on delete restrict
);

create table if not exists public.gp_v2_proposal_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.gp_v2_organizations(id) on delete restrict,
  proposal_version_id uuid not null,
  product_version_id uuid,
  position integer not null default 0 check (position >= 0),
  quantity numeric(14,3) not null default 1 check (quantity > 0),
  unit_code_snapshot text not null default 'UN',
  name_snapshot text not null,
  description_snapshot text not null default '',
  image_path_snapshot text not null default '',
  unit_amount numeric(14,2) not null default 0 check (unit_amount >= 0),
  discount_amount numeric(14,2) not null default 0 check (discount_amount >= 0),
  tax_amount numeric(14,2) not null default 0 check (tax_amount >= 0),
  net_amount numeric(14,2) not null default 0 check (net_amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (proposal_version_id, organization_id) references public.gp_v2_proposal_versions(id, organization_id) on delete restrict,
  foreign key (product_version_id, organization_id) references public.gp_v2_product_versions(id, organization_id) on delete restrict
);

create table if not exists public.gp_v2_proposal_item_costs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.gp_v2_organizations(id) on delete restrict,
  proposal_item_id uuid not null,
  cost_type text not null default 'production',
  amount numeric(14,2) not null check (amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (proposal_item_id, organization_id) references public.gp_v2_proposal_items(id, organization_id) on delete restrict
);

create table if not exists public.gp_v2_proposal_installments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.gp_v2_organizations(id) on delete restrict,
  proposal_version_id uuid not null,
  position integer not null check (position > 0),
  due_date date,
  amount numeric(14,2) not null check (amount >= 0),
  created_at timestamptz not null default now(),
  unique (organization_id, proposal_version_id, position),
  unique (id, organization_id),
  foreign key (proposal_version_id, organization_id) references public.gp_v2_proposal_versions(id, organization_id) on delete restrict
);

create table if not exists public.gp_v2_proposal_approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.gp_v2_organizations(id) on delete restrict,
  proposal_version_id uuid not null,
  requested_by uuid not null,
  decided_by uuid,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  note text not null default '',
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  unique (id, organization_id),
  foreign key (proposal_version_id, organization_id) references public.gp_v2_proposal_versions(id, organization_id) on delete restrict
);

create table if not exists public.gp_v2_proposal_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.gp_v2_organizations(id) on delete restrict,
  proposal_id uuid not null,
  proposal_version_id uuid,
  event_type text not null,
  actor_id uuid,
  note text not null default '',
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (proposal_id, organization_id) references public.gp_v2_proposals(id, organization_id) on delete restrict,
  foreign key (proposal_version_id, organization_id) references public.gp_v2_proposal_versions(id, organization_id) on delete restrict
);

create table if not exists public.gp_v2_proposal_files (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.gp_v2_organizations(id) on delete restrict,
  proposal_id uuid not null,
  proposal_version_id uuid not null,
  file_kind text not null check (file_kind in ('pdf_draft', 'pdf_final', 'attachment')),
  storage_path text not null,
  generated_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (organization_id, storage_path),
  unique (id, organization_id),
  foreign key (proposal_id, organization_id) references public.gp_v2_proposals(id, organization_id) on delete restrict,
  foreign key (proposal_version_id, organization_id) references public.gp_v2_proposal_versions(id, organization_id) on delete restrict
);

commit;

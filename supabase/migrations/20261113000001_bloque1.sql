-- =====================================================================
-- Bloque 1 de la apertura (13 nov 2026)
--  ORG-01 régimen fiscal · T-08 una cuenta Starter por RFC · ORG-05 calendario de la empresa
--  EXP-02 régimen de contratación SAT · JOR-16 topes de jornada por año
--  T-12 conteo de empleados activos por periodo · origen de registros y lista de espera
-- =====================================================================

-- ---------------------------------------------------------------------
-- ORG-01 / T-08: régimen fiscal (catálogo c_RegimenFiscal del SAT) y búsqueda por RFC
-- ---------------------------------------------------------------------
alter table core.companies
  add column tax_regime text check (tax_regime ~ '^\d{3}$'),
  -- De dónde llegó el registro (?origen= del sitio, de una guía o del enlace de un despacho)
  add column signup_origin text check (signup_origin ~ '^[a-z0-9-]{2,40}$'),
  -- Teléfono de contacto capturado al registrarse (sin SMS en cuentas gratuitas)
  add column signup_phone text check (signup_phone ~ '^\+?\d{10,15}$');
create index companies_tax_id_idx on core.companies (upper(tax_id)) where tax_id is not null;

alter table core.waitlist
  add column origin text check (origin ~ '^[a-z0-9-]{2,40}$');

-- Enlaces con código para despachos contables y campañas (los da de alta la plataforma)
create table core.referral_codes (
  code          text primary key check (code ~ '^[a-z0-9-]{2,40}$'),
  kind          text not null default 'despacho' check (kind in ('despacho', 'campana')),
  name          text not null check (length(trim(name)) > 0),
  contact_email text,
  notes         text,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);
alter table core.referral_codes enable row level security;
-- Sin políticas: solo la API (service_role) la lee y escribe

-- ---------------------------------------------------------------------
-- ORG-05: días de descanso y festivos propios de la empresa (los oficiales se calculan solos)
-- ---------------------------------------------------------------------
create table rh.company_days (
  company_id uuid not null references core.companies (id) on delete cascade,
  day        date not null,
  kind       text not null default 'descanso' check (kind in ('descanso', 'festivo')),
  name       text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now(),
  primary key (company_id, day)
);
alter table rh.company_days enable row level security;
create policy company_days_select on rh.company_days for select using (core.is_member(company_id));

-- ---------------------------------------------------------------------
-- EXP-02: régimen de contratación (catálogo c_TipoRegimen del SAT)
-- ---------------------------------------------------------------------
alter table rh.employee_profiles
  add column sat_regime text check (sat_regime in ('02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '99'));

-- ---------------------------------------------------------------------
-- JOR-16: topes de jornada por año. Sin valor, se usa el de la ley para cada año
-- (2027: 46 h · 2028: 44 h · 2029: 42 h · 2030 en adelante: 40 h).
-- ---------------------------------------------------------------------
alter table jornada.settings
  add column weekly_limits jsonb not null default '{}'::jsonb check (jsonb_typeof(weekly_limits) = 'object'),
  alter column weekly_hour_limit drop not null,
  alter column weekly_hour_limit drop default;
-- El 46 anterior era el valor por omisión, no una decisión de la empresa
update jornada.settings set weekly_hour_limit = null where weekly_hour_limit = 46;
grant update (weekly_limits) on jornada.settings to authenticated;

-- ---------------------------------------------------------------------
-- T-12: empleados activos por día (foto diaria) y máximo del periodo
-- ---------------------------------------------------------------------
create table core.employee_counts (
  company_id   uuid not null references core.companies (id) on delete cascade,
  day          date not null,
  active_count integer not null check (active_count >= 0),
  primary key (company_id, day)
);
alter table core.employee_counts enable row level security;
create policy employee_counts_select on core.employee_counts for select using (core.is_member(company_id));

-- Máximo de empleados activos en el periodo: fotos diarias y, para días sin foto, altas y bajas.
create or replace function core.active_employees_in_period(p_company uuid, p_from date, p_to date)
returns integer language sql stable security definer set search_path = core as $$
  select greatest(
    coalesce((select max(active_count) from core.employee_counts
              where company_id = p_company and day between p_from and p_to), 0),
    (select count(*)::integer from core.employees e
     where e.company_id = p_company
       and coalesce(e.hired_at, e.created_at::date) <= p_to
       and (e.terminated_at is null or e.terminated_at >= p_from)
       and (e.active or e.terminated_at is not null))
  );
$$;
-- Solo la API la llama (ya validó el permiso); así nadie cuenta el personal de otra empresa
revoke execute on function core.active_employees_in_period(uuid, date, date) from public, anon, authenticated;
grant execute on function core.active_employees_in_period(uuid, date, date) to service_role;

create or replace function core.run_daily_jobs(p_consent_version text)
returns jsonb language plpgsql security definer set search_path = core as $$
declare
  v_archived integer;
  v_waitlisted integer;
  v_counted integer;
begin
  update core.subscriptions set status = 'archived'
  where read_only_at is not null and read_only_at + interval '90 days' <= now() and status <> 'archived';
  get diagnostics v_archived = row_count;

  insert into core.waitlist (email, source, consent_version, company_id)
  select distinct on (lower(u.email)) lower(u.email), 'starter_dia90', p_consent_version, s.company_id
  from core.subscriptions s
  join core.memberships m on m.company_id = s.company_id and m.active
  join core.roles r on r.id = m.role_id and r.company_id is null and r.key = 'owner'
  join auth.users u on u.id = m.user_id
  where s.plan = 'starter' and s.starter_clock_until <= now() and u.email is not null
  on conflict (email) do nothing;
  get diagnostics v_waitlisted = row_count;

  -- Foto diaria de empleados activos (base del límite de Starter y del cobro por periodo)
  insert into core.employee_counts (company_id, day, active_count)
  select c.id, (now() at time zone 'America/Mexico_City')::date,
         (select count(*) from core.employees e where e.company_id = c.id and e.active)
  from core.companies c
  join core.subscriptions s on s.company_id = c.id and s.status <> 'archived'
  on conflict (company_id, day) do update set active_count = excluded.active_count;
  get diagnostics v_counted = row_count;

  return jsonb_build_object('archived', v_archived, 'waitlisted', v_waitlisted, 'counted', v_counted);
end;
$$;
revoke execute on function core.run_daily_jobs(text) from public, anon, authenticated;
grant execute on function core.run_daily_jobs(text) to service_role;

-- ---------------------------------------------------------------------
-- Permisos de las tablas nuevas
-- ---------------------------------------------------------------------
revoke all on core.referral_codes from anon, authenticated;
grant all on core.referral_codes to service_role;
grant select on core.employee_counts to authenticated;
grant all on core.employee_counts to service_role;
grant select on rh.company_days to authenticated;
grant all on rh.company_days to service_role;

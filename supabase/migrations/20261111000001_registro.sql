-- =====================================================================
-- Korporia · Registro por autoservicio, plan Korporia Starter y lista de espera
-- (lanzamiento del 1 dic 2026)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Datos que se piden al registrarse (Operación y Ventas: registro mínimo)
-- ---------------------------------------------------------------------
alter table core.companies
  add column declared_employees integer check (declared_employees between 1 and 100000),
  add column industry text,
  add column state text;

-- ---------------------------------------------------------------------
-- Korporia Starter (términos 2.2, sección 3.1): dos vigencias contadas
-- desde la creación de la cuenta. Las fechas se guardan para aplicar los
-- cortes (checador al día 90, RH básico al mes 6) y para los avisos.
-- ---------------------------------------------------------------------
alter table core.subscriptions
  add column starter_started_at timestamptz,
  add column starter_clock_until timestamptz,
  add column starter_hr_until timestamptz;

-- ---------------------------------------------------------------------
-- Aceptación de términos y avisos (Legal): versión, fecha, usuario e IP.
-- Inalterable: una nueva versión se acepta con un registro nuevo.
-- ---------------------------------------------------------------------
create table core.legal_acceptances (
  id          bigint generated always as identity primary key,
  company_id  uuid references core.companies (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  document    text not null check (document in ('terminos', 'privacidad')),
  version     text not null,
  accepted_at timestamptz not null default now(),
  ip          text,
  user_agent  text
);
create index legal_acceptances_company_idx on core.legal_acceptances (company_id, document, accepted_at desc);

create trigger legal_acceptances_no_update before update on core.legal_acceptances
for each row execute function core.forbid_mutation();
create trigger legal_acceptances_no_delete before delete on core.legal_acceptances
for each row when (current_setting('role', true) <> 'service_role') execute function core.forbid_mutation();

-- ---------------------------------------------------------------------
-- Lista de espera de Despegue, Full y módulos "Próximamente"
-- (Precio Fundador: quien se registre en 2027 y contrate dentro de los
-- 60 días siguientes a que el plan esté disponible)
-- ---------------------------------------------------------------------
create table core.waitlist (
  id                bigint generated always as identity primary key,
  email             text not null unique check (email = lower(email) and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  lang              text not null default 'es' check (lang in ('es', 'en')),
  plans             text[] not null default '{despegue,full}',
  marketing_opt_out boolean not null default false,
  source            text not null default 'landing',
  consent_version   text not null,
  company_id        uuid references core.companies (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create trigger waitlist_touch before update on core.waitlist
for each row execute function core.touch_updated_at();

-- Solo la API (service role) escribe y lee estas tablas
alter table core.legal_acceptances enable row level security;
alter table core.waitlist enable row level security;

create policy legal_acceptances_select on core.legal_acceptances
  for select using (user_id = auth.uid() or core.can(company_id, 'core.empresa.editar'));

grant select on core.legal_acceptances to authenticated;
grant all on core.legal_acceptances, core.waitlist to service_role;
grant usage, select on all sequences in schema core to service_role;
revoke all on core.waitlist from anon, authenticated;

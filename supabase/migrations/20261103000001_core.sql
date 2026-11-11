-- =====================================================================
-- Korporia · Núcleo (esquema core)
--
-- Lo que comparten todos los módulos: empresas, suscripción y módulos
-- contratados, roles y permisos, colaboradores, obras/sucursales y bitácora.
--
-- Principios:
--   * Multiempresa: toda tabla de negocio lleva company_id y RLS.
--   * Cada módulo vive en su propio esquema (jornada, nomina, finanzas…) y
--     solo puede referenciar tablas de core, nunca las de otro módulo.
--   * Los permisos son "módulo.acción". core.can(empresa, permiso) es la única
--     función que deciden RLS y la API; además exige que el módulo del permiso
--     esté contratado y la cuenta no esté suspendida.
--   * El catálogo de módulos, permisos y roles del sistema se siembra aquí y
--     debe coincidir con packages/core/src/permissions.json (lo verifican las
--     pruebas de supabase/tests/run.mjs).
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;
create schema if not exists core;

create type core.company_status as enum ('trial', 'active', 'past_due', 'suspended', 'archived');

-- ---------------------------------------------------------------------
-- Plataforma (Erik)
-- ---------------------------------------------------------------------
create table core.platform_admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Catálogo: módulos y permisos
-- ---------------------------------------------------------------------
create table core.modules (
  key      text primary key check (key ~ '^[a-z]+$'),
  name     text not null,
  billable boolean not null default true,
  sort     smallint not null default 0
);

create table core.permissions (
  key        text primary key check (key ~ '^[a-z]+(\.[a-z_]+)+$'),
  module_key text not null references core.modules (key),
  label      text not null,
  check (split_part(key, '.', 1) = module_key)
);

-- ---------------------------------------------------------------------
-- Empresas cliente
-- ---------------------------------------------------------------------
create table core.companies (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (length(trim(name)) > 0),
  -- Código corto con el que los colaboradores inician sesión (código + número de empleado)
  code             text not null unique check (code ~ '^[a-z0-9]{3,16}$'),
  legal_name       text,
  -- Identificador fiscal del país (RFC en México)
  tax_id           text,
  country          char(2) not null default 'MX' check (country ~ '^[A-Z]{2}$'),
  currency         char(3) not null default 'MXN' check (currency ~ '^[A-Z]{3}$'),
  timezone         text not null default 'America/Mexico_City',
  locale           text not null default 'es-MX',
  whatsapp_support text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Plan y estado de pago. Solo lo cambian la plataforma y el webhook de Stripe.
create table core.subscriptions (
  company_id             uuid primary key references core.companies (id) on delete cascade,
  status                 core.company_status not null default 'trial',
  plan                   text not null default 'trial',
  -- Colaboradores activos permitidos (el cobro es por colaborador)
  employee_limit         integer not null default 3 check (employee_limit > 0),
  trial_ends_at          timestamptz default (now() + interval '15 days'),
  current_period_end     timestamptz,
  stripe_customer_id     text unique,
  stripe_subscription_id text unique,
  updated_at             timestamptz not null default now()
);

-- Módulos contratados por cada empresa (core siempre está disponible)
create table core.company_modules (
  company_id   uuid not null references core.companies (id) on delete cascade,
  module_key   text not null references core.modules (key),
  active       boolean not null default true,
  activated_at timestamptz not null default now(),
  primary key (company_id, module_key),
  check (module_key <> 'core')
);

-- ---------------------------------------------------------------------
-- Roles y membresías
-- ---------------------------------------------------------------------
-- company_id nulo = rol del sistema (dueño, administrador, supervisor, colaborador).
-- Cada empresa puede crear roles propios con los permisos que necesite.
create table core.roles (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid references core.companies (id) on delete cascade,
  key         text not null check (key ~ '^[a-z][a-z0-9_]{1,31}$'),
  name        text not null,
  description text,
  created_at  timestamptz not null default now()
);
create unique index roles_system_key_idx  on core.roles (key) where company_id is null;
create unique index roles_company_key_idx on core.roles (company_id, key) where company_id is not null;

create table core.role_permissions (
  role_id        uuid not null references core.roles (id) on delete cascade,
  permission_key text not null references core.permissions (key) on delete cascade,
  primary key (role_id, permission_key)
);

create table core.memberships (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references core.companies (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role_id    uuid not null references core.roles (id),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, user_id)
);
create index memberships_user_idx on core.memberships (user_id) where active;

-- ---------------------------------------------------------------------
-- Obras y sucursales (con geocerca, usada por Jornada)
-- ---------------------------------------------------------------------
create table core.sites (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references core.companies (id) on delete cascade,
  name          text not null,
  address       text,
  lat           double precision not null check (lat between -90 and 90),
  lng           double precision not null check (lng between -180 and 180),
  radius_m      integer not null default 150 check (radius_m between 20 and 5000),
  geofence_mode text not null default 'flag' check (geofence_mode in ('block', 'flag')),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (company_id, id)
);
create index sites_company_idx on core.sites (company_id) where active;

-- Obras asignadas a una membresía (p. ej., las que ve un supervisor)
create table core.membership_sites (
  membership_id uuid not null references core.memberships (id) on delete cascade,
  site_id       uuid not null references core.sites (id) on delete cascade,
  primary key (membership_id, site_id)
);

-- ---------------------------------------------------------------------
-- Colaboradores: un expediente por persona y empresa, compartido por
-- todos los módulos (asistencia, nómina, finanzas, reclutamiento).
-- ---------------------------------------------------------------------
create table core.employees (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references core.companies (id) on delete cascade,
  user_id          uuid unique references auth.users (id) on delete set null,
  employee_number  text not null,
  full_name        text not null,
  phone            text,
  email            text,
  -- Identificador personal del país (CURP en México)
  national_id      text,
  -- Identificador fiscal de la persona (RFC en México)
  tax_id           text,
  position         text,
  default_site_id  uuid,
  active           boolean not null default true,
  hired_at         date,
  terminated_at    date,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (company_id, employee_number),
  unique (company_id, id),
  foreign key (company_id, default_site_id) references core.sites (company_id, id) on delete set null (default_site_id)
);
create index employees_company_idx on core.employees (company_id) where active;

-- ---------------------------------------------------------------------
-- Bitácora general
-- ---------------------------------------------------------------------
create table core.audit_log (
  id         bigint generated always as identity primary key,
  company_id uuid references core.companies (id),
  actor_id   uuid references auth.users (id),
  action     text not null,
  entity     text not null,
  entity_id  uuid,
  details    jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_log_company_idx on core.audit_log (company_id, created_at desc);

-- =====================================================================
-- Funciones de permisos (SECURITY DEFINER para evitar recursión de RLS)
-- =====================================================================
create or replace function core.is_platform_admin()
returns boolean language sql stable security definer set search_path = core as $$
  select exists (select 1 from core.platform_admins where user_id = auth.uid());
$$;

-- ¿La empresa tiene contratado el módulo y su cuenta no está suspendida?
create or replace function core.has_module(p_company uuid, p_module text)
returns boolean language sql stable security definer set search_path = core as $$
  select p_module = 'core' or exists (
    select 1
    from core.company_modules cm
    join core.subscriptions s on s.company_id = cm.company_id
    where cm.company_id = p_company and cm.module_key = p_module and cm.active
      and s.status not in ('suspended', 'archived')
  );
$$;

-- ¿El usuario actual tiene el permiso en la empresa? (el módulo debe estar contratado)
create or replace function core.can(p_company uuid, p_permission text)
returns boolean language sql stable security definer set search_path = core as $$
  select core.is_platform_admin() or (
    exists (
      select 1
      from core.memberships m
      join core.role_permissions rp on rp.role_id = m.role_id
      where m.company_id = p_company and m.user_id = auth.uid() and m.active
        and rp.permission_key = p_permission
    )
    and core.has_module(p_company, split_part(p_permission, '.', 1))
  );
$$;

create or replace function core.is_member(p_company uuid)
returns boolean language sql stable security definer set search_path = core as $$
  select exists (
    select 1 from core.memberships m
    where m.company_id = p_company and m.user_id = auth.uid() and m.active
  );
$$;

-- ¿La obra está asignada a la membresía del usuario actual?
create or replace function core.assigned_to_site(p_site uuid)
returns boolean language sql stable security definer set search_path = core as $$
  select exists (
    select 1 from core.membership_sites ms
    join core.memberships m on m.id = ms.membership_id
    where ms.site_id = p_site and m.user_id = auth.uid() and m.active
  );
$$;

create or replace function core.my_employee_id(p_company uuid)
returns uuid language sql stable security definer set search_path = core as $$
  select e.id from core.employees e where e.company_id = p_company and e.user_id = auth.uid();
$$;

-- Accesos de un usuario en todas sus empresas, en una sola consulta (la usa la API).
create or replace function core.user_access(p_user uuid)
returns table (
  membership_id uuid,
  company_id    uuid,
  role_key      text,
  permissions   text[],
  modules       text[],
  status        core.company_status
)
language sql stable security definer set search_path = core as $$
  select m.id, m.company_id, r.key,
    coalesce(array(select rp.permission_key from core.role_permissions rp where rp.role_id = m.role_id order by 1), '{}'),
    array['core'] || coalesce(array(
      select cm.module_key from core.company_modules cm
      where cm.company_id = m.company_id and cm.active order by 1
    ), '{}'),
    s.status
  from core.memberships m
  join core.roles r on r.id = m.role_id
  left join core.subscriptions s on s.company_id = m.company_id
  where m.user_id = p_user and m.active;
$$;

-- =====================================================================
-- Reglas de integridad
-- =====================================================================
-- Una membresía solo puede usar un rol del sistema o uno de su propia empresa
create or replace function core.memberships_check_role()
returns trigger language plpgsql security definer set search_path = core as $$
begin
  if not exists (
    select 1 from core.roles r
    where r.id = new.role_id and (r.company_id is null or r.company_id = new.company_id)
  ) then
    raise exception 'El rol no pertenece a la empresa' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger memberships_check_role before insert or update of role_id, company_id on core.memberships
for each row execute function core.memberships_check_role();

-- Los roles del sistema no se editan desde la aplicación
create or replace function core.forbid_system_role_change()
returns trigger language plpgsql as $$
begin
  if (tg_op = 'DELETE' and old.company_id is null) or (tg_op = 'UPDATE' and (old.company_id is null or new.company_id is null)) then
    raise exception 'Los roles del sistema no se pueden modificar' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger roles_protect_system before update or delete on core.roles
for each row execute function core.forbid_system_role_change();

-- La obra de un supervisor debe ser de su misma empresa
create or replace function core.membership_sites_check()
returns trigger language plpgsql security definer set search_path = core as $$
begin
  if not exists (
    select 1 from core.memberships m join core.sites s on s.company_id = m.company_id
    where m.id = new.membership_id and s.id = new.site_id
  ) then
    raise exception 'La obra no pertenece a la empresa' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger membership_sites_check before insert or update on core.membership_sites
for each row execute function core.membership_sites_check();

-- Tablas inalterables (las usan los módulos para registros con valor legal)
create or replace function core.forbid_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'Los registros de % son inalterables; registra una corrección', tg_table_name
    using errcode = '42501';
end;
$$;

create or replace function core.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;
create trigger companies_touch before update on core.companies
for each row execute function core.touch_updated_at();
create trigger subscriptions_touch before update on core.subscriptions
for each row execute function core.touch_updated_at();
create trigger employees_touch before update on core.employees
for each row execute function core.touch_updated_at();

-- =====================================================================
-- Alta de una empresa cliente (solo la API de la plataforma)
-- Crea la empresa, su suscripción de prueba, sus módulos y al dueño.
-- =====================================================================
create or replace function core.provision_company(
  p_name           text,
  p_code           text,
  p_owner          uuid,
  p_employee_limit integer default 3,
  p_trial_days     integer default 15,
  p_modules        text[] default array['jornada']
)
returns uuid language plpgsql security definer set search_path = core as $$
declare
  v_company uuid;
begin
  insert into core.companies (name, code) values (p_name, p_code) returning id into v_company;
  insert into core.subscriptions (company_id, employee_limit, trial_ends_at)
  values (v_company, p_employee_limit, now() + make_interval(days => p_trial_days));
  insert into core.company_modules (company_id, module_key)
  select v_company, m from unnest(p_modules) as m where m <> 'core';
  insert into core.memberships (company_id, user_id, role_id)
  select v_company, p_owner, r.id from core.roles r where r.company_id is null and r.key = 'owner';
  insert into core.audit_log (company_id, actor_id, action, entity, entity_id, details)
  values (v_company, auth.uid(), 'company.created', 'companies', v_company, jsonb_build_object('modules', p_modules));
  return v_company;
end;
$$;

-- =====================================================================
-- Catálogo inicial (debe coincidir con packages/core/src/permissions.json)
-- =====================================================================
insert into core.modules (key, name, billable, sort) values
  ('core',          'Núcleo',        false, 0),
  ('jornada',       'Jornada',       true,  1),
  ('nomina',        'Nómina',        true,  2),
  ('finanzas',      'Finanzas',      true,  3),
  ('reclutamiento', 'Reclutamiento', true,  4);

insert into core.permissions (key, module_key, label) values
  ('core.empresa.editar',              'core',    'Editar los datos de la empresa'),
  ('core.empresa.suscripcion',         'core',    'Ver y cambiar el plan y los módulos contratados'),
  ('core.usuarios.gestionar',          'core',    'Dar de alta usuarios y asignar roles'),
  ('core.personal.ver',                'core',    'Ver colaboradores'),
  ('core.personal.gestionar',          'core',    'Dar de alta, editar y dar de baja colaboradores'),
  ('core.sitios.gestionar',            'core',    'Crear y editar obras y sucursales'),
  ('core.bitacora.ver',                'core',    'Consultar la bitácora de cambios'),
  ('jornada.checar',                   'jornada', 'Registrar mi entrada y salida'),
  ('jornada.asistencia.ver',           'jornada', 'Ver la asistencia de toda la empresa'),
  ('jornada.asistencia.ver_asignadas', 'jornada', 'Ver la asistencia solo de las obras asignadas'),
  ('jornada.reportes.ver',             'jornada', 'Ver y descargar reportes de jornada'),
  ('jornada.correcciones.crear',       'jornada', 'Corregir checadas con motivo'),
  ('jornada.rostros.registrar',        'jornada', 'Tomar la foto de registro en persona'),
  ('jornada.rostros.restablecer',      'jornada', 'Borrar una foto de registro para tomarla de nuevo'),
  ('jornada.configurar',               'jornada', 'Cambiar los ajustes del módulo Jornada'),
  ('jornada.cadena.verificar',         'jornada', 'Verificar la integridad de los registros');

insert into core.roles (key, name, description) values
  ('owner',      'Dueño',         'Control total de la empresa, incluido el plan contratado'),
  ('admin',      'Administrador', 'Administra personal, obras y módulos; no cambia el plan'),
  ('supervisor', 'Supervisor',    'Ve la asistencia de sus obras y toma fotos de registro'),
  ('worker',     'Colaborador',   'Registra su propia jornada');

insert into core.role_permissions (role_id, permission_key)
select r.id, p.key from core.roles r cross join core.permissions p
where r.company_id is null and r.key = 'owner';

insert into core.role_permissions (role_id, permission_key)
select r.id, p from core.roles r, unnest(array[
  'core.empresa.editar', 'core.usuarios.gestionar', 'core.personal.ver', 'core.personal.gestionar',
  'core.sitios.gestionar', 'core.bitacora.ver',
  'jornada.checar', 'jornada.asistencia.ver', 'jornada.asistencia.ver_asignadas', 'jornada.reportes.ver', 'jornada.correcciones.crear',
  'jornada.rostros.registrar', 'jornada.rostros.restablecer', 'jornada.configurar', 'jornada.cadena.verificar'
]) as p
where r.company_id is null and r.key = 'admin';

insert into core.role_permissions (role_id, permission_key)
select r.id, p from core.roles r, unnest(array[
  'core.personal.ver', 'jornada.asistencia.ver_asignadas', 'jornada.reportes.ver', 'jornada.rostros.registrar'
]) as p
where r.company_id is null and r.key = 'supervisor';

insert into core.role_permissions (role_id, permission_key)
select r.id, 'jornada.checar' from core.roles r
where r.company_id is null and r.key = 'worker';

-- =====================================================================
-- Seguridad por fila (RLS)
-- Las altas de usuarios, membresías y colaboradores pasan por la API,
-- que valida permisos, límite del plan y que nadie otorgue más de lo que tiene.
-- =====================================================================
alter table core.platform_admins  enable row level security;
alter table core.modules          enable row level security;
alter table core.permissions      enable row level security;
alter table core.companies        enable row level security;
alter table core.subscriptions    enable row level security;
alter table core.company_modules  enable row level security;
alter table core.roles            enable row level security;
alter table core.role_permissions enable row level security;
alter table core.memberships      enable row level security;
alter table core.sites            enable row level security;
alter table core.membership_sites enable row level security;
alter table core.employees        enable row level security;
alter table core.audit_log        enable row level security;

create policy platform_admins_self on core.platform_admins
  for select using (user_id = auth.uid());

-- Catálogo: lectura para cualquier usuario autenticado
create policy modules_read on core.modules for select to authenticated using (true);
create policy permissions_read on core.permissions for select to authenticated using (true);

create policy companies_select on core.companies
  for select using (core.is_member(id) or core.is_platform_admin());
create policy companies_update on core.companies
  for update using (core.can(id, 'core.empresa.editar')) with check (core.can(id, 'core.empresa.editar'));

create policy subscriptions_select on core.subscriptions
  for select using (core.is_member(company_id) or core.is_platform_admin());
create policy company_modules_select on core.company_modules
  for select using (core.is_member(company_id) or core.is_platform_admin());

create policy roles_select on core.roles
  for select using (company_id is null or core.is_member(company_id) or core.is_platform_admin());
create policy role_permissions_select on core.role_permissions
  for select using (exists (
    select 1 from core.roles r where r.id = role_id
      and (r.company_id is null or core.is_member(r.company_id) or core.is_platform_admin())
  ));

create policy memberships_select on core.memberships
  for select using (user_id = auth.uid() or core.can(company_id, 'core.usuarios.gestionar'));

create policy sites_select on core.sites
  for select using (core.is_member(company_id) or core.is_platform_admin());
create policy sites_insert on core.sites
  for insert with check (core.can(company_id, 'core.sitios.gestionar'));
create policy sites_update on core.sites
  for update using (core.can(company_id, 'core.sitios.gestionar')) with check (core.can(company_id, 'core.sitios.gestionar'));

create policy membership_sites_select on core.membership_sites
  for select using (exists (
    select 1 from core.memberships m where m.id = membership_id
      and (m.user_id = auth.uid() or core.can(m.company_id, 'core.usuarios.gestionar'))
  ));

create policy employees_select on core.employees
  for select using (core.can(company_id, 'core.personal.ver') or user_id = auth.uid());

create policy audit_log_select on core.audit_log
  for select using (core.can(company_id, 'core.bitacora.ver'));

-- Permisos base de Supabase
grant usage on schema core to anon, authenticated, service_role;
grant select on all tables in schema core to authenticated;
grant all on all tables in schema core to service_role;
grant usage, select on all sequences in schema core to service_role;

grant update (name, legal_name, tax_id, timezone, locale, whatsapp_support) on core.companies to authenticated;
grant insert, update on core.sites to authenticated;

-- Funciones internas: solo la API (service role)
revoke execute on function core.user_access(uuid) from public, anon, authenticated;
revoke execute on function core.provision_company(text, text, uuid, integer, integer, text[]) from public, anon, authenticated;
grant execute on function core.user_access(uuid) to service_role;
grant execute on function core.provision_company(text, text, uuid, integer, integer, text[]) to service_role;

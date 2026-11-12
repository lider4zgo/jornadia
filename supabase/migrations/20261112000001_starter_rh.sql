-- =====================================================================
-- Korporia · Planes con vigencia, acceso del trabajador y RH básico
-- (lanzamiento del 1 dic 2026)
--
--  1. Permisos por plan (PLT-19): cada módulo puede quedar en solo lectura
--     a partir de una fecha (Korporia Starter: checador al día 90 y RH
--     básico al mes 6) y la cuenta completa pasa a solo lectura; después,
--     archivo sin acceso. Los permisos de consulta siguen funcionando.
--  2. Acceso del trabajador con código de activación y PIN, y firma en la
--     app del aviso de privacidad, el acuerdo de registro de jornada y el
--     consentimiento biométrico (Legal), con registro inalterable.
--  3. Módulo RH básico (esquema rh): áreas, puestos y jefe directo;
--     expediente con documentos; vacaciones, permisos e incapacidades.
--
-- En Supabase, agrega "rh" a Project Settings → Data API → Exposed schemas.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Permisos por plan
-- ---------------------------------------------------------------------
-- Permisos que siguen disponibles cuando el módulo o la cuenta están en solo lectura
alter table core.permissions add column read_only_ok boolean not null default false;

-- Fecha desde la que el módulo queda en solo lectura (null = sin límite)
alter table core.company_modules add column writable_until timestamptz;

alter table core.subscriptions
  -- Desde esta fecha toda la cuenta queda en solo lectura con exportación
  add column read_only_at timestamptz,
  -- Usuarios de gestión (todos menos colaboradores); null = sin límite
  add column admin_limit integer check (admin_limit > 0),
  -- Espacio de documentos por colaborador activo, como promedio de la cuenta
  add column doc_mb_per_employee integer check (doc_mb_per_employee > 0),
  add column doc_max_file_mb integer not null default 10 check (doc_max_file_mb between 1 and 100);

-- Datos del patrón para el aviso de privacidad de sus trabajadores
alter table core.companies
  add column address text,
  add column privacy_email text,
  add column privacy_phone text;
grant update (address, privacy_email, privacy_phone) on core.companies to authenticated;

-- ¿El módulo acepta cambios hoy? ('core' = la cuenta completa)
create or replace function core.module_writable(p_company uuid, p_module text)
returns boolean language sql stable security definer set search_path = core as $$
  select not exists (
      select 1 from core.subscriptions s
      where s.company_id = p_company and s.read_only_at is not null and s.read_only_at <= now()
    )
    and (p_module = 'core' or not exists (
      select 1 from core.company_modules cm
      where cm.company_id = p_company and cm.module_key = p_module
        and cm.writable_until is not null and cm.writable_until <= now()
    ));
$$;

-- Una cuenta archivada pierde también el núcleo
create or replace function core.has_module(p_company uuid, p_module text)
returns boolean language sql stable security definer set search_path = core as $$
  select case
    when p_module = 'core' then not exists (
      select 1 from core.subscriptions s where s.company_id = p_company and s.status = 'archived'
    )
    else exists (
      select 1
      from core.company_modules cm
      join core.subscriptions s on s.company_id = cm.company_id
      where cm.company_id = p_company and cm.module_key = p_module and cm.active
        and s.status not in ('suspended', 'archived')
    )
  end;
$$;

-- El permiso de suscripción siempre funciona (para contratar y reactivar la cuenta)
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
    and (
      p_permission = 'core.empresa.suscripcion'
      or (
        core.has_module(p_company, split_part(p_permission, '.', 1))
        and (
          exists (select 1 from core.permissions p where p.key = p_permission and p.read_only_ok)
          or core.module_writable(p_company, split_part(p_permission, '.', 1))
        )
      )
    )
  );
$$;

drop function core.user_access(uuid);
create function core.user_access(p_user uuid)
returns table (
  membership_id uuid,
  company_id    uuid,
  role_key      text,
  permissions   text[],
  modules       text[],
  writable      text[],
  status        core.company_status
)
language sql stable security definer set search_path = core as $$
  select m.id, m.company_id, r.key,
    coalesce(array(select rp.permission_key from core.role_permissions rp where rp.role_id = m.role_id order by 1), '{}'),
    array['core'] || coalesce(array(
      select cm.module_key from core.company_modules cm
      where cm.company_id = m.company_id and cm.active order by 1
    ), '{}'),
    array(
      select k from unnest(array['core'] || coalesce(array(
        select cm.module_key from core.company_modules cm where cm.company_id = m.company_id and cm.active
      ), '{}')) as k
      where core.module_writable(m.company_id, k)
      order by 1
    ),
    s.status
  from core.memberships m
  join core.roles r on r.id = m.role_id
  left join core.subscriptions s on s.company_id = m.company_id
  where m.user_id = p_user and m.active;
$$;
revoke execute on function core.user_access(uuid) from public, anon, authenticated;
grant execute on function core.user_access(uuid) to service_role;

-- ---------------------------------------------------------------------
-- 2. Acceso del trabajador y documentos que firma en la app
-- ---------------------------------------------------------------------
-- PIN (para entrar, firmar y checar sin biometría) y código de activación.
-- Solo la API los lee y escribe.
create table core.employee_credentials (
  employee_id           uuid primary key references core.employees (id) on delete cascade,
  company_id            uuid not null references core.companies (id) on delete cascade,
  pin_hash              text,
  pin_set_at            timestamptz,
  activation_hash       text,
  activation_expires_at timestamptz,
  failed_attempts       smallint not null default 0,
  locked_until          timestamptz,
  updated_at            timestamptz not null default now(),
  foreign key (company_id, employee_id) references core.employees (company_id, id) on delete cascade
);
create trigger employee_credentials_touch before update on core.employee_credentials
for each row execute function core.touch_updated_at();

-- Firmas del trabajador (aviso, acuerdo de jornada, consentimiento biométrico).
-- Inalterable: un cambio de versión o el retiro del consentimiento es un registro nuevo.
create table core.employee_acceptances (
  id            bigint generated always as identity primary key,
  company_id    uuid not null references core.companies (id) on delete cascade,
  employee_id   uuid not null references core.employees (id) on delete cascade,
  document      text not null check (document in ('aviso_trabajadores', 'acuerdo_jornada', 'biometria')),
  version       text not null,
  choice        text not null check (choice in ('acepto', 'autorizo', 'no_autorizo', 'retiro')),
  method        text not null check (method in ('pin', 'impreso')),
  signed_at     timestamptz not null default now(),
  recorded_by   uuid references auth.users (id),
  evidence_path text,
  ip            text,
  user_agent    text,
  check ((document = 'biometria') = (choice in ('autorizo', 'no_autorizo', 'retiro')))
);
create index employee_acceptances_idx on core.employee_acceptances (employee_id, document, signed_at desc);
create trigger employee_acceptances_no_update before update on core.employee_acceptances
for each row execute function core.forbid_mutation();
create trigger employee_acceptances_no_delete before delete on core.employee_acceptances
for each row when (current_setting('role', true) <> 'service_role') execute function core.forbid_mutation();

alter table core.employee_credentials enable row level security;
alter table core.employee_acceptances enable row level security;
revoke all on core.employee_credentials from anon, authenticated;
create policy employee_acceptances_select on core.employee_acceptances
  for select using (core.can(company_id, 'core.personal.ver') or employee_id = core.my_employee_id(company_id));
grant select on core.employee_acceptances to authenticated;
grant all on core.employee_credentials, core.employee_acceptances to service_role;
grant usage, select on all sequences in schema core to service_role;

-- Borrado de selfies 1 año después de la baja (Legal): qué colaboradores ya se procesaron
create table jornada.selfie_purges (
  employee_id uuid primary key references core.employees (id) on delete cascade,
  company_id  uuid not null references core.companies (id) on delete cascade,
  objects     integer not null default 0,
  purged_at   timestamptz not null default now()
);
alter table jornada.selfie_purges enable row level security;
grant all on jornada.selfie_purges to service_role;

-- ---------------------------------------------------------------------
-- 3. RH básico (esquema rh)
-- ---------------------------------------------------------------------
create schema if not exists rh;

create table rh.departments (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references core.companies (id) on delete cascade,
  name       text not null check (length(trim(name)) > 0),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, id)
);
create unique index departments_name_idx on rh.departments (company_id, lower(name)) where active;

create table rh.positions (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references core.companies (id) on delete cascade,
  name          text not null check (length(trim(name)) > 0),
  description   text,
  department_id uuid,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, department_id) references rh.departments (company_id, id) on delete set null (department_id)
);
create unique index positions_name_idx on rh.positions (company_id, lower(name)) where active;

-- Expediente: datos laborales y personales (los básicos viven en core.employees)
create table rh.employee_profiles (
  employee_id     uuid primary key references core.employees (id) on delete cascade,
  company_id      uuid not null references core.companies (id) on delete cascade,
  department_id   uuid,
  position_id     uuid,
  manager_id      uuid,
  contract_type   text check (contract_type in ('indeterminado', 'determinado', 'obra', 'prueba', 'capacitacion')),
  contract_start  date,
  contract_end    date,
  probation_end   date,
  daily_salary    numeric(10,2) check (daily_salary >= 0),
  birth_date      date,
  nss             text check (nss ~ '^\d{11}$'),
  address         text,
  emergency_name  text,
  emergency_phone text,
  beneficiaries   text,
  -- Días de descanso semanal (ISO: 1 = lunes … 7 = domingo) para contar días de vacaciones
  rest_days       smallint[] not null default '{7}',
  -- Días de vacaciones ya disfrutados antes de usar Korporia (saldo inicial)
  vacation_days_taken_before numeric(5,1) not null default 0 check (vacation_days_taken_before >= 0),
  updated_at      timestamptz not null default now(),
  check (contract_end is null or contract_start is null or contract_end >= contract_start),
  check (manager_id is null or manager_id <> employee_id),
  foreign key (company_id, employee_id)   references core.employees (company_id, id) on delete cascade,
  foreign key (company_id, department_id) references rh.departments (company_id, id) on delete set null (department_id),
  foreign key (company_id, position_id)   references rh.positions (company_id, id) on delete set null (position_id),
  foreign key (company_id, manager_id)    references core.employees (company_id, id) on delete set null (manager_id)
);
create trigger employee_profiles_touch before update on rh.employee_profiles
for each row execute function core.touch_updated_at();

-- Documentos del expediente (archivos en R2). Se borran de forma lógica.
create table rh.documents (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references core.companies (id) on delete cascade,
  employee_id  uuid not null,
  kind         text not null check (kind in ('ine', 'curp', 'rfc', 'nss', 'domicilio', 'acta', 'estudios', 'contrato',
                                             'consentimiento', 'incapacidad', 'licencia', 'certificacion', 'otro')),
  name         text not null,
  path         text not null unique,
  mime         text not null,
  size_bytes   integer not null check (size_bytes > 0),
  expires_on   date,
  uploaded_by  uuid references auth.users (id),
  by_employee  boolean not null default false,
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  deleted_by   uuid references auth.users (id),
  foreign key (company_id, employee_id) references core.employees (company_id, id) on delete cascade
);
create index documents_employee_idx on rh.documents (employee_id) where deleted_at is null;
create index documents_company_idx on rh.documents (company_id) where deleted_at is null;

-- Vacaciones, permisos, licencias e incapacidades
create table rh.leave_requests (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references core.companies (id) on delete cascade,
  employee_id     uuid not null,
  kind            text not null check (kind in ('vacaciones', 'permiso_con_goce', 'permiso_sin_goce', 'incapacidad',
                                                'maternidad', 'paternidad', 'cuidados')),
  start_date      date not null,
  end_date        date not null,
  -- Días que descuenta del saldo (vacaciones) o que dura la ausencia
  days            numeric(5,1) not null check (days > 0),
  reason          text,
  status          text not null default 'pendiente' check (status in ('pendiente', 'aprobada', 'rechazada', 'cancelada')),
  -- Incapacidades del IMSS
  imss_folio      text,
  incapacity_type text check (incapacity_type in ('enfermedad_general', 'riesgo_trabajo', 'maternidad')),
  document_id     uuid references rh.documents (id) on delete set null,
  requested_by    uuid references auth.users (id),
  by_employee     boolean not null default false,
  decided_by      uuid references auth.users (id),
  decided_at      timestamptz,
  decision_note   text,
  created_at      timestamptz not null default now(),
  check (end_date >= start_date),
  check (kind <> 'incapacidad' or incapacity_type is not null),
  foreign key (company_id, employee_id) references core.employees (company_id, id) on delete cascade
);
create index leave_requests_employee_idx on rh.leave_requests (employee_id, start_date desc);
create index leave_requests_pending_idx on rh.leave_requests (company_id) where status = 'pendiente';

-- Todo lo escribe la API (service role) después de validar permisos, plan y saldos.
alter table rh.departments       enable row level security;
alter table rh.positions         enable row level security;
alter table rh.employee_profiles enable row level security;
alter table rh.documents         enable row level security;
alter table rh.leave_requests    enable row level security;

create policy departments_select on rh.departments for select using (core.is_member(company_id));
create policy positions_select on rh.positions for select using (core.is_member(company_id));
create policy employee_profiles_select on rh.employee_profiles
  for select using (core.can(company_id, 'rh.expediente.ver') or employee_id = core.my_employee_id(company_id));
create policy documents_select on rh.documents
  for select using (core.can(company_id, 'rh.expediente.ver') or employee_id = core.my_employee_id(company_id));
create policy leave_requests_select on rh.leave_requests
  for select using (core.can(company_id, 'rh.ausencias.ver') or employee_id = core.my_employee_id(company_id));

grant usage on schema rh to anon, authenticated, service_role;
grant select on all tables in schema rh to authenticated;
grant all on all tables in schema rh to service_role;

-- ---------------------------------------------------------------------
-- Catálogo: módulo RH básico y permisos nuevos (coincide con permissions.json)
-- ---------------------------------------------------------------------
insert into core.modules (key, name, billable, sort) values ('rh', 'RH básico', false, 2);

insert into core.permissions (key, module_key, label) values
  ('jornada.registros.propios', 'jornada', 'Consultar y descargar mis registros de jornada'),
  ('rh.estructura.gestionar',   'rh', 'Crear áreas y puestos y asignar jefes'),
  ('rh.expediente.ver',         'rh', 'Ver expedientes y documentos del personal'),
  ('rh.expediente.gestionar',   'rh', 'Editar expedientes y cargar documentos'),
  ('rh.ausencias.ver',          'rh', 'Ver vacaciones, permisos e incapacidades'),
  ('rh.ausencias.aprobar',      'rh', 'Aprobar solicitudes y registrar incapacidades'),
  ('rh.portal.ver',             'rh', 'Ver mis datos, documentos y solicitudes'),
  ('rh.portal.solicitar',       'rh', 'Pedir vacaciones y permisos y cargar mis documentos');

update core.permissions set read_only_ok = true where key in (
  'core.personal.ver', 'core.bitacora.ver', 'core.empresa.suscripcion',
  'jornada.asistencia.ver', 'jornada.asistencia.ver_asignadas', 'jornada.reportes.ver',
  'jornada.cadena.verificar', 'jornada.registros.propios',
  'rh.expediente.ver', 'rh.ausencias.ver', 'rh.portal.ver'
);

-- Dueño: todos los permisos
insert into core.role_permissions (role_id, permission_key)
select r.id, p.key from core.roles r cross join core.permissions p
where r.company_id is null and r.key = 'owner'
on conflict do nothing;

insert into core.role_permissions (role_id, permission_key)
select r.id, p from core.roles r, unnest(array[
  'jornada.registros.propios', 'rh.estructura.gestionar', 'rh.expediente.ver', 'rh.expediente.gestionar',
  'rh.ausencias.ver', 'rh.ausencias.aprobar', 'rh.portal.ver', 'rh.portal.solicitar'
]) as p
where r.company_id is null and r.key = 'admin';

insert into core.role_permissions (role_id, permission_key)
select r.id, p from core.roles r, unnest(array['rh.ausencias.ver', 'rh.portal.ver', 'rh.portal.solicitar']) as p
where r.company_id is null and r.key = 'supervisor';

insert into core.role_permissions (role_id, permission_key)
select r.id, p from core.roles r, unnest(array['jornada.registros.propios', 'rh.portal.ver', 'rh.portal.solicitar']) as p
where r.company_id is null and r.key = 'worker';

-- RH básico va incluido en todos los planes: se activa en las empresas existentes
insert into core.company_modules (company_id, module_key)
select c.id, 'rh' from core.companies c
on conflict do nothing;

-- Las empresas que ya estaban en Korporia Starter toman sus vigencias
update core.company_modules cm set writable_until = s.starter_clock_until
from core.subscriptions s
where s.company_id = cm.company_id and s.plan = 'starter' and cm.module_key = 'jornada';
update core.company_modules cm set writable_until = s.starter_hr_until
from core.subscriptions s
where s.company_id = cm.company_id and s.plan = 'starter' and cm.module_key = 'rh';
update core.subscriptions set read_only_at = starter_hr_until, admin_limit = 1, doc_mb_per_employee = 50
where plan = 'starter';

-- ---------------------------------------------------------------------
-- Tareas diarias (las llama el Worker con un cron)
--  * Archiva las cuentas 90 días después de pasar a solo lectura.
--  * Al día 90 de Korporia Starter inscribe al dueño en la lista de espera
--    de Despegue (si no estaba; respeta a quien pidió no recibir novedades).
-- ---------------------------------------------------------------------
create or replace function core.run_daily_jobs(p_consent_version text)
returns jsonb language plpgsql security definer set search_path = core as $$
declare
  v_archived integer;
  v_waitlisted integer;
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

  return jsonb_build_object('archived', v_archived, 'waitlisted', v_waitlisted);
end;
$$;
revoke execute on function core.run_daily_jobs(text) from public, anon, authenticated;
grant execute on function core.run_daily_jobs(text) to service_role;

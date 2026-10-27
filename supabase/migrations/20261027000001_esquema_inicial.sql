-- =====================================================================
-- Jornadia · Esquema inicial
-- Registro electrónico de jornada (LFT art. 132 fr. XXXIV, vigente 2027)
--
-- Principios:
--   * Multiempresa: toda tabla de negocio lleva company_id y RLS.
--   * Las checadas (punches) son INALTERABLES: no se permite UPDATE ni
--     DELETE. Las correcciones se registran aparte, con motivo y autor.
--   * Cada checada guarda el hash de la anterior de su empresa, formando
--     una cadena verificable (verify_punch_chain).
--   * La hora oficial es la del servidor (server_ts = now()).
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------
create type public.member_role   as enum ('owner', 'admin', 'supervisor', 'worker');
create type public.company_status as enum ('trial', 'active', 'past_due', 'suspended', 'archived');
create type public.geofence_mode as enum ('block', 'flag');
create type public.punch_kind    as enum ('in', 'break_start', 'break_end', 'out');
create type public.correction_action as enum ('add', 'void', 'adjust_time');

-- ---------------------------------------------------------------------
-- Plataforma (Erik)
-- ---------------------------------------------------------------------
create table public.platform_admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Empresas cliente
-- ---------------------------------------------------------------------
create table public.companies (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null check (length(trim(name)) > 0),
  -- Código corto con el que los trabajadores inician sesión (número + NIP + código)
  code               text not null unique check (code ~ '^[a-z0-9]{3,16}$'),
  legal_name         text,
  rfc                text,
  status             public.company_status not null default 'trial',
  plan               text not null default 'trial',
  employee_limit     integer not null default 3 check (employee_limit > 0),
  trial_ends_at      timestamptz default (now() + interval '15 days'),
  timezone           text not null default 'America/Mexico_City',
  weekly_hour_limit  numeric(4,1) not null default 46 check (weekly_hour_limit between 1 and 72),
  -- Umbral mínimo de similitud facial aceptado (0..1)
  face_match_threshold numeric(3,2) not null default 0.55 check (face_match_threshold between 0 and 1),
  -- Días que se conservan las selfies antes de borrarlas (los registros se conservan siempre)
  selfie_retention_days integer not null default 365 check (selfie_retention_days >= 30),
  stripe_customer_id text,
  whatsapp_support   text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table public.memberships (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       public.member_role not null,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, user_id)
);
create index memberships_user_idx on public.memberships (user_id) where active;

-- ---------------------------------------------------------------------
-- Obras / sucursales con geocerca
-- ---------------------------------------------------------------------
create table public.sites (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  name          text not null,
  address       text,
  lat           double precision not null check (lat between -90 and 90),
  lng           double precision not null check (lng between -180 and 180),
  radius_m      integer not null default 150 check (radius_m between 20 and 5000),
  geofence_mode public.geofence_mode not null default 'flag',
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (company_id, id)
);
create index sites_company_idx on public.sites (company_id) where active;

-- Obras asignadas a cada supervisor
create table public.supervisor_sites (
  membership_id uuid not null references public.memberships (id) on delete cascade,
  site_id       uuid not null references public.sites (id) on delete cascade,
  primary key (membership_id, site_id)
);

-- ---------------------------------------------------------------------
-- Horarios
-- ---------------------------------------------------------------------
create table public.schedules (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies (id) on delete cascade,
  name           text not null,
  start_time     time not null,
  end_time       time not null,                       -- si end < start, cruza medianoche
  weekdays       smallint[] not null default '{1,2,3,4,5,6}', -- ISO: 1 = lunes
  break_minutes  smallint not null default 60 check (break_minutes between 0 and 240),
  tolerance_minutes smallint not null default 10 check (tolerance_minutes between 0 and 120),
  created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Trabajadores
-- ---------------------------------------------------------------------
create table public.employees (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  user_id          uuid unique references auth.users (id) on delete set null,
  employee_number  text not null,
  full_name        text not null,
  phone            text,
  curp             text,
  position         text,
  schedule_id      uuid references public.schedules (id) on delete set null,
  default_site_id  uuid references public.sites (id) on delete set null,
  -- El cliente declara que obtuvo el consentimiento por escrito del trabajador
  consent_confirmed_at timestamptz,
  consent_confirmed_by uuid references auth.users (id),
  active           boolean not null default true,
  hired_at         date,
  terminated_at    date,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (company_id, employee_number)
);
create index employees_company_idx on public.employees (company_id) where active;

-- Referencia biométrica (dato sensible). Separada para restringir su lectura.
create table public.employee_faces (
  employee_id    uuid primary key references public.employees (id) on delete cascade,
  company_id     uuid not null references public.companies (id) on delete cascade,
  descriptor     real[] not null check (cardinality(descriptor) between 64 and 2048),
  photo_path     text not null,               -- llave en R2
  model_version  text not null,
  enrolled_at    timestamptz not null default now(),
  approved_at    timestamptz,                 -- un admin revisa la foto de alta
  approved_by    uuid references auth.users (id)
);

-- ---------------------------------------------------------------------
-- Checadas (inalterables, encadenadas por hash)
-- ---------------------------------------------------------------------
create table public.punches (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id),
  employee_id     uuid not null references public.employees (id),
  site_id         uuid references public.sites (id),
  kind            public.punch_kind not null,
  server_ts       timestamptz not null default now(),   -- hora oficial
  device_ts       timestamptz,                          -- hora del teléfono (referencia)
  captured_offline boolean not null default false,
  lat             double precision,
  lng             double precision,
  accuracy_m      real,
  distance_m      real,                                 -- a la obra más cercana
  inside_geofence boolean,
  face_score      real,                                 -- similitud 0..1 calculada en el navegador
  face_matched    boolean,
  liveness_passed boolean,
  antispoof_score real,
  model_version   text,
  selfie_path     text,                                 -- llave en R2
  flags           text[] not null default '{}',
  device_info     jsonb not null default '{}',
  client_uuid     uuid not null,                        -- idempotencia para la cola sin conexión
  seq             bigint not null default 0,            -- consecutivo por empresa (lo fija el trigger)
  prev_hash       text not null default '',
  hash            text not null default '',
  created_by      uuid references auth.users (id),
  unique (company_id, client_uuid),
  unique (company_id, seq)
);
create index punches_employee_ts_idx on public.punches (employee_id, server_ts desc);
create index punches_company_ts_idx  on public.punches (company_id, server_ts desc);
create index punches_site_ts_idx     on public.punches (site_id, server_ts desc);

-- Correcciones: nunca se edita la checada original
create table public.punch_corrections (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies (id),
  employee_id    uuid not null references public.employees (id),
  punch_id       uuid references public.punches (id),   -- null cuando action = 'add'
  action         public.correction_action not null,
  kind           public.punch_kind,                     -- para 'add'
  corrected_ts   timestamptz,                           -- para 'add' y 'adjust_time'
  reason         text not null check (length(trim(reason)) >= 5),
  made_by        uuid not null references auth.users (id),
  made_at        timestamptz not null default now(),
  check (
    (action = 'add'         and punch_id is null     and kind is not null and corrected_ts is not null) or
    (action = 'void'        and punch_id is not null and corrected_ts is null) or
    (action = 'adjust_time' and punch_id is not null and corrected_ts is not null)
  )
);
create index punch_corrections_employee_idx on public.punch_corrections (employee_id, made_at desc);

-- Conformidad del trabajador con su resumen semanal (respalda la "prueba plena")
create table public.week_acknowledgments (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id),
  employee_id     uuid not null references public.employees (id),
  week_start      date not null,                    -- lunes
  worked_minutes  integer not null check (worked_minutes >= 0),
  overtime_minutes integer not null default 0 check (overtime_minutes >= 0),
  summary_hash    text not null,                    -- hash del resumen que el trabajador vio
  acknowledged_at timestamptz not null default now(),
  device_info     jsonb not null default '{}',
  unique (employee_id, week_start)
);

-- Bitácora general de acciones administrativas
create table public.audit_log (
  id         bigint generated always as identity primary key,
  company_id uuid references public.companies (id),
  actor_id   uuid references auth.users (id),
  action     text not null,
  entity     text not null,
  entity_id  uuid,
  details    jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_log_company_idx on public.audit_log (company_id, created_at desc);

-- =====================================================================
-- Funciones auxiliares de permisos (SECURITY DEFINER para evitar
-- recursión de RLS al consultar memberships)
-- =====================================================================
create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid());
$$;

create or replace function public.has_role(p_company uuid, p_roles public.member_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.memberships m
    where m.company_id = p_company and m.user_id = auth.uid()
      and m.active and m.role = any (p_roles)
  );
$$;

create or replace function public.is_member(p_company uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(p_company, array['owner','admin','supervisor','worker']::public.member_role[]);
$$;

create or replace function public.is_manager(p_company uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(p_company, array['owner','admin']::public.member_role[]);
$$;

-- ¿El supervisor actual tiene asignada esta obra?
create or replace function public.supervises_site(p_site uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.supervisor_sites ss
    join public.memberships m on m.id = ss.membership_id
    where ss.site_id = p_site and m.user_id = auth.uid() and m.active and m.role = 'supervisor'
  );
$$;

create or replace function public.my_employee_id(p_company uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select e.id from public.employees e where e.company_id = p_company and e.user_id = auth.uid();
$$;

-- =====================================================================
-- Inalterabilidad y cadena de hashes de checadas
-- =====================================================================
create or replace function public.punch_canonical(p public.punches)
returns text language sql stable as $$
  select concat_ws('|',
    p.company_id::text,
    p.seq::text,
    p.employee_id::text,
    coalesce(p.site_id::text, ''),
    p.kind::text,
    to_char(p.server_ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    coalesce(p.lat::text, ''),
    coalesce(p.lng::text, ''),
    coalesce(p.accuracy_m::text, ''),
    coalesce(p.face_score::text, ''),
    coalesce(p.liveness_passed::text, ''),
    coalesce(p.selfie_path, ''),
    p.client_uuid::text,
    p.prev_hash
  );
$$;

create or replace function public.punches_before_insert()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare
  v_last record;
begin
  -- Serializa las inserciones por empresa para mantener la cadena íntegra
  perform pg_advisory_xact_lock(hashtextextended(new.company_id::text, 0));

  -- La hora oficial siempre es la del servidor
  new.server_ts := now();

  -- El trabajador debe pertenecer a la empresa
  if not exists (select 1 from employees e where e.id = new.employee_id and e.company_id = new.company_id) then
    raise exception 'El trabajador no pertenece a la empresa' using errcode = '23514';
  end if;
  if new.site_id is not null and not exists (select 1 from sites s where s.id = new.site_id and s.company_id = new.company_id) then
    raise exception 'La obra no pertenece a la empresa' using errcode = '23514';
  end if;

  select p.seq, p.hash into v_last
  from punches p where p.company_id = new.company_id
  order by p.seq desc limit 1;

  new.seq       := coalesce(v_last.seq, 0) + 1;
  new.prev_hash := coalesce(v_last.hash, 'GENESIS');
  new.hash      := encode(extensions.digest(public.punch_canonical(new), 'sha256'), 'hex');
  return new;
end;
$$;

create trigger punches_before_insert
before insert on public.punches
for each row execute function public.punches_before_insert();

create or replace function public.forbid_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'Los registros de % son inalterables; use punch_corrections', tg_table_name
    using errcode = '42501';
end;
$$;

create trigger punches_no_update before update on public.punches
for each row execute function public.forbid_mutation();
create trigger punches_no_delete before delete on public.punches
for each row execute function public.forbid_mutation();
create trigger corrections_no_update before update on public.punch_corrections
for each row execute function public.forbid_mutation();
create trigger corrections_no_delete before delete on public.punch_corrections
for each row execute function public.forbid_mutation();
create trigger acknowledgments_no_update before update on public.week_acknowledgments
for each row execute function public.forbid_mutation();
create trigger acknowledgments_no_delete before delete on public.week_acknowledgments
for each row execute function public.forbid_mutation();

-- Verifica la cadena completa de una empresa. Devuelve las checadas con problema.
create or replace function public.verify_punch_chain(p_company uuid)
returns table (seq bigint, punch_id uuid, problem text)
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  r public.punches;
  v_prev text := 'GENESIS';
  v_expected_seq bigint := 1;
begin
  if not (public.is_manager(p_company) or public.is_platform_admin() or auth.uid() is null) then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  for r in select * from punches p where p.company_id = p_company order by p.seq loop
    if r.seq <> v_expected_seq then
      seq := r.seq; punch_id := r.id; problem := 'Consecutivo faltante antes de este registro'; return next;
    end if;
    if r.prev_hash <> v_prev then
      seq := r.seq; punch_id := r.id; problem := 'prev_hash no coincide con el registro anterior'; return next;
    end if;
    if r.hash <> encode(extensions.digest(public.punch_canonical(r), 'sha256'), 'hex') then
      seq := r.seq; punch_id := r.id; problem := 'El contenido no coincide con su hash'; return next;
    end if;
    v_prev := r.hash;
    v_expected_seq := r.seq + 1;
  end loop;
end;
$$;

-- Validación de correcciones: pertenencia a la empresa
create or replace function public.corrections_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.made_at := now();
  if not exists (select 1 from employees e where e.id = new.employee_id and e.company_id = new.company_id) then
    raise exception 'El trabajador no pertenece a la empresa' using errcode = '23514';
  end if;
  if new.punch_id is not null and not exists (
    select 1 from punches p where p.id = new.punch_id and p.employee_id = new.employee_id
  ) then
    raise exception 'La checada no corresponde al trabajador' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger corrections_before_insert
before insert on public.punch_corrections
for each row execute function public.corrections_before_insert();

-- Bitácora automática de correcciones
create or replace function public.log_correction()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log (company_id, actor_id, action, entity, entity_id, details)
  values (new.company_id, new.made_by, 'correction.' || new.action, 'punch_corrections', new.id,
          jsonb_build_object('punch_id', new.punch_id, 'reason', new.reason, 'corrected_ts', new.corrected_ts));
  return new;
end;
$$;

create trigger corrections_audit after insert on public.punch_corrections
for each row execute function public.log_correction();

-- updated_at
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;
create trigger companies_touch before update on public.companies
for each row execute function public.touch_updated_at();
create trigger employees_touch before update on public.employees
for each row execute function public.touch_updated_at();

-- =====================================================================
-- Vista de checadas efectivas (originales + correcciones)
-- =====================================================================
create or replace view public.effective_punches
with (security_invoker = true) as
  -- Una checada capturada sin conexión cuenta a la hora en que ocurrió en el
  -- teléfono (device_ts), siempre que no sea posterior a su llegada al servidor.
  -- Esas checadas llevan la bandera 'captured_offline' para revisión.
  select p.id, p.company_id, p.employee_id, p.site_id, p.kind,
         coalesce(
           adj.corrected_ts,
           case when p.captured_offline and p.device_ts is not null and p.device_ts <= p.server_ts
                then p.device_ts else p.server_ts end
         ) as ts,
         p.server_ts as original_ts,
         case when adj.id is not null then 'adjusted' else 'original' end as source,
         p.flags, p.inside_geofence, p.face_matched, p.liveness_passed, p.captured_offline
  from public.punches p
  left join lateral (
    select c.id, c.corrected_ts from public.punch_corrections c
    where c.punch_id = p.id and c.action = 'adjust_time'
    order by c.made_at desc limit 1
  ) adj on true
  where not exists (
    select 1 from public.punch_corrections v where v.punch_id = p.id and v.action = 'void'
  )
union all
  select c.id, c.company_id, c.employee_id, null::uuid, c.kind,
         c.corrected_ts, null::timestamptz, 'manual', '{}'::text[], null, null, null, false
  from public.punch_corrections c
  where c.action = 'add';

-- =====================================================================
-- Seguridad por fila (RLS)
-- Las checadas se insertan solo desde la API (service role), que valida
-- geocerca, identidad y secuencia antes de escribir.
-- =====================================================================
alter table public.platform_admins      enable row level security;
alter table public.companies            enable row level security;
alter table public.memberships          enable row level security;
alter table public.sites                enable row level security;
alter table public.supervisor_sites     enable row level security;
alter table public.schedules            enable row level security;
alter table public.employees            enable row level security;
alter table public.employee_faces       enable row level security;
alter table public.punches              enable row level security;
alter table public.punch_corrections    enable row level security;
alter table public.week_acknowledgments enable row level security;
alter table public.audit_log            enable row level security;

create policy platform_admins_self on public.platform_admins
  for select using (user_id = auth.uid());

-- Empresas
create policy companies_select on public.companies
  for select using (public.is_member(id) or public.is_platform_admin());
create policy companies_update on public.companies
  for update using (public.has_role(id, array['owner']::public.member_role[]) or public.is_platform_admin());

-- Membresías: cada quien ve la suya; dueños y admins ven las de su empresa
create policy memberships_select on public.memberships
  for select using (user_id = auth.uid() or public.is_manager(company_id) or public.is_platform_admin());
create policy memberships_write on public.memberships
  for all using (public.has_role(company_id, array['owner']::public.member_role[]) or public.is_platform_admin())
  with check (public.has_role(company_id, array['owner']::public.member_role[]) or public.is_platform_admin());

-- Obras: cualquier miembro las ve (el trabajador necesita su geocerca)
create policy sites_select on public.sites
  for select using (public.is_member(company_id) or public.is_platform_admin());
create policy sites_write on public.sites
  for all using (public.is_manager(company_id)) with check (public.is_manager(company_id));

create policy supervisor_sites_select on public.supervisor_sites
  for select using (exists (
    select 1 from public.memberships m where m.id = membership_id
      and (m.user_id = auth.uid() or public.is_manager(m.company_id))
  ));
create policy supervisor_sites_write on public.supervisor_sites
  for all using (exists (select 1 from public.memberships m where m.id = membership_id and public.is_manager(m.company_id)))
  with check (exists (select 1 from public.memberships m where m.id = membership_id and public.is_manager(m.company_id)));

-- Horarios
create policy schedules_select on public.schedules
  for select using (public.is_member(company_id));
create policy schedules_write on public.schedules
  for all using (public.is_manager(company_id)) with check (public.is_manager(company_id));

-- Trabajadores
create policy employees_select on public.employees
  for select using (
    public.has_role(company_id, array['owner','admin','supervisor']::public.member_role[])
    or user_id = auth.uid()
    or public.is_platform_admin()
  );
create policy employees_write on public.employees
  for all using (public.is_manager(company_id)) with check (public.is_manager(company_id));

-- Biometría: el trabajador ve la suya; dueños y admins las de su empresa
create policy employee_faces_select on public.employee_faces
  for select using (
    public.is_manager(company_id)
    or employee_id = public.my_employee_id(company_id)
  );
create policy employee_faces_approve on public.employee_faces
  for update using (public.is_manager(company_id)) with check (public.is_manager(company_id));

-- Checadas: lectura según rol; inserción solo por la API
create policy punches_select on public.punches
  for select using (
    public.is_manager(company_id)
    or (public.has_role(company_id, array['supervisor']::public.member_role[]) and public.supervises_site(site_id))
    or employee_id = public.my_employee_id(company_id)
    or public.is_platform_admin()
  );

-- Correcciones: dueños y admins las crean; lectura igual que checadas
create policy corrections_select on public.punch_corrections
  for select using (
    public.is_manager(company_id)
    or employee_id = public.my_employee_id(company_id)
    or public.is_platform_admin()
  );
create policy corrections_insert on public.punch_corrections
  for insert with check (public.is_manager(company_id) and made_by = auth.uid());

-- Conformidad semanal: el trabajador la firma; managers la consultan
create policy acknowledgments_select on public.week_acknowledgments
  for select using (public.is_manager(company_id) or employee_id = public.my_employee_id(company_id));
create policy acknowledgments_insert on public.week_acknowledgments
  for insert with check (employee_id = public.my_employee_id(company_id));

-- Bitácora: solo lectura para dueños y admins
create policy audit_log_select on public.audit_log
  for select using (public.is_manager(company_id) or public.is_platform_admin());

-- Permisos base de Supabase
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on public.effective_punches to authenticated;
revoke all on public.punches from anon;
revoke insert, update, delete on public.punches from authenticated;
revoke update, delete on public.punch_corrections, public.week_acknowledgments, public.audit_log from authenticated;

-- El dueño puede editar datos de su empresa, pero no su plan, estado, límites ni código
revoke insert, update, delete on public.companies from authenticated;
grant update (name, legal_name, rfc, timezone, weekly_hour_limit, face_match_threshold, selfie_retention_days, whatsapp_support)
  on public.companies to authenticated;
-- La biometría solo la inserta o borra la API; los admins solo pueden aprobarla
revoke insert, delete on public.employee_faces from authenticated;
revoke update on public.employee_faces from authenticated;
grant update (approved_at, approved_by) on public.employee_faces to authenticated;
-- Plataforma y bitácora: solo lectura para usuarios
revoke insert, update, delete on public.platform_admins, public.audit_log from authenticated;

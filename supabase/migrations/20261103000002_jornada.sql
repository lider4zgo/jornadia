-- =====================================================================
-- Korporia · Módulo Jornada (esquema jornada)
-- Registro electrónico de jornada (LFT art. 132 fr. XXXIV, vigente 2027)
--
-- Principios:
--   * Solo depende de core (empresas, colaboradores, obras, permisos).
--   * Las checadas (punches) son INALTERABLES: no se permite UPDATE ni
--     DELETE. Las correcciones se registran aparte, con motivo y autor.
--   * Cada checada guarda el hash de la anterior de su empresa, formando
--     una cadena verificable (jornada.verify_punch_chain).
--   * La hora oficial es la del servidor (server_ts = now()).
-- =====================================================================

create schema if not exists jornada;

create type jornada.punch_kind        as enum ('in', 'break_start', 'break_end', 'out');
create type jornada.correction_action as enum ('add', 'void', 'adjust_time');

-- ---------------------------------------------------------------------
-- Ajustes del módulo por empresa (se crean al contratar el módulo)
-- ---------------------------------------------------------------------
create table jornada.settings (
  company_id            uuid primary key references core.companies (id) on delete cascade,
  -- Tope semanal (LFT: 46 h en 2027, bajando a 40 h en 2030)
  weekly_hour_limit     numeric(4,1) not null default 46 check (weekly_hour_limit between 1 and 72),
  -- Umbral mínimo de similitud facial aceptado (0..1)
  face_match_threshold  numeric(3,2) not null default 0.55 check (face_match_threshold between 0 and 1),
  -- Días que se conservan las selfies antes de borrarlas (los registros se conservan siempre)
  selfie_retention_days integer not null default 365 check (selfie_retention_days >= 30),
  -- Registrar inicio y fin de comida es opcional; si está apagado no se muestra al colaborador
  track_breaks          boolean not null default false,
  updated_at            timestamptz not null default now()
);

create or replace function jornada.ensure_settings()
returns trigger language plpgsql security definer set search_path = jornada as $$
begin
  insert into jornada.settings (company_id) values (new.company_id) on conflict do nothing;
  return new;
end;
$$;
create trigger jornada_settings_on_activate after insert on core.company_modules
for each row when (new.module_key = 'jornada') execute function jornada.ensure_settings();

create trigger settings_touch before update on jornada.settings
for each row execute function core.touch_updated_at();

-- ---------------------------------------------------------------------
-- Horarios
-- ---------------------------------------------------------------------
create table jornada.schedules (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references core.companies (id) on delete cascade,
  name              text not null,
  start_time        time not null,
  end_time          time not null,                          -- si end < start, cruza medianoche
  weekdays          smallint[] not null default '{1,2,3,4,5,6}', -- ISO: 1 = lunes
  break_minutes     smallint not null default 60 check (break_minutes between 0 and 240),
  tolerance_minutes smallint not null default 10 check (tolerance_minutes between 0 and 120),
  created_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Datos del colaborador propios de este módulo
-- ---------------------------------------------------------------------
create table jornada.employee_settings (
  employee_id          uuid primary key references core.employees (id) on delete cascade,
  company_id           uuid not null references core.companies (id) on delete cascade,
  schedule_id          uuid references jornada.schedules (id) on delete set null,
  -- El cliente declara que obtuvo el consentimiento por escrito para la biometría
  consent_confirmed_at timestamptz,
  consent_confirmed_by uuid references auth.users (id),
  -- Fecha de la foto de registro (visible para supervisores sin exponer la biometría)
  face_enrolled_at     timestamptz,
  foreign key (company_id, employee_id) references core.employees (company_id, id) on delete cascade
);

-- Referencia biométrica (dato sensible). Separada para restringir su lectura.
-- La toma un supervisor o administrador EN PERSONA frente al colaborador.
create table jornada.faces (
  employee_id   uuid primary key references core.employees (id) on delete cascade,
  company_id    uuid not null references core.companies (id) on delete cascade,
  descriptor    real[] not null check (cardinality(descriptor) between 64 and 2048),
  photo_path    text not null,               -- llave en R2
  model_version text not null,
  enrolled_at   timestamptz not null default now(),
  enrolled_by   uuid references auth.users (id),
  approved_at   timestamptz,
  approved_by   uuid references auth.users (id),
  foreign key (company_id, employee_id) references core.employees (company_id, id) on delete cascade
);

-- ---------------------------------------------------------------------
-- Checadas (inalterables, encadenadas por hash)
-- ---------------------------------------------------------------------
create table jornada.punches (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references core.companies (id),
  employee_id      uuid not null references core.employees (id),
  site_id          uuid references core.sites (id),
  kind             jornada.punch_kind not null,
  server_ts        timestamptz not null default now(),   -- hora oficial
  device_ts        timestamptz,                          -- hora del teléfono (referencia)
  captured_offline boolean not null default false,
  lat              double precision,
  lng              double precision,
  accuracy_m       real,
  distance_m       real,                                 -- a la obra más cercana
  inside_geofence  boolean,
  face_score       real,                                 -- similitud 0..1 calculada en el navegador
  face_matched     boolean,
  liveness_passed  boolean,
  antispoof_score  real,
  model_version    text,
  selfie_path      text,                                 -- llave en R2
  flags            text[] not null default '{}',
  device_info      jsonb not null default '{}',
  client_uuid      uuid not null,                        -- idempotencia para la cola sin conexión
  seq              bigint not null default 0,            -- consecutivo por empresa (lo fija el trigger)
  prev_hash        text not null default '',
  hash             text not null default '',
  created_by       uuid references auth.users (id),
  unique (company_id, client_uuid),
  unique (company_id, seq)
);
create index punches_employee_ts_idx on jornada.punches (employee_id, server_ts desc);
create index punches_company_ts_idx  on jornada.punches (company_id, server_ts desc);
create index punches_site_ts_idx     on jornada.punches (site_id, server_ts desc);

-- Correcciones: nunca se edita la checada original
create table jornada.punch_corrections (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references core.companies (id),
  employee_id  uuid not null references core.employees (id),
  punch_id     uuid references jornada.punches (id),   -- null cuando action = 'add'
  action       jornada.correction_action not null,
  kind         jornada.punch_kind,                     -- para 'add'
  corrected_ts timestamptz,                            -- para 'add' y 'adjust_time'
  reason       text not null check (length(trim(reason)) >= 5),
  made_by      uuid not null references auth.users (id),
  made_at      timestamptz not null default now(),
  check (
    (action = 'add'         and punch_id is null     and kind is not null and corrected_ts is not null) or
    (action = 'void'        and punch_id is not null and corrected_ts is null) or
    (action = 'adjust_time' and punch_id is not null and corrected_ts is not null)
  )
);
create index punch_corrections_employee_idx on jornada.punch_corrections (employee_id, made_at desc);

-- Conformidad del colaborador con su resumen semanal (respalda la "prueba plena")
create table jornada.week_acknowledgments (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references core.companies (id),
  employee_id      uuid not null references core.employees (id),
  week_start       date not null,                    -- lunes
  worked_minutes   integer not null check (worked_minutes >= 0),
  overtime_minutes integer not null default 0 check (overtime_minutes >= 0),
  summary_hash     text not null,                    -- hash del resumen que el colaborador vio
  acknowledged_at  timestamptz not null default now(),
  device_info      jsonb not null default '{}',
  unique (employee_id, week_start)
);

-- =====================================================================
-- Inalterabilidad y cadena de hashes de checadas
-- =====================================================================
create or replace function jornada.punch_canonical(p jornada.punches)
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

create or replace function jornada.punches_before_insert()
returns trigger language plpgsql security definer set search_path = jornada, core, extensions as $$
declare
  v_last record;
begin
  -- Serializa las inserciones por empresa para mantener la cadena íntegra
  perform pg_advisory_xact_lock(hashtextextended(new.company_id::text, 0));

  -- La hora oficial siempre es la del servidor
  new.server_ts := now();

  -- El colaborador y la obra deben pertenecer a la empresa
  if not exists (select 1 from core.employees e where e.id = new.employee_id and e.company_id = new.company_id) then
    raise exception 'El colaborador no pertenece a la empresa' using errcode = '23514';
  end if;
  if new.site_id is not null and not exists (select 1 from core.sites s where s.id = new.site_id and s.company_id = new.company_id) then
    raise exception 'La obra no pertenece a la empresa' using errcode = '23514';
  end if;

  select p.seq, p.hash into v_last
  from jornada.punches p where p.company_id = new.company_id
  order by p.seq desc limit 1;

  new.seq       := coalesce(v_last.seq, 0) + 1;
  new.prev_hash := coalesce(v_last.hash, 'GENESIS');
  new.hash      := encode(extensions.digest(jornada.punch_canonical(new), 'sha256'), 'hex');
  return new;
end;
$$;

create trigger punches_before_insert
before insert on jornada.punches
for each row execute function jornada.punches_before_insert();

create trigger punches_no_update before update on jornada.punches
for each row execute function core.forbid_mutation();
create trigger punches_no_delete before delete on jornada.punches
for each row execute function core.forbid_mutation();
create trigger corrections_no_update before update on jornada.punch_corrections
for each row execute function core.forbid_mutation();
create trigger corrections_no_delete before delete on jornada.punch_corrections
for each row execute function core.forbid_mutation();
create trigger acknowledgments_no_update before update on jornada.week_acknowledgments
for each row execute function core.forbid_mutation();
create trigger acknowledgments_no_delete before delete on jornada.week_acknowledgments
for each row execute function core.forbid_mutation();

-- Verifica la cadena completa de una empresa. Devuelve las checadas con problema.
create or replace function jornada.verify_punch_chain(p_company uuid)
returns table (seq bigint, punch_id uuid, problem text)
language plpgsql stable security definer set search_path = jornada, core, extensions as $$
declare
  r jornada.punches;
  v_prev text := 'GENESIS';
  v_expected_seq bigint := 1;
begin
  if not (core.can(p_company, 'jornada.cadena.verificar') or auth.uid() is null) then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  for r in select * from jornada.punches p where p.company_id = p_company order by p.seq loop
    if r.seq <> v_expected_seq then
      seq := r.seq; punch_id := r.id; problem := 'Consecutivo faltante antes de este registro'; return next;
    end if;
    if r.prev_hash <> v_prev then
      seq := r.seq; punch_id := r.id; problem := 'prev_hash no coincide con el registro anterior'; return next;
    end if;
    if r.hash <> encode(extensions.digest(jornada.punch_canonical(r), 'sha256'), 'hex') then
      seq := r.seq; punch_id := r.id; problem := 'El contenido no coincide con su hash'; return next;
    end if;
    v_prev := r.hash;
    v_expected_seq := r.seq + 1;
  end loop;
end;
$$;

-- Validación de correcciones: pertenencia a la empresa
create or replace function jornada.corrections_before_insert()
returns trigger language plpgsql security definer set search_path = jornada, core as $$
begin
  new.made_at := now();
  if not exists (select 1 from core.employees e where e.id = new.employee_id and e.company_id = new.company_id) then
    raise exception 'El colaborador no pertenece a la empresa' using errcode = '23514';
  end if;
  if new.punch_id is not null and not exists (
    select 1 from jornada.punches p where p.id = new.punch_id and p.employee_id = new.employee_id
  ) then
    raise exception 'La checada no corresponde al colaborador' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger corrections_before_insert
before insert on jornada.punch_corrections
for each row execute function jornada.corrections_before_insert();

-- Bitácora automática de correcciones
create or replace function jornada.log_correction()
returns trigger language plpgsql security definer set search_path = jornada, core as $$
begin
  insert into core.audit_log (company_id, actor_id, action, entity, entity_id, details)
  values (new.company_id, new.made_by, 'jornada.correction.' || new.action, 'jornada.punch_corrections', new.id,
          jsonb_build_object('punch_id', new.punch_id, 'reason', new.reason, 'corrected_ts', new.corrected_ts));
  return new;
end;
$$;

create trigger corrections_audit after insert on jornada.punch_corrections
for each row execute function jornada.log_correction();

-- =====================================================================
-- Vista de checadas efectivas (originales + correcciones)
-- =====================================================================
create or replace view jornada.effective_punches
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
  from jornada.punches p
  left join lateral (
    select c.id, c.corrected_ts from jornada.punch_corrections c
    where c.punch_id = p.id and c.action = 'adjust_time'
    order by c.made_at desc limit 1
  ) adj on true
  where not exists (
    select 1 from jornada.punch_corrections v where v.punch_id = p.id and v.action = 'void'
  )
union all
  select c.id, c.company_id, c.employee_id, null::uuid, c.kind,
         c.corrected_ts, null::timestamptz, 'manual', '{}'::text[], null, null, null, false
  from jornada.punch_corrections c
  where c.action = 'add';

-- =====================================================================
-- Seguridad por fila (RLS)
-- Las checadas y la biometría se escriben solo desde la API (service role),
-- que valida geocerca, identidad y secuencia antes de escribir.
-- =====================================================================
alter table jornada.settings             enable row level security;
alter table jornada.schedules            enable row level security;
alter table jornada.employee_settings    enable row level security;
alter table jornada.faces                enable row level security;
alter table jornada.punches              enable row level security;
alter table jornada.punch_corrections    enable row level security;
alter table jornada.week_acknowledgments enable row level security;

create policy settings_select on jornada.settings
  for select using (core.is_member(company_id) or core.is_platform_admin());
create policy settings_update on jornada.settings
  for update using (core.can(company_id, 'jornada.configurar')) with check (core.can(company_id, 'jornada.configurar'));

create policy schedules_select on jornada.schedules
  for select using (core.is_member(company_id));
create policy schedules_write on jornada.schedules
  for all using (core.can(company_id, 'jornada.configurar')) with check (core.can(company_id, 'jornada.configurar'));

create policy employee_settings_select on jornada.employee_settings
  for select using (core.can(company_id, 'core.personal.ver') or employee_id = core.my_employee_id(company_id));

-- Biometría: el colaborador ve la suya; quien ve toda la asistencia, las de su empresa
create policy faces_select on jornada.faces
  for select using (
    core.can(company_id, 'jornada.asistencia.ver')
    or employee_id = core.my_employee_id(company_id)
  );

-- Checadas: toda la empresa, solo las obras asignadas o solo las propias.
-- Las propias siempre se pueden consultar (derecho del colaborador a sus registros).
create policy punches_select on jornada.punches
  for select using (
    core.can(company_id, 'jornada.asistencia.ver')
    or (core.can(company_id, 'jornada.asistencia.ver_asignadas') and core.assigned_to_site(site_id))
    or employee_id = core.my_employee_id(company_id)
  );

create policy corrections_select on jornada.punch_corrections
  for select using (
    core.can(company_id, 'jornada.asistencia.ver')
    or employee_id = core.my_employee_id(company_id)
  );
create policy corrections_insert on jornada.punch_corrections
  for insert with check (core.can(company_id, 'jornada.correcciones.crear') and made_by = auth.uid());

create policy acknowledgments_select on jornada.week_acknowledgments
  for select using (core.can(company_id, 'jornada.asistencia.ver') or employee_id = core.my_employee_id(company_id));
create policy acknowledgments_insert on jornada.week_acknowledgments
  for insert with check (employee_id = core.my_employee_id(company_id) and core.has_module(company_id, 'jornada'));

-- Permisos base de Supabase
grant usage on schema jornada to anon, authenticated, service_role;
grant select on all tables in schema jornada to authenticated;
grant all on all tables in schema jornada to service_role;

grant update (weekly_hour_limit, face_match_threshold, selfie_retention_days, track_breaks) on jornada.settings to authenticated;
grant insert, update, delete on jornada.schedules to authenticated;
grant insert on jornada.punch_corrections, jornada.week_acknowledgments to authenticated;

-- =====================================================================
-- Segundo paso por correo para administradores (Dirección, 13 nov 2026)
--  - Acceso con correo y contraseña.
--  - Código de 6 dígitos al correo en un dispositivo o navegador nuevo, cada 30 días,
--    y antes de cambiar la contraseña o datos sensibles.
--  - Los trabajadores (código de empresa + número + PIN) no cambian.
--
-- La regla vive en la base: una sesión de administrador sin verificar no ve ni cambia
-- datos de ninguna empresa, aunque alguien use la API de Supabase directamente.
-- =====================================================================

-- Dispositivos de confianza (el navegador guarda un token aleatorio; aquí solo su hash)
create table core.trusted_devices (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  token_hash   text not null,
  label        text,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '30 days',
  unique (user_id, token_hash)
);
create index trusted_devices_user_idx on core.trusted_devices (user_id);

-- Sesiones de Supabase ya verificadas (session_id del token de acceso)
create table core.verified_sessions (
  session_id  uuid primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  device_id   uuid references core.trusted_devices (id) on delete cascade,
  verified_at timestamptz not null default now(),
  -- Último código escrito: los cambios sensibles piden uno de hace menos de 10 minutos
  step_up_at  timestamptz,
  expires_at  timestamptz not null
);
create index verified_sessions_user_idx on core.verified_sessions (user_id);

-- Códigos enviados por correo (solo el hash; vencen en 10 minutos; 5 intentos)
create table core.email_challenges (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  session_id  uuid not null,
  purpose     text not null check (purpose in ('device', 'sensitive')),
  code_hash   text not null,
  attempts    integer not null default 0,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '10 minutes',
  used_at     timestamptz
);
create index email_challenges_user_idx on core.email_challenges (user_id, created_at desc);

alter table core.trusted_devices enable row level security;
alter table core.verified_sessions enable row level security;
alter table core.email_challenges enable row level security;
-- Sin políticas: solo la API (service_role) las lee y escribe
revoke all on core.trusted_devices, core.verified_sessions, core.email_challenges from anon, authenticated;
grant all on core.trusted_devices, core.verified_sessions, core.email_challenges to service_role;

-- ---------------------------------------------------------------------
-- ¿La sesión actual puede ver datos? Trabajadores siempre; administradores con sesión verificada.
-- ---------------------------------------------------------------------
create or replace function core.session_ok()
returns boolean language sql stable security definer set search_path = core as $$
  select coalesce(auth.jwt() ->> 'email', '') like '%.trabajadores.korporia.com'
    or exists (
      select 1 from core.verified_sessions v
      where v.session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid
        and v.user_id = auth.uid()
        and v.expires_at > now()
    );
$$;
revoke execute on function core.session_ok() from public, anon;
grant execute on function core.session_ok() to authenticated, service_role;

create or replace function core.is_platform_admin()
returns boolean language sql stable security definer set search_path = core as $$
  select exists (select 1 from core.platform_admins where user_id = auth.uid()) and core.session_ok();
$$;

create or replace function core.is_member(p_company uuid)
returns boolean language sql stable security definer set search_path = core as $$
  select exists (
    select 1 from core.memberships m
    where m.company_id = p_company and m.user_id = auth.uid() and m.active
  ) and core.session_ok();
$$;

create or replace function core.assigned_to_site(p_site uuid)
returns boolean language sql stable security definer set search_path = core as $$
  select exists (
    select 1 from core.membership_sites ms
    join core.memberships m on m.id = ms.membership_id
    where ms.site_id = p_site and m.user_id = auth.uid() and m.active
  ) and core.session_ok();
$$;

create or replace function core.can(p_company uuid, p_permission text)
returns boolean language sql stable security definer set search_path = core as $$
  select core.is_platform_admin() or (
    core.session_ok()
    and exists (
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

-- Limpieza diaria: códigos usados o vencidos y sesiones vencidas
create or replace function core.purge_auth_records()
returns jsonb language plpgsql security definer set search_path = core as $$
declare v_codes integer; v_sessions integer; v_devices integer;
begin
  delete from core.email_challenges where expires_at < now() - interval '1 day';
  get diagnostics v_codes = row_count;
  delete from core.verified_sessions where expires_at < now();
  get diagnostics v_sessions = row_count;
  delete from core.trusted_devices where expires_at < now() - interval '30 days';
  get diagnostics v_devices = row_count;
  return jsonb_build_object('codes', v_codes, 'sessions', v_sessions, 'devices', v_devices);
end;
$$;
revoke execute on function core.purge_auth_records() from public, anon, authenticated;
grant execute on function core.purge_auth_records() to service_role;

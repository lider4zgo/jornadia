-- =====================================================================
-- Perfil del usuario y datos completos de la empresa (Erik, 13 nov 2026)
-- El registro pide solo correo y contraseña; al entrar, nombre de la empresa, RFC y
-- número de empleados. Lo demás se completa después en estos perfiles.
-- =====================================================================

-- Perfil del usuario (administradores; los trabajadores tienen su expediente en rh)
create table core.user_profiles (
  user_id            uuid primary key references auth.users (id) on delete cascade,
  first_names        text check (length(first_names) <= 80),
  last_name_paternal text check (length(last_name_paternal) <= 60),
  last_name_maternal text check (length(last_name_maternal) <= 60),
  birth_date         date check (birth_date between '1900-01-01' and current_date),
  mobile             text check (mobile ~ '^\+?\d{10,15}$'),
  position_title     text check (length(position_title) <= 80),
  updated_at         timestamptz not null default now()
);
alter table core.user_profiles enable row level security;
-- Cada quien ve el suyo (sesión verificada); los cambios van por la API
create policy user_profiles_self on core.user_profiles for select using (user_id = auth.uid() and core.session_ok());
revoke all on core.user_profiles from anon, authenticated;
grant select on core.user_profiles to authenticated;
grant all on core.user_profiles to service_role;

-- Domicilio fiscal por partes y teléfono de la empresa (address queda armado para el aviso)
alter table core.companies
  add column street        text check (length(street) <= 160),
  add column neighborhood  text check (length(neighborhood) <= 100),
  add column postal_code   text check (postal_code ~ '^\d{5}$'),
  add column city          text check (length(city) <= 100),
  add column company_phone text check (company_phone ~ '^\+?\d{10,15}$');

-- Puestos y giros que escribe cada empresa cuando no están en la lista
alter table core.companies
  add column custom_positions  text[] not null default '{}',
  add column custom_industries text[] not null default '{}';

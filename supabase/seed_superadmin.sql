-- Ejecuta esto UNA vez en Supabase → SQL Editor, después de crear tu usuario
-- en Authentication → Users ("Add user", con tu correo y contraseña).
-- Te convierte en administrador de la plataforma (puedes crear empresas cliente).

insert into public.platform_admins (user_id)
select id from auth.users where email = 'TU-CORREO@ejemplo.com'
on conflict do nothing;

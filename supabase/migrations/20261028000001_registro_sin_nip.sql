-- =====================================================================
-- Jornadia · Entrada del trabajador sin NIP y foto de registro en presencia
--
-- El trabajador entra con código de empresa + número de empleado y confirma
-- su nombre. Su identidad la garantiza la selfie de cada checada, comparada
-- con una foto de registro que SOLO puede tomar un supervisor o administrador
-- frente a la persona.
-- =====================================================================

-- Fecha en que se registró la foto (visible para supervisores sin exponer la biometría)
alter table public.employees add column if not exists face_enrolled_at timestamptz;

update public.employees e
set face_enrolled_at = f.enrolled_at
from public.employee_faces f
where f.employee_id = e.id and e.face_enrolled_at is null;

-- Quién tomó la foto de registro
alter table public.employee_faces add column if not exists enrolled_by uuid references auth.users (id);

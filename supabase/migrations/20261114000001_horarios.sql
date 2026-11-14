-- JOR-10: horarios con horas por día (Erik, 14 nov 2026).
-- days = [{ "weekday": 1, "start": "09:00", "end": "18:00", "breakMinutes": 60 }, …]
-- Los límites de la LFT solo se avisan; el horario no bloquea la checada.

alter table jornada.schedules
  add column days       jsonb not null default '[]'::jsonb check (jsonb_typeof(days) = 'array'),
  add column active     boolean not null default true,
  add column updated_at timestamptz not null default now(),
  alter column start_time drop not null,
  alter column end_time drop not null,
  add constraint schedules_name_check check (length(trim(name)) > 0);

-- Horarios previos (mismas horas para los días marcados) al nuevo formato
update jornada.schedules s
set days = coalesce((
  select jsonb_agg(jsonb_build_object(
           'weekday', w,
           'start', to_char(s.start_time, 'HH24:MI'),
           'end', to_char(s.end_time, 'HH24:MI'),
           'breakMinutes', s.break_minutes) order by w)
  from unnest(s.weekdays) as w
), '[]'::jsonb)
where s.days = '[]'::jsonb and s.start_time is not null and s.end_time is not null;

create unique index schedules_name_idx on jornada.schedules (company_id, lower(name)) where active;
create unique index if not exists schedules_company_id_idx on jornada.schedules (company_id, id);

create trigger schedules_touch before update on jornada.schedules
for each row execute function core.touch_updated_at();

-- Un colaborador solo puede tener un horario de su misma empresa
create or replace function jornada.check_schedule_company()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.schedule_id is not null and not exists (
    select 1 from jornada.schedules s where s.id = new.schedule_id and s.company_id = new.company_id
  ) then
    raise exception 'El horario no pertenece a la empresa' using errcode = '23503';
  end if;
  return new;
end;
$$;

create trigger employee_settings_schedule_company
before insert or update of schedule_id on jornada.employee_settings
for each row execute function jornada.check_schedule_company();

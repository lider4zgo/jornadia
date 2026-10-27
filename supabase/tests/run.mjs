// Pruebas del esquema con PGlite (Postgres en memoria, sin Docker).
// Simula lo mínimo de Supabase: esquema auth, auth.uid() y los roles.
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'migrations');

const db = new PGlite({ extensions: { pgcrypto } });

const SUPABASE_STUB = `
  create schema if not exists extensions;
  create schema if not exists auth;
  create table auth.users (id uuid primary key, email text);
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  end $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
`;

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}\n      ${err.message}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
async function expectError(promise, fragment) {
  try {
    await promise;
  } catch (err) {
    if (fragment && !String(err.message).includes(fragment)) {
      throw new Error(`Error inesperado: ${err.message}`);
    }
    return;
  }
  throw new Error('Se esperaba un error y no ocurrió');
}

// Ejecuta como usuario autenticado (RLS activo)
async function asUser(userId, sql, params = []) {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role authenticated`);
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId]);
    return tx.query(sql, params);
  });
}

const ids = {
  companyA: '00000000-0000-0000-0000-00000000000a',
  companyB: '00000000-0000-0000-0000-00000000000b',
  owner: '10000000-0000-0000-0000-000000000001',
  supervisor: '10000000-0000-0000-0000-000000000002',
  worker1: '10000000-0000-0000-0000-000000000003',
  worker2: '10000000-0000-0000-0000-000000000004',
  ownerB: '10000000-0000-0000-0000-000000000005',
  siteNorte: '20000000-0000-0000-0000-000000000001',
  siteSur: '20000000-0000-0000-0000-000000000002',
  emp1: '30000000-0000-0000-0000-000000000001',
  emp2: '30000000-0000-0000-0000-000000000002',
};

async function insertPunch({ employee, site, kind, client }) {
  const { rows } = await db.query(
    `insert into public.punches (company_id, employee_id, site_id, kind, lat, lng, accuracy_m, client_uuid, server_ts)
     values ($1, $2, $3, $4, 25.54, -103.41, 12, $5, '2000-01-01')
     returning *`,
    [ids.companyA, employee, site, kind, client],
  );
  return rows[0];
}

console.log('\nEsquema Jornadia');

await test('aplica las migraciones', async () => {
  await db.exec(SUPABASE_STUB);
  for (const file of readdirSync(migrationsDir).sort()) {
    await db.exec(readFileSync(join(migrationsDir, file), 'utf8'));
  }
});

await test('carga datos de prueba', async () => {
  await db.exec(`
    insert into auth.users (id) values
      ('${ids.owner}'), ('${ids.supervisor}'), ('${ids.worker1}'), ('${ids.worker2}'), ('${ids.ownerB}');
    insert into public.companies (id, name, code) values ('${ids.companyA}', 'Eléctrica Laguna', 'elaguna'), ('${ids.companyB}', 'Otra Empresa', 'otra');
    insert into public.memberships (company_id, user_id, role) values
      ('${ids.companyA}', '${ids.owner}', 'owner'),
      ('${ids.companyA}', '${ids.supervisor}', 'supervisor'),
      ('${ids.companyA}', '${ids.worker1}', 'worker'),
      ('${ids.companyA}', '${ids.worker2}', 'worker'),
      ('${ids.companyB}', '${ids.ownerB}', 'owner');
    insert into public.sites (id, company_id, name, lat, lng) values
      ('${ids.siteNorte}', '${ids.companyA}', 'Obra Norte', 25.5428, -103.4068),
      ('${ids.siteSur}',   '${ids.companyA}', 'Obra Sur',   25.5100, -103.3900);
    insert into public.supervisor_sites (membership_id, site_id)
      select id, '${ids.siteNorte}' from public.memberships where user_id = '${ids.supervisor}';
    insert into public.employees (id, company_id, user_id, employee_number, full_name) values
      ('${ids.emp1}', '${ids.companyA}', '${ids.worker1}', '001', 'Juan Pérez'),
      ('${ids.emp2}', '${ids.companyA}', '${ids.worker2}', '002', 'Luis Gómez');
  `);
});

let first;
await test('las checadas se encadenan con consecutivo y hash', async () => {
  first = await insertPunch({ employee: ids.emp1, site: ids.siteNorte, kind: 'in', client: crypto.randomUUID() });
  const second = await insertPunch({ employee: ids.emp2, site: ids.siteSur, kind: 'in', client: crypto.randomUUID() });
  const third = await insertPunch({ employee: ids.emp1, site: ids.siteNorte, kind: 'out', client: crypto.randomUUID() });
  assert(first.seq === 1n || Number(first.seq) === 1, `seq esperado 1, fue ${first.seq}`);
  assert(first.prev_hash === 'GENESIS', 'el primer registro debe partir de GENESIS');
  assert(second.prev_hash === first.hash, 'el segundo debe apuntar al hash del primero');
  assert(third.prev_hash === second.hash, 'el tercero debe apuntar al hash del segundo');
  assert(/^[0-9a-f]{64}$/.test(first.hash), 'hash SHA-256 en hexadecimal');
});

await test('la hora oficial es la del servidor, no la enviada', async () => {
  assert(new Date(first.server_ts).getFullYear() > 2020, 'server_ts no debe aceptar la hora enviada');
});

await test('la misma checada (client_uuid) no se duplica al sincronizar', async () => {
  const client = crypto.randomUUID();
  await insertPunch({ employee: ids.emp2, site: ids.siteSur, kind: 'out', client });
  await expectError(insertPunch({ employee: ids.emp2, site: ids.siteSur, kind: 'out', client }), 'duplicate');
});

await test('no se permite editar ni borrar checadas', async () => {
  await expectError(db.query(`update public.punches set lat = 0 where id = $1`, [first.id]), 'inalterables');
  await expectError(db.query(`delete from public.punches where id = $1`, [first.id]), 'inalterables');
});

await test('rechaza un trabajador de otra empresa', async () => {
  await expectError(
    db.query(
      `insert into public.punches (company_id, employee_id, kind, client_uuid) values ($1, $2, 'in', $3)`,
      [ids.companyB, ids.emp1, crypto.randomUUID()],
    ),
    'no pertenece',
  );
});

await test('la cadena íntegra se verifica sin problemas', async () => {
  const { rows } = await db.query(`select * from public.verify_punch_chain($1)`, [ids.companyA]);
  assert(rows.length === 0, `se encontraron problemas: ${JSON.stringify(rows)}`);
});

await test('una alteración directa en la base se detecta', async () => {
  await db.exec(`
    alter table public.punches disable trigger punches_no_update;
    update public.punches set lat = 19.43 where seq = 2 and company_id = '${ids.companyA}';
    alter table public.punches enable trigger punches_no_update;
  `);
  const { rows } = await db.query(`select * from public.verify_punch_chain($1)`, [ids.companyA]);
  assert(rows.some((r) => Number(r.seq) === 2 && r.problem.includes('hash')), 'debió detectar el registro 2 alterado');
  // Restaurar para las pruebas siguientes
  await db.exec(`
    alter table public.punches disable trigger punches_no_update;
    update public.punches set lat = 25.54 where seq = 2 and company_id = '${ids.companyA}';
    alter table public.punches enable trigger punches_no_update;
  `);
});

await test('RLS: el trabajador solo ve sus propias checadas', async () => {
  const { rows } = await asUser(ids.worker1, `select employee_id from public.punches`);
  assert(rows.length === 2, `esperaba 2, vio ${rows.length}`);
  assert(rows.every((r) => r.employee_id === ids.emp1), 'vio checadas de otro trabajador');
});

await test('RLS: el supervisor solo ve las checadas de sus obras', async () => {
  const { rows } = await asUser(ids.supervisor, `select site_id from public.punches`);
  assert(rows.length === 2 && rows.every((r) => r.site_id === ids.siteNorte), `vio ${rows.length} registros o de otra obra`);
});

await test('RLS: el dueño ve todas las checadas de su empresa', async () => {
  const { rows } = await asUser(ids.owner, `select id from public.punches`);
  assert(rows.length === 4, `esperaba 4, vio ${rows.length}`);
});

await test('RLS: otra empresa no ve nada', async () => {
  const p = await asUser(ids.ownerB, `select id from public.punches`);
  const e = await asUser(ids.ownerB, `select id from public.employees`);
  assert(p.rows.length === 0 && e.rows.length === 0, 'una empresa vio datos de otra');
});

await test('RLS: un usuario no puede insertar checadas directamente', async () => {
  await expectError(
    asUser(ids.worker1, `insert into public.punches (company_id, employee_id, kind, client_uuid) values ($1, $2, 'in', $3)`, [
      ids.companyA,
      ids.emp1,
      crypto.randomUUID(),
    ]),
  );
});

await test('corrección con motivo: ajusta la hora en las checadas efectivas', async () => {
  await asUser(
    ids.owner,
    `insert into public.punch_corrections (company_id, employee_id, punch_id, action, corrected_ts, reason, made_by)
     values ($1, $2, $3, 'adjust_time', '2026-11-02T14:00:00Z', 'Olvidó checar al llegar a la obra', $4)`,
    [ids.companyA, ids.emp1, first.id, ids.owner],
  );
  const { rows } = await asUser(ids.owner, `select ts, source from public.effective_punches where id = $1`, [first.id]);
  assert(rows[0]?.source === 'adjusted', 'la checada debió aparecer como ajustada');
  const log = await asUser(ids.owner, `select action from public.audit_log`);
  assert(log.rows.some((r) => r.action === 'correction.adjust_time'), 'la corrección no quedó en bitácora');
});

await test('una corrección sin motivo suficiente se rechaza', async () => {
  await expectError(
    asUser(
      ids.owner,
      `insert into public.punch_corrections (company_id, employee_id, punch_id, action, reason, made_by)
       values ($1, $2, $3, 'void', 'x', $4)`,
      [ids.companyA, ids.emp1, first.id, ids.owner],
    ),
  );
});

await test('el trabajador no puede hacer correcciones', async () => {
  await expectError(
    asUser(
      ids.worker1,
      `insert into public.punch_corrections (company_id, employee_id, punch_id, action, reason, made_by)
       values ($1, $2, $3, 'void', 'Quiero borrar mi retardo', $4)`,
      [ids.companyA, ids.emp1, first.id, ids.worker1],
    ),
  );
});

await test('el dueño no puede cambiar su plan ni su límite de empleados', async () => {
  await expectError(asUser(ids.owner, `update public.companies set employee_limit = 9999 where id = $1`, [ids.companyA]));
  await expectError(asUser(ids.owner, `update public.companies set status = 'active' where id = $1`, [ids.companyA]));
  const ok = await asUser(ids.owner, `update public.companies set whatsapp_support = '5218710000000' where id = $1 returning id`, [ids.companyA]);
  assert(ok.rows.length === 1, 'el dueño debería poder editar los datos permitidos');
});

await test('el trabajador no puede registrar ni cambiar biometría directamente', async () => {
  await expectError(
    asUser(
      ids.worker2,
      `insert into public.employee_faces (employee_id, company_id, descriptor, photo_path, model_version)
       values ($1, $2, array_fill(0.1::real, array[128]), 'x', 'test')`,
      [ids.emp2, ids.companyA],
    ),
  );
});

await test('un usuario no puede hacerse administrador de la plataforma', async () => {
  await expectError(asUser(ids.worker1, `insert into public.platform_admins (user_id) values ($1)`, [ids.worker1]));
});

await test('la comida es opcional y el dueño puede activarla', async () => {
  const { rows } = await db.query(`select track_breaks from public.companies where id = $1`, [ids.companyA]);
  assert(rows[0].track_breaks === false, 'por defecto no se registra la comida');
  const ok = await asUser(ids.owner, `update public.companies set track_breaks = true where id = $1 returning track_breaks`, [ids.companyA]);
  assert(ok.rows[0]?.track_breaks === true, 'el dueño debería poder activarla');
});

console.log(`\n${passed} pruebas correctas, ${failed} fallidas\n`);
await db.close();
process.exit(failed ? 1 : 0);

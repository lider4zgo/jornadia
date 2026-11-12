// Pruebas del esquema con PGlite (Postgres en memoria, sin Docker).
// Simula lo mínimo de Supabase: esquema auth, auth.uid() y los roles.
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'migrations');
const catalog = JSON.parse(readFileSync(join(here, '..', '..', 'packages', 'core', 'src', 'permissions.json'), 'utf8'));

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
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
  end $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
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

// Ejecuta como la API (service role, sin usuario)
async function asService(sql, params = []) {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role service_role`);
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
  admin: '10000000-0000-0000-0000-000000000006',
  newOwner: '10000000-0000-0000-0000-000000000007',
  siteNorte: '20000000-0000-0000-0000-000000000001',
  siteSur: '20000000-0000-0000-0000-000000000002',
  emp1: '30000000-0000-0000-0000-000000000001',
  emp2: '30000000-0000-0000-0000-000000000002',
};

async function insertPunch({ employee, site, kind, client }) {
  const { rows } = await db.query(
    `insert into jornada.punches (company_id, employee_id, site_id, kind, lat, lng, accuracy_m, client_uuid, server_ts)
     values ($1, $2, $3, $4, 25.54, -103.41, 12, $5, '2000-01-01')
     returning *`,
    [ids.companyA, employee, site, kind, client],
  );
  return rows[0];
}

const role = (key) => `(select id from core.roles where company_id is null and key = '${key}')`;

console.log('\nEsquema Korporia (core + jornada)');

await test('aplica las migraciones', async () => {
  await db.exec(SUPABASE_STUB);
  for (const file of readdirSync(migrationsDir).sort()) {
    await db.exec(readFileSync(join(migrationsDir, file), 'utf8'));
  }
});

await test('el catálogo de la base coincide con permissions.json', async () => {
  const modules = (await db.query(`select key from core.modules order by key`)).rows.map((r) => r.key);
  assert(JSON.stringify(modules) === JSON.stringify(catalog.modules.map((m) => m.key).sort()), `módulos distintos: ${modules}`);
  const perms = (await db.query(`select key from core.permissions order by key`)).rows.map((r) => r.key);
  const expected = catalog.permissions.map((p) => p.key).sort();
  assert(JSON.stringify(perms) === JSON.stringify(expected), `permisos distintos:\n  base: ${perms}\n  json: ${expected}`);
  for (const r of catalog.systemRoles) {
    const got = (
      await db.query(
        `select rp.permission_key from core.role_permissions rp join core.roles ro on ro.id = rp.role_id
         where ro.company_id is null and ro.key = $1 order by 1`,
        [r.key],
      )
    ).rows.map((x) => x.permission_key);
    const want = (r.permissions === '*' ? expected : [...r.permissions]).sort();
    assert(JSON.stringify(got) === JSON.stringify(want), `rol ${r.key} distinto:\n  base: ${got}\n  json: ${want}`);
  }
});

await test('carga datos de prueba', async () => {
  await db.exec(`
    insert into auth.users (id) values
      ('${ids.owner}'), ('${ids.supervisor}'), ('${ids.worker1}'), ('${ids.worker2}'), ('${ids.ownerB}'), ('${ids.admin}'), ('${ids.newOwner}');
    insert into core.companies (id, name, code) values ('${ids.companyA}', 'Eléctrica Laguna', 'elaguna'), ('${ids.companyB}', 'Otra Empresa', 'otra');
    insert into core.subscriptions (company_id) values ('${ids.companyA}'), ('${ids.companyB}');
    insert into core.company_modules (company_id, module_key) values ('${ids.companyA}', 'jornada');
    insert into core.memberships (company_id, user_id, role_id) values
      ('${ids.companyA}', '${ids.owner}', ${role('owner')}),
      ('${ids.companyA}', '${ids.admin}', ${role('admin')}),
      ('${ids.companyA}', '${ids.supervisor}', ${role('supervisor')}),
      ('${ids.companyA}', '${ids.worker1}', ${role('worker')}),
      ('${ids.companyA}', '${ids.worker2}', ${role('worker')}),
      ('${ids.companyB}', '${ids.ownerB}', ${role('owner')});
    insert into core.sites (id, company_id, name, lat, lng) values
      ('${ids.siteNorte}', '${ids.companyA}', 'Obra Norte', 25.5428, -103.4068),
      ('${ids.siteSur}',   '${ids.companyA}', 'Obra Sur',   25.5100, -103.3900);
    insert into core.membership_sites (membership_id, site_id)
      select id, '${ids.siteNorte}' from core.memberships where user_id = '${ids.supervisor}';
    insert into core.employees (id, company_id, user_id, employee_number, full_name) values
      ('${ids.emp1}', '${ids.companyA}', '${ids.worker1}', '001', 'Juan Pérez'),
      ('${ids.emp2}', '${ids.companyA}', '${ids.worker2}', '002', 'Luis Gómez');
  `);
});

await test('al contratar Jornada se crean sus ajustes', async () => {
  const { rows } = await db.query(`select weekly_hour_limit, track_breaks from jornada.settings where company_id = $1`, [ids.companyA]);
  assert(rows.length === 1 && Number(rows[0].weekly_hour_limit) === 46, 'faltan los ajustes de Jornada');
  const none = await db.query(`select 1 from jornada.settings where company_id = $1`, [ids.companyB]);
  assert(none.rows.length === 0, 'una empresa sin Jornada no debe tener ajustes');
});

// ---------------------------------------------------------------------
// Checadas: cadena, inalterabilidad
// ---------------------------------------------------------------------
let first;
await test('las checadas se encadenan con consecutivo y hash', async () => {
  first = await insertPunch({ employee: ids.emp1, site: ids.siteNorte, kind: 'in', client: crypto.randomUUID() });
  const second = await insertPunch({ employee: ids.emp2, site: ids.siteSur, kind: 'in', client: crypto.randomUUID() });
  const third = await insertPunch({ employee: ids.emp1, site: ids.siteNorte, kind: 'out', client: crypto.randomUUID() });
  assert(Number(first.seq) === 1, `seq esperado 1, fue ${first.seq}`);
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
  await expectError(db.query(`update jornada.punches set lat = 0 where id = $1`, [first.id]), 'inalterables');
  await expectError(db.query(`delete from jornada.punches where id = $1`, [first.id]), 'inalterables');
});

await test('rechaza un colaborador de otra empresa', async () => {
  await expectError(
    db.query(`insert into jornada.punches (company_id, employee_id, kind, client_uuid) values ($1, $2, 'in', $3)`, [
      ids.companyB,
      ids.emp1,
      crypto.randomUUID(),
    ]),
    'no pertenece',
  );
});

await test('la cadena íntegra se verifica sin problemas', async () => {
  const { rows } = await db.query(`select * from jornada.verify_punch_chain($1)`, [ids.companyA]);
  assert(rows.length === 0, `se encontraron problemas: ${JSON.stringify(rows)}`);
});

await test('una alteración directa en la base se detecta', async () => {
  await db.exec(`
    alter table jornada.punches disable trigger punches_no_update;
    update jornada.punches set lat = 19.43 where seq = 2 and company_id = '${ids.companyA}';
    alter table jornada.punches enable trigger punches_no_update;
  `);
  const { rows } = await db.query(`select * from jornada.verify_punch_chain($1)`, [ids.companyA]);
  assert(rows.some((r) => Number(r.seq) === 2 && r.problem.includes('hash')), 'debió detectar el registro 2 alterado');
  await db.exec(`
    alter table jornada.punches disable trigger punches_no_update;
    update jornada.punches set lat = 25.54 where seq = 2 and company_id = '${ids.companyA}';
    alter table jornada.punches enable trigger punches_no_update;
  `);
});

await test('solo quien tiene permiso verifica la cadena', async () => {
  const ok = await asUser(ids.admin, `select * from jornada.verify_punch_chain($1)`, [ids.companyA]);
  assert(ok.rows.length === 0, 'el administrador debería poder verificarla');
  await expectError(asUser(ids.supervisor, `select * from jornada.verify_punch_chain($1)`, [ids.companyA]), 'Sin permiso');
});

// ---------------------------------------------------------------------
// RLS por rol y por empresa
// ---------------------------------------------------------------------
await test('RLS: el colaborador solo ve sus propias checadas', async () => {
  const { rows } = await asUser(ids.worker1, `select employee_id from jornada.punches`);
  assert(rows.length === 2, `esperaba 2, vio ${rows.length}`);
  assert(rows.every((r) => r.employee_id === ids.emp1), 'vio checadas de otro colaborador');
});

await test('RLS: el supervisor solo ve las checadas de sus obras', async () => {
  const { rows } = await asUser(ids.supervisor, `select site_id from jornada.punches`);
  assert(rows.length === 2 && rows.every((r) => r.site_id === ids.siteNorte), `vio ${rows.length} registros o de otra obra`);
});

await test('RLS: dueño y administrador ven todas las checadas de su empresa', async () => {
  for (const u of [ids.owner, ids.admin]) {
    const { rows } = await asUser(u, `select id from jornada.punches`);
    assert(rows.length === 4, `esperaba 4, vio ${rows.length}`);
  }
});

await test('RLS: otra empresa no ve nada', async () => {
  const p = await asUser(ids.ownerB, `select id from jornada.punches`);
  const e = await asUser(ids.ownerB, `select id from core.employees`);
  const s = await asUser(ids.ownerB, `select id from core.sites`);
  assert(p.rows.length === 0 && e.rows.length === 0 && s.rows.length === 0, 'una empresa vio datos de otra');
});

await test('RLS: el colaborador no ve el expediente de sus compañeros', async () => {
  const { rows } = await asUser(ids.worker1, `select id from core.employees`);
  assert(rows.length === 1 && rows[0].id === ids.emp1, `vio ${rows.length} expedientes`);
});

await test('RLS: un usuario no puede insertar checadas directamente', async () => {
  await expectError(
    asUser(ids.worker1, `insert into jornada.punches (company_id, employee_id, kind, client_uuid) values ($1, $2, 'in', $3)`, [
      ids.companyA,
      ids.emp1,
      crypto.randomUUID(),
    ]),
  );
});

await test('RLS: nadie crea membresías ni colaboradores desde la app (solo la API)', async () => {
  await expectError(
    asUser(ids.owner, `insert into core.memberships (company_id, user_id, role_id) values ($1, $2, ${role('owner')})`, [ids.companyA, ids.ownerB]),
  );
  await expectError(
    asUser(ids.owner, `insert into core.employees (company_id, employee_number, full_name) values ($1, '999', 'Fantasma')`, [ids.companyA]),
  );
});

// ---------------------------------------------------------------------
// Correcciones
// ---------------------------------------------------------------------
await test('corrección con motivo: ajusta la hora en las checadas efectivas', async () => {
  await asUser(
    ids.admin,
    `insert into jornada.punch_corrections (company_id, employee_id, punch_id, action, corrected_ts, reason, made_by)
     values ($1, $2, $3, 'adjust_time', '2026-11-02T14:00:00Z', 'Olvidó checar al llegar a la obra', $4)`,
    [ids.companyA, ids.emp1, first.id, ids.admin],
  );
  const { rows } = await asUser(ids.owner, `select ts, source from jornada.effective_punches where id = $1`, [first.id]);
  assert(rows[0]?.source === 'adjusted', 'la checada debió aparecer como ajustada');
  const log = await asUser(ids.owner, `select action from core.audit_log`);
  assert(log.rows.some((r) => r.action === 'jornada.correction.adjust_time'), 'la corrección no quedó en bitácora');
});

await test('una corrección sin motivo suficiente se rechaza', async () => {
  await expectError(
    asUser(
      ids.owner,
      `insert into jornada.punch_corrections (company_id, employee_id, punch_id, action, reason, made_by)
       values ($1, $2, $3, 'void', 'x', $4)`,
      [ids.companyA, ids.emp1, first.id, ids.owner],
    ),
  );
});

await test('el colaborador y el supervisor no pueden hacer correcciones', async () => {
  for (const u of [ids.worker1, ids.supervisor]) {
    await expectError(
      asUser(
        u,
        `insert into jornada.punch_corrections (company_id, employee_id, punch_id, action, reason, made_by)
         values ($1, $2, $3, 'void', 'Quiero borrar mi retardo', $4)`,
        [ids.companyA, ids.emp1, first.id, u],
      ),
    );
  }
});

// ---------------------------------------------------------------------
// Suscripción, módulos y datos protegidos
// ---------------------------------------------------------------------
await test('nadie cambia su plan, límite ni módulos desde la app', async () => {
  const plan = await asUser(ids.owner, `update core.subscriptions set employee_limit = 9999 where company_id = $1 returning 1`, [ids.companyA]).catch(
    () => ({ rows: [] }),
  );
  assert(plan.rows.length === 0, 'el dueño no debe poder cambiar su límite');
  await expectError(asUser(ids.owner, `insert into core.company_modules (company_id, module_key) values ($1, 'nomina')`, [ids.companyA]));
  await expectError(asUser(ids.owner, `update core.companies set code = 'otro' where id = $1`, [ids.companyA]));
  const ok = await asUser(ids.owner, `update core.companies set whatsapp_support = '5218710000000' where id = $1 returning id`, [ids.companyA]);
  assert(ok.rows.length === 1, 'el dueño debería poder editar los datos permitidos');
});

await test('el supervisor no puede editar la empresa ni las obras', async () => {
  const c = await asUser(ids.supervisor, `update core.companies set name = 'X' where id = $1 returning id`, [ids.companyA]);
  const s = await asUser(ids.supervisor, `update core.sites set name = 'X' where id = $1 returning id`, [ids.siteNorte]);
  assert(c.rows.length === 0 && s.rows.length === 0, 'el supervisor modificó datos sin permiso');
});

await test('sin el módulo contratado no hay acceso a sus datos', async () => {
  // Empresa B no tiene Jornada: su dueño no puede usar permisos de Jornada
  const { rows } = await asUser(ids.ownerB, `select core.can($1, 'jornada.asistencia.ver') as ok, core.can($1, 'core.personal.ver') as core_ok`, [
    ids.companyB,
  ]);
  assert(rows[0].ok === false, 'no debería tener permisos de un módulo no contratado');
  assert(rows[0].core_ok === true, 'el núcleo siempre está disponible');
});

await test('una cuenta suspendida pierde los módulos, no el núcleo', async () => {
  await db.query(`update core.subscriptions set status = 'suspended' where company_id = $1`, [ids.companyA]);
  const { rows } = await asUser(ids.owner, `select core.can($1, 'jornada.asistencia.ver') as j, core.can($1, 'core.personal.ver') as c`, [
    ids.companyA,
  ]);
  const own = await asUser(ids.worker1, `select id from jornada.punches`);
  await db.query(`update core.subscriptions set status = 'trial' where company_id = $1`, [ids.companyA]);
  assert(rows[0].j === false && rows[0].c === true, 'la suspensión debe apagar Jornada y dejar el núcleo');
  assert(own.rows.length === 2, 'el colaborador conserva acceso a sus propios registros');
});

await test('una membresía no puede usar el rol personalizado de otra empresa', async () => {
  const { rows } = await db.query(`insert into core.roles (company_id, key, name) values ($1, 'contador', 'Contador') returning id`, [ids.companyB]);
  await expectError(
    db.query(`insert into core.memberships (company_id, user_id, role_id) values ($1, $2, $3)`, [ids.companyA, ids.newOwner, rows[0].id]),
    'no pertenece',
  );
});

await test('los roles del sistema no se pueden modificar', async () => {
  await expectError(db.query(`delete from core.roles where company_id is null and key = 'worker'`), 'sistema');
  await expectError(db.query(`update core.roles set company_id = $1 where company_id is null and key = 'admin'`, [ids.companyA]), 'sistema');
});

await test('el colaborador no puede registrar ni ver biometría ajena', async () => {
  await db.query(
    `insert into jornada.faces (employee_id, company_id, descriptor, photo_path, model_version)
     values ($1, $2, array_fill(0.1::real, array[128]), 'faces/x', 'test')`,
    [ids.emp1, ids.companyA],
  );
  await expectError(
    asUser(
      ids.worker2,
      `insert into jornada.faces (employee_id, company_id, descriptor, photo_path, model_version)
       values ($1, $2, array_fill(0.1::real, array[128]), 'x', 'test')`,
      [ids.emp2, ids.companyA],
    ),
  );
  const seen = await asUser(ids.worker2, `select employee_id from jornada.faces`);
  assert(seen.rows.length === 0, 'vio la biometría de otro colaborador');
});

await test('un usuario no puede hacerse administrador de la plataforma', async () => {
  await expectError(asUser(ids.worker1, `insert into core.platform_admins (user_id) values ($1)`, [ids.worker1]));
});

await test('la comida es opcional y el administrador puede activarla', async () => {
  const { rows } = await db.query(`select track_breaks from jornada.settings where company_id = $1`, [ids.companyA]);
  assert(rows[0].track_breaks === false, 'por defecto no se registra la comida');
  const ok = await asUser(ids.admin, `update jornada.settings set track_breaks = true where company_id = $1 returning track_breaks`, [ids.companyA]);
  assert(ok.rows[0]?.track_breaks === true, 'el administrador debería poder activarla');
  const no = await asUser(ids.supervisor, `update jornada.settings set track_breaks = false where company_id = $1 returning 1`, [ids.companyA]);
  assert(no.rows.length === 0, 'el supervisor no debe cambiar ajustes');
});

// ---------------------------------------------------------------------
// Funciones de la API
// ---------------------------------------------------------------------
await test('user_access devuelve rol, permisos y módulos en una consulta', async () => {
  const { rows } = await asService(`select * from core.user_access($1)`, [ids.supervisor]);
  assert(rows.length === 1, 'debería tener una membresía');
  const r = rows[0];
  assert(r.role_key === 'supervisor', `rol: ${r.role_key}`);
  assert(r.permissions.includes('jornada.asistencia.ver_asignadas') && !r.permissions.includes('jornada.asistencia.ver'), 'permisos del supervisor');
  assert(r.modules.includes('core') && r.modules.includes('jornada'), `módulos: ${r.modules}`);
});

await test('user_access y provision_company no están disponibles para usuarios', async () => {
  await expectError(asUser(ids.owner, `select * from core.user_access($1)`, [ids.owner]));
  await expectError(asUser(ids.owner, `select core.provision_company('X', 'xxx', $1)`, [ids.owner]));
});

await test('provision_company crea empresa, prueba, módulos, ajustes y dueño', async () => {
  const { rows } = await asService(`select core.provision_company('Nueva SA', 'nueva', $1, 25, 30, array['jornada']) as id`, [ids.newOwner]);
  const id = rows[0].id;
  const sub = await db.query(`select status, employee_limit from core.subscriptions where company_id = $1`, [id]);
  assert(sub.rows[0].status === 'trial' && sub.rows[0].employee_limit === 25, 'suscripción de prueba');
  const settings = await db.query(`select 1 from jornada.settings where company_id = $1`, [id]);
  assert(settings.rows.length === 1, 'ajustes de Jornada');
  const access = await asService(`select role_key, modules from core.user_access($1)`, [ids.newOwner]);
  assert(access.rows[0].role_key === 'owner' && access.rows[0].modules.includes('jornada'), 'el dueño quedó con acceso a Jornada');
});

// ---------------------------------------------------------------------
// Registro por autoservicio y lista de espera
// ---------------------------------------------------------------------
await test('la lista de espera no se lee ni se escribe desde la app', async () => {
  await asService(`insert into core.waitlist (email, consent_version) values ('prospecto@ejemplo.com', '2026-11-06')`);
  await expectError(asUser(ids.owner, `select * from core.waitlist`));
  await expectError(asUser(ids.owner, `insert into core.waitlist (email, consent_version) values ('x@y.com', 'v')`));
  await expectError(asService(`insert into core.waitlist (email, consent_version) values ('Mayus@Ejemplo.com', 'v')`));
});

await test('la aceptación de términos es inalterable y cada quien ve la suya', async () => {
  await asService(
    `insert into core.legal_acceptances (company_id, user_id, document, version, ip) values ($1, $2, 'terminos', '2.2', '200.1.1.1')`,
    [ids.companyA, ids.owner],
  );
  await expectError(db.query(`update core.legal_acceptances set version = '1.0'`), 'inalterables');
  const own = await asUser(ids.owner, `select version from core.legal_acceptances`);
  const other = await asUser(ids.worker1, `select version from core.legal_acceptances`);
  assert(own.rows.length === 1 && other.rows.length === 0, 'visibilidad de aceptaciones');
  await expectError(asUser(ids.owner, `insert into core.legal_acceptances (user_id, document, version) values ($1, 'terminos', '9')`, [ids.owner]));
});

await test('Korporia Starter guarda sus dos vigencias', async () => {
  await asService(
    `update core.subscriptions set plan = 'starter', starter_started_at = now(), starter_clock_until = now() + interval '90 days', starter_hr_until = now() + interval '6 months' where company_id = $1`,
    [ids.companyB],
  );
  const { rows } = await db.query(`select plan, starter_clock_until < starter_hr_until as ok from core.subscriptions where company_id = $1`, [ids.companyB]);
  assert(rows[0].plan === 'starter' && rows[0].ok, 'vigencias del plan Starter');
});

console.log(`\n${passed} pruebas correctas, ${failed} fallidas\n`);
await db.close();
process.exit(failed ? 1 : 0);

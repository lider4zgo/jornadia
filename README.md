# Korporia

Plataforma SaaS de recursos humanos y finanzas para PyMEs del continente americano (arranque en México). Es una aplicación web responsiva e instalable (PWA): no requiere tienda de apps.

Korporia es un **monolito modular**: un repositorio, una app web, una API en Cloudflare Workers y una base de datos multiempresa en Supabase, divididos por dentro en un **núcleo** y **módulos** que cada empresa contrata.

| Módulo | Estado | Qué hace |
| --- | --- | --- |
| Núcleo (`core`) | Listo | Empresas, suscripción y módulos contratados, roles y permisos, colaboradores, obras y sucursales, bitácora |
| Jornada (`jornada`) | Listo (piloto) | Registro electrónico de jornada (LFT art. 132 fr. XXXIV, obligatorio desde el 1 ene 2027): selfie con verificación facial y prueba de vida, geocercas, funciona sin señal |
| Nómina (`nomina`) | Siguiente fase | Cálculo de ISR, IMSS e INFONAVIT y recibos CFDI timbrados |
| Finanzas (`finanzas`) | Planeado | Pólizas, facturación CFDI, bancos, exportación al contador |
| Reclutamiento (`reclutamiento`) | Planeado | Vacantes y candidatos |

## Estructura

```
apps/web                  App web (React + Vite, PWA)
  src/core                Inicio de sesión, alta de empresas (plataforma)
  src/modules/<módulo>    Pantallas de cada módulo; se cargan bajo demanda
apps/api                  API en Cloudflare Workers (Hono); también sirve la app web
  src/core                /api/core/*: sesión (me), empresas, usuarios
  src/modules/<módulo>    /api/<módulo>/*: rutas de cada módulo
packages/core             Catálogo de módulos, permisos y roles; identidad
packages/jornada          Reglas de Jornada: geocercas, secuencia de checadas, cálculo de jornada LFT
supabase/migrations       Un esquema de PostgreSQL por módulo (core, jornada, …)
supabase/tests            Pruebas del esquema en Postgres en memoria
```

Reglas de la arquitectura:

- **Cada módulo solo depende del núcleo**, nunca de otro módulo (ni en SQL ni en código).
- **Permisos `módulo.acción`** (por ejemplo `jornada.checar`, `core.personal.gestionar`). La fuente es `packages/core/src/permissions.json`; la migración `core` siembra lo mismo y las pruebas verifican que coincidan. La misma regla vive en `core.can()` (base de datos) y en `can()` (API): el usuario debe tener el permiso **y** el módulo debe estar contratado y la cuenta no suspendida.
- **Nadie otorga más de lo que tiene:** solo se puede asignar un rol con estrictamente menos permisos que los propios. Así un administrador da de alta supervisores, pero no otros administradores.
- **Roles del sistema:** dueño, administrador, supervisor y colaborador. Cada empresa podrá crear roles propios (`core.roles` con su `company_id`).

### Agregar un módulo

1. `supabase/migrations/<fecha>_<módulo>.sql` con su esquema, que solo referencie tablas de `core`.
2. Sus permisos en `packages/core/src/permissions.json` y en la migración (las pruebas avisan si no coinciden).
3. `packages/<módulo>` con sus reglas puras y pruebas.
4. `apps/api/src/modules/<módulo>/index.ts` que exporte un `ApiModule` (rutas, datos para `me`, alta de colaboradores) y agregarlo a `MODULE_REGISTRY`.
5. `apps/web/src/modules/<módulo>/index.tsx` y agregarlo a `WEB_MODULES`.
6. Agregar el esquema en Supabase → Data API → Exposed schemas.

## Cómo se protege el registro de jornada

- Las checadas **no se pueden editar ni borrar** (lo impide la base de datos).
- Cada checada guarda el hash de la anterior; `jornada.verify_punch_chain(empresa)` detecta cualquier alteración.
- La hora oficial es la del servidor. Las checadas sin conexión usan la hora del teléfono corregida con la última sincronización y quedan marcadas para revisión.
- Seguridad por fila (RLS): cada empresa solo ve sus datos; cada rol, solo lo que le corresponde.
- Las fotos solo las ve quien revisa asistencia; un colaborador no puede ver ninguna.
- Correcciones con motivo obligatorio y bitácora: el registro original nunca se modifica.

## Puesta en marcha

### 1. Supabase (proyecto nuevo `korporia`)

1. Crea un proyecto nuevo llamado `korporia` (el plan gratuito permite dos).
2. **SQL Editor** → pega y ejecuta, en orden, los archivos de `supabase/migrations/`.
3. **Project Settings → Data API → Exposed schemas**: agrega `core` y `jornada` (además de `public`).
4. **Authentication → Sign In / Providers**: desactiva *Allow new users to sign up*. Las cuentas solo las crea la plataforma.
5. **Authentication → Users → Add user**: crea tu usuario con tu correo y contraseña (marca *Auto Confirm User*).
6. **SQL Editor** → ejecuta `supabase/seed_superadmin.sql` con tu correo.
7. Recomendado: **Project Settings → JWT Keys** → usa llaves de firma asimétricas. Así la API valida las sesiones sin consultar a Supabase en cada petición (si no, funciona igual, solo un poco más lento).
8. **Project Settings → API**: copia *Project URL*, la llave *anon* y la llave *service_role* (esta última es secreta).

### 2. Cloudflare

1. **R2** → crea un bucket llamado `korporia-files`.
2. Edita `apps/api/wrangler.toml`: pon tu *Project URL* en `SUPABASE_URL`.
3. **Workers & Pages → Create → Import a repository** → elige este repositorio:
   - Root directory: `apps/api`
   - Build command: `cd ../.. && npm ci && npm run build -w @korporia/web`
   - Deploy command: `npx wrangler deploy`
   - Variables de compilación: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SUPPORT_WHATSAPP`
4. En el Worker → **Settings → Variables and Secrets**, agrega como *Secret*: `SUPABASE_SERVICE_ROLE_KEY` y `SUPABASE_ANON_KEY`.

La app queda en `https://app.korporia.com` (definido en `routes` de `wrangler.toml`) y también en `https://korporia.<tu-cuenta>.workers.dev`.

### 3. Primer uso

1. Entra con tu correo en la pestaña *Administración* y crea la empresa del piloto (por ejemplo, código `elaguna`). Se crea con prueba gratuita y el módulo Jornada activo.
2. Entrega al dueño su correo y contraseña. Él (o un administrador) da de alta obras y colaboradores.
3. Un supervisor o administrador toma la foto de registro de cada colaborador en *Personal → Tomar foto*.
4. Cada colaborador recibe por WhatsApp su enlace, código de empresa y número.

## Desarrollo local

```bash
npm install
cp apps/web/.env.example apps/web/.env.local       # llena los valores
cp apps/api/.dev.vars.example apps/api/.dev.vars   # llena los valores
npm run build -w @korporia/web
npm run dev:api     # API + app en http://localhost:8787
```

La cámara y el GPS del navegador solo funcionan en `localhost` o con HTTPS.

## Pruebas

```bash
npm test
```

- `packages/core`: catálogo de permisos y regla para otorgar roles.
- `packages/jornada`: geocercas, secuencia de checadas, jornada y horas extra.
- `apps/api`: reglas de aceptación de checadas.
- `supabase/tests`: esquema real en Postgres en memoria: catálogo igual al de `permissions.json`, cadena de hashes, inalterabilidad, permisos por rol, módulos contratados, cuentas suspendidas y alta de empresas.

## Pendiente (siguientes fases)

Fase 1: cobro con Stripe (webhook que actualiza `core.subscriptions`), dominio korporia.com, prueba gratuita automática. Fase 2: módulo Nómina y paquete `locale-mx` (ISR, IMSS, CFDI). Además: pantalla de roles personalizados, mover Personal y Obras a una sección del núcleo, modo kiosco, conformidad semanal del colaborador y verificación facial en servidor.

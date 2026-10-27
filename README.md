# Jornadia

Registro electrónico de jornada laboral para México (LFT art. 132 fr. XXXIV, obligatorio desde el 1 de enero de 2027), pensado para personal en campo: selfie con verificación facial y prueba de vida, ubicación con geocercas por obra y funcionamiento sin señal.

Es una aplicación web responsiva e instalable (PWA): no requiere tienda de apps.

## Qué incluye esta versión (piloto)

**Trabajador** (celular)
- Inicio de sesión con código de empresa + número de empleado + NIP de 6 dígitos.
- Foto de registro en el primer uso.
- Checada de entrada, comida y salida: selfie, parpadeo (prueba de vida), comparación facial en el teléfono y GPS.
- Sin señal: la checada se guarda en el teléfono con su hora y ubicación y se envía sola al volver la conexión.
- Historial y avance de la semana contra el tope legal (46 h en 2027).

**Empresa cliente** (dueño, administrador, supervisor)
- *Hoy*: quién checó, dónde, a qué distancia de la obra, selfie y observaciones por revisar.
- *Reporte*: horas trabajadas y extra por trabajador y periodo; descarga para Excel.
- *Personal*: alta de trabajadores con NIP automático y envío del acceso por WhatsApp.
- *Obras*: geocercas creadas desde la ubicación actual o con coordenadas de Google Maps.
- Correcciones con motivo obligatorio: el registro original nunca se modifica.
- El supervisor solo ve *Hoy* y *Reporte* de sus obras.

**Plataforma** (superadmin)
- Alta de empresas cliente con su usuario propietario.

## Cómo se protege el registro

- Las checadas **no se pueden editar ni borrar** (lo impide la base de datos).
- Cada checada guarda el hash de la anterior; `verify_punch_chain(empresa)` detecta cualquier alteración.
- La hora oficial es la del servidor. Las checadas sin conexión usan la hora del teléfono corregida con la última sincronización y quedan marcadas para revisión.
- Seguridad por fila (RLS): cada empresa solo ve sus datos; cada rol, solo lo que le corresponde.
- Las fotos se sirven únicamente a quien puede ver el registro al que pertenecen.

## Estructura

```
apps/web        App web (React + Vite, PWA)
apps/api        API en Cloudflare Workers (Hono); también sirve la app web
packages/core   Reglas compartidas: geocercas, secuencia de checadas, cálculo de jornada LFT
supabase/       Esquema de base de datos y pruebas
```

## Puesta en marcha

### 1. Supabase (proyecto `jornadia`)

1. **SQL Editor** → pega y ejecuta `supabase/migrations/20261027000001_esquema_inicial.sql`.
2. **Authentication → Sign In / Providers**: desactiva *Allow new users to sign up*. Las cuentas solo las crea la plataforma.
3. **Authentication → Users → Add user**: crea tu usuario con tu correo y contraseña (marca *Auto Confirm User*).
4. **SQL Editor** → ejecuta `supabase/seed_superadmin.sql` con tu correo.
5. **Project Settings → API**: copia *Project URL*, la llave *anon* y la llave *service_role* (esta última es secreta).

### 2. Cloudflare

1. **R2** → crea un bucket llamado `jornadia-files` (R2 pide registrar un método de pago aunque el uso quede en el plan gratuito).
2. Edita `apps/api/wrangler.toml`: pon tu *Project URL* en `SUPABASE_URL`.
3. **Workers & Pages → Create → Import a repository** → elige `lider4zgo/jornadia`:
   - Root directory: `apps/api`
   - Build command: `cd ../.. && npm ci && npm run build -w @jornadia/web`
   - Deploy command: `npx wrangler deploy`
   - Variables de compilación: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SUPPORT_WHATSAPP`
4. En el Worker ya creado → **Settings → Variables and Secrets**, agrega como *Secret*: `SUPABASE_SERVICE_ROLE_KEY` y `SUPABASE_ANON_KEY`.

La app queda en `https://jornadia.<tu-cuenta>.workers.dev`. Cuando compres `jornadia.mx`, se conecta en **Settings → Domains & Routes**.

### 3. Primer uso

1. Entra con tu correo en la pestaña *Administración* y crea la empresa del piloto (por ejemplo, código `elaguna`).
2. Entrega al dueño su correo y contraseña. Él (o tú, con su usuario) da de alta obras y trabajadores.
3. Cada trabajador recibe por WhatsApp su enlace, código, número y NIP; en el primer uso registra su foto.

## Desarrollo local

```bash
npm install
cp apps/web/.env.example apps/web/.env.local       # llena los valores
cp apps/api/.dev.vars.example apps/api/.dev.vars   # llena los valores
npm run build -w @jornadia/web
npm run dev:api     # API + app en http://localhost:8787
```

La cámara y el GPS del navegador solo funcionan en `localhost` o con HTTPS.

## Pruebas

```bash
npm test
```

- `packages/core`: geocercas, secuencia de checadas, jornada y horas extra (16 pruebas).
- `apps/api`: reglas de aceptación de checadas (11 pruebas, `npm test -w @jornadia/api`).
- `supabase/tests`: esquema real en Postgres en memoria: cadena de hashes, inalterabilidad, detección de alteraciones y permisos por rol (20 pruebas).

## Pendiente (siguientes fases)

Cobro con Stripe, facturas CFDI, landing pública y prueba gratuita automática, modo kiosco, incidencias, exportación a nómina, conformidad semanal del trabajador y verificación facial en servidor.

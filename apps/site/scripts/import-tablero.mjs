// Importa al sitio korporia.com las páginas del tablero de Marketing
// ("Korporia — Identidad de marca": 6 · Precios y 7 · Landing) y la página
// "Korporia Legal" de Legal. Las fuentes viven en apps/site/tablero/.
//
// Uso:  node apps/site/scripts/import-tablero.mjs
//
// Para actualizar el sitio cuando Marketing o Legal cambien algo: reemplaza los
// archivos de apps/site/tablero/ con la versión nueva y vuelve a correr este
// script. Los ajustes propios del sitio (enlaces a la app, lista de espera,
// idioma por URL) se aplican aquí abajo, así no se pierden al reimportar.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (f) => readFileSync(join(root, 'tablero', f), 'utf8');
const out = (f, text) => {
  mkdirSync(dirname(join(root, f)), { recursive: true });
  writeFileSync(join(root, f), text);
};

const APP = 'https://app.korporia.com';
const SIGNUP = `${APP}/registro`;
const WHATSAPP = '528718963470';

/** Reemplaza exactamente una vez; falla si el texto del tablero cambió y el ajuste ya no aplica. */
function patch(text, from, to, { all = false, file } = {}) {
  const count = text.split(from).length - 1;
  if (count === 0 || (!all && count > 1)) {
    throw new Error(`${file}: se esperaba ${all ? 'al menos una' : 'una'} coincidencia de ${JSON.stringify(from.slice(0, 80))}, hay ${count}`);
  }
  return all ? text.split(from).join(to) : text.replace(from, to);
}

/** Reemplazo con expresión regular; falla si no encuentra nada. */
function patchRe(text, re, to, { file } = {}) {
  if (!re.test(text)) throw new Error(`${file}: no se encontró ${re}`);
  re.lastIndex = 0;
  return text.replace(re, to);
}

/** Separa un .dc.html en: estilos y fuentes de <helmet>, la plantilla y la clase Component. */
function splitDc(html, file) {
  const helmet = html.match(/<helmet>([\s\S]*?)<\/helmet>/)?.[1] ?? '';
  const xdc = html.match(/<x-dc>([\s\S]*?)<\/x-dc>/)?.[1];
  const script = html.match(/<script type="text\/x-dc" data-dc-script[^>]*>([\s\S]*?)<\/script>/)?.[1];
  if (!xdc || !script) throw new Error(`${file}: no tiene <x-dc> o su script`);
  const template = xdc.replace(/<helmet>[\s\S]*?<\/helmet>/, '').trim();
  return { helmet: helmet.trim(), template, script: script.trim() };
}

/** Lógica común a ambas páginas: idioma forzado por URL (/en/…) para buscadores. */
function patchLanguage(script, file) {
  return patch(
    script,
    'componentDidMount() {',
    `componentDidMount() {
const forced = document.documentElement.getAttribute('data-force-lang');
if (forced === 'es' || forced === 'en') { try { window.localStorage.setItem('kp-lang', forced); } catch (e) {} this.setState({ lang: forced }); return; }`,
    { file },
  );
}

function component(script) {
  return `// Generado por scripts/import-tablero.mjs a partir del tablero de Marketing. No editar a mano.
import { DCLogic } from '../runtime.js';

${script}

export default Component;
`;
}

// ---------------------------------------------------------------------
// Landing (7 · Landing)
// ---------------------------------------------------------------------
{
  const file = 'Landing.dc.html';
  let { helmet, template, script } = splitDc(src(file), file);

  template = patchRe(template, /<a href="#"([^>]*aria-label="Korporia")>/g, '<a href="/"$1>', { file });
  template = patch(template, 'href="Precios.dc.html"', 'href="/precios"', { all: true, file });
  template = patchRe(template, /<a href="#"([^>]*)>\{\{t\.navLogin\}\}/g, `<a href="${APP}/"$1>{{t.navLogin}}`, { file });
  // Todos los "Empezar gratis" van al registro de la app
  template = patchRe(template, /<a href="#"([^>]*)>\{\{t\.(navTrial|ctaTrial)\}\}/g, `<a href="${SIGNUP}"$1>{{t.$2}}`, { file });
  // Centro de ayuda: mientras no exista, WhatsApp de soporte
  template = patchRe(template, /<a href="#"([^>]*)>\{\{t\.footHelp\}\}/g, `<a href="https://wa.me/${WHATSAPP}" target="_blank" rel="noopener"$1>{{t.footHelp}}`, { file });
  template = patch(template, 'https://korporia.com/', '/', { all: true, file });
  if (/href="#"/.test(template)) throw new Error(`${file}: quedó un enlace sin destino (href="#")`);

  // Blog (Dirección, 13 nov): enlace junto a "Precios" en el menú, el menú del celular y el pie
  template = patchRe(
    template,
    /(<a href="\/precios"( style="[^"]*")>\{\{t\.navPricing\}\}<\/a>)/g,
    '$1\n        <a href="{{t.navBlogHref}}"$2>{{t.navBlog}}</a>',
    { file },
  );
  script = patch(script, "navPricing: 'Precios',", "navPricing: 'Precios', navBlog: 'Blog', navBlogHref: '/blog/',", { file });
  script = patch(script, "navPricing: 'Pricing',", "navPricing: 'Pricing', navBlog: 'Blog', navBlogHref: '/en/blog/',", { file });

  // Lista de espera real: id para el enlace desde precios, casilla de exclusión y envío a la API
  template = patch(template, '<input type="checkbox" style="width: 18px; height: 18px; margin: 0; accent-color: #2B3FD1">{{t.wlOptOut}}', '<input id="wl-optout" type="checkbox" style="width: 18px; height: 18px; margin: 0; accent-color: #2B3FD1">{{t.wlOptOut}}', { file });
  template = patch(template, '<section id="modulos"', '<span id="lista-espera"></span><section id="modulos"', { file });
  script = patch(
    script,
    'join: () => this.setState({ joined: true }),',
    `join: () => {
if (this.state.sending) return;
const input = document.getElementById('wl-email');
const optOut = document.getElementById('wl-optout');
const email = input ? String(input.value || '').trim() : '';
if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) { if (input) { input.focus(); input.setAttribute('aria-invalid', 'true'); } return; }
this.setState({ sending: true });
fetch('/api/core/waitlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email, lang: lang, marketing_opt_out: !!(optOut && optOut.checked), source: 'landing' }) })
.then((r) => { if (!r.ok) throw new Error(String(r.status)); this.setState({ joined: true, sending: false }); })
.catch(() => { this.setState({ sending: false }); window.alert(lang === 'en' ? 'We could not save your email. Please try again.' : 'No pudimos guardar tu correo. Intenta de nuevo.'); });
},`,
    { file },
  );
  script = patchLanguage(script, file);

  out('src/pages/landing.template.html', template + '\n');
  out('src/pages/landing.component.js', component(script));
  out('src/pages/landing.head.html', helmet + '\n');
}

// ---------------------------------------------------------------------
// Precios (6 · Precios)
// ---------------------------------------------------------------------
{
  const file = 'Precios.dc.html';
  let { helmet, template, script } = splitDc(src(file), file);

  template = patch(template, 'href="Landing.dc.html"', 'href="/"', { all: true, file });
  template = patchRe(template, /<a href="#"([^>]*)>\{\{t\.navLogin\}\}/g, `<a href="${APP}/"$1>{{t.navLogin}}`, { file });
  template = patchRe(template, /<a href="#"([^>]*)>\{\{t\.(navTrial|founderCta)\}\}/g, `<a href="${SIGNUP}"$1>{{t.$2}}`, { file });
  template = patchRe(template, /<a href="#"([^>]*)>\{\{t\.navPricing\}\}/g, '<a href="/precios"$1>{{t.navPricing}}', { file });
  template = patch(template, 'https://korporia.com/', '/', { all: true, file });
  if (/href="#"/.test(template)) throw new Error(`${file}: quedó un enlace sin destino (href="#")`);

  // Starter: registro. Jornada: registro hasta 25; desde 26, alta asistida por WhatsApp (Stripe llega en enero).
  script = patch(script, "cta: es ? 'Empezar gratis' : 'Start free', href: '#',", `cta: es ? 'Empezar gratis' : 'Start free', href: '${SIGNUP}',`, { file });
  script = patch(
    script,
    "Object.assign({ href: '#', name: 'Jornada',",
    `Object.assign({ href: stOk ? '${SIGNUP}' : 'https://wa.me/${WHATSAPP}?text=' + encodeURIComponent(es ? 'Hola, quiero contratar Korporia Jornada (' + n + ' empleados).' : 'Hi, I’d like to subscribe to Korporia Jornada (' + n + ' employees).'), name: 'Jornada',`,
    { file },
  );
  // Despegue y Full: lista de espera de la landing; Full con más de 250 lleva a ventas
  script = patch(script, "Object.assign({ href: '#', name: 'Despegue',", "Object.assign({ href: '/#lista-espera', name: 'Despegue',", { file });
  script = patch(script, "Object.assign({ href: '#', name: 'Full',", "Object.assign({ href: big ? salesHref : '/#lista-espera', name: 'Full',", { file });
  if (/href: '#'/.test(script)) throw new Error(`${file}: quedó un botón sin destino (href: '#')`);
  script = patchLanguage(script, file);

  out('src/pages/precios.template.html', template + '\n');
  out('src/pages/precios.component.js', component(script));
  out('src/pages/precios.head.html', helmet + '\n');
}

// ---------------------------------------------------------------------
// Páginas legales (Korporia Legal): una página, cuatro rutas
// ---------------------------------------------------------------------
{
  const file = 'legal.html';
  let html = src(file);
  for (const p of ['terminos', 'privacidad', 'subencargados', 'cookies']) {
    html = html.split(`href="#${p}"`).join(`href="/${p}"`);
  }
  html = patch(html, '<a class="brand" href="/terminos"', '<a class="brand" href="/"', { file });
  // La sección se elige por la ruta (/privacidad); el #fragmento se mantiene para enlaces antiguos
  html = patch(
    html,
    "var id=pages.indexOf(h)>=0?h:'terminos';",
    "var path=location.pathname.replace(/^\\/+|\\/+$/g,'');var id=pages.indexOf(h)>=0?h:(pages.indexOf(path)>=0?path:'terminos');",
    { file },
  );
  html = patch(html, '<meta charset=utf8>', '<meta charset=utf8><link rel="icon" href="/favicon.svg" type="image/svg+xml"><html lang="es">', { file });
  for (const p of ['terminos', 'privacidad', 'subencargados', 'cookies']) out(`public/${p}/index.html`, html);
}

// ---------------------------------------------------------------------
// Entradas HTML del sitio (español por defecto; /en/ fuerza inglés)
// ---------------------------------------------------------------------
const SITE = 'https://korporia.com';
const pages = [
  { path: '/', file: 'index.html', page: 'landing', lang: '', title: 'Korporia · RH y finanzas para PyMEs', desc: 'Asistencia, personal, nómina y finanzas de tu PyME en un solo lugar. Korporia Starter: gratis hasta 25 empleados.' },
  { path: '/en/', file: 'en/index.html', page: 'landing', lang: 'en', title: 'Korporia · HR and finance for SMBs', desc: 'Attendance, people, payroll and finance for your business in one place. Korporia Starter: free for up to 25 employees.' },
  { path: '/precios', file: 'precios/index.html', page: 'precios', lang: '', title: 'Precios · Korporia', desc: 'Precios de Korporia por número de empleados. Korporia Starter gratis hasta 25 empleados y Jornada desde $49 al mes.' },
  { path: '/en/precios', file: 'en/precios/index.html', page: 'precios', lang: 'en', title: 'Pricing · Korporia', desc: 'Korporia pricing by number of employees. Korporia Starter is free for up to 25 employees and Jornada starts at $49 a month.' },
];
for (const p of pages) {
  const alt = p.page === 'landing' ? { es: '/', en: '/en/' } : { es: '/precios', en: '/en/precios' };
  const head = readFileSync(join(root, `src/pages/${p.page}.head.html`), 'utf8');
  out(
    p.file,
    `<!doctype html>
<html lang="${p.lang || 'es'}"${p.lang ? ` data-force-lang="${p.lang}"` : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${p.title}</title>
<meta name="description" content="${p.desc}">
<meta name="theme-color" content="#0E1630">
<link rel="canonical" href="${SITE}${p.path}">
<link rel="alternate" hreflang="es" href="${SITE}${alt.es}">
<link rel="alternate" hreflang="en" href="${SITE}${alt.en}">
<link rel="alternate" hreflang="x-default" href="${SITE}${alt.es}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta property="og:title" content="${p.title}">
<meta property="og:description" content="${p.desc}">
<meta property="og:image" content="${SITE}/icon-512.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
${head}</head>
<body>
<div id="root"></div>
<script type="module" src="/src/entries/${p.page}.js"></script>
</body>
</html>
`,
  );
}

console.log('Sitio importado: landing, precios y páginas legales.');

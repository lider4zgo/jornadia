// Blog de korporia.com: convierte los artículos de apps/site/blog en páginas estáticas.
//
// Agregar un artículo = agregar un archivo:
//   blog/<slug>.md        artículo en español (obligatorio)
//   blog/<slug>.en.md     versión en inglés (opcional, mismo <slug>)
// Imágenes en public/blog/ (se referencian como /blog/mi-imagen.jpg).
//
// Encabezado de cada archivo (entre líneas ---):
//   title: Título del artículo
//   description: Resumen de una o dos líneas (buscadores y redes)
//   date: 2026-11-16
//   author: Equipo Korporia          (opcional)
//   image: /blog/portada.jpg         (opcional)
//   draft: true                      (opcional: no se publica)
//
// Se ejecuta después de `vite build` y escribe en ../web/dist/_site/blog y /en/blog,
// además de agregar los artículos a sitemap.xml.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, '../blog');
const OUT = resolve(here, '../../web/dist/_site');
const SITE = 'https://korporia.com';
const ORIGIN_SCRIPT = readFileSync(resolve(here, '../src/origen.js'), 'utf8');

const T = {
  es: {
    blog: 'Blog',
    intro: 'Guías claras sobre asistencia, jornada laboral, nómina y RH para PyMEs en México.',
    by: 'Por',
    share: 'Compartir',
    copy: 'Copiar enlace',
    copied: 'Enlace copiado',
    back: 'Todos los artículos',
    ctaTitle: 'Prueba Korporia Starter',
    ctaText: 'Checador con selfie o PIN, expediente y vacaciones de ley. Gratis hasta 25 empleados.',
    ctaBtn: 'Crear mi cuenta gratis',
    ctaWait: 'Avísame de las novedades',
    readEn: 'Read in English',
    empty: 'Muy pronto, los primeros artículos.',
    home: '/',
    prices: '/precios',
    pricesLabel: 'Precios',
    signup: 'https://app.korporia.com/registro',
    lang: 'es-MX',
  },
  en: {
    blog: 'Blog',
    intro: 'Clear guides on attendance, working hours, payroll and HR for SMEs in Mexico.',
    by: 'By',
    share: 'Share',
    copy: 'Copy link',
    copied: 'Link copied',
    back: 'All articles',
    ctaTitle: 'Try Korporia Starter',
    ctaText: 'Time clock with selfie or PIN, employee files and statutory leave. Free up to 25 employees.',
    ctaBtn: 'Create my free account',
    ctaWait: 'Keep me posted',
    readEs: 'Leer en español',
    empty: 'First articles coming soon.',
    home: '/en/',
    prices: '/en/precios',
    pricesLabel: 'Pricing',
    signup: 'https://app.korporia.com/registro',
    lang: 'en-US',
  },
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function parse(file) {
  const raw = readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) throw new Error(`${file}: falta el encabezado entre líneas ---`);
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i < 1) continue;
    meta[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  for (const k of ['title', 'description', 'date']) if (!meta[k]) throw new Error(`${file}: falta "${k}" en el encabezado`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.date)) throw new Error(`${file}: la fecha debe ser AAAA-MM-DD`);
  return { meta, html: marked.parse(m[2], { gfm: true }) };
}

const fmtDate = (iso, lang) =>
  new Intl.DateTimeFormat(T[lang].lang, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`));

const CSS = `
:root{--ink:#0E1630;--indigo:#2B3FD1;--green:#12A37E;--bg:#fff;--surface:#F4F5FA;--line:#DDE0EC;--fg:#0E1630;--muted:#4A5470;--link:#2B3FD1;
--k-stem:#2B3FD1;--k-arm:#12A37E;--display:"Plus Jakarta Sans","Segoe UI",system-ui,sans-serif;--body:"Inter","Segoe UI",system-ui,-apple-system,sans-serif}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0B1126;--surface:#131B36;--line:#263052;--fg:#E8EAF4;--muted:#A3AAC4;--link:#8C9BFF;--k-stem:#6F80FF;--k-arm:#3FD3A6;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#0B1126;--surface:#131B36;--line:#263052;--fg:#E8EAF4;--muted:#A3AAC4;--link:#8C9BFF;--k-stem:#6F80FF;--k-arm:#3FD3A6;color-scheme:dark}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:400 17px/1.7 var(--body);-webkit-font-smoothing:antialiased}
a{color:var(--link);text-underline-offset:2px}
.wrap{max-width:1120px;margin:0 auto;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
header.top{border-bottom:1px solid var(--line)}header.top .wrap{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-block:18px;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:10px;text-decoration:none;color:var(--fg)}.brand b{font:700 22px/1 var(--display);letter-spacing:-.025em}
.brand span{font:500 13px/1 var(--display);color:var(--muted);letter-spacing:.06em;text-transform:uppercase;padding-left:10px;border-left:1px solid var(--line)}
nav.top{display:flex;gap:6px;flex-wrap:wrap;align-items:center}nav.top a{font:600 14px/1 var(--body);text-decoration:none;color:var(--muted);padding:10px 14px;border-radius:999px;min-height:40px;display:inline-flex;align-items:center}
nav.top a:hover{color:var(--fg);background:var(--surface)}nav.top a.cta{background:var(--indigo);color:#fff}
main{padding-block:44px 72px}
.read{max-width:70ch;margin:0 auto}
.eyebrow{font:600 12px/1 var(--body);letter-spacing:.09em;text-transform:uppercase;color:var(--green);margin:0 0 14px}
h1{font:800 clamp(30px,5vw,44px)/1.1 var(--display);letter-spacing:-.03em;margin:0 0 14px;text-wrap:balance}
.lead{color:var(--muted);font-size:19px;margin:0 0 18px}
.meta{display:flex;flex-wrap:wrap;gap:6px 18px;color:var(--muted);font-size:14px;margin:0 0 28px;padding-bottom:22px;border-bottom:1px solid var(--line)}
.cover{width:100%;height:auto;border-radius:12px;margin:0 0 28px}
article h2{font:700 24px/1.3 var(--display);letter-spacing:-.015em;margin:44px 0 12px;text-wrap:balance}
article h3{font:700 19px/1.35 var(--display);margin:30px 0 10px}
article p{margin:0 0 16px}article ul,article ol{margin:0 0 18px;padding-left:24px}article li{margin:0 0 6px}
article img{max-width:100%;height:auto;border-radius:8px}
article blockquote{margin:0 0 18px;padding:12px 18px;border-left:3px solid var(--green);background:var(--surface);border-radius:0 8px 8px 0}
article table{border-collapse:collapse;width:100%;font-size:15px;margin:0 0 20px;display:block;overflow-x:auto}
article th,article td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--line)}article th{background:var(--surface)}
article code{background:var(--surface);padding:2px 6px;border-radius:4px;font-size:.92em}
.share{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:36px 0 0;padding-top:22px;border-top:1px solid var(--line)}
.share strong{font:600 14px/1 var(--body);margin-right:4px}
.share a,.share button{font:600 14px/1 var(--body);text-decoration:none;color:var(--fg);background:var(--surface);border:1px solid var(--line);padding:10px 14px;border-radius:999px;min-height:40px;display:inline-flex;align-items:center;gap:6px;cursor:pointer}
.share a:hover,.share button:hover{border-color:var(--indigo)}
.cta-box{margin:40px 0 0;padding:24px;border-radius:14px;background:var(--ink);color:#fff}
.cta-box h2{font:700 22px/1.25 var(--display);margin:0 0 8px;color:#fff}.cta-box p{margin:0 0 16px;color:#C9CEE3}
.cta-box a{display:inline-flex;align-items:center;min-height:44px;padding:0 18px;border-radius:999px;font:600 15px/1 var(--body);text-decoration:none;margin:0 8px 8px 0}
.cta-box a.primary{background:#fff;color:var(--ink)}.cta-box a.secondary{border:1px solid #5A648A;color:#fff}
.list{display:grid;gap:18px;margin:28px 0 0;padding:0;list-style:none}
.list li{border:1px solid var(--line);border-radius:12px;padding:20px 22px}
.list a.t{font:700 21px/1.3 var(--display);text-decoration:none;color:var(--fg)}.list a.t:hover{color:var(--link)}
.list p{margin:8px 0 0;color:var(--muted)}.list .d{font-size:14px;color:var(--muted);margin:0 0 6px}
.back{display:inline-block;margin:0 0 22px;font-size:15px}
footer.site{border-top:1px solid var(--line);color:var(--muted);font-size:14px}footer.site .wrap{display:flex;flex-wrap:wrap;gap:8px 22px;padding-block:24px}
footer.site a{color:var(--muted)}
`;

function layout({ lang, title, description, canonical, alternates, image, body, type = 'website', jsonLd }) {
  const t = T[lang];
  const alt = alternates
    .map((a) => `<link rel="alternate" hreflang="${a.lang}" href="${SITE}${a.path}">`)
    .concat(alternates.length > 1 ? [`<link rel="alternate" hreflang="x-default" href="${SITE}${alternates.find((a) => a.lang === 'es').path}">`] : [])
    .join('\n');
  const img = image ? `${SITE}${image}` : `${SITE}/icon-512.png`;
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="#0E1630">
<link rel="canonical" href="${SITE}${canonical}">
${alt}
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta property="og:type" content="${type}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${SITE}${canonical}">
<meta property="og:image" content="${img}">
<meta property="og:locale" content="${lang === 'es' ? 'es_MX' : 'en_US'}">
<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">
<link rel="alternate" type="application/rss+xml" title="Korporia · Blog" href="${SITE}${lang === 'es' ? '' : '/en'}/blog/rss.xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;700;800&amp;family=Inter:wght@400;500;600&amp;display=swap">
<style>${CSS}</style>
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>` : ''}
</head>
<body>
<header class="top"><div class="wrap">
<a class="brand" href="${t.home}"><svg width="28" height="28" viewBox="0 0 48 48" aria-hidden="true"><rect x="6" y="4" width="9" height="40" fill="var(--k-stem)"/><polygon points="18,25 30,25 44,44 32,44" fill="var(--k-stem)"/><polygon points="18,22 32,4 44,4 30,22" fill="var(--k-arm)"/></svg><b>Korporia</b><span>${t.blog}</span></a>
<nav class="top"><a href="${t.prices}">${t.pricesLabel}</a><a href="${lang === 'es' ? '/blog/' : '/en/blog/'}">${t.blog}</a><a class="cta" href="${t.signup}">${lang === 'es' ? 'Empieza gratis' : 'Start free'}</a></nav>
</div></header>
<main><div class="wrap">${body}</div></main>
<footer class="site"><div class="wrap"><span>© ${new Date().getFullYear()} Korporia</span><a href="/terminos">${lang === 'es' ? 'Términos' : 'Terms'}</a><a href="/privacidad">${lang === 'es' ? 'Privacidad' : 'Privacy'}</a><a href="/cookies">Cookies</a><a href="mailto:hola@korporia.com">hola@korporia.com</a></div></footer>
<script type="module">${ORIGIN_SCRIPT}</script>
<script>
document.querySelectorAll('[data-copy]').forEach(function(b){b.addEventListener('click',function(){
  var done=function(){b.textContent=b.getAttribute('data-done')};
  if(navigator.share&&/Mobi/i.test(navigator.userAgent)){navigator.share({title:document.title,url:b.getAttribute('data-copy')}).catch(function(){});return}
  if(navigator.clipboard){navigator.clipboard.writeText(b.getAttribute('data-copy')).then(done)}
})});
</script>
</body>
</html>
`;
}

function shareBar(url, title, lang) {
  const t = T[lang];
  const u = encodeURIComponent(url);
  const text = encodeURIComponent(`${title} ${url}`);
  return `<div class="share" aria-label="${t.share}">
<strong>${t.share}</strong>
<a href="https://wa.me/?text=${text}" target="_blank" rel="noopener">WhatsApp</a>
<a href="https://www.linkedin.com/sharing/share-offsite/?url=${u}" target="_blank" rel="noopener">LinkedIn</a>
<a href="https://www.facebook.com/sharer/sharer.php?u=${u}" target="_blank" rel="noopener">Facebook</a>
<button type="button" data-copy="${esc(url)}" data-done="${t.copied}">${t.copy}</button>
</div>`;
}

function ctaBox(lang) {
  const t = T[lang];
  return `<aside class="cta-box"><h2>${t.ctaTitle}</h2><p>${t.ctaText}</p>
<a class="primary" href="${t.signup}">${t.ctaBtn}</a><a class="secondary" href="${t.home}#lista-espera">${t.ctaWait}</a></aside>`;
}

// ---------------------------------------------------------------------
const files = existsSync(SRC) ? readdirSync(SRC).filter((f) => f.endsWith('.md') && !f.startsWith('_') && f !== 'README.md') : [];
const posts = new Map(); // slug -> { es, en }
for (const f of files) {
  const m = f.match(/^([a-z0-9-]+?)(\.en)?\.md$/);
  if (!m) throw new Error(`blog/${f}: el nombre debe ser minúsculas, números y guiones (ej. reforma-40-horas.md)`);
  const [, slug, en] = m;
  const post = posts.get(slug) ?? {};
  post[en ? 'en' : 'es'] = parse(join(SRC, f));
  posts.set(slug, post);
}
const visible = [...posts.entries()]
  .filter(([slug, p]) => {
    if (!p.es) throw new Error(`blog/${slug}.en.md no tiene versión en español (${slug}.md)`);
    return p.es.meta.draft !== 'true';
  })
  .sort((a, b) => b[1].es.meta.date.localeCompare(a[1].es.meta.date));

const write = (path, html) => {
  mkdirSync(dirname(join(OUT, path)), { recursive: true });
  writeFileSync(join(OUT, path), html);
};
// La versión en inglés puede tener su propia dirección (slug: en su encabezado)
const pathOf = (slug, lang) => {
  const own = posts.get(slug)?.[lang]?.meta.slug;
  if (own && !/^[a-z0-9-]+$/.test(own)) throw new Error(`blog/${slug}: slug inválido (${own})`);
  return lang === 'es' ? `/blog/${own || slug}` : `/en/blog/${own || slug}`;
};

for (const [slug, p] of visible) {
  for (const lang of ['es', 'en']) {
    const post = p[lang];
    if (!post) continue;
    const t = T[lang];
    const url = `${SITE}${pathOf(slug, lang)}`;
    const other = lang === 'es' ? (p.en ? `<a href="${pathOf(slug, 'en')}">${T.es.readEn}</a>` : '') : `<a href="${pathOf(slug, 'es')}">${T.en.readEs}</a>`;
    const alternates = [{ lang: 'es', path: pathOf(slug, 'es') }, ...(p.en ? [{ lang: 'en', path: pathOf(slug, 'en') }] : [])];
    const { meta } = post;
    const body = `<div class="read">
<a class="back" href="${lang === 'es' ? '/blog/' : '/en/blog/'}">← ${t.back}</a>
<article>
<p class="eyebrow">${t.blog}</p>
<h1>${esc(meta.title)}</h1>
<p class="lead">${esc(meta.description)}</p>
<div class="meta"><time datetime="${meta.date}">${fmtDate(meta.date, lang)}</time>${meta.author ? `<span>${t.by} ${esc(meta.author)}</span>` : ''}${other ? `<span>${other}</span>` : ''}</div>
${meta.image ? `<img class="cover" src="${esc(meta.image)}" alt="${esc(meta.image_alt)}" width="1200" height="630">` : ''}
${post.html}
</article>
${shareBar(url, meta.title, lang)}
${ctaBox(lang)}
</div>`;
    write(`${pathOf(slug, lang)}/index.html`, layout({
      lang, title: meta.seo_title || `${meta.title} · Korporia`, description: meta.description, canonical: pathOf(slug, lang), alternates, image: meta.image, body, type: 'article',
      jsonLd: { '@context': 'https://schema.org', '@type': 'BlogPosting', headline: meta.title, description: meta.description, datePublished: meta.date, inLanguage: t.lang, author: { '@type': meta.author ? 'Person' : 'Organization', name: meta.author || 'Korporia' }, publisher: { '@type': 'Organization', name: 'Korporia', logo: `${SITE}/icon-512.png` }, mainEntityOfPage: url, ...(meta.image ? { image: `${SITE}${meta.image}` } : {}) },
    }));
  }
}

for (const lang of ['es', 'en']) {
  const t = T[lang];
  const list = visible.filter(([, p]) => p[lang]);
  const items = list
    .map(([slug, p]) => `<li><p class="d">${fmtDate(p[lang].meta.date, lang)}</p><a class="t" href="${pathOf(slug, lang)}">${esc(p[lang].meta.title)}</a><p>${esc(p[lang].meta.description)}</p></li>`)
    .join('\n');
  const index = lang === 'es' ? '/blog/' : '/en/blog/';
  write(`${index}index.html`, layout({
    lang, title: `${t.blog} · Korporia`, description: t.intro, canonical: index,
    alternates: [{ lang: 'es', path: '/blog/' }, { lang: 'en', path: '/en/blog/' }],
    body: `<div class="read"><p class="eyebrow">Korporia</p><h1>${t.blog}</h1><p class="lead">${t.intro}</p>${items ? `<ul class="list">${items}</ul>` : `<p>${t.empty}</p>`}${ctaBox(lang)}</div>`,
  }));
  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Korporia · ${t.blog}</title><link>${SITE}${index}</link><description>${esc(t.intro)}</description><language>${t.lang}</language>
${list.map(([slug, p]) => `<item><title>${esc(p[lang].meta.title)}</title><link>${SITE}${pathOf(slug, lang)}</link><guid>${SITE}${pathOf(slug, lang)}</guid><pubDate>${new Date(`${p[lang].meta.date}T12:00:00Z`).toUTCString()}</pubDate><description>${esc(p[lang].meta.description)}</description></item>`).join('\n')}
</channel></rss>
`;
  write(`${index}rss.xml`, rss);
}

// Sitemap: se agregan el blog y sus artículos
const sitemapPath = join(OUT, 'sitemap.xml');
if (existsSync(sitemapPath)) {
  const entries = [
    `  <url><loc>${SITE}/blog/</loc><xhtml:link rel="alternate" hreflang="en" href="${SITE}/en/blog/"/></url>`,
    `  <url><loc>${SITE}/en/blog/</loc><xhtml:link rel="alternate" hreflang="es" href="${SITE}/blog/"/></url>`,
    ...visible.flatMap(([slug, p]) => {
      const es = `  <url><loc>${SITE}${pathOf(slug, 'es')}</loc><lastmod>${p.es.meta.date}</lastmod>${p.en ? `<xhtml:link rel="alternate" hreflang="en" href="${SITE}${pathOf(slug, 'en')}"/>` : ''}</url>`;
      const en = p.en ? [`  <url><loc>${SITE}${pathOf(slug, 'en')}</loc><lastmod>${p.en.meta.date}</lastmod><xhtml:link rel="alternate" hreflang="es" href="${SITE}${pathOf(slug, 'es')}"/></url>`] : [];
      return [es, ...en];
    }),
  ];
  const xml = readFileSync(sitemapPath, 'utf8').replace('</urlset>', `${entries.join('\n')}\n</urlset>`);
  writeFileSync(sitemapPath, xml);
}

console.log(`Blog: ${visible.length} artículo(s) publicados`);

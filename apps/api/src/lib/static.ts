/**
 * Un solo Worker sirve dos sitios desde los mismos archivos estáticos (apps/web/dist):
 *  - korporia.com          → sitio público (landing, precios, legales), compilado en /_site
 *  - app.korporia.com      → la app (PWA de una sola página)
 * www.korporia.com redirige a korporia.com.
 */
const SITE_HOSTS = new Set(['korporia.com', 'www.korporia.com']);

/** Ruta del archivo del sitio: /precios → /_site/precios/index.html */
export function sitePath(pathname: string): string {
  const clean = pathname.replace(/\/{2,}/g, '/');
  if (clean.endsWith('/')) return `/_site${clean}index.html`;
  const last = clean.slice(clean.lastIndexOf('/') + 1);
  return last.includes('.') ? `/_site${clean}` : `/_site${clean}/index.html`;
}

export async function serveStatic(request: Request, assets: Fetcher): Promise<Response> {
  const url = new URL(request.url);

  if (url.hostname === 'www.korporia.com') {
    return Response.redirect(`https://korporia.com${url.pathname}${url.search}`, 301);
  }

  if (SITE_HOSTS.has(url.hostname)) {
    const res = await assets.fetch(new Request(new URL(sitePath(url.pathname), url), request));
    if (res.status !== 404) return res;
    // Página que no existe: la portada, con estado 404
    const home = await assets.fetch(new Request(new URL('/_site/index.html', url), request));
    return new Response(home.body, { status: 404, headers: home.headers });
  }

  // App: el sitio no se publica dentro de app.korporia.com
  if (url.pathname.startsWith('/_site/')) return new Response('No encontrado', { status: 404 });
  const res = await assets.fetch(request);
  if (res.status !== 404 || request.method !== 'GET' || url.pathname.includes('.')) return res;
  // Rutas de la app (/registro, /jornada/hoy…): siempre index.html
  return assets.fetch(new Request(new URL('/index.html', url), request));
}

import { describe, expect, it } from 'vitest';
import { serveStatic, sitePath } from './static';

describe('sitePath', () => {
  it('convierte rutas del sitio a archivos de /_site', () => {
    expect(sitePath('/')).toBe('/_site/index.html');
    expect(sitePath('/precios')).toBe('/_site/precios/index.html');
    expect(sitePath('/en/')).toBe('/_site/en/index.html');
    expect(sitePath('/assets/landing-x.js')).toBe('/_site/assets/landing-x.js');
    expect(sitePath('//terminos')).toBe('/_site/terminos/index.html');
  });
});

describe('serveStatic', () => {
  const files: Record<string, string> = { '/_site/index.html': 'sitio', '/_site/precios/index.html': 'precios', '/index.html': 'app' };
  const assets = {
    fetch: async (req: Request) => {
      const body = files[new URL(req.url).pathname];
      return new Response(body ?? 'no', { status: body ? 200 : 404 });
    },
  } as unknown as Fetcher;
  const get = (u: string) => serveStatic(new Request(u), assets);

  it('korporia.com sirve el sitio', async () => {
    expect(await (await get('https://korporia.com/precios')).text()).toBe('precios');
    const missing = await get('https://korporia.com/no-existe');
    expect(missing.status).toBe(404);
    expect(await missing.text()).toBe('sitio');
  });
  it('www redirige al dominio principal', async () => {
    const r = await get('https://www.korporia.com/precios?x=1');
    expect(r.status).toBe(301);
    expect(r.headers.get('Location')).toBe('https://korporia.com/precios?x=1');
  });
  it('app.korporia.com sirve la app y sus rutas', async () => {
    expect(await (await get('https://app.korporia.com/registro')).text()).toBe('app');
    expect((await get('https://app.korporia.com/_site/index.html')).status).toBe(404);
  });
});

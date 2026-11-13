// Origen de la visita (?origen= de una guía, campaña o el enlace de un despacho contable).
// Se guarda solo durante la visita (sessionStorage, sin cookies) y viaja con:
//  - los enlaces a app.korporia.com/registro (se les agrega ?origen=…)
//  - el alta en la lista de espera (campo origin)
// Vive fuera de las páginas importadas del tablero de Marketing para que una reimportación no lo borre.
const KEY = 'korporia-origen';

function normalize(value) {
  const v = String(value || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40);
  return v.length >= 2 ? v : null;
}

function read() {
  let origin = normalize(new URLSearchParams(location.search).get('origen'));
  try {
    if (origin) sessionStorage.setItem(KEY, origin);
    else origin = normalize(sessionStorage.getItem(KEY));
  } catch {
    /* navegación privada: se usa solo el de la URL */
  }
  return origin;
}

const origin = read();

if (origin) {
  const withOrigin = (href) => {
    try {
      const url = new URL(href, location.href);
      const toSignup = url.hostname === 'app.korporia.com' && url.pathname.startsWith('/registro');
      const internal = url.hostname === location.hostname;
      if ((toSignup || internal) && !url.searchParams.has('origen')) url.searchParams.set('origen', origin);
      return url.toString();
    } catch {
      return href;
    }
  };
  // Al hacer clic (o clic central) en un enlace al registro o a otra página del sitio
  const onClick = (e) => {
    const a = e.target instanceof Element ? e.target.closest('a[href]') : null;
    if (a && !a.href.startsWith('mailto:') && !a.href.includes('wa.me')) a.href = withOrigin(a.getAttribute('href'));
  };
  document.addEventListener('click', onClick, true);
  document.addEventListener('auxclick', onClick, true);

  // La lista de espera se manda con fetch desde la página: se le agrega el origen
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input?.url;
    if (url && url.includes('/api/core/waitlist') && init && typeof init.body === 'string') {
      try {
        const body = JSON.parse(init.body);
        if (!body.origin) init = { ...init, body: JSON.stringify({ ...body, origin }) };
      } catch {
        /* cuerpo no JSON: se manda igual */
      }
    }
    return nativeFetch(input, init);
  };
}

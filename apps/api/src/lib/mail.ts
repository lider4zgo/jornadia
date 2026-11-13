import { HTTPException } from 'hono/http-exception';
import type { Env } from '../env';

const FROM = 'Korporia <no-responder@korporia.com>';

/** Manda un correo con Resend (los códigos del segundo paso). */
export async function sendMail(env: Env, to: string, subject: string, html: string, text: string): Promise<void> {
  if (!env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY no está configurada');
    throw new HTTPException(503, { message: 'No pudimos enviar el código. Intenta en unos minutos o escríbenos a soporte@korporia.com.' });
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], subject, html, text }),
  });
  if (!res.ok) {
    console.error('resend failed', res.status, await res.text().catch(() => ''));
    throw new HTTPException(502, { message: 'No pudimos enviar el código. Intenta de nuevo en un momento.' });
  }
}

/** Correo con el código de 6 dígitos. */
export function codeEmail(code: string, purpose: 'device' | 'sensitive', device: string) {
  const why =
    purpose === 'device'
      ? `Alguien inició sesión en Korporia con tu contraseña desde ${device}. Si fuiste tú, escribe este código para confirmar el dispositivo.`
      : 'Escribe este código para confirmar el cambio que estás haciendo en Korporia.';
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#F4F5FA;font-family:Inter,Segoe UI,Arial,sans-serif;color:#0E1630">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:480px;background:#fff;border-radius:12px" cellpadding="0" cellspacing="0"><tr><td style="padding:28px">
<p style="margin:0 0 18px;font-weight:700;font-size:20px">Korporia</p>
<p style="margin:0 0 18px;font-size:15px;line-height:1.6">${why}</p>
<p style="margin:0 0 18px;font-size:34px;font-weight:700;letter-spacing:8px">${code}</p>
<p style="margin:0 0 8px;font-size:14px;color:#4A5470;line-height:1.6">Vence en 10 minutos. Nadie de Korporia te lo va a pedir.</p>
<p style="margin:0;font-size:14px;color:#4A5470;line-height:1.6">Si no fuiste tú, cambia tu contraseña y escríbenos a soporte@korporia.com.</p>
</td></tr></table></td></tr></table></body></html>`;
  const text = `${why}\n\nCódigo: ${code}\n\nVence en 10 minutos. Nadie de Korporia te lo va a pedir.\nSi no fuiste tú, cambia tu contraseña y escríbenos a soporte@korporia.com.`;
  return { html, text, subject: `${code} es tu código de Korporia` };
}

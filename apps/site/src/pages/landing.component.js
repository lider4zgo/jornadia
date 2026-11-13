// Generado por scripts/import-tablero.mjs a partir del tablero de Marketing. No editar a mano.
import { DCLogic } from '../runtime.js';

class Component extends DCLogic {
constructor(props) {
super(props);
this.state = { lang: 'es', openFaq: 0, joined: false, menu: false };
}
componentDidMount() {
const forced = document.documentElement.getAttribute('data-force-lang');
if (forced === 'es' || forced === 'en') { try { window.localStorage.setItem('kp-lang', forced); } catch (e) {} this.setState({ lang: forced }); return; }
// Idioma: 1) elección guardada, 2) idioma del dispositivo, 3) zona horaria (aprox. de ubicación), 4) español
let lang = null;
try { const saved = window.localStorage.getItem('kp-lang'); if (saved === 'es' || saved === 'en') lang = saved; } catch (e) {}
if (!lang) {
try {
const list = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || '']).map((l) => String(l).toLowerCase());
for (const l of list) { if (l.indexOf('es') === 0) { lang = 'es'; break; } if (l.indexOf('en') === 0) { lang = 'en'; break; } }
} catch (e) {}
}
if (!lang) {
try {
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
const enZones = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Phoenix', 'America/Anchorage', 'Pacific/Honolulu', 'America/Toronto', 'America/Vancouver', 'America/Edmonton', 'America/Winnipeg', 'America/Halifax'];
lang = enZones.indexOf(tz) >= 0 ? 'en' : 'es';
} catch (e) { lang = 'es'; }
}
this.setState({ lang });
}
setLang(lang) {
try { window.localStorage.setItem('kp-lang', lang); } catch (e) {}
try { document.documentElement.lang = lang; } catch (e) {}
this.setState({ lang });
}
renderVals() {
const lang = this.state.lang === 'en' ? 'en' : 'es';
const T = {
es: {
navLabel: 'Principal', navModules: 'Módulos', navHow: 'Cómo funciona', navPricing: 'Precios', navBlog: 'Blog', navBlogHref: '/blog/', navFaq: 'Preguntas', navLogin: 'Iniciar sesión', navTrial: 'Empezar gratis', menu: 'Menú', langLabel: 'Idioma',
heroBadge: 'Diseñado para el registro electrónico de jornada 2027', heroTitle: 'Crece con estructura.',
heroSub: 'Hoy, asistencia y personal. Muy pronto, nómina y finanzas, todo en un solo lugar. La estructura de una gran empresa, al precio y a la medida de la tuya.',
ctaTrial: 'Empezar gratis', ctaPricing: 'Ver precios', perks: ['Korporia Starter: gratis hasta 25 empleados', 'Sin tarjeta para empezar', 'Sin plazos forzosos'],
mockAlt: 'Vista ilustrativa del panel de Korporia Jornada y del registro desde el celular', mockTitle: 'Asistencia de hoy', mockSite: 'Obra Norte',
stats: [{ label: 'Presentes', value: '58' }, { label: 'Retardos', value: '3' }, { label: 'Horas extra', value: '6 h' }],
mockWeek: 'Semana actual', mockCap: 'Tope: 46 h', mockPayroll: 'Reporte de jornada listo para revisar', mockPayrollSub: 'Horas trabajadas, retardos y horas extra de la semana', mockGeo: 'Dentro de la geocerca', mockClock: 'Registrar entrada',
probEyebrow: 'El reto', probTitle: 'Tu empresa creció. Tus herramientas, no.',
probSub: 'Listas en papel, hojas de cálculo, mensajes de WhatsApp y archivos que van y vienen con el contador. Funciona… hasta que deja de funcionar.',
problems: [
{ title: 'La reforma ya tiene fecha', body: 'Desde el 1 de enero de 2027, el registro electrónico de jornada es obligatorio, y la jornada máxima bajará de 46 horas en 2027 a 40 horas en 2030.' },
{ title: 'Las multas no son menores', body: 'La ley contempla sanciones de 250 a 5,000 UMA. Un registro claro, en el que cada corrección queda registrada, es tu mejor respaldo.' },
{ title: 'El tiempo se va en papeleo', body: 'Cada quincena se van horas en capturar asistencias, calcular la nómina y cuadrar con el IMSS. Son horas que no dedicas a vender ni a crecer.' }
],
modEyebrow: 'La plataforma', modTitle: 'RH y finanzas en un solo lugar', modSub: 'Empieza hoy con Jornada y RH básico, incluido sin costo en todos los planes de pago y por 6 meses en Korporia Starter. Los demás módulos se activan conforme estén listos; si ya están incluidos en tu plan, sin costo extra.',
avail: 'Disponible hoy', soon: 'Próximamente',
wlTitle: 'Anótate en la lista de espera', wlBody: 'Te avisaremos cuando Despegue, Full y cada módulo estén listos. Si te registras en 2027 y contratas dentro de los 60 días siguientes a su lanzamiento, conservas el Precio Fundador.',
wlLabel: 'Correo', wlPlaceholder: 'tu@empresa.com', wlButton: 'Avisarme', wlConsent: 'Korporia (Erik Rodrigo Martínez Canales) usará tu correo para avisarte cuando los planes y módulos estén disponibles y, si no lo rechazas, para enviarte novedades y encuestas. Consulta el', wlPrivacy: 'aviso de privacidad', wlOptOut: 'No deseo recibir novedades ni encuestas', wlDone: 'Listo. Te avisaremos por correo.',
howEyebrow: 'Cómo funciona', howTitle: 'En marcha el mismo día',
steps: [
{ n: '01', title: 'Crea tu cuenta', body: 'Entra con tu correo y contraseña, o con Google o Microsoft. Sin tarjeta y sin hablar con un vendedor.' },
{ n: '02', title: 'Configura tu empresa', body: 'Un asistente te guía paso a paso: da de alta tus sucursales u obras con su geocerca, define los horarios y carga a tu personal desde una plantilla de Excel.' },
{ n: '03', title: 'Invita a tu equipo', body: 'Cada trabajador recibe un enlace por WhatsApp, lo abre en el navegador de su celular y registra su entrada con selfie o PIN. No instala nada, y si se queda sin señal, el registro se guarda y se envía después.' }
],
signInWith: 'Inicia sesión con:', emailLabel: 'Correo y contraseña',
whoTitle: 'Hecho para quienes sostienen la empresa',
who: [
{ role: 'Dueños', title: 'Control sin estar encima de todo', body: 'Quién llegó y cuántas horas extra llevas, desde tu celular. Pronto, también tu nómina y tu flujo de efectivo.' },
{ role: 'Responsables de RH', title: 'Menos captura, más tiempo para tu gente', body: 'Expedientes, vacaciones e incidencias conectados con la asistencia real desde hoy. La nómina, conforme esté lista.' },
{ role: 'Contadores', title: 'Información ordenada y a tiempo', body: 'Tu cliente te da acceso a sus reportes de jornada. Pronto, un solo panel para administrar a todas tus empresas cliente.' }
],
priceEyebrow: 'Precios', priceTitle: 'Un plan para cada etapa de tu empresa',
priceSub: 'Hoy están disponibles Korporia Starter, gratis, y Jornada, ambos con RH básico. Despegue y Full llegan pronto: anótate en la lista de espera y conserva el Precio Fundador. Siempre pagas solo por tus empleados activos.', priceCta: 'Calcula tu precio',
priceFoot: 'Precios de lanzamiento 2027 en pesos mexicanos, más IVA. Con Despegue, Korporia timbrará tu nómina, enviará tus movimientos al IMSS y preparará la dispersión. El pago anual no es reembolsable, salvo lo previsto en los Términos. Consulta las condiciones completas en', priceFootLink: 'Precios', priceFootAnd: ' y en los ',
pc: [
{ name: 'Korporia Starter', sub: 'Asistencia y RH básico para empezar', price: 'Gratis', unit: 'hasta 25 empleados', note: 'Checador 3 meses y RH básico 6 meses. Después, Jornada desde $49 al mes, con RH básico incluido.', badge: 'Empieza gratis', badgeStyle: 'padding: 4px 10px; background: #FDF1DF; color: #7A4A05; font-size: 12px; font-weight: 600; border-radius: 100px; white-space: nowrap' },
{ name: 'Despegue', sub: 'Personal y nómina para equipos de hasta 10', price: '$149', unit: 'al mes', note: 'Durante tus primeros 6 meses. Desde el mes 7, a partir de $249. Anótate en la lista de espera.', badge: 'Próximamente' },
{ name: 'Full', sub: 'Todo Korporia, RH y finanzas, para equipos en crecimiento', price: 'Desde $249', unit: 'al mes', note: 'Precio de arranque para equipos de hasta 25 empleados durante tus primeros 6 meses. Desde 26 empleados, $40 por empleado al mes (a partir del mes 7, $60). Anótate en la lista de espera.', badge: 'Próximamente' },
{ name: 'Empresa', sub: 'Más de 250 empleados o varias razones sociales', price: 'Hablemos', unit: '', note: 'Hoy: Jornada y RH básico para más de 250 empleados y varias razones sociales. El resto de Full, conforme esté listo. Armamos una propuesta a la medida, con implementación sin costo y soporte prioritario.', cta: 'Contactar a ventas', ctaHref: 'https://wa.me/528718963470?text=Hola%2C%20quiero%20informaci%C3%B3n%20del%20plan%20Empresa%20de%20Korporia', ctaAlt: 'o escríbenos a ventas@korporia.com' }
],
faqTitle: 'Preguntas frecuentes',
faq: [
['¿Qué es el registro electrónico de jornada?', 'Es la obligación de registrar electrónicamente la entrada y salida de tus trabajadores, exigible desde el 1 de enero de 2027. Korporia Jornada lo genera de forma automática, con el acuerdo del trabajador, y cada corrección queda registrada con fecha y responsable, sin posibilidad de borrarla. Lo actualizaremos cuando la STPS publique sus reglas.'],
['¿Qué incluye Korporia Starter?', 'Es el plan gratuito para empresas de hasta 25 empleados. Los primeros 3 meses incluye el checador completo y RH básico (expediente, contratación, vacaciones e incidencias y portal del empleado); del mes 4 al 6, RH básico. Al día 90 el checador se deshabilita y conservas la consulta y la exportación de tus registros; para seguir registrando, contratas Jornada. Al terminar el mes 6, tu cuenta pasa a solo lectura con exportación por 90 días; después, la información se archiva y se elimina a los 12 meses. Incluye 1 razón social, 1 administrador y 50 MB de documentos por empleado activo (promedio de la cuenta, archivos de hasta 10 MB), con una cuenta por RFC. Funciona en modo demo: no timbra ni envía movimientos al IMSS. El soporte es por el centro de ayuda.'],
['¿Cómo inicio sesión?', 'Entra con tu correo y contraseña, o con tu cuenta de Google o Microsoft: solo confirmas el acceso y entras.'],
['¿Mis trabajadores necesitan instalar algo?', 'No. Korporia funciona completo en el navegador del celular (Android o iPhone) o de la computadora. El trabajador solo abre su enlace; si quiere, puede guardar un acceso directo en su pantalla de inicio. Si se queda sin señal, el registro se guarda y se sincroniza al volver a conectarse.'],
['¿Y si un trabajador no quiere tomarse una selfie?', 'La verificación facial es opcional. Quien no la autorice puede registrar su entrada con PIN y ubicación, sin ninguna consecuencia.'],
['¿Korporia timbra mi nómina?', 'Sí, con el plan Despegue, que llega pronto: Korporia timbrará tu nómina, enviará los movimientos al IMSS y preparará la dispersión. Las pruebas gratuitas funcionan en modo demo, sin validez fiscal.'],
['¿Mi contador puede usarlo?', 'Sí. Hoy puedes darle acceso a tus reportes de jornada. Cuando esté listo el panel para contadores, podrá administrar desde ahí a todas las empresas que se lo autoricen.'],
['¿Dónde se guardan mis datos?', 'En servidores en la nube de Supabase y Cloudflare, en Estados Unidos, con la información cifrada, y cada acceso del equipo de Korporia queda registrado en una bitácora. Encontrarás los detalles en nuestro aviso de privacidad y en la lista de subencargados.'],
['¿Puedo cancelar cuando quiera?', 'Sí, no hay plazos forzosos. Si pagaste un año, conservas el servicio hasta que termine el periodo pagado; el pago anual no es reembolsable, salvo lo previsto en los Términos. Al cancelar, tienes acceso de solo lectura durante 90 días para exportar toda tu información. Después, tu información se archiva y se elimina a los 12 meses.']
],
closeTitle: 'Ordena hoy lo que te hará crecer mañana.', closeSub: 'Empieza gratis con Korporia Starter y prepárate para la reforma 2027 desde el primer día.',
footLabel: 'Pie de página', footProduct: 'Producto', footHelp: 'Centro de ayuda', footTerms: 'Términos y condiciones', footPrivacy: 'Aviso de privacidad', footSub: 'Subencargados', footCookies: 'Aviso de cookies', footContact: 'Contacto',
footFine: 'Korporia es un nombre comercial de Erik Rodrigo Martínez Canales. Precios en pesos mexicanos más IVA. Las funciones marcadas “Próximamente” se activan conforme estén listas. La vista del producto es ilustrativa, con cifras de ejemplo.'
},
en: {
navLabel: 'Main', navModules: 'Modules', navHow: 'How it works', navPricing: 'Pricing', navBlog: 'Blog', navBlogHref: '/en/blog/', navFaq: 'FAQ', navLogin: 'Log in', navTrial: 'Start free', menu: 'Menu', langLabel: 'Language',
heroBadge: 'Designed for Mexico’s 2027 electronic time-tracking rule', heroTitle: 'Grow with structure.',
heroSub: 'Today, attendance and people. Coming soon, payroll and finance, all in one place. The structure of a large company, sized and priced for yours.',
ctaTrial: 'Start free', ctaPricing: 'See pricing', perks: ['Korporia Starter: free for up to 25 employees', 'No card to start', 'No long-term contracts'],
mockAlt: 'Illustrative view of the Korporia Jornada dashboard and clocking in from a phone', mockTitle: 'Today’s attendance', mockSite: 'North site',
stats: [{ label: 'Present', value: '58' }, { label: 'Late', value: '3' }, { label: 'Overtime', value: '6 h' }],
mockWeek: 'This week', mockCap: 'Limit: 46 h', mockPayroll: 'Time report ready to review', mockPayrollSub: 'Hours worked, late arrivals and overtime this week', mockGeo: 'Inside the geofence', mockClock: 'Clock in',
probEyebrow: 'The challenge', probTitle: 'Your business grew. Your tools didn’t.',
probSub: 'Paper sign-in sheets, spreadsheets, WhatsApp messages and files going back and forth with your accountant. It works… until it doesn’t.',
problems: [
{ title: 'The new rule has a date', body: 'Starting January 1, 2027, electronic time tracking is mandatory in Mexico, and the maximum workweek will drop from 46 hours in 2027 to 40 hours in 2030.' },
{ title: 'The fines are not small', body: 'The law sets penalties of 250 to 5,000 UMA. A clear record, where every correction is logged, is your best protection.' },
{ title: 'Time disappears into paperwork', body: 'Every payday, hours go into logging attendance, running payroll and reconciling with IMSS. Those are hours you don’t spend selling or growing.' }
],
modEyebrow: 'The platform', modTitle: 'HR and finance in one place', modSub: 'Start today with Jornada and basic HR, included at no cost in every paid plan and for 6 months on Korporia Starter. The other modules switch on as they become ready; if they’re already included in your plan, at no extra cost.',
avail: 'Available today', soon: 'Coming soon',
wlTitle: 'Join the waitlist', wlBody: 'We’ll let you know when Despegue, Full and each module are ready. Register in 2027 and subscribe within 60 days of its release, and you keep the Founder Price.',
wlLabel: 'Email', wlPlaceholder: 'you@company.com', wlButton: 'Notify me', wlConsent: 'Korporia (Erik Rodrigo Martínez Canales) will use your email to let you know when plans and modules are available and, unless you opt out, to send you news and surveys. See our', wlPrivacy: 'privacy notice', wlOptOut: 'I don’t want to receive news or surveys', wlDone: 'Done. We’ll let you know by email.',
howEyebrow: 'How it works', howTitle: 'Up and running the same day',
steps: [
{ n: '01', title: 'Create your account', body: 'Sign in with your email and password, or with Google or Microsoft. No card and no sales call.' },
{ n: '02', title: 'Set up your company', body: 'A guided assistant walks you through it: add your branches or job sites with their geofence, set schedules and upload your staff from an Excel template.' },
{ n: '03', title: 'Invite your team', body: 'Each worker gets a link on WhatsApp, opens it in their phone’s browser and clocks in with a selfie or PIN. Nothing to install, and if they lose signal, the record is saved and sent later.' }
],
signInWith: 'Sign in with:', emailLabel: 'Email and password',
whoTitle: 'Built for the people who keep the business running',
who: [
{ role: 'Owners', title: 'In control without micromanaging', body: 'Who showed up and how much overtime your team has, right from your phone. Soon, your payroll and cash flow too.' },
{ role: 'HR managers', title: 'Less data entry, more time for your people', body: 'Employee records, time off and incidents connected to real attendance, starting today. Payroll, as it becomes ready.' },
{ role: 'Accountants', title: 'Organized, on-time information', body: 'Your client gives you access to their time reports. Soon, a single panel to manage all your client companies.' }
],
priceEyebrow: 'Pricing', priceTitle: 'A plan for every stage of your business',
priceSub: 'Korporia Starter, free, and Jornada are available today, both with basic HR. Despegue and Full are coming soon: join the waitlist and keep the Founder Price. You always pay only for your active employees.', priceCta: 'Calculate your price',
priceFoot: '2027 launch prices in Mexican pesos, plus VAT. With Despegue, Korporia will stamp your payroll (CFDI), file changes with IMSS and prepare the disbursement. Annual plans are non-refundable, except as provided in the Terms. See the full terms on', priceFootLink: 'Pricing', priceFootAnd: ' and in the ',
pc: [
{ name: 'Korporia Starter', sub: 'Attendance and basic HR to get started', price: 'Free', unit: 'up to 25 employees', note: 'Time clock for 3 months and basic HR for 6 months. Then Jornada from $49 a month, with basic HR included.', badge: 'Start free', badgeStyle: 'padding: 4px 10px; background: #FDF1DF; color: #7A4A05; font-size: 12px; font-weight: 600; border-radius: 100px; white-space: nowrap' },
{ name: 'Despegue', sub: 'People and payroll for teams of up to 10', price: '$149', unit: 'a month', note: 'For your first 6 months. From month 7, starting at $249. Join the waitlist.', badge: 'Coming soon' },
{ name: 'Full', sub: 'All of Korporia, HR and finance, for growing teams', price: 'From $249', unit: 'a month', note: 'Starter price for teams of up to 25 employees during your first 6 months. From 26 employees, $40 per employee a month ($60 from month 7). Join the waitlist.', badge: 'Coming soon' },
{ name: 'Empresa', sub: 'More than 250 employees or multiple legal entities', price: 'Let’s talk', unit: '', note: 'Today: Jornada and basic HR for more than 250 employees and multiple legal entities. The rest of Full, as it becomes ready. We’ll put together a tailored proposal, with free implementation and priority support.', cta: 'Contact sales', ctaHref: 'https://wa.me/528718963470?text=Hi%2C%20I%27d%20like%20information%20about%20the%20Korporia%20Empresa%20plan', ctaAlt: 'or email ventas@korporia.com' }
],
faqTitle: 'Frequently asked questions',
faq: [
['What is electronic time tracking?', 'It is the legal requirement in Mexico to record your workers’ clock-in and clock-out times electronically, enforceable from January 1, 2027. Korporia Jornada creates that record automatically, with the worker’s agreement, and every correction is logged with date and author and can’t be deleted. We’ll update it when the STPS publishes its rules.'],
['What does Korporia Starter include?', 'It’s the free plan for companies with up to 25 employees. For the first 3 months it includes the full time clock and basic HR (employee records, hiring, time off and incidents, and the employee portal); from month 4 to 6, basic HR. On day 90 the time clock is turned off and you keep access to view and export your records; to keep clocking in, you subscribe to Jornada. After month 6, your account becomes read-only with export for 90 days; after that, your data is archived and deleted at 12 months. It includes 1 legal entity, 1 admin and 50 MB of documents per active employee (averaged across the account, files up to 10 MB), with one account per RFC. It runs in demo mode: it doesn’t stamp CFDI or file with IMSS. Support is through the help center.'],
['How do I sign in?', 'Sign in with your email and password, or with your Google or Microsoft account: just confirm access and you’re in.'],
['Do my workers need to install anything?', 'No. Korporia runs entirely in the browser on any phone (Android or iPhone) or computer. Workers just open their link and can optionally save a shortcut to their home screen. If they lose signal, the record is saved and syncs once they’re back online.'],
['What if a worker doesn’t want to take a selfie?', 'Face verification is optional. Anyone who doesn’t authorize it can clock in with a PIN and location, with no consequences.'],
['Does Korporia stamp my payroll?', 'Yes, with the Despegue plan, coming soon: Korporia will stamp your payroll (CFDI), file the changes with IMSS and prepare the disbursement. Free trials run in demo mode, with no tax validity.'],
['Can my accountant use it?', 'Yes. Today you can give them access to your time reports. Once the accountant panel is ready, they’ll manage every company that authorizes them from there.'],
['Where is my data stored?', 'On Supabase and Cloudflare cloud servers in the United States, with your information encrypted, and every access by the Korporia team is logged. You’ll find the details in our privacy notice and subprocessor list.'],
['Can I cancel anytime?', 'Yes, there are no long-term contracts. If you paid for a year, you keep the service until the paid period ends; annual plans are non-refundable, except as provided in the Terms. When you cancel, you get read-only access for 90 days to export all your information. After that, your data is archived and deleted at 12 months.']
],
closeTitle: 'Get organized today for the growth of tomorrow.', closeSub: 'Start free with Korporia Starter and get ready for the 2027 rule from day one.',
footLabel: 'Footer', footProduct: 'Product', footHelp: 'Help center', footTerms: 'Terms and conditions', footPrivacy: 'Privacy notice', footSub: 'Subprocessors', footCookies: 'Cookie notice', footContact: 'Contact',
footFine: 'Korporia is a trade name of Erik Rodrigo Martínez Canales. Prices in Mexican pesos plus VAT. Features marked “Coming soon” switch on as they become ready. The product view is illustrative, with sample figures. In case of discrepancy, the Spanish version prevails.'
}
};
const t = T[lang];
const segOn = 'min-width: 40px; min-height: 36px; padding: 0 10px; border: none; background: #0E1630; color: #FFFFFF; font-size: 13px; font-weight: 700';
const segOff = 'min-width: 40px; min-height: 36px; padding: 0 10px; border: none; background: #FFFFFF; color: #4A5470; font-size: 13px; font-weight: 700';

const avail = { cardStyle: 'display: flex; flex-direction: column; gap: 10px; padding: 22px; background: #FFFFFF; border: 2px solid #F0A23B; border-radius: 8px', iconStyle: 'display: inline-flex; align-items: center; justify-content: center; min-width: 44px; height: 30px; padding: 0 8px; border-radius: 6px; background: #FDF1DF; color: #7A4A05; font-size: 12px; font-weight: 700; letter-spacing: 0.06em', badgeStyle: 'padding: 4px 10px; background: #F0A23B; color: #2A1A05; font-size: 12px; font-weight: 600; border-radius: 100px; white-space: nowrap', badge: t.avail };
const availHR = Object.assign({}, { cardStyle: 'display: flex; flex-direction: column; gap: 10px; padding: 22px; background: #FFFFFF; border: 1px solid #12A37E; border-radius: 8px', iconStyle: 'display: inline-flex; align-items: center; justify-content: center; min-width: 44px; height: 30px; padding: 0 8px; border-radius: 6px; background: #E7F6F1; color: #0A6B4F; font-size: 12px; font-weight: 700; letter-spacing: 0.06em', badgeStyle: 'padding: 4px 10px; background: #E7F6F1; color: #0A6B4F; font-size: 12px; font-weight: 600; border-radius: 100px; white-space: nowrap', badge: lang === 'es' ? 'Disponible hoy' : 'Available today' });
const soon = { cardStyle: 'display: flex; flex-direction: column; gap: 10px; padding: 22px; background: #FFFFFF; border: 1px solid #DDE0EA; border-radius: 8px', iconStyle: 'display: inline-flex; align-items: center; justify-content: center; min-width: 44px; height: 30px; padding: 0 8px; border-radius: 6px; background: #EEF0FC; color: #2B3FD1; font-size: 12px; font-weight: 700; letter-spacing: 0.06em', badgeStyle: 'padding: 4px 10px; background: #F4F5FA; color: #4A5470; font-size: 12px; font-weight: 600; border-radius: 100px; border: 1px solid #DDE0EA; white-space: nowrap', badge: t.soon };
const M = {
es: [
['JOR', 'Jornada', 'Asistencia con selfie y verificación facial o PIN, y geocercas por obra o sucursal. Cada corrección queda registrada. Funciona sin señal.', avail],
['EXP', 'Personal y expediente', 'Contratación, expediente digital y avisos firmados en la app por cada trabajador.', availHR],
['VAC', 'Vacaciones e incidencias', 'Solicitudes, permisos e incapacidades, con los saldos de ley y conectados con la asistencia.', availHR],
['POR', 'Portal del empleado', 'Cada trabajador consulta sus registros y vacaciones desde su celular. Sus recibos de nómina, cuando llegue la nómina.', availHR],
['NOM', 'Nómina con timbrado', 'Nómina ordinaria, aguinaldo, PTU, finiquitos y liquidaciones, timbrada y lista para dispersar.', soon],
['IMS', 'IMSS directo', 'Altas, bajas y cambios de salario enviados al IDSE, además de SUA, INFONAVIT y FONACOT.', soon],
['FIN', 'Finanzas y facturación', 'Facturas CFDI, ingresos, gastos y flujo de efectivo en el mismo lugar que tu nómina.', soon],
['CON', 'Panel para tu contador', 'Acceso autorizado por ti para que tu contador trabaje con información al día.', soon],
['REC', 'Reclutamiento y talento', 'Vacantes, desempeño y capacitación para cuando tu equipo crezca.', soon]
],
en: [
['JOR', 'Jornada', 'Attendance with selfie and face verification or PIN, and geofences by job site or branch. Every correction is logged. Works without signal.', avail],
['EXP', 'People and records', 'Hiring, digital employee files and notices signed in the app by each worker.', availHR],
['VAC', 'Time off and incidents', 'Requests, leave and sick days, with legal balances and connected to attendance.', availHR],
['POR', 'Employee portal', 'Each worker checks their records and vacation days from their phone. Pay stubs once payroll arrives.', availHR],
['NOM', 'Payroll with CFDI stamping', 'Regular payroll, year-end bonus, profit sharing, severance and settlements, stamped and ready to disburse.', soon],
['IMS', 'Direct IMSS filing', 'Hires, terminations and salary changes sent to IDSE, plus SUA, INFONAVIT and FONACOT.', soon],
['FIN', 'Finance and invoicing', 'CFDI invoices, income, expenses and cash flow in the same place as your payroll.', soon],
['CON', 'Accountant panel', 'Access you authorize so your accountant works with up-to-date information.', soon],
['REC', 'Recruiting and talent', 'Job openings, performance and training for when your team grows.', soon]
]
};
const modules = M[lang].map((m) => Object.assign({ code: m[0], name: m[1], desc: m[2] }, m[3]));
const light = { cardStyle: 'display: flex; flex-direction: column; gap: 8px; padding: 24px; border: 1px solid #DDE0EA; border-radius: 8px; background: #FFFFFF', subStyle: 'font-size: 14px; line-height: 1.45; color: #4A5470; min-height: 40px', unitStyle: 'font-size: 15px; color: #4A5470', noteStyle: 'font-size: 14px; line-height: 1.5; color: #4A5470' };
const hl = Object.assign({}, light, { cardStyle: 'display: flex; flex-direction: column; gap: 8px; padding: 24px; border: 2px solid #2B3FD1; border-radius: 8px; background: #F7F8FE' });
const dark = { cardStyle: 'display: flex; flex-direction: column; gap: 8px; padding: 24px; border: 1px solid #0E1630; border-radius: 8px; background: #0E1630; color: #FFFFFF', subStyle: 'font-size: 14px; line-height: 1.45; color: #C9CEE8; min-height: 40px', unitStyle: 'font-size: 15px; color: #C9CEE8', noteStyle: 'font-size: 14px; line-height: 1.5; color: #C9CEE8' };
const badgeSoon = 'padding: 4px 10px; background: #F4F5FA; color: #3A4360; border: 1px solid #C9CEDA; font-size: 12px; font-weight: 600; border-radius: 100px; white-space: nowrap';
const priceCards = t.pc.map((c, i) => Object.assign({ badge: c.badge || '', cta: '', ctaHref: '', ctaAlt: '' }, i === 2 ? hl : i === 3 ? dark : light, c, { badgeStyle: c.badgeStyle || badgeSoon }));
const open = this.state.openFaq;
const faqs = t.faq.map((x, i) => ({ q: x[0], a: x[1], open: open === i, expanded: open === i ? 'true' : 'false', sign: open === i ? '−' : '+', toggle: () => this.setState({ openFaq: open === i ? -1 : i }) }));
return {
t,
modules,
priceCards,
faqs,
providers: [t.emailLabel, 'Google', 'Microsoft'],
joined: !!this.state.joined,
notJoined: !this.state.joined,
join: () => {
if (this.state.sending) return;
const input = document.getElementById('wl-email');
const optOut = document.getElementById('wl-optout');
const email = input ? String(input.value || '').trim() : '';
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { if (input) { input.focus(); input.setAttribute('aria-invalid', 'true'); } return; }
this.setState({ sending: true });
fetch('/api/core/waitlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email, lang: lang, marketing_opt_out: !!(optOut && optOut.checked), source: 'landing' }) })
.then((r) => { if (!r.ok) throw new Error(String(r.status)); this.setState({ joined: true, sending: false }); })
.catch(() => { this.setState({ sending: false }); window.alert(lang === 'en' ? 'We could not save your email. Please try again.' : 'No pudimos guardar tu correo. Intenta de nuevo.'); });
},
menuOpen: !!this.state.menu,
menuExpanded: this.state.menu ? 'true' : 'false',
toggleMenu: () => this.setState({ menu: !this.state.menu }),
closeMenu: () => this.setState({ menu: false }),
esPressed: lang === 'es' ? 'true' : 'false', enPressed: lang === 'en' ? 'true' : 'false',
esStyle: lang === 'es' ? segOn : segOff, enStyle: lang === 'en' ? segOn : segOff,
setEs: () => this.setLang('es'), setEn: () => this.setLang('en')
};
}
}

export default Component;

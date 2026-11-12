/**
 * Documentos que el trabajador firma en la app en su primer ingreso (Legal,
 * "Aviso de privacidad para trabajadores — Korporia Jornada", validado por Erik
 * el 10 nov 2026): aviso simplificado (con enlace al integral), acuerdo de
 * registro electrónico de jornada y consentimiento biométrico opcional.
 *
 * El responsable de los datos es el patrón (cliente de Korporia); Korporia es su
 * encargado. Los textos se arman con los datos del patrón y del trabajador.
 *
 * Cambia la versión cuando cambie el texto: la app pide una nueva firma a cada
 * trabajador cuya última firma sea de otra versión.
 */

export type WorkerDocKey = 'aviso_trabajadores' | 'acuerdo_jornada' | 'biometria';

const BASE_VERSIONS: Record<WorkerDocKey, string> = {
  aviso_trabajadores: '2026-11-06',
  acuerdo_jornada: '2026-11-03',
  biometria: '2026-11-03',
};

export interface WorkerDocContext {
  companyName: string;
  legalName?: string | null;
  address?: string | null;
  privacyEmail?: string | null;
  privacyPhone?: string | null;
  employeeName: string;
  employeeNumber: string;
  /** El patrón usa el expediente de Korporia (RH básico) */
  usesRecords: boolean;
  /** El patrón usa la nómina de Korporia (Despegue, Full o Empresa) */
  usesPayroll: boolean;
}

/** Versión vigente; el aviso cambia de variante si el patrón usa expediente o nómina. */
export function workerDocVersion(doc: WorkerDocKey, ctx: Pick<WorkerDocContext, 'usesRecords' | 'usesPayroll'>): string {
  if (doc !== 'aviso_trabajadores') return BASE_VERSIONS[doc];
  return BASE_VERSIONS[doc] + (ctx.usesRecords ? '+expediente' : '') + (ctx.usesPayroll ? '+nomina' : '');
}

/** Un párrafo con partes en negritas: [texto, negritas?] */
export type Rich = (string | { b: string })[];
/** Sección de un documento: en pantalla se muestran primero las viñetas y luego los párrafos. */
export interface DocSection {
  title?: string;
  paragraphs?: Rich[];
  bullets?: Rich[];
}

export interface WorkerDoc {
  key: WorkerDocKey;
  version: string;
  title: string;
  sections: DocSection[];
}

function contact(ctx: WorkerDocContext): string {
  return ctx.privacyEmail || ctx.privacyPhone || 'el área de Recursos Humanos de tu empresa';
}

/** Aviso simplificado (pantalla del primer ingreso). */
export function simplifiedNotice(ctx: WorkerDocContext): WorkerDoc {
  const paragraphs: Rich[] = [
    [`${ctx.companyName} usa esta app para registrar tu jornada de trabajo, como lo pide la ley. Guardamos tus horas de entrada y salida, y tu ubicación `, { b: 'solo al registrarte' }, '.'],
    ['Si aceptas, también usamos una selfie para confirmar que eres tú. Es opcional: si no aceptas, registras con tu PIN.'],
  ];
  if (ctx.usesRecords) {
    paragraphs.push(['También guardamos tu expediente: tus datos de contacto, puesto, contrato, vacaciones, permisos e incapacidades, y los documentos que entregues a la empresa.']);
  }
  if (ctx.usesPayroll) {
    paragraphs.push(['También la usamos para calcular y depositar tu nómina, timbrar tus recibos y dar tus avisos al IMSS.']);
  }
  paragraphs.push(['La app la opera Korporia por cuenta nuestra. No vendemos tus datos; solo los compartimos con autoridades cuando la ley lo pide.']);
  paragraphs.push([`Puedes pedir ver, corregir o borrar tus datos en ${contact(ctx)}.`]);
  return {
    key: 'aviso_trabajadores',
    version: workerDocVersion('aviso_trabajadores', ctx),
    title: 'Tu privacidad',
    sections: [{ paragraphs }],
  };
}

/** Aviso de privacidad integral para trabajadores ("Leer el aviso completo"). */
export function fullNotice(ctx: WorkerDocContext): WorkerDoc {
  const who = ctx.legalName || ctx.companyName;
  const data: Rich[] = [
    [{ b: 'Identificación y contacto:' }, ' nombre, número de empleado, puesto y el teléfono o correo con el que entras a la app.'],
    [{ b: 'Laborales:' }, ' obra asignada, horario, horas de entrada y salida, horas trabajadas y horas extra, vacaciones, permisos e incapacidades.'],
    [{ b: 'Ubicación:' }, ' tu posición GPS ', { b: 'solo en el momento' }, ' en que registras tu entrada o salida. No te seguimos durante el día.'],
    [{ b: 'Datos biométricos (sensibles):' }, ' la selfie que tomas al registrarte y la comparación de tu rostro para confirmar que eres tú. Estos datos se usan solo si das tu consentimiento por escrito.'],
  ];
  if (ctx.usesRecords || ctx.usesPayroll) {
    data.push([{ b: 'Fiscales y de seguridad social:' }, ' RFC, CURP, número de seguridad social, domicilio y, en su caso, tus créditos INFONAVIT o FONACOT.']);
    data.push([{ b: 'Expediente:' }, ' tu contrato y los documentos que entregues a la empresa, como identificación y comprobantes.']);
  }
  if (ctx.usesPayroll) {
    data.push([{ b: 'Financieros:' }, ' salario, percepciones y deducciones, recibos de nómina y la cuenta bancaria o CLABE donde recibes tu pago.']);
  }
  const uses: Rich[] = [
    ['Llevar el registro electrónico de tu jornada, como lo exige la Ley Federal del Trabajo.'],
    ['Confirmar que quien registra la asistencia eres tú (solo con tu consentimiento).'],
    ['Confirmar que el registro se hace en la obra o sucursal que te corresponde.'],
    ['Calcular tus horas trabajadas y tus horas extra para tu pago.'],
  ];
  if (ctx.usesRecords) uses.push(['Llevar tu expediente de personal y controlar tus vacaciones, permisos e incapacidades.']);
  if (ctx.usesPayroll) {
    uses.push(['Calcular tu nómina, aguinaldo, PTU, vacaciones y, en su caso, tu finiquito; timbrar tus recibos ante el SAT; dar tus avisos de alta, baja y cambio de salario al IMSS; aplicar los descuentos de INFONAVIT y FONACOT; y depositar tu sueldo.']);
  }
  uses.push(['Atender inspecciones de la autoridad laboral y, en su caso, defender o acreditar derechos en un juicio.']);

  const sharing: Rich[] = [
    [{ b: 'Korporia' }, ' (Erik Rodrigo Martínez Canales, RFC MACE880618E65), que opera la app por cuenta nuestra y solo sigue nuestras instrucciones. Sus proveedores guardan la información en servidores en Estados Unidos.'],
  ];
  if (ctx.usesPayroll) {
    sharing.push([{ b: 'SAT, IMSS, INFONAVIT y FONACOT' }, ', para timbrar tus recibos y dar los avisos y descuentos que la ley obliga al patrón; y ', { b: 'tu banco o STP' }, ', para depositar tu sueldo.']);
  }
  sharing.push([{ b: 'Autoridades laborales o judiciales' }, ', solo cuando lo requieran conforme a la ley.']);

  const where = [ctx.address ? `con domicilio en ${ctx.address}` : null].filter(Boolean).join('');
  const reach = [ctx.privacyEmail ? `escribe a ${ctx.privacyEmail}` : null, ctx.privacyPhone ? `llama al ${ctx.privacyPhone}` : null]
    .filter(Boolean)
    .join(' o ');

  return {
    key: 'aviso_trabajadores',
    version: workerDocVersion('aviso_trabajadores', ctx),
    title: 'Aviso de privacidad integral para trabajadores',
    sections: [
      {
        title: '¿Quién es responsable de tus datos?',
        paragraphs: [
          [`${who}${where ? `, ${where},` : ''} es responsable de tus datos personales. Para cualquier tema de privacidad, ${reach || 'acude al área de Recursos Humanos de tu empresa'}.`],
        ],
      },
      { title: '¿Qué datos usamos?', bullets: data },
      {
        title: '¿Para qué los usamos?',
        bullets: uses,
        paragraphs: [
          ['Salvo tu rostro, estos datos son necesarios para tu relación de trabajo y para que cumplamos la ley, por eso no requieren tu consentimiento. No usamos tus datos para ningún otro fin, como publicidad o venta a terceros.'],
        ],
      },
      {
        title: '¿Y si no quiero dar mi rostro?',
        paragraphs: [['Puedes negarte. Es tu derecho y no tendrá ninguna consecuencia en tu trabajo. En ese caso registrarás tu asistencia con tu PIN personal y tu ubicación.']],
      },
      {
        title: '¿Quién más ve tus datos?',
        bullets: sharing,
        paragraphs: [['En estos casos no se necesita tu consentimiento. No compartimos tus datos con nadie más.']],
      },
      {
        title: '¿Cuánto tiempo guardamos tus datos?',
        paragraphs: [
          [
            'Tus selfies y la comparación de tu rostro, mientras trabajes con nosotros y hasta 1 año después de tu baja; luego se borran. Tus registros de jornada',
            ctx.usesRecords || ctx.usesPayroll ? ', tu expediente' : '',
            ctx.usesPayroll ? ' y tus recibos de nómina y avisos al IMSS' : '',
            ', por el plazo que exigen las leyes laborales, fiscales y de seguridad social.',
          ],
        ],
      },
      {
        title: 'Tus derechos',
        paragraphs: [
          [
            `Puedes pedir acceder a tus datos, corregirlos, cancelarlos u oponerte a su uso (derechos ARCO), así como retirar tu consentimiento para el uso de tu rostro. Envía tu solicitud a ${contact(ctx)} con tu nombre, número de empleado, qué pides y una copia de tu identificación. Te responderemos en un máximo de 20 días hábiles. También puedes retirar tu consentimiento biométrico desde la app, en "Mi privacidad".`,
          ],
          ['Si consideras que no atendimos tu derecho, puedes acudir a la Secretaría Anticorrupción y Buen Gobierno.'],
        ],
      },
      {
        title: 'Cambios a este aviso',
        paragraphs: [['Si este aviso cambia, te avisaremos en la app antes de que el cambio aplique.'], [`Versión ${workerDocVersion('aviso_trabajadores', ctx)}.`]],
      },
    ],
  };
}

/** Acuerdo de registro electrónico de jornada (aplica a todos). */
export function journeyAgreement(ctx: WorkerDocContext): WorkerDoc {
  return {
    key: 'acuerdo_jornada',
    version: workerDocVersion('acuerdo_jornada', ctx),
    title: 'Acuerdo de registro electrónico de jornada',
    sections: [
      {
        paragraphs: [
          [
            `Yo, ${ctx.employeeName}, número de empleado ${ctx.employeeNumber}, estoy de acuerdo en que mi entrada y salida se registren de forma electrónica en la app Korporia Jornada, que usa ${ctx.companyName} para cumplir con el artículo 132, fracción XXXIV, de la Ley Federal del Trabajo.`,
          ],
          ['Sé que puedo consultar mis registros en la app en cualquier momento, y que cualquier corrección queda guardada con la fecha y el nombre de quien la hizo.'],
        ],
      },
    ],
  };
}

/** Consentimiento para el uso del rostro (opcional). */
export function biometricConsent(ctx: WorkerDocContext): WorkerDoc {
  return {
    key: 'biometria',
    version: workerDocVersion('biometria', ctx),
    title: 'Consentimiento para el uso de mi rostro (datos biométricos)',
    sections: [
      {
        paragraphs: [
          [`He leído el aviso de privacidad. Autorizo a ${ctx.companyName} a tomar y usar mi selfie y la comparación de mi rostro `, { b: 'únicamente' }, ' para confirmar mi identidad al registrar mi asistencia.'],
          ['Sé que:'],
        ],
      },
      {
        // Sección aparte: en pantalla las viñetas van antes que los párrafos de su sección
        bullets: [
          ['es voluntario y, si no acepto, registraré con mi PIN sin ninguna consecuencia;'],
          [`puedo retirar este consentimiento cuando quiera desde la app o escribiendo a ${contact(ctx)};`],
          ['mis selfies se guardan mientras trabaje aquí y hasta 1 año después de mi baja.'],
        ],
      },
    ],
  };
}

/** Texto plano de un documento (para guardar la evidencia o imprimir). */
export function docToText(doc: WorkerDoc): string {
  const rich = (r: Rich) => r.map((p) => (typeof p === 'string' ? p : p.b)).join('');
  const lines = [doc.title];
  for (const s of doc.sections) {
    if (s.title) lines.push('', s.title);
    for (const p of s.paragraphs ?? []) lines.push(rich(p));
    for (const b of s.bullets ?? []) lines.push(`• ${rich(b)}`);
  }
  return lines.join('\n');
}

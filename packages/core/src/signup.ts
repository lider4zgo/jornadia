/**
 * Giros sugeridos (perfil de la empresa). Si el suyo no está, la persona escribe otro.
 * 'Otro' se conserva para registros anteriores.
 */
export const INDUSTRIES = [
  'Construcción y contratistas',
  'Instalaciones eléctricas, hidráulicas y de gas',
  'Comercio con sucursales',
  'Comercio al por mayor y distribución',
  'Restaurantes y alimentos',
  'Hoteles y turismo',
  'Manufactura',
  'Logística y transporte',
  'Limpieza, mantenimiento y seguridad',
  'Servicios en campo',
  'Salud, clínicas y consultorios',
  'Educación y capacitación',
  'Servicios profesionales y oficina',
  'Despacho contable o legal',
  'Talleres y servicio automotriz',
  'Agricultura, ganadería y pesca',
  'Tecnología y software',
  'Inmobiliaria y administración de inmuebles',
  'Belleza y bienestar',
  'Otro',
] as const;

/** Puestos sugeridos para quien administra la cuenta. Si el suyo no está, escribe otro. */
export const ADMIN_POSITIONS = [
  'Dueño(a) o director(a) general',
  'Socio(a)',
  'Gerente general',
  'Administrador(a)',
  'Contador(a)',
  'Recursos humanos',
  'Nóminas',
  'Gerente de operaciones',
  'Residente o superintendente de obra',
  'Supervisor(a)',
  'Asistente administrativo(a)',
] as const;

export const MX_STATES = [
  'Aguascalientes', 'Baja California', 'Baja California Sur', 'Campeche', 'Chiapas', 'Chihuahua', 'Ciudad de México',
  'Coahuila', 'Colima', 'Durango', 'Estado de México', 'Guanajuato', 'Guerrero', 'Hidalgo', 'Jalisco', 'Michoacán',
  'Morelos', 'Nayarit', 'Nuevo León', 'Oaxaca', 'Puebla', 'Querétaro', 'Quintana Roo', 'San Luis Potosí', 'Sinaloa',
  'Sonora', 'Tabasco', 'Tamaulipas', 'Tlaxcala', 'Veracruz', 'Yucatán', 'Zacatecas', 'Fuera de México',
] as const;

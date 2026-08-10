/**
 * Reglas de validación del catálogo.
 *
 * Separadas del ejecutable para poder testearlas. Cada regla devuelve
 * incidencias con severidad: 'error' bloquea, 'warn' informa.
 *
 * La validación es la red de seguridad de la regla suprema del repositorio:
 * detecta strings vacíos donde debería haber null, precios sin fuente,
 * certificados «gratuitos» con precio, y verificaciones vencidas.
 */

import { isValidHttpUrl } from './urls.mjs';
import { isIsoDate, isStale, DEFAULT_MAX_AGE_DAYS } from './dates.mjs';

const REQUIRED = ['id', 'title', 'institution', 'domain', 'url_official', 'verification_status', 'source_of_truth'];

const ENUMS = {
  domain: ['ai-tecnica', 'ai-negocio', 'pmo', 'finanzas', 'gerencia', 'derecho', 'sostenibilidad', 'datos', 'salud', 'ciencias', 'humanidades'],
  provider_type: ['institucion', 'proveedor-ia'],
  level: ['introductorio', 'intermedio', 'avanzado'],
  pace: ['autoadministrado', 'cohorte', 'programado'],
  cost_access: ['gratis', 'audit gratuito', 'pagado'],
  credential_type: [
    'certificado gratuito', 'badge gratuito', 'declaracion de logro',
    'certificado pagado verificable', 'certificado pagado',
  ],
  verification_status: [
    'VERIFICADO', 'PENDIENTE', 'REVERIFICAR', 'NO_DISPONIBLE', 'MANUAL_REVIEW_REQUIRED',
  ],
  status: ['activo', 'archivado', 'no disponible', 'desconocido'],
  access_mode: ['permanente', 'cohorte', 'archivo'],
};

const URL_FIELDS = [
  'url_official', 'url_credential_info', 'url_syllabus',
  'source_of_truth', 'official_institution_url',
];

const DATE_FIELDS = ['last_verified', 'start_date', 'end_date', 'discovered_at', 'updated_at'];

const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function issue(level, id, field, message) {
  return { level, id, field, message };
}

/** Valida un curso aislado. */
export function validateCourse(course, options = {}) {
  const maxAgeDays = options.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS;
  const now = options.now ?? new Date();
  const found = [];
  const id = course?.id ?? '(sin id)';

  if (!course || typeof course !== 'object' || Array.isArray(course)) {
    return [issue('error', id, null, 'El registro no es un objeto.')];
  }

  for (const field of REQUIRED) {
    const value = course[field];
    if (value === null || value === undefined || value === '') {
      found.push(issue('error', id, field, 'Campo obligatorio ausente.'));
    }
  }

  if (course.id && !ID_PATTERN.test(course.id)) {
    found.push(issue('error', id, 'id', 'El id debe ser kebab-case sin acentos.'));
  }

  // Un string vacío nunca es un dato: debe ser null.
  for (const [field, value] of Object.entries(course)) {
    if (typeof value === 'string' && value.trim() === '') {
      found.push(issue('error', id, field, 'String vacío: usar null.'));
    }
  }

  for (const [field, allowed] of Object.entries(ENUMS)) {
    const value = course[field];
    if (value !== null && value !== undefined && !allowed.includes(value)) {
      found.push(issue('error', id, field, `Valor fuera de la lista permitida: ${value}`));
    }
  }

  for (const field of URL_FIELDS) {
    const value = course[field];
    if (value !== null && value !== undefined && !isValidHttpUrl(value)) {
      found.push(issue('error', id, field, `URL inválida: ${value}`));
    }
  }

  for (const field of DATE_FIELDS) {
    const value = course[field];
    if (value !== null && value !== undefined && !isIsoDate(value)) {
      found.push(issue('error', id, field, `Fecha inválida (se espera YYYY-MM-DD): ${value}`));
    }
  }

  const relevance = course.relevance_ppp_infra;
  if (relevance !== null && relevance !== undefined) {
    if (!Number.isInteger(relevance) || relevance < 0 || relevance > 3) {
      found.push(issue('error', id, 'relevance_ppp_infra', 'Debe ser un entero entre 0 y 3.'));
    } else if (relevance > 0 && !course.notes) {
      // Toda puntuación mayor que 0 exige justificación editorial.
      found.push(issue('warn', id, 'notes', 'Relevancia mayor que 0 sin justificación en notes.'));
    }
  }

  const price = course.credential_price_usd;
  if (price !== null && price !== undefined) {
    if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) {
      found.push(issue('error', id, 'credential_price_usd', 'Precio inválido.'));
    }
    // Coherencia crítica: un certificado gratuito no puede costar dinero.
    if (course.credential_free === true && typeof price === 'number' && price > 0) {
      found.push(issue('error', id, 'credential_price_usd',
        'Incoherencia: credential_free es true pero el precio es mayor que cero.'));
    }
    if (typeof price === 'number' && price > 0 && !course.last_verified) {
      found.push(issue('warn', id, 'credential_price_usd',
        'Precio sin fecha de verificación: los precios son volátiles.'));
    }
  }

  // «Curso gratuito» no implica «certificado gratuito» (§12).
  const type = course.credential_type;
  if (type === 'certificado gratuito' && course.credential_free === false) {
    found.push(issue('error', id, 'credential_free',
      'Incoherencia: el tipo es certificado gratuito pero credential_free es false.'));
  }
  if ((type === 'certificado pagado' || type === 'certificado pagado verificable')
      && course.credential_free === true) {
    found.push(issue('error', id, 'credential_free',
      'Incoherencia: el tipo es certificado pagado pero credential_free es true.'));
  }
  if (course.cost_access === 'audit gratuito' && course.credential_free === true) {
    found.push(issue('warn', id, 'cost_access',
      'Audit gratuito con credencial gratuita: confirmar contra fuente oficial.'));
  }

  // Un registro VERIFICADO exige respaldo real.
  if (course.verification_status === 'VERIFICADO') {
    if (!course.last_verified) {
      found.push(issue('error', id, 'last_verified', 'VERIFICADO exige fecha de verificación.'));
    } else if (isStale(course.last_verified, maxAgeDays, now)) {
      found.push(issue('warn', id, 'last_verified',
        `Verificación vencida (más de ${maxAgeDays} días): corresponde REVERIFICAR.`));
    }
    if (!course.source_of_truth) {
      found.push(issue('error', id, 'source_of_truth', 'VERIFICADO exige fuente de verdad.'));
    }
  }

  for (const field of ['topics', 'language', 'subtitles']) {
    const value = course[field];
    if (value === undefined || value === null) continue;
    if (!Array.isArray(value)) {
      found.push(issue('error', id, field, 'Debe ser un arreglo o null.'));
    } else if (value.length === 0) {
      found.push(issue('error', id, field, 'Arreglo vacío: usar null.'));
    }
  }

  return found;
}

/** Valida el catálogo completo, incluidas las reglas entre registros. */
export function validateCatalog(courses, options = {}) {
  const found = [];

  if (!Array.isArray(courses)) {
    return [issue('error', '(catálogo)', null, 'El catálogo debe ser un arreglo.')];
  }

  const seenIds = new Map();
  const seenUrls = new Map();

  for (const course of courses) {
    found.push(...validateCourse(course, options));

    const id = course?.id;
    if (id) {
      if (seenIds.has(id)) {
        found.push(issue('error', id, 'id', 'ID duplicado en el catálogo.'));
      }
      seenIds.set(id, true);
    }

    const url = course?.url_official;
    if (url) {
      if (seenUrls.has(url)) {
        found.push(issue('warn', id ?? '(sin id)', 'url_official',
          `URL repetida: ya usada por ${seenUrls.get(url)}. Revisar posible duplicado.`));
      } else {
        seenUrls.set(url, id ?? '(sin id)');
      }
    }
  }

  return found;
}

export function summarize(issues) {
  return {
    errors: issues.filter((i) => i.level === 'error').length,
    warnings: issues.filter((i) => i.level === 'warn').length,
    total: issues.length,
  };
}

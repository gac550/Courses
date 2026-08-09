/**
 * Normalización de datos del catálogo.
 *
 * Regla suprema del repositorio: prohibido inventar. Estas funciones sólo
 * limpian, convierten formato o clasifican a partir de evidencia explícita.
 * Ante cualquier ambigüedad devuelven null, nunca un valor plausible.
 */

import { canonicalUrl } from './urls.mjs';

/** Un string vacío nunca es un dato: se convierte en null. */
export function cleanString(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed === '' ? null : trimmed;
}

/** Slug estable en kebab-case, sin acentos. */
export function slugify(value) {
  const text = cleanString(value);
  if (text === null) return null;

  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || null;
}

const INSTITUTION_ABBREV = {
  'massachusetts institute of technology': 'mit',
  'stanford university': 'stanford',
  'harvard university': 'harvard',
  'university of california, berkeley': 'berkeley',
  'carnegie mellon university': 'cmu',
  'georgia institute of technology': 'georgia-tech',
  'university of oxford': 'oxford',
  'university of cambridge': 'cambridge',
  'imperial college london': 'imperial',
  'project management institute': 'pmi',
  'banco interamericano de desarrollo': 'iadb',
};

/**
 * ID estable: institución abreviada + código de curso o título.
 * Determinístico — la misma entrada produce siempre el mismo id.
 */
export function makeId({ institution, course_code: courseCode, title }) {
  const name = cleanString(institution);
  const prefix = name
    ? (INSTITUTION_ABBREV[name.toLowerCase()] ?? slugify(name))
    : null;

  const suffix = slugify(courseCode) ?? slugify(title);
  if (suffix === null) return null;

  return prefix ? `${prefix}-${suffix}` : suffix;
}

/** Título normalizado para deduplicación. No reemplaza al título oficial. */
export function normalizeTitle(value) {
  const text = cleanString(value);
  if (text === null) return null;

  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || null;
}

/**
 * Precio en USD a partir de texto.
 *
 * Sólo acepta cifras acompañadas de una marca explícita de USD; ante cualquier
 * otra moneda o ambigüedad devuelve null. Nunca convierte divisas.
 */
export function parsePriceUsd(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : null;
  }

  const text = cleanString(value);
  if (text === null) return null;

  if (/\b(free|gratis|sin costo|no cost)\b/i.test(text)) return 0;

  // Rechaza monedas distintas de USD.
  if (/[€£¥₹]|\b(eur|gbp|jpy|clp|mxn|cop|ars|brl)\b/i.test(text)) return null;

  const match = text.match(/(?:us\$|usd|\$)\s*([\d.,]+)/i);
  if (!match) return null;

  // Formato anglosajón: la coma separa miles.
  const numeric = Number.parseFloat(match[1].replace(/,/g, ''));
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

/**
 * Clasificación de credencial a partir de evidencia.
 *
 * «Curso gratuito» NUNCA implica «certificado gratuito» (§12). Sin evidencia
 * suficiente devuelve null y el registro queda PENDIENTE.
 */
export function classifyCredential({ text, priceUsd, isBadge = false }) {
  const source = cleanString(text)?.toLowerCase() ?? '';
  const price = typeof priceUsd === 'number' ? priceUsd : parsePriceUsd(priceUsd);

  const mentionsCertificate = /\b(certificate|certificado|certification)\b/.test(source);
  const mentionsBadge = isBadge || /\b(badge|insignia|digital badge)\b/.test(source);
  const mentionsStatement = /\b(statement of accomplishment|declaraci[oó]n de logro)\b/.test(source);
  const freeCredential = /\b(free certificate|certificado gratuito|certificate.{0,20}free|no cost certificate)\b/
    .test(source);

  if (mentionsBadge && (price === 0 || freeCredential)) return 'badge gratuito';
  if (mentionsStatement) return 'declaracion de logro';
  if (mentionsCertificate && (freeCredential || price === 0)) return 'certificado gratuito';

  if (mentionsCertificate && typeof price === 'number' && price > 0) {
    const verifiable = /\b(verified|verifiable|verificable|shareable)\b/.test(source);
    return verifiable ? 'certificado pagado verificable' : 'certificado pagado';
  }

  // Evidencia insuficiente: no se adivina.
  return null;
}

/** Aplica la normalización a un registro completo. */
export function normalizeCourse(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const course = { ...raw };

  for (const [key, value] of Object.entries(course)) {
    if (typeof value === 'string') course[key] = cleanString(value);
  }

  for (const field of ['url_official', 'url_credential_info', 'url_syllabus', 'source_of_truth']) {
    if (course[field]) course[field] = canonicalUrl(course[field]) ?? course[field];
  }

  for (const field of ['topics', 'language', 'subtitles']) {
    if (Array.isArray(course[field])) {
      const items = course[field].map(cleanString).filter((item) => item !== null);
      course[field] = items.length > 0 ? items : null;
    }
  }

  if (!course.id) course.id = makeId(course);

  return course;
}

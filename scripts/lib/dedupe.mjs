/**
 * Deduplicación de candidatos (§17).
 *
 * Progresión: URL canónica, institución + código, institución + título
 * normalizado, plataforma + identificador, y similitud textual como mecanismo
 * auxiliar.
 *
 * Regla dura: los casos ambiguos NUNCA se fusionan automáticamente. Se marcan
 * para revisión manual.
 */

import { canonicalUrl } from './urls.mjs';
import { normalizeTitle } from './normalize.mjs';

/** Umbral a partir del cual dos títulos se consideran sospechosamente similares. */
export const SIMILARITY_THRESHOLD = 0.88;

/** Distancia de Levenshtein normalizada a similitud entre 0 y 1. */
export function similarity(a, b) {
  const left = normalizeTitle(a);
  const right = normalizeTitle(b);

  if (!left || !right) return 0;
  if (left === right) return 1;

  const rows = left.length + 1;
  const cols = right.length + 1;
  let previous = Array.from({ length: cols }, (_v, i) => i);

  for (let i = 1; i < rows; i += 1) {
    const current = [i];
    for (let j = 1; j < cols; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
    }
    previous = current;
  }

  const distance = previous[cols - 1];
  return 1 - distance / Math.max(left.length, right.length);
}

/** Claves de identidad de un curso, de la más fuerte a la más débil. */
export function identityKeys(course) {
  const keys = [];

  const url = canonicalUrl(course?.url_official);
  if (url) keys.push({ kind: 'url', value: url });

  const institution = normalizeTitle(course?.institution);

  if (institution && course?.course_code) {
    keys.push({ kind: 'institution+code', value: `${institution}|${normalizeTitle(course.course_code)}` });
  }

  if (institution && course?.title) {
    keys.push({ kind: 'institution+title', value: `${institution}|${normalizeTitle(course.title)}` });
  }

  if (course?.platform && course?.course_code) {
    keys.push({
      kind: 'platform+code',
      value: `${normalizeTitle(course.platform)}|${normalizeTitle(course.course_code)}`,
    });
  }

  return keys;
}

/**
 * Compara un candidato contra el catálogo.
 *
 * Devuelve:
 *   - { match: 'exact', course }  coincidencia inequívoca: es el mismo curso
 *   - { match: 'ambiguous', ... } parecido pero no idéntico: revisión manual
 *   - { match: 'none' }           es un curso nuevo
 */
export function findDuplicate(candidate, catalog, { threshold = SIMILARITY_THRESHOLD } = {}) {
  const keys = identityKeys(candidate);

  for (const key of keys) {
    for (const course of catalog) {
      const existing = identityKeys(course);
      if (existing.some((e) => e.kind === key.kind && e.value === key.value)) {
        return { match: 'exact', course, by: key.kind };
      }
    }
  }

  // Sin coincidencia exacta: se busca similitud textual dentro de la misma
  // institución. Nunca se fusiona automáticamente.
  const candidateInstitution = normalizeTitle(candidate?.institution);

  for (const course of catalog) {
    if (candidateInstitution && normalizeTitle(course.institution) !== candidateInstitution) continue;

    const score = similarity(candidate?.title, course.title);
    if (score >= threshold) {
      return { match: 'ambiguous', course, score, by: 'similitud de título' };
    }
  }

  return { match: 'none' };
}

/** Separa candidatos en nuevos, duplicados exactos y ambiguos. */
export function classifyCandidates(candidates, catalog, options = {}) {
  const nuevos = [];
  const duplicados = [];
  const ambiguos = [];
  const vistos = [];

  for (const candidate of candidates) {
    // Se compara contra el catálogo y contra los ya aceptados en esta pasada.
    const result = findDuplicate(candidate, [...catalog, ...vistos], options);

    if (result.match === 'exact') {
      duplicados.push({ candidate, existing: result.course, by: result.by });
    } else if (result.match === 'ambiguous') {
      ambiguos.push({ candidate, existing: result.course, score: result.score, by: result.by });
    } else {
      nuevos.push(candidate);
      vistos.push(candidate);
    }
  }

  return { nuevos, duplicados, ambiguos };
}

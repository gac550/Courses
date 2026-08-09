/**
 * Deprecación de cursos que dejaron de estar disponibles (§16).
 *
 * Regla dura: NUNCA se borra un curso del catálogo. Un curso que desaparece de
 * su fuente pasa a `NO_DISPONIBLE` conservando todos sus datos, la fecha en que
 * se detectó y el motivo. El historial es la evidencia del cambio.
 *
 * La deprecación exige confirmación repetida: un fallo aislado de red no puede
 * marcar un curso como retirado.
 */

import { canonicalUrl } from './urls.mjs';
import { today } from './dates.mjs';

const NOTE_PREFIX = '[DEPRECADO';

/** Indica si un curso ya fue marcado como no disponible. */
export function isDeprecated(course) {
  return course?.verification_status === 'NO_DISPONIBLE';
}

/**
 * Marca un curso como no disponible conservando sus datos.
 * Devuelve una copia: no muta la entrada.
 */
export function deprecateCourse(course, { reason, detectedAt = today(), missingCount = null } = {}) {
  const detalle = [
    `${NOTE_PREFIX} ${detectedAt}]`,
    reason ? `Motivo: ${reason}.` : 'Motivo no especificado.',
    missingCount ? `Confirmado tras ${missingCount} verificaciones fallidas consecutivas.` : null,
    'Los datos se conservan tal como fueron verificados por ultima vez.',
  ].filter(Boolean).join(' ');

  return {
    ...course,
    verification_status: 'NO_DISPONIBLE',
    status: 'no disponible',
    enrollment_open: false,
    updated_at: detectedAt,
    notes: course.notes ? `${detalle} ${course.notes}` : detalle,
  };
}

/** Revierte la deprecación cuando el curso vuelve a estar disponible. */
export function restoreCourse(course, { detectedAt = today() } = {}) {
  const notes = String(course.notes ?? '')
    .replace(new RegExp(`\\${NOTE_PREFIX}[^\\]]*\\][^.]*\\.[^.]*\\.[^.]*\\.\\s*`), '')
    .trim();

  return {
    ...course,
    verification_status: 'REVERIFICAR',
    status: 'desconocido',
    enrollment_open: null,
    updated_at: detectedAt,
    notes: notes
      ? `[RESTAURADO ${detectedAt}] El curso volvio a responder. ${notes}`
      : `[RESTAURADO ${detectedAt}] El curso volvio a responder tras haber sido marcado como no disponible.`,
  };
}

/**
 * Aplica la deprecación al catálogo a partir de las URLs retiradas.
 *
 * Solo afecta a cursos cuya URL oficial coincide con una URL confirmada como
 * retirada. Devuelve el catálogo actualizado y el detalle de los cambios.
 */
export function applyDeprecations(catalog, retired, { detectedAt = today() } = {}) {
  const porUrl = new Map();
  for (const item of retired) {
    const key = canonicalUrl(item.url) ?? item.url;
    porUrl.set(key, item);
  }

  const deprecados = [];
  const restaurados = [];

  const actualizado = catalog.map((course) => {
    const key = canonicalUrl(course.url_official) ?? course.url_official;
    const retirada = porUrl.get(key);

    if (retirada && !isDeprecated(course)) {
      deprecados.push({ id: course.id, title: course.title, url: course.url_official });
      return deprecateCourse(course, {
        reason: retirada.reason ?? 'La URL dejo de responder',
        detectedAt,
        missingCount: retirada.missingCount ?? retirada.missing_count ?? null,
      });
    }

    // Volvió a estar disponible: se restaura para reverificación humana.
    if (!retirada && isDeprecated(course)) {
      restaurados.push({ id: course.id, title: course.title });
      return restoreCourse(course, { detectedAt });
    }

    return course;
  });

  return { catalog: actualizado, deprecados, restaurados };
}

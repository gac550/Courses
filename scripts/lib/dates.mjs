/**
 * Utilidades de fecha. Todo el catálogo usa ISO YYYY-MM-DD.
 *
 * Las funciones aceptan una fecha de referencia explícita para ser puras y
 * testeables: nunca dependen implícitamente del reloj.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const DEFAULT_MAX_AGE_DAYS = 90;

export function isIsoDate(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return false;
  // Rechaza fechas imposibles normalizadas por Date (p. ej. 2026-02-31).
  return date.toISOString().slice(0, 10) === value;
}

export function today(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

/** Días transcurridos desde `value`. Devuelve null si la fecha no es válida. */
export function daysSince(value, now = new Date()) {
  if (!isIsoDate(value)) return null;
  const then = Date.parse(`${value}T00:00:00Z`);
  const reference = Date.parse(`${today(now)}T00:00:00Z`);
  return Math.floor((reference - then) / 86_400_000);
}

/**
 * Indica si una verificación está vencida.
 * Una fecha ausente o inválida cuenta como vencida: nunca se asume vigencia.
 */
export function isStale(lastVerified, maxAgeDays = DEFAULT_MAX_AGE_DAYS, now = new Date()) {
  const age = daysSince(lastVerified, now);
  if (age === null) return true;
  return age > maxAgeDays;
}

/**
 * Estado derivado de verificación.
 *
 * No altera los datos: sólo indica que un registro VERIFICADO vencido debe
 * pasar a REVERIFICAR, según la regla de los 90 días.
 */
export function derivedStatus(course, maxAgeDays = DEFAULT_MAX_AGE_DAYS, now = new Date()) {
  const status = course?.verification_status;
  if (status !== 'VERIFICADO') return status ?? 'PENDIENTE';
  return isStale(course?.last_verified, maxAgeDays, now) ? 'REVERIFICAR' : 'VERIFICADO';
}

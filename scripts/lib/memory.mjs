/**
 * Memoria persistente del crawler (§8.2, §16).
 *
 * Registra qué URLs se han visto, cuándo y con qué resultado, para que cada
 * ejecución sea incremental: las páginas conocidas y estables se revisitan con
 * menos frecuencia, y las nuevas tienen prioridad.
 *
 * También sostiene la detección de desapariciones: una URL que estaba y deja de
 * responder acumula fallos hasta marcarse como retirada. Nunca se borra nada:
 * el historial es la evidencia del cambio.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

import { today, daysSince } from './dates.mjs';

/** Fallos consecutivos antes de dar una URL por retirada. */
export const MISSING_THRESHOLD = 3;

/** Días tras los cuales conviene revisitar una página ya conocida. */
export const REVISIT_AFTER_DAYS = 14;

export function emptyMemory() {
  return { version: 1, updated_at: null, urls: {} };
}

export function loadMemory(path) {
  if (!existsSync(path)) return emptyMemory();

  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    return data && typeof data.urls === 'object' ? { ...emptyMemory(), ...data } : emptyMemory();
  } catch {
    // Una memoria corrupta no debe detener el pipeline: se reconstruye.
    return emptyMemory();
  }
}

export function saveMemory(path, memory) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ ...memory, updated_at: today() }, null, 2)}\n`);
}

/**
 * Registra una visita exitosa. Reinicia el contador de fallos: la página existe.
 */
export function recordSeen(memory, url, { source, isCourse = false, contentHash = null, now = new Date() } = {}) {
  const previous = memory.urls[url] ?? {};

  memory.urls[url] = {
    source: source ?? previous.source ?? null,
    first_seen: previous.first_seen ?? today(now),
    last_seen: today(now),
    is_course: isCourse || previous.is_course === true,
    content_hash: contentHash ?? previous.content_hash ?? null,
    changed_at: contentHash && previous.content_hash && contentHash !== previous.content_hash
      ? today(now)
      : previous.changed_at ?? null,
    missing_count: 0,
    status: 'activo',
  };

  return memory.urls[url];
}

/**
 * Registra un fallo. Tras MISSING_THRESHOLD intentos consecutivos, la URL pasa
 * a 'retirado': deja de considerarse disponible.
 */
export function recordMissing(memory, url, { reason = null, now = new Date() } = {}) {
  const previous = memory.urls[url] ?? { first_seen: today(now), missing_count: 0 };
  const count = (previous.missing_count ?? 0) + 1;

  memory.urls[url] = {
    ...previous,
    last_missing: today(now),
    missing_count: count,
    last_reason: reason,
    status: count >= MISSING_THRESHOLD ? 'retirado' : 'inestable',
  };

  return memory.urls[url];
}

/**
 * Decide si una URL conocida merece revisitarse en esta pasada.
 * Lo nunca visto siempre se visita; lo reciente y estable se pospone.
 */
export function shouldRevisit(memory, url, { revisitAfterDays = REVISIT_AFTER_DAYS, now = new Date() } = {}) {
  const entry = memory.urls[url];
  if (!entry) return true;
  if (entry.status === 'retirado') return false;
  if (entry.status === 'inestable') return true;

  // Las fichas de curso son estables y se posponen el plazo completo. Las
  // páginas de índice y navegación son la fuente de enlaces nuevos, así que se
  // revisitan mucho antes: sin ellas el crawler dejaría de descubrir.
  const plazo = entry.is_course ? revisitAfterDays : Math.max(1, Math.round(revisitAfterDays / 7));

  const age = daysSince(entry.last_seen, now);
  return age === null || age >= plazo;
}

/** URLs dadas por retiradas: alimentan la deprecación del catálogo. */
export function retiredUrls(memory) {
  return Object.entries(memory.urls)
    .filter(([, entry]) => entry.status === 'retirado')
    .map(([url, entry]) => ({
      url,
      last_seen: entry.last_seen ?? null,
      missing_count: entry.missing_count ?? 0,
      reason: entry.last_reason ?? null,
    }));
}

export function summarize(memory) {
  const entries = Object.values(memory.urls);
  return {
    total: entries.length,
    activos: entries.filter((e) => e.status === 'activo').length,
    inestables: entries.filter((e) => e.status === 'inestable').length,
    retirados: entries.filter((e) => e.status === 'retirado').length,
    cursos: entries.filter((e) => e.is_course).length,
  };
}

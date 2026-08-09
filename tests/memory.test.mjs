import test from 'node:test';
import assert from 'node:assert/strict';

import {
  emptyMemory, recordSeen, recordMissing, shouldRevisit, retiredUrls,
  summarize, MISSING_THRESHOLD,
} from '../scripts/lib/memory.mjs';
import {
  deprecateCourse, restoreCourse, applyDeprecations, isDeprecated,
} from '../scripts/lib/deprecate.mjs';

const NOW = new Date('2026-08-09T12:00:00Z');
const url = 'https://ejemplo.test/curso';

/* ------------------------------------------------------------------ memoria */

test('una URL vista queda registrada como activa', () => {
  const memory = emptyMemory();
  const entry = recordSeen(memory, url, { source: 'test', isCourse: true, now: NOW });

  assert.equal(entry.status, 'activo');
  assert.equal(entry.is_course, true);
  assert.equal(entry.first_seen, '2026-08-09');
  assert.equal(entry.missing_count, 0);
});

test('first_seen se conserva entre visitas', () => {
  const memory = emptyMemory();
  recordSeen(memory, url, { now: new Date('2026-01-01T00:00:00Z') });
  const entry = recordSeen(memory, url, { now: NOW });

  assert.equal(entry.first_seen, '2026-01-01');
  assert.equal(entry.last_seen, '2026-08-09');
});

test('un cambio de contenido queda fechado', () => {
  const memory = emptyMemory();
  recordSeen(memory, url, { contentHash: 'aaa', now: new Date('2026-01-01T00:00:00Z') });
  const entry = recordSeen(memory, url, { contentHash: 'bbb', now: NOW });

  assert.equal(entry.changed_at, '2026-08-09');
});

test('un contenido idéntico no marca cambio', () => {
  const memory = emptyMemory();
  recordSeen(memory, url, { contentHash: 'aaa', now: new Date('2026-01-01T00:00:00Z') });
  const entry = recordSeen(memory, url, { contentHash: 'aaa', now: NOW });

  assert.equal(entry.changed_at, null);
});

test('un fallo aislado marca inestable, no retirado', () => {
  const memory = emptyMemory();
  const entry = recordMissing(memory, url, { reason: 'HTTP 500', now: NOW });

  assert.equal(entry.status, 'inestable');
  assert.equal(entry.missing_count, 1);
});

test('la retirada exige fallos repetidos', () => {
  const memory = emptyMemory();
  recordSeen(memory, url, { now: NOW });

  for (let i = 1; i < MISSING_THRESHOLD; i += 1) {
    assert.equal(recordMissing(memory, url, { now: NOW }).status, 'inestable');
  }

  assert.equal(recordMissing(memory, url, { now: NOW }).status, 'retirado');
});

test('una visita exitosa reinicia el contador de fallos', () => {
  const memory = emptyMemory();
  recordMissing(memory, url, { now: NOW });
  recordMissing(memory, url, { now: NOW });
  const entry = recordSeen(memory, url, { now: NOW });

  assert.equal(entry.missing_count, 0);
  assert.equal(entry.status, 'activo');
});

test('una URL desconocida siempre se visita', () => {
  assert.equal(shouldRevisit(emptyMemory(), url, { now: NOW }), true);
});

test('una ficha de curso reciente se pospone', () => {
  const memory = emptyMemory();
  recordSeen(memory, url, { isCourse: true, now: new Date('2026-08-05T00:00:00Z') });

  assert.equal(shouldRevisit(memory, url, { revisitAfterDays: 14, now: NOW }), false);
});

test('una página de índice se revisita mucho antes que una ficha de curso', () => {
  const memory = emptyMemory();
  const hace3dias = new Date('2026-08-06T00:00:00Z');

  recordSeen(memory, 'https://a.test/courses', { isCourse: false, now: hace3dias });
  recordSeen(memory, 'https://a.test/curso/ml', { isCourse: true, now: hace3dias });

  assert.equal(
    shouldRevisit(memory, 'https://a.test/courses', { revisitAfterDays: 14, now: NOW }),
    true,
    'el índice trae enlaces nuevos: debe revisitarse pronto',
  );
  assert.equal(
    shouldRevisit(memory, 'https://a.test/curso/ml', { revisitAfterDays: 14, now: NOW }),
    false,
    'la ficha de curso es estable: se pospone',
  );
});

test('una URL antigua se revisita', () => {
  const memory = emptyMemory();
  recordSeen(memory, url, { now: new Date('2026-06-01T00:00:00Z') });

  assert.equal(shouldRevisit(memory, url, { revisitAfterDays: 14, now: NOW }), true);
});

test('una URL retirada no se revisita', () => {
  const memory = emptyMemory();
  for (let i = 0; i < MISSING_THRESHOLD; i += 1) recordMissing(memory, url, { now: NOW });

  assert.equal(shouldRevisit(memory, url, { now: NOW }), false);
});

test('una URL inestable se revisita en la próxima pasada', () => {
  const memory = emptyMemory();
  recordMissing(memory, url, { now: NOW });

  assert.equal(shouldRevisit(memory, url, { now: NOW }), true);
});

test('retiredUrls lista solo las confirmadas como retiradas', () => {
  const memory = emptyMemory();
  recordSeen(memory, 'https://a.test/1', { now: NOW });
  recordMissing(memory, 'https://b.test/2', { now: NOW });
  for (let i = 0; i < MISSING_THRESHOLD; i += 1) {
    recordMissing(memory, 'https://c.test/3', { reason: 'HTTP 404', now: NOW });
  }

  const retiradas = retiredUrls(memory);
  assert.equal(retiradas.length, 1);
  assert.equal(retiradas[0].url, 'https://c.test/3');
  assert.equal(retiradas[0].reason, 'HTTP 404');
});

test('summarize cuenta cada estado', () => {
  const memory = emptyMemory();
  recordSeen(memory, 'https://a.test/1', { isCourse: true, now: NOW });
  recordMissing(memory, 'https://b.test/2', { now: NOW });
  for (let i = 0; i < MISSING_THRESHOLD; i += 1) recordMissing(memory, 'https://c.test/3', { now: NOW });

  assert.deepEqual(summarize(memory), {
    total: 3, activos: 1, inestables: 1, retirados: 1, cursos: 1,
  });
});

/* -------------------------------------------------------------- deprecación */

const curso = (o) => ({
  id: 'demo', title: 'Curso', institution: 'Test',
  url_official: 'https://ejemplo.test/curso',
  verification_status: 'VERIFICADO', notes: 'Nota original.', ...o,
});

test('deprecar conserva todos los datos del curso', () => {
  const original = curso({ credential_price_usd: 149, level: 'intermedio' });
  const result = deprecateCourse(original, { reason: 'HTTP 404', detectedAt: '2026-08-09' });

  assert.equal(result.verification_status, 'NO_DISPONIBLE');
  assert.equal(result.status, 'no disponible');
  assert.equal(result.credential_price_usd, 149, 'los datos verificados se conservan');
  assert.equal(result.level, 'intermedio');
  assert.match(result.notes, /DEPRECADO 2026-08-09/);
  assert.match(result.notes, /Nota original/, 'la nota previa no se pierde');
});

test('deprecar no muta el curso original', () => {
  const original = curso();
  const copia = { ...original };
  deprecateCourse(original, { reason: 'x' });

  assert.deepEqual(original, copia);
});

test('isDeprecated reconoce el estado', () => {
  assert.equal(isDeprecated(curso({ verification_status: 'NO_DISPONIBLE' })), true);
  assert.equal(isDeprecated(curso()), false);
});

test('un curso restaurado pasa a REVERIFICAR, no a VERIFICADO', () => {
  const deprecado = deprecateCourse(curso(), { reason: 'HTTP 404', detectedAt: '2026-07-01' });
  const restaurado = restoreCourse(deprecado, { detectedAt: '2026-08-09' });

  assert.equal(restaurado.verification_status, 'REVERIFICAR');
  assert.match(restaurado.notes, /RESTAURADO 2026-08-09/);
});

test('applyDeprecations marca solo los cursos cuya URL se retiró', () => {
  const catalogo = [
    curso({ id: 'vivo', url_official: 'https://vivo.test/a' }),
    curso({ id: 'muerto', url_official: 'https://muerto.test/b' }),
  ];

  const { catalog, deprecados } = applyDeprecations(
    catalogo,
    [{ url: 'https://muerto.test/b', reason: 'HTTP 404', missing_count: 3 }],
    { detectedAt: '2026-08-09' },
  );

  assert.equal(deprecados.length, 1);
  assert.equal(deprecados[0].id, 'muerto');
  assert.equal(catalog.find((c) => c.id === 'vivo').verification_status, 'VERIFICADO');
  assert.equal(catalog.find((c) => c.id === 'muerto').verification_status, 'NO_DISPONIBLE');
});

test('ningún curso se borra al deprecar', () => {
  const catalogo = [curso({ id: 'a' }), curso({ id: 'b', url_official: 'https://b.test/x' })];
  const { catalog } = applyDeprecations(catalogo, [{ url: 'https://ejemplo.test/curso' }]);

  assert.equal(catalog.length, 2, 'el catálogo conserva todos los registros');
});

test('un curso que vuelve se restaura automáticamente', () => {
  const catalogo = [deprecateCourse(curso({ id: 'vuelve' }), { reason: 'HTTP 404' })];
  const { catalog, restaurados } = applyDeprecations(catalogo, [], { detectedAt: '2026-08-09' });

  assert.equal(restaurados.length, 1);
  assert.equal(catalog[0].verification_status, 'REVERIFICAR');
});

test('deprecar dos veces no duplica la nota', () => {
  const catalogo = [curso()];
  const retiradas = [{ url: 'https://ejemplo.test/curso', reason: 'HTTP 404' }];

  const primera = applyDeprecations(catalogo, retiradas, { detectedAt: '2026-08-09' });
  const segunda = applyDeprecations(primera.catalog, retiradas, { detectedAt: '2026-08-10' });

  assert.equal(segunda.deprecados.length, 0, 'ya estaba deprecado');
  assert.equal((segunda.catalog[0].notes.match(/DEPRECADO/g) ?? []).length, 1);
});

test('la comparación de URL es canónica', () => {
  const catalogo = [curso({ url_official: 'https://ejemplo.test/curso' })];
  const { deprecados } = applyDeprecations(
    catalogo,
    [{ url: 'http://www.ejemplo.test/curso/?utm_source=x' }],
  );

  assert.equal(deprecados.length, 1, 'variantes de la misma URL deben coincidir');
});

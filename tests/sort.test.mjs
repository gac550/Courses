import test from 'node:test';
import assert from 'node:assert/strict';

import { sortCourses, credentialRank, compareCourses } from '../scripts/lib/sort.mjs';

const course = (overrides) => ({
  id: 'x',
  title: 'T',
  institution: 'I',
  credential_type: null,
  verification_status: 'PENDIENTE',
  relevance_ppp_infra: 0,
  ...overrides,
});

test('la acreditabilidad manda sobre cualquier otro criterio', () => {
  const sorted = sortCourses([
    course({ id: 'sin', credential_type: null, relevance_ppp_infra: 3 }),
    course({ id: 'gratis', credential_type: 'certificado gratuito', relevance_ppp_infra: 0 }),
    course({ id: 'pagado', credential_type: 'certificado pagado', relevance_ppp_infra: 3 }),
  ]);

  assert.deepEqual(sorted.map((c) => c.id), ['gratis', 'pagado', 'sin']);
});

test('sin credencial va después de cualquier credencial conocida', () => {
  assert.ok(credentialRank({ credential_type: null }) > credentialRank({ credential_type: 'certificado pagado' }));
});

test('un tipo de credencial desconocido no supera a uno conocido', () => {
  const rank = credentialRank({ credential_type: 'algo-no-previsto' });
  assert.ok(rank > credentialRank({ credential_type: 'certificado pagado' }));
  assert.ok(rank < credentialRank({ credential_type: null }));
});

test('VERIFICADO desempata frente a PENDIENTE', () => {
  const sorted = sortCourses([
    course({ id: 'pendiente', credential_type: 'certificado gratuito', verification_status: 'PENDIENTE' }),
    course({ id: 'verificado', credential_type: 'certificado gratuito', verification_status: 'VERIFICADO' }),
  ]);

  assert.deepEqual(sorted.map((c) => c.id), ['verificado', 'pendiente']);
});

test('la relevancia ordena de mayor a menor', () => {
  const sorted = sortCourses([
    course({ id: 'baja', relevance_ppp_infra: 1 }),
    course({ id: 'alta', relevance_ppp_infra: 3 }),
    course({ id: 'media', relevance_ppp_infra: 2 }),
  ]);

  assert.deepEqual(sorted.map((c) => c.id), ['alta', 'media', 'baja']);
});

test('una relevancia nula queda después de cualquier valor numérico', () => {
  const sorted = sortCourses([
    course({ id: 'nula', relevance_ppp_infra: null }),
    course({ id: 'cero', relevance_ppp_infra: 0 }),
  ]);

  assert.deepEqual(sorted.map((c) => c.id), ['cero', 'nula']);
});

test('el orden es determinístico y estable', () => {
  const input = [
    course({ id: 'c', institution: 'B', title: 'A' }),
    course({ id: 'a', institution: 'A', title: 'B' }),
    course({ id: 'b', institution: 'A', title: 'A' }),
  ];

  const first = sortCourses(input).map((c) => c.id);
  const second = sortCourses([...input].reverse()).map((c) => c.id);

  assert.deepEqual(first, second, 'el orden no debe depender del orden de entrada');
  assert.deepEqual(first, ['b', 'a', 'c']);
});

test('sortCourses no muta el arreglo original', () => {
  const input = [course({ id: 'z' }), course({ id: 'a', credential_type: 'certificado gratuito' })];
  const copy = [...input];
  sortCourses(input);

  assert.deepEqual(input, copy);
});

test('el comparador devuelve cero para registros equivalentes', () => {
  assert.equal(compareCourses(course({ id: 'same' }), course({ id: 'same' })), 0);
});

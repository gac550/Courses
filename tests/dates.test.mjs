import test from 'node:test';
import assert from 'node:assert/strict';

import { isIsoDate, daysSince, isStale, derivedStatus, today } from '../scripts/lib/dates.mjs';

// Fecha de referencia fija: los tests no dependen del reloj real.
const NOW = new Date('2026-08-09T12:00:00Z');

test('solo se aceptan fechas ISO válidas', () => {
  assert.equal(isIsoDate('2026-08-09'), true);
  assert.equal(isIsoDate('2026-8-9'), false);
  assert.equal(isIsoDate('09-08-2026'), false);
  assert.equal(isIsoDate(''), false);
  assert.equal(isIsoDate(null), false);
});

test('una fecha inexistente se rechaza', () => {
  assert.equal(isIsoDate('2026-02-31'), false);
  assert.equal(isIsoDate('2026-13-01'), false);
});

test('daysSince calcula la antigüedad contra la referencia dada', () => {
  assert.equal(daysSince('2026-08-09', NOW), 0);
  assert.equal(daysSince('2026-08-02', NOW), 7);
  assert.equal(daysSince('2026-05-11', NOW), 90);
});

test('daysSince devuelve null ante una fecha inválida', () => {
  assert.equal(daysSince('no-es-fecha', NOW), null);
  assert.equal(daysSince(null, NOW), null);
});

test('la verificación vence pasados los 90 días', () => {
  assert.equal(isStale('2026-08-09', 90, NOW), false);
  assert.equal(isStale('2026-05-11', 90, NOW), false, '90 días exactos aún es vigente');
  assert.equal(isStale('2026-05-10', 90, NOW), true, '91 días ya está vencida');
});

test('una fecha ausente cuenta como vencida: nunca se asume vigencia', () => {
  assert.equal(isStale(null, 90, NOW), true);
  assert.equal(isStale('', 90, NOW), true);
});

test('un VERIFICADO vencido deriva a REVERIFICAR sin alterar el dato', () => {
  const course = { verification_status: 'VERIFICADO', last_verified: '2026-01-01' };
  assert.equal(derivedStatus(course, 90, NOW), 'REVERIFICAR');
  assert.equal(course.verification_status, 'VERIFICADO', 'el registro original no se modifica');
});

test('un VERIFICADO vigente se mantiene', () => {
  assert.equal(
    derivedStatus({ verification_status: 'VERIFICADO', last_verified: '2026-08-01' }, 90, NOW),
    'VERIFICADO',
  );
});

test('los demás estados se conservan tal cual', () => {
  assert.equal(derivedStatus({ verification_status: 'PENDIENTE' }, 90, NOW), 'PENDIENTE');
  assert.equal(
    derivedStatus({ verification_status: 'MANUAL_REVIEW_REQUIRED' }, 90, NOW),
    'MANUAL_REVIEW_REQUIRED',
  );
});

test('un registro sin estado se considera PENDIENTE', () => {
  assert.equal(derivedStatus({}, 90, NOW), 'PENDIENTE');
});

test('today devuelve formato ISO', () => {
  assert.equal(today(NOW), '2026-08-09');
});

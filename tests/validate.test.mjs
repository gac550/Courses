import test from 'node:test';
import assert from 'node:assert/strict';

import { validateCourse, validateCatalog, summarize } from '../scripts/lib/validate-lib.mjs';

const NOW = new Date('2026-08-09T12:00:00Z');

const valid = (overrides) => ({
  id: 'harvard-cs50x',
  title: 'CS50',
  institution: 'Harvard University',
  domain: 'ai-tecnica',
  url_official: 'https://cs50.harvard.edu/x/',
  verification_status: 'VERIFICADO',
  last_verified: '2026-08-01',
  source_of_truth: 'https://cs50.harvard.edu/x/',
  relevance_ppp_infra: 0,
  ...overrides,
});

const errors = (course) =>
  validateCourse(course, { now: NOW }).filter((i) => i.level === 'error');

const fields = (issues) => issues.map((i) => i.field);

test('un registro correcto no genera errores', () => {
  assert.equal(errors(valid()).length, 0);
});

test('faltar un campo obligatorio es error', () => {
  assert.ok(fields(errors(valid({ title: undefined }))).includes('title'));
  assert.ok(fields(errors(valid({ url_official: null }))).includes('url_official'));
});

test('un string vacío es error: debe usarse null', () => {
  const found = errors(valid({ platform: '' }));
  assert.ok(fields(found).includes('platform'));
  assert.match(found.find((i) => i.field === 'platform').message, /null/);
});

test('un id que no es kebab-case es error', () => {
  assert.ok(fields(errors(valid({ id: 'Harvard CS50' }))).includes('id'));
  assert.ok(fields(errors(valid({ id: 'harvard_cs50' }))).includes('id'));
});

test('un valor fuera de la lista permitida es error', () => {
  assert.ok(fields(errors(valid({ domain: 'otro' }))).includes('domain'));
  assert.ok(fields(errors(valid({ level: 'experto' }))).includes('level'));
  assert.ok(fields(errors(valid({ verification_status: 'QUIZAS' }))).includes('verification_status'));
});

test('una URL inválida es error', () => {
  assert.ok(fields(errors(valid({ url_official: 'no-es-url' }))).includes('url_official'));
  assert.ok(fields(errors(valid({ url_syllabus: 'javascript:alert(1)' }))).includes('url_syllabus'));
});

test('una fecha mal formada es error', () => {
  assert.ok(fields(errors(valid({ last_verified: '01-08-2026' }))).includes('last_verified'));
  assert.ok(fields(errors(valid({ start_date: '2026-02-31' }))).includes('start_date'));
});

test('un certificado gratuito no puede tener precio mayor que cero', () => {
  const found = errors(valid({ credential_free: true, credential_price_usd: 149 }));
  assert.ok(fields(found).includes('credential_price_usd'));
  assert.match(found.find((i) => i.field === 'credential_price_usd').message, /Incoherencia/);
});

test('el tipo de credencial debe concordar con credential_free', () => {
  assert.ok(fields(errors(valid({
    credential_type: 'certificado gratuito', credential_free: false,
  }))).includes('credential_free'));

  assert.ok(fields(errors(valid({
    credential_type: 'certificado pagado', credential_free: true,
  }))).includes('credential_free'));
});

test('VERIFICADO exige fecha y fuente de verdad', () => {
  assert.ok(fields(errors(valid({ last_verified: null }))).includes('last_verified'));
  assert.ok(fields(errors(valid({ source_of_truth: null }))).includes('source_of_truth'));
});

test('una verificación vencida genera aviso, no error', () => {
  const issues = validateCourse(valid({ last_verified: '2026-01-01' }), { now: NOW });
  const warn = issues.find((i) => i.field === 'last_verified');

  assert.equal(warn.level, 'warn');
  assert.match(warn.message, /REVERIFICAR/);
});

test('una relevancia fuera de rango es error', () => {
  assert.ok(fields(errors(valid({ relevance_ppp_infra: 5 }))).includes('relevance_ppp_infra'));
  assert.ok(fields(errors(valid({ relevance_ppp_infra: -1 }))).includes('relevance_ppp_infra'));
  assert.ok(fields(errors(valid({ relevance_ppp_infra: 2.5 }))).includes('relevance_ppp_infra'));
});

test('una relevancia mayor que 0 sin justificación genera aviso', () => {
  const issues = validateCourse(valid({ relevance_ppp_infra: 3, notes: null }), { now: NOW });
  assert.ok(issues.some((i) => i.level === 'warn' && i.field === 'notes'));
});

test('un arreglo vacío es error: debe usarse null', () => {
  assert.ok(fields(errors(valid({ topics: [] }))).includes('topics'));
  assert.ok(fields(errors(valid({ language: [] }))).includes('language'));
});

test('un precio negativo o no numérico es error', () => {
  assert.ok(fields(errors(valid({ credential_price_usd: -10 }))).includes('credential_price_usd'));
  assert.ok(fields(errors(valid({ credential_price_usd: '149' }))).includes('credential_price_usd'));
});

test('los IDs duplicados se detectan en el catálogo', () => {
  const issues = validateCatalog([valid(), valid()], { now: NOW });
  assert.ok(issues.some((i) => i.level === 'error' && i.field === 'id'));
});

test('una URL repetida genera aviso de posible duplicado', () => {
  const issues = validateCatalog(
    [valid(), valid({ id: 'otro-curso' })],
    { now: NOW },
  );
  assert.ok(issues.some((i) => i.level === 'warn' && i.field === 'url_official'));
});

test('un catálogo vacío es válido', () => {
  assert.equal(validateCatalog([], { now: NOW }).length, 0);
});

test('un catálogo que no es arreglo es error', () => {
  assert.equal(summarize(validateCatalog({}, { now: NOW })).errors, 1);
});

test('summarize cuenta errores y avisos por separado', () => {
  const summary = summarize([
    { level: 'error' }, { level: 'error' }, { level: 'warn' },
  ]);
  assert.deepEqual(summary, { errors: 2, warnings: 1, total: 3 });
});

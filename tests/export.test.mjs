import test from 'node:test';
import assert from 'node:assert/strict';

import { toCsv, toMarkdown, toJson } from '../src/renderer/export.js';

const course = (overrides) => ({
  id: 'demo',
  title: 'Curso',
  institution: 'Institución',
  credential_type: 'certificado gratuito',
  credential_free: true,
  credential_price_usd: null,
  verification_status: 'VERIFICADO',
  url_official: 'https://example.com/x',
  ...overrides,
});

test('el CSV usa punto y coma como separador', () => {
  const csv = toCsv([course()]);
  const header = csv.split('\r\n')[0];

  assert.ok(header.includes(';'));
  assert.ok(header.includes('"Título"'));
});

test('el CSV incluye BOM para que Excel respete los acentos', () => {
  assert.ok(toCsv([course()]).startsWith('﻿'));
});

test('las comillas internas se escapan duplicándolas', () => {
  const csv = toCsv([course({ title: 'Curso "avanzado"' })]);
  assert.ok(csv.includes('"Curso ""avanzado"""'));
});

test('un texto que empieza por = no se ejecuta como fórmula', () => {
  const csv = toCsv([course({ title: '=SUM(A1:A9)' })]);

  assert.ok(csv.includes(`"'=SUM(A1:A9)"`), 'debe anteponerse una comilla simple');
  assert.ok(!csv.includes('"=SUM'), 'no debe quedar una fórmula activa');
});

test('los demás caracteres peligrosos también se neutralizan', () => {
  for (const prefix of ['+', '-', '@']) {
    const csv = toCsv([course({ title: `${prefix}cmd` })]);
    assert.ok(csv.includes(`"'${prefix}cmd"`), `debe neutralizar el prefijo ${prefix}`);
  }
});

test('los valores nulos quedan como celda vacía', () => {
  const csv = toCsv([course({ credential_price_usd: null, course_code: null })]);
  assert.ok(csv.includes('""'));
  assert.ok(!csv.toLowerCase().includes('null'));
});

test('los booleanos se exportan en español', () => {
  const csv = toCsv([course({ credential_free: true })]);
  assert.ok(csv.includes('"sí"'));
});

test('la tabla Markdown lleva la columna ID primero', () => {
  const md = toMarkdown([course()]);
  assert.ok(md.startsWith('| ID |'));
});

test('las barras verticales no rompen la tabla Markdown', () => {
  const md = toMarkdown([course({ title: 'A | B' })]);
  assert.ok(md.includes('A \\| B'));
});

test('un curso sin credencial se declara explícitamente', () => {
  const md = toMarkdown([course({ credential_type: null })]);
  assert.ok(md.includes('sin credencial'));
});

test('el JSON exportado es válido y conserva los registros', () => {
  const parsed = JSON.parse(toJson([course(), course({ id: 'otro' })]));
  assert.equal(parsed.length, 2);
  assert.equal(parsed[1].id, 'otro');
});

test('exportar una lista vacía no falla', () => {
  assert.ok(toCsv([]).includes('"ID"'));
  assert.ok(toMarkdown([]).startsWith('| ID |'));
  assert.equal(JSON.parse(toJson([])).length, 0);
});

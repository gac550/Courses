import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cleanString, slugify, makeId, normalizeTitle,
  parsePriceUsd, classifyCredential, normalizeCourse,
} from '../scripts/lib/normalize.mjs';

test('un string vacío nunca es un dato: se convierte en null', () => {
  assert.equal(cleanString(''), null);
  assert.equal(cleanString('   '), null);
  assert.equal(cleanString('\n\t '), null);
  assert.equal(cleanString(null), null);
  assert.equal(cleanString(undefined), null);
});

test('cleanString colapsa espacios internos', () => {
  assert.equal(cleanString('  Machine   Learning  '), 'Machine Learning');
});

test('slugify elimina acentos y produce kebab-case', () => {
  assert.equal(slugify('Introducción a la Programación'), 'introduccion-a-la-programacion');
  assert.equal(slugify('CS50x'), 'cs50x');
  assert.equal(slugify('  AI & Business  '), 'ai-business');
});

test('los IDs generados son estables y determinísticos', () => {
  const input = { institution: 'Harvard University', course_code: 'CS50x', title: 'Intro to CS' };
  assert.equal(makeId(input), 'harvard-cs50x');
  assert.equal(makeId(input), makeId(input));
});

test('el ID usa el título cuando no hay código de curso', () => {
  assert.equal(
    makeId({ institution: 'Stanford University', title: 'Machine Learning' }),
    'stanford-machine-learning',
  );
});

test('sin título ni código no se inventa un ID', () => {
  assert.equal(makeId({ institution: 'MIT' }), null);
});

test('normalizeTitle permite comparar títulos equivalentes', () => {
  assert.equal(normalizeTitle('Máquina de Aprendizaje!'), normalizeTitle('maquina de aprendizaje'));
});

test('los precios en USD se interpretan correctamente', () => {
  assert.equal(parsePriceUsd('$199.00 USD'), 199);
  assert.equal(parsePriceUsd('USD 1,299'), 1299);
  assert.equal(parsePriceUsd(49), 49);
  assert.equal(parsePriceUsd('Free'), 0);
  assert.equal(parsePriceUsd('gratis'), 0);
});

test('otras monedas no se convierten: devuelven null', () => {
  assert.equal(parsePriceUsd('€199'), null);
  assert.equal(parsePriceUsd('£150'), null);
  assert.equal(parsePriceUsd('CLP 90.000'), null);
});

test('un precio no verificable es null, nunca un valor plausible', () => {
  assert.equal(parsePriceUsd('consultar precio'), null);
  assert.equal(parsePriceUsd(''), null);
  assert.equal(parsePriceUsd(null), null);
  assert.equal(parsePriceUsd(-5), null);
});

test('«curso gratuito» NO implica «certificado gratuito»', () => {
  assert.equal(classifyCredential({ text: 'This course is free to audit' }), null);
  assert.equal(classifyCredential({ text: 'Free online course' }), null);
});

test('un certificado gratuito se clasifica solo con evidencia explícita', () => {
  assert.equal(classifyCredential({ text: 'Free certificate available' }), 'certificado gratuito');
});

test('un certificado pagado verificable se distingue de uno simple', () => {
  assert.equal(
    classifyCredential({ text: 'Verified certificate', priceUsd: 149 }),
    'certificado pagado verificable',
  );
  assert.equal(
    classifyCredential({ text: 'Certificate of completion', priceUsd: 99 }),
    'certificado pagado',
  );
});

test('sin evidencia suficiente la credencial queda en null', () => {
  assert.equal(classifyCredential({ text: '' }), null);
  assert.equal(classifyCredential({ text: 'Learn at your own pace' }), null);
});

test('normalizeCourse convierte strings vacíos en null', () => {
  const result = normalizeCourse({ title: 'Curso', platform: '', notes: '   ' });
  assert.equal(result.platform, null);
  assert.equal(result.notes, null);
  assert.equal(result.title, 'Curso');
});

test('normalizeCourse limpia arreglos y deja null si quedan vacíos', () => {
  const result = normalizeCourse({ title: 'X', topics: ['  ai  ', '', null], language: ['', '  '] });
  assert.deepEqual(result.topics, ['ai']);
  assert.equal(result.language, null);
});

test('normalizeCourse canoniza las URLs', () => {
  const result = normalizeCourse({
    title: 'X',
    url_official: 'http://WWW.Example.com/curso/?utm_source=x#seccion',
  });
  assert.equal(result.url_official, 'https://example.com/curso');
});

import test from 'node:test';
import assert from 'node:assert/strict';

import { isValidHttpUrl, canonicalUrl, hostOf, isAllowedHost } from '../scripts/lib/urls.mjs';

test('solo se aceptan URLs http y https', () => {
  assert.equal(isValidHttpUrl('https://mit.edu'), true);
  assert.equal(isValidHttpUrl('http://mit.edu'), true);
  assert.equal(isValidHttpUrl('ftp://mit.edu'), false);
  assert.equal(isValidHttpUrl('javascript:alert(1)'), false);
  assert.equal(isValidHttpUrl('mit.edu'), false);
  assert.equal(isValidHttpUrl(''), false);
  assert.equal(isValidHttpUrl(null), false);
});

test('la canonicalización normaliza esquema, host y barra final', () => {
  assert.equal(canonicalUrl('http://WWW.MIT.edu/curso/'), 'https://mit.edu/curso');
  assert.equal(canonicalUrl('https://mit.edu'), 'https://mit.edu/');
});

test('se eliminan fragmento y parámetros de seguimiento', () => {
  assert.equal(
    canonicalUrl('https://mit.edu/curso?utm_source=google&utm_medium=cpc#intro'),
    'https://mit.edu/curso',
  );
});

test('los parámetros significativos se conservan y ordenan', () => {
  assert.equal(
    canonicalUrl('https://edx.org/course?b=2&a=1'),
    'https://edx.org/course?a=1&b=2',
  );
});

test('dos variantes de la misma URL canonizan al mismo valor', () => {
  assert.equal(
    canonicalUrl('http://www.edx.org/course/ai/?utm_campaign=x'),
    canonicalUrl('https://edx.org/course/ai'),
  );
});

test('una URL inválida no se canoniza', () => {
  assert.equal(canonicalUrl('no-es-url'), null);
  assert.equal(canonicalUrl(null), null);
});

test('hostOf extrae el host sin www', () => {
  assert.equal(hostOf('https://www.ocw.mit.edu/x'), 'ocw.mit.edu');
  assert.equal(hostOf('invalida'), null);
});

test('la allowlist acepta el dominio y sus subdominios', () => {
  assert.equal(isAllowedHost('https://ocw.mit.edu/curso', ['mit.edu']), true);
  assert.equal(isAllowedHost('https://mit.edu/curso', ['mit.edu']), true);
  assert.equal(isAllowedHost('https://www.mit.edu/curso', ['mit.edu']), true);
});

test('la allowlist rechaza dominios ajenos y suplantaciones', () => {
  assert.equal(isAllowedHost('https://evil.com/curso', ['mit.edu']), false);
  assert.equal(isAllowedHost('https://mit.edu.evil.com/x', ['mit.edu']), false);
  assert.equal(isAllowedHost('https://notmit.edu/x', ['mit.edu']), false);
});

test('sin allowlist válida no se autoriza nada', () => {
  assert.equal(isAllowedHost('https://mit.edu', null), false);
  assert.equal(isAllowedHost('https://mit.edu', []), false);
});

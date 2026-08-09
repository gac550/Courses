#!/usr/bin/env node
/**
 * Reporta la composición del catálogo (§21).
 * Solo lee: nunca modifica data/courses.json.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { derivedStatus, isStale } from './lib/dates.mjs';

const root = process.env.COURSES_ROOT ?? process.cwd();
const jsonPath = join(root, 'data', 'courses.json');

if (!existsSync(jsonPath)) {
  console.error(`No existe la fuente de verdad: ${jsonPath}`);
  process.exit(1);
}

const courses = JSON.parse(readFileSync(jsonPath, 'utf8'));

if (!Array.isArray(courses) || courses.length === 0) {
  console.log('Catálogo vacío: 0 cursos.');
  process.exit(0);
}

const countBy = (key, fallback = '(sin dato)') => {
  const map = new Map();
  for (const course of courses) {
    const value = course[key] ?? fallback;
    map.set(value, (map.get(value) ?? 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), 'es'));
};

const table = (title, rows) => {
  console.log(`\n${title}`);
  const width = Math.max(...rows.map(([label]) => String(label).length), 10);
  for (const [label, n] of rows) {
    console.log(`  ${String(label).padEnd(width)}  ${String(n).padStart(4)}`);
  }
};

const freeCertificate = courses.filter(
  (c) => c.credential_free === true && c.credential_type === 'certificado gratuito',
).length;
const freeBadge = courses.filter(
  (c) => c.credential_free === true && c.credential_type === 'badge gratuito',
).length;
const paid = courses.filter((c) => c.credential_free === false).length;
const none = courses.filter((c) => c.credential_type === null || c.credential_type === undefined).length;
const stale = courses.filter((c) => isStale(c.last_verified)).length;

console.log('Resumen del catálogo');
console.log(`  Cursos totales          ${courses.length}`);
console.log(`  Instituciones           ${new Set(courses.map((c) => c.institution)).size}`);
console.log(`  Certificado gratuito    ${freeCertificate}`);
console.log(`  Badge gratuito          ${freeBadge}`);
console.log(`  Certificado pagado      ${paid}`);
console.log(`  Sin credencial          ${none}`);
console.log(`  Verificación vencida    ${stale}`);

table('Por origen', countBy('provider_type'));
table('Por dominio', countBy('domain'));
table('Por institución', countBy('institution'));
table('Por país', countBy('institution_country'));
table('Por plataforma', countBy('platform'));
table('Por credencial', countBy('credential_type', 'sin credencial'));
table('Por estado de verificación', countBy('verification_status'));

const derived = new Map();
for (const course of courses) {
  const value = derivedStatus(course);
  derived.set(value, (derived.get(value) ?? 0) + 1);
}
table('Estado derivado (regla de 90 días)', [...derived.entries()].sort((a, b) => b[1] - a[1]));

console.log('');

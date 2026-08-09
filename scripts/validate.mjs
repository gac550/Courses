#!/usr/bin/env node
/**
 * Valida data/courses.json: estructura, coherencia, credenciales, precios,
 * fechas, enums, duplicados y antigüedad de las verificaciones.
 *
 * Sale con código 1 si hay errores, para que CI falle ante datos inválidos.
 * Las advertencias no bloquean pero se reportan siempre.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { validateCatalog, summarize } from './lib/validate-lib.mjs';

const root = process.env.COURSES_ROOT ?? process.cwd();
const jsonPath = join(root, 'data', 'courses.json');

if (!existsSync(jsonPath)) {
  console.error(`No existe la fuente de verdad: ${jsonPath}`);
  process.exit(1);
}

let courses;
try {
  courses = JSON.parse(readFileSync(jsonPath, 'utf8'));
} catch (error) {
  console.error(`JSON inválido en ${jsonPath}: ${error.message}`);
  process.exit(1);
}

const issues = validateCatalog(courses);
const summary = summarize(issues);

if (issues.length > 0) {
  const byId = new Map();
  for (const item of issues) {
    if (!byId.has(item.id)) byId.set(item.id, []);
    byId.get(item.id).push(item);
  }

  for (const [id, items] of byId) {
    console.log(`\n${id}`);
    for (const item of items) {
      const mark = item.level === 'error' ? 'ERROR' : 'aviso';
      const field = item.field ? ` [${item.field}]` : '';
      console.log(`  ${mark}${field}: ${item.message}`);
    }
  }
  console.log('');
}

const count = Array.isArray(courses) ? courses.length : 0;
console.log(
  `Validación: ${count} cursos · ${summary.errors} errores · ${summary.warnings} avisos`,
);

if (summary.errors > 0) process.exit(1);

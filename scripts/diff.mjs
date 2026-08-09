#!/usr/bin/env node
/**
 * Detecta cambios relevantes en el catálogo (§16, §21).
 *
 * Compara data/courses.json contra la última instantánea de
 * data/snapshots/. Reporta altas, bajas y cambios de campos sensibles:
 * URL, credencial, precio, estado y verificación.
 *
 * Solo lee y reporta: nunca modifica el catálogo.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { today } from './lib/dates.mjs';

const root = process.env.COURSES_ROOT ?? process.cwd();
const coursesPath = join(root, 'data', 'courses.json');
const snapshotsDir = join(root, 'data', 'snapshots');
const reportsDir = join(root, 'reports');

const WATCHED = [
  'title', 'url_official', 'credential_type', 'credential_free',
  'credential_price_usd', 'verification_status', 'status', 'last_verified',
];

const actual = JSON.parse(readFileSync(coursesPath, 'utf8'));

mkdirSync(snapshotsDir, { recursive: true });

const snapshots = existsSync(snapshotsDir)
  ? readdirSync(snapshotsDir).filter((f) => f.endsWith('.json')).sort()
  : [];

if (snapshots.length === 0) {
  const nombre = `courses-${today()}.json`;
  writeFileSync(join(snapshotsDir, nombre), `${JSON.stringify(actual, null, 2)}\n`);
  console.log(`Primera instantánea creada: data/snapshots/${nombre}`);
  console.log('Sin comparación previa: ejecutar de nuevo tras el próximo cambio.');
  process.exit(0);
}

const anterior = JSON.parse(
  readFileSync(join(snapshotsDir, snapshots[snapshots.length - 1]), 'utf8'),
);

const indice = (lista) => new Map(lista.map((c) => [c.id, c]));
const antes = indice(anterior);
const ahora = indice(actual);

const altas = actual.filter((c) => !antes.has(c.id));
const bajas = anterior.filter((c) => !ahora.has(c.id));
const cambios = [];

for (const [id, curso] of ahora) {
  const previo = antes.get(id);
  if (!previo) continue;

  for (const field of WATCHED) {
    const valorAntes = previo[field] ?? null;
    const valorAhora = curso[field] ?? null;

    if (JSON.stringify(valorAntes) !== JSON.stringify(valorAhora)) {
      cambios.push({ id, field, antes: valorAntes, ahora: valorAhora });
    }
  }
}

const lineas = [
  '# Reporte de cambios del catálogo',
  '',
  `Fecha: ${today()}`,
  `Instantánea comparada: ${snapshots[snapshots.length - 1]}`,
  '',
  `- Cursos actuales: ${actual.length}`,
  `- Altas: ${altas.length}`,
  `- Bajas: ${bajas.length}`,
  `- Campos modificados: ${cambios.length}`,
  '',
];

if (altas.length > 0) {
  lineas.push('## Cursos nuevos', '', '| ID | Título | Institución |', '|---|---|---|');
  for (const c of altas) lineas.push(`| ${c.id} | ${c.title} | ${c.institution} |`);
  lineas.push('');
}

if (bajas.length > 0) {
  lineas.push('## Cursos eliminados', '', '| ID | Título |', '|---|---|');
  for (const c of bajas) lineas.push(`| ${c.id} | ${c.title} |`);
  lineas.push('');
}

if (cambios.length > 0) {
  lineas.push('## Cambios en campos sensibles', '', '| ID | Campo | Antes | Ahora |', '|---|---|---|---|');
  for (const c of cambios) {
    lineas.push(`| ${c.id} | ${c.field} | ${JSON.stringify(c.antes)} | ${JSON.stringify(c.ahora)} |`);
  }
  lineas.push('');
}

if (altas.length === 0 && bajas.length === 0 && cambios.length === 0) {
  lineas.push('Sin cambios respecto de la instantánea anterior.', '');
}

mkdirSync(reportsDir, { recursive: true });
writeFileSync(join(reportsDir, 'diff-report.md'), lineas.join('\n'), 'utf8');

// Instantánea nueva para la próxima comparación.
writeFileSync(
  join(snapshotsDir, `courses-${today()}.json`),
  `${JSON.stringify(actual, null, 2)}\n`,
);

console.log(`Altas: ${altas.length} · Bajas: ${bajas.length} · Cambios: ${cambios.length}`);
console.log('Reporte: reports/diff-report.md');

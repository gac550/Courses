#!/usr/bin/env node
/**
 * Audita el acceso de los cursos cuyo `cost_access` está sin verificar.
 *
 * El filtro de entrada del catálogo es el acceso gratuito al contenido. Un
 * curso de pago no pertenece, por prestigiosa que sea la institución.
 *
 * Este script SOLO reporta: escribe reports/access-audit.json con la
 * clasificación de cada curso. La decisión de retirar registros del catálogo
 * se toma con ese reporte a la vista, nunca automáticamente.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { createFetcher } from './lib/fetcher.mjs';
import { extractText } from './lib/extract-lib.mjs';
import { classifyAccess, extractPrice } from './lib/pricing.mjs';
import { today } from './lib/dates.mjs';

const root = process.env.COURSES_ROOT ?? process.cwd();
const config = JSON.parse(readFileSync(join(root, 'config', 'crawler.json'), 'utf8'));
const courses = JSON.parse(readFileSync(join(root, 'data', 'courses.json'), 'utf8'));

// Solo los que no tienen el acceso confirmado.
const pendientes = courses.filter((c) => c.cost_access === null);

if (pendientes.length === 0) {
  console.log('Todos los cursos tienen el acceso verificado.');
  process.exit(0);
}

console.log(`Auditando el acceso de ${pendientes.length} cursos…`);

const fetcher = createFetcher(config);
const inicio = Date.now();

const gratuitos = [];
const pagados = [];
const indeterminados = [];
let procesados = 0;

async function auditar(course) {
  const result = await fetcher.get(course.url_official);
  procesados += 1;

  if (procesados % 10 === 0 || procesados === pendientes.length) {
    console.log(
      `  ${procesados}/${pendientes.length} · ${gratuitos.length} gratuitos · ` +
      `${pagados.length} de pago · ${indeterminados.length} sin determinar`,
    );
  }

  if (!result.ok) {
    indeterminados.push({ id: course.id, motivo: result.reason });
    return;
  }

  const texto = extractText(result.body);
  const acceso = classifyAccess(texto);
  const precio = extractPrice(texto);

  const registro = { id: course.id, title: course.title, url: course.url_official, precio };

  if (acceso === 'pagado') pagados.push(registro);
  else if (acceso === 'gratis') gratuitos.push(registro);
  else indeterminados.push({ ...registro, motivo: 'evidencia insuficiente o contradictoria' });
}

await Promise.all(pendientes.map(auditar));

const segundos = Math.round((Date.now() - inicio) / 1000);

mkdirSync(join(root, 'reports'), { recursive: true });
writeFileSync(
  join(root, 'reports', 'access-audit.json'),
  `${JSON.stringify({
    generated_at: today(),
    auditados: pendientes.length,
    gratuitos,
    pagados,
    indeterminados,
  }, null, 2)}\n`,
);

console.log(`\nResultado (${segundos} s):`);
console.log(`  Acceso gratuito confirmado: ${gratuitos.length}`);
console.log(`  Acceso de pago detectado:   ${pagados.length}`);
console.log(`  Sin determinar:             ${indeterminados.length}`);
console.log('\nReporte: reports/access-audit.json');

if (pagados.length > 0) {
  console.log('\nCursos de pago que no pertenecen al catálogo:');
  for (const c of pagados.slice(0, 10)) {
    console.log(`  ${c.precio ? `$${c.precio}` : '—'}  ${String(c.title).slice(0, 60)}`);
  }
  if (pagados.length > 10) console.log(`  … y ${pagados.length - 10} más`);
}

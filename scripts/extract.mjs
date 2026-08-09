#!/usr/bin/env node
/**
 * Extrae metadatos de los candidatos descubiertos (§9).
 *
 * Lee data/discovery/crawl.json y escribe data/discovery/extracted.json.
 * Los registros resultantes son CANDIDATOS: ninguno entra al catálogo sin pasar
 * por verify.mjs.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { createFetcher } from './lib/fetcher.mjs';
import { extractCourse } from './lib/extract-lib.mjs';
import { normalizeCourse } from './lib/normalize.mjs';
import { today } from './lib/dates.mjs';

const root = process.env.COURSES_ROOT ?? process.cwd();
const discoveryDir = join(root, 'data', 'discovery');
const crawlPath = join(discoveryDir, 'crawl.json');

if (!existsSync(crawlPath)) {
  console.log('No hay resultados de crawl. Ejecutar primero: npm run crawl');
  process.exit(0);
}

const config = JSON.parse(readFileSync(join(root, 'config', 'crawler.json'), 'utf8'));
const crawl = JSON.parse(readFileSync(crawlPath, 'utf8'));

const candidatos = crawl.sources.flatMap((s) => s.candidates ?? []);

if (candidatos.length === 0) {
  console.log('Sin candidatos que procesar.');
  process.exit(0);
}

const fetcher = createFetcher(config);
const extraidos = [];
const fallidos = [];

console.log(`Extrayendo metadatos de ${candidatos.length} candidatos…`);

const inicio = Date.now();
let procesados = 0;

/**
 * Procesa un candidato. El fetcher mantiene los límites de concurrencia, de
 * modo que lanzarlos todos a la vez no atropella a ningún host.
 */
async function procesar(candidato) {
  const result = await fetcher.get(candidato.url);
  procesados += 1;

  if (procesados % 5 === 0 || procesados === candidatos.length) {
    console.log(`  ${procesados}/${candidatos.length} procesados · ${extraidos.length} extraídos`);
  }

  if (!result.ok) {
    fallidos.push({
      url: candidato.url,
      reason: result.reason,
      manualReview: Boolean(result.manualReview),
    });
    return;
  }

  const extraido = extractCourse(result.body, candidato.url);

  // La institución de la fuente configurada prevalece sobre la de la página:
  // está verificada en config/sources.json.
  if (candidato.institution) extraido.institution = candidato.institution;

  extraidos.push({
    ...normalizeCourse(extraido),
    evidence: extraido.evidence,
    source_id: candidato.source,
    adapter: candidato.adapter,
    discovered_at: candidato.discovered_at ?? today(),
    extracted_at: today(),
  });
}

await Promise.all(candidatos.map(procesar));

const segundos = Math.round((Date.now() - inicio) / 1000);

mkdirSync(discoveryDir, { recursive: true });
writeFileSync(
  join(discoveryDir, 'extracted.json'),
  `${JSON.stringify({ generated_at: today(), courses: extraidos, failed: fallidos }, null, 2)}\n`,
);

console.log(`Extraídos: ${extraidos.length} · Fallidos: ${fallidos.length} (${segundos} s)`);
console.log('Resultado: data/discovery/extracted.json');

const revision = fallidos.filter((f) => f.manualReview).length;
if (revision > 0) {
  console.log(`${revision} páginas requieren revisión manual: el sitio impide el acceso automatizado.`);
}

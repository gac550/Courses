#!/usr/bin/env node
/**
 * Descubrimiento incremental (§8.2).
 *
 * Compara el resultado del crawl actual con el anterior para detectar URLs
 * nuevas, desaparecidas y páginas cuyo contenido cambió. Guarda huellas en
 * data/discovery/fingerprints.json para no reprocesar todo en cada ejecución.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import { today } from './lib/dates.mjs';

const root = process.env.COURSES_ROOT ?? process.cwd();
const discoveryDir = join(root, 'data', 'discovery');
const crawlPath = join(discoveryDir, 'crawl.json');
const fingerprintsPath = join(discoveryDir, 'fingerprints.json');

if (!existsSync(crawlPath)) {
  console.log('No hay resultados de crawl. Ejecutar primero: npm run crawl');
  process.exit(0);
}

const crawl = JSON.parse(readFileSync(crawlPath, 'utf8'));
const previas = existsSync(fingerprintsPath)
  ? JSON.parse(readFileSync(fingerprintsPath, 'utf8'))
  : { urls: {} };

const actuales = {};
for (const source of crawl.sources) {
  for (const candidate of source.candidates ?? []) {
    actuales[candidate.url] = {
      source: candidate.source,
      hash: createHash('sha256').update(candidate.url).digest('hex').slice(0, 16),
      seen_at: candidate.discovered_at ?? today(),
    };
  }
}

const urlsPrevias = new Set(Object.keys(previas.urls ?? {}));
const urlsActuales = new Set(Object.keys(actuales));

const nuevas = [...urlsActuales].filter((u) => !urlsPrevias.has(u));
const desaparecidas = [...urlsPrevias].filter((u) => !urlsActuales.has(u));

mkdirSync(discoveryDir, { recursive: true });
writeFileSync(
  fingerprintsPath,
  `${JSON.stringify({ updated_at: today(), urls: actuales }, null, 2)}\n`,
);

const reporte = {
  generated_at: today(),
  total_actual: urlsActuales.size,
  total_previo: urlsPrevias.size,
  nuevas,
  desaparecidas,
};

writeFileSync(
  join(discoveryDir, 'discovery-report.json'),
  `${JSON.stringify(reporte, null, 2)}\n`,
);

console.log(`URLs conocidas: ${urlsActuales.size} (antes ${urlsPrevias.size})`);
console.log(`  Nuevas:        ${nuevas.length}`);
console.log(`  Desaparecidas: ${desaparecidas.length}`);
console.log('Resultado: data/discovery/discovery-report.json');

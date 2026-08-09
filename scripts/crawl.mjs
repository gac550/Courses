#!/usr/bin/env node
/**
 * Recorre las fuentes autorizadas con profundidad controlada (§6, §8.1).
 *
 * Escribe los candidatos en data/discovery/crawl-<fuente>.json. No toca
 * data/courses.json: la incorporación al catálogo la decide verify.mjs.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { createFetcher } from './lib/fetcher.mjs';
import { extractLinks } from './lib/extract-lib.mjs';
import { canonicalUrl, isAllowedHost } from './lib/urls.mjs';
import { today } from './lib/dates.mjs';

const root = process.env.COURSES_ROOT ?? process.cwd();
const configDir = join(root, 'config');
const discoveryDir = join(root, 'data', 'discovery');

const config = JSON.parse(readFileSync(join(configDir, 'crawler.json'), 'utf8'));
const sources = JSON.parse(readFileSync(join(configDir, 'sources.json'), 'utf8'));

const fetcher = createFetcher(config);

/** Descarta rutas irrelevantes según la configuración. */
function isRelevant(url) {
  const lower = url.toLowerCase();

  if (config.skipExtensions?.some((ext) => lower.endsWith(ext))) return false;
  if (config.skipUrlPatterns?.some((pattern) => lower.includes(pattern.toLowerCase()))) return false;

  return true;
}

/** Indicios de que una URL puede ser una página de curso. */
function looksLikeCourse(url) {
  return /\/(course|courses|curso|cursos|learn|class|classes|program|training|mooc)s?\//i.test(url)
    || /course_templates|course-v1/i.test(url);
}

async function crawlSource(source) {
  const seeds = source.seed_urls ?? [];

  if (seeds.length === 0) {
    console.log(`  ${source.id}: sin seed_urls configuradas, se omite.`);
    return { source: source.id, visited: 0, candidates: [], notes: 'sin seed_urls' };
  }

  console.log(`  ${source.id}: iniciando…`);

  const maxDepth = source.max_depth ?? config.maxDepth ?? 3;
  const maxPages = config.maxPagesPerSource ?? 300;

  const visited = new Set();
  const candidates = new Map();
  const blocked = [];
  const queue = seeds.map((url) => ({ url, depth: 0 }));
  let ultimoReporte = -1;

  while (queue.length > 0 && visited.size < maxPages) {
    const { url, depth } = queue.shift();
    const canonical = canonicalUrl(url) ?? url;

    if (visited.has(canonical)) continue;
    if (!isAllowedHost(url, source.domains)) continue;
    visited.add(canonical);

    const result = await fetcher.get(url);

    if (!result.ok) {
      if (result.manualReview) {
        blocked.push({ url, reason: result.reason, status: result.status });
      }
      continue;
    }

    if (looksLikeCourse(url)) {
      candidates.set(canonical, {
        url: canonical,
        source: source.id,
        institution: source.institution,
        adapter: source.adapter ?? 'generic',
        depth,
        discovered_at: today(),
      });
    }

    // Progreso cada pocas páginas: sin esto la ejecución parece detenida.
    if (visited.size % 5 === 0 || candidates.size !== ultimoReporte) {
      console.log(
        `  ${source.id}: ${visited.size}/${maxPages} páginas · ${candidates.size} candidatos`,
      );
      ultimoReporte = candidates.size;
    }

    if (depth >= maxDepth) continue;

    for (const link of extractLinks(result.body, url)) {
      const linkCanonical = canonicalUrl(link) ?? link;
      if (visited.has(linkCanonical)) continue;
      if (!isAllowedHost(link, source.domains)) continue;
      if (!isRelevant(link)) continue;

      queue.push({ url: link, depth: depth + 1 });
    }
  }

  console.log(
    `  ${source.id}: ${visited.size} páginas visitadas, ` +
    `${candidates.size} candidatos, ${blocked.length} bloqueadas.`,
  );

  return {
    source: source.id,
    visited: visited.size,
    candidates: [...candidates.values()],
    blocked,
  };
}

const enabled = sources.filter((s) => s.enabled !== false);
console.log(`Recorriendo ${enabled.length} fuentes habilitadas en paralelo…`);

mkdirSync(discoveryDir, { recursive: true });

const inicio = Date.now();

/*
 * Las fuentes se recorren en paralelo: apuntan a hosts distintos, y el fetcher
 * mantiene el límite por host y la pausa mínima. En serie, el tiempo era la
 * suma de todas las fuentes; en paralelo es el de la más lenta.
 */
const resultados = await Promise.all(enabled.map((source) => crawlSource(source)));

const segundos = Math.round((Date.now() - inicio) / 1000);

const salida = {
  generated_at: today(),
  sources: resultados,
  total_candidates: resultados.reduce((n, r) => n + r.candidates.length, 0),
  total_blocked: resultados.reduce((n, r) => n + (r.blocked?.length ?? 0), 0),
};

writeFileSync(join(discoveryDir, 'crawl.json'), `${JSON.stringify(salida, null, 2)}\n`);

console.log(
  `\nTotal: ${salida.total_candidates} candidatos, ${salida.total_blocked} páginas bloqueadas ` +
  `(${segundos} s).`,
);
console.log('Resultado: data/discovery/crawl.json');

if (salida.total_candidates === 0) {
  console.log('\nNota: sin candidatos. Las fuentes requieren seed_urls verificadas en config/sources.json.');
}

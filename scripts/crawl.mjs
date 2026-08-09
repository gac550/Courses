#!/usr/bin/env node
/**
 * Recorre las fuentes autorizadas con profundidad controlada (§6, §8.1).
 *
 * Escribe los candidatos en data/discovery/crawl-<fuente>.json. No toca
 * data/courses.json: la incorporación al catálogo la decide verify.mjs.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import { createFetcher } from './lib/fetcher.mjs';
import { extractLinks } from './lib/extract-lib.mjs';
import { canonicalUrl, isAllowedHost } from './lib/urls.mjs';
import { today } from './lib/dates.mjs';
import {
  loadMemory, saveMemory, recordSeen, recordMissing, shouldRevisit, summarize,
} from './lib/memory.mjs';

const root = process.env.COURSES_ROOT ?? process.cwd();
const configDir = join(root, 'config');
const discoveryDir = join(root, 'data', 'discovery');

const config = JSON.parse(readFileSync(join(configDir, 'crawler.json'), 'utf8'));
const sources = JSON.parse(readFileSync(join(configDir, 'sources.json'), 'utf8'));

const fetcher = createFetcher(config);

// Memoria persistente: lo ya visto no se reprocesa en cada pasada.
const memoryPath = join(discoveryDir, 'memory.json');
const memory = loadMemory(memoryPath);
const incremental = process.env.COURSES_FULL_CRAWL !== '1';

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
  let omitidas = 0;

  // Cota de tiempo por fuente: una cola grande no puede volver interminable la
  // pasada. Lo que queda pendiente se retoma en la siguiente, gracias a la
  // memoria incremental.
  const limiteMs = (config.maxSecondsPerSource ?? 300) * 1000;
  const inicioFuente = Date.now();

  while (queue.length > 0 && visited.size < maxPages) {
    if (Date.now() - inicioFuente > limiteMs) {
      console.log(`  ${source.id}: límite de tiempo alcanzado, continúa en la próxima pasada.`);
      break;
    }

    const { url, depth } = queue.shift();
    const canonical = canonicalUrl(url) ?? url;

    if (visited.has(canonical)) continue;
    if (!isAllowedHost(url, source.domains)) continue;

    // Modo incremental: lo conocido y estable se pospone, liberando el
    // presupuesto de páginas para descubrir cosas nuevas.
    //
    // Las semillas (profundidad 0) se visitan SIEMPRE: son la puerta de entrada
    // a cada fuente y sin ellas no hay enlaces nuevos que seguir.
    if (incremental && depth > 0 && !shouldRevisit(memory, canonical)) {
      omitidas += 1;
      const conocido = memory.urls[canonical];

      // Un curso ya conocido sigue contando como candidato de esta pasada.
      if (conocido?.is_course) {
        candidates.set(canonical, {
          url: canonical,
          source: source.id,
          institution: source.institution,
          adapter: source.adapter ?? 'generic',
          depth,
          discovered_at: conocido.first_seen ?? today(),
          from_memory: true,
        });
      }
      continue;
    }

    visited.add(canonical);

    const result = await fetcher.get(url);

    if (!result.ok) {
      recordMissing(memory, canonical, { reason: result.reason });
      if (result.manualReview) {
        blocked.push({ url, reason: result.reason, status: result.status });
      }
      continue;
    }

    recordSeen(memory, canonical, {
      source: source.id,
      isCourse: looksLikeCourse(url),
      contentHash: createHash('sha256').update(result.body ?? '').digest('hex').slice(0, 16),
    });

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

      // Persistencia periódica: una interrupción no pierde lo aprendido.
      saveMemory(memoryPath, memory);
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
    `${candidates.size} candidatos, ${omitidas} desde memoria, ${blocked.length} bloqueadas.`,
  );

  return {
    source: source.id,
    visited: visited.size,
    skipped_from_memory: omitidas,
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

// La memoria persiste entre ejecuciones: es lo que hace incremental al crawler.
saveMemory(memoryPath, memory);
const resumen = summarize(memory);
console.log(
  `\nMemoria: ${resumen.total} URLs conocidas · ${resumen.activos} activas · ` +
  `${resumen.inestables} inestables · ${resumen.retirados} retiradas.`,
);

console.log(
  `\nTotal: ${salida.total_candidates} candidatos, ${salida.total_blocked} páginas bloqueadas ` +
  `(${segundos} s).`,
);
console.log('Resultado: data/discovery/crawl.json');

if (salida.total_candidates === 0) {
  console.log('\nNota: sin candidatos. Las fuentes requieren seed_urls verificadas en config/sources.json.');
}

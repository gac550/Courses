#!/usr/bin/env node
/**
 * Verifica los enlaces del catálogo: HEAD primero, GET como respaldo.
 *
 * Nunca modifica data/courses.json: solo escribe reports/links-report.md.
 * Respeta concurrencia, timeout y user-agent identificable de config/crawler.json.
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.env.COURSES_ROOT ?? process.cwd();
const jsonPath = join(root, 'data', 'courses.json');
const configPath = join(root, 'config', 'crawler.json');
const reportsDir = join(root, 'reports');

if (!existsSync(jsonPath)) {
  console.error(`No existe la fuente de verdad: ${jsonPath}`);
  process.exit(1);
}

const config = existsSync(configPath)
  ? JSON.parse(readFileSync(configPath, 'utf8'))
  : {};

const USER_AGENT = config.userAgent ?? 'CoursesCatalogBot/0.1';
const TIMEOUT_MS = config.timeoutMs ?? 15000;
const CONCURRENCY = config.concurrency?.global ?? 5;

const courses = JSON.parse(readFileSync(jsonPath, 'utf8'));

const URL_FIELDS = ['url_official', 'url_credential_info', 'url_syllabus', 'source_of_truth'];

const targets = [];
for (const course of courses) {
  for (const field of URL_FIELDS) {
    const url = course[field];
    if (typeof url === 'string' && url) targets.push({ id: course.id, field, url });
  }
}

if (targets.length === 0) {
  console.log('No hay enlaces que verificar.');
  process.exit(0);
}

async function request(url, method) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method,
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,*/*' },
    });
    return { status: response.status, finalUrl: response.url };
  } finally {
    clearTimeout(timer);
  }
}

async function checkOne(target) {
  try {
    let result = await request(target.url, 'HEAD');

    // Algunos servidores rechazan HEAD: se reintenta con GET.
    if (result.status === 405 || result.status === 403 || result.status >= 500) {
      result = await request(target.url, 'GET');
    }

    const redirected = result.finalUrl && result.finalUrl !== target.url;
    return {
      ...target,
      status: result.status,
      ok: result.status >= 200 && result.status < 400,
      finalUrl: redirected ? result.finalUrl : null,
      error: null,
    };
  } catch (error) {
    const reason = error.name === 'AbortError' ? `timeout tras ${TIMEOUT_MS} ms` : error.message;
    return { ...target, status: null, ok: false, finalUrl: null, error: reason };
  }
}

/** Ejecuta con concurrencia acotada. */
async function runPool(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]);
    }
  });

  await Promise.all(runners);
  return results;
}

console.log(`Verificando ${targets.length} enlaces (concurrencia ${CONCURRENCY})…`);

const results = await runPool(targets, CONCURRENCY, checkOne);

const broken = results.filter((r) => !r.ok);
const redirected = results.filter((r) => r.ok && r.finalUrl);

const stamp = new Date().toISOString().slice(0, 10);
const lines = [
  '# Reporte de enlaces',
  '',
  `Fecha: ${stamp}`,
  '',
  `- Enlaces verificados: ${results.length}`,
  `- Con problemas: ${broken.length}`,
  `- Con redirección: ${redirected.length}`,
  '',
];

if (broken.length > 0) {
  lines.push('## Enlaces con problemas', '');
  lines.push('| ID | Curso | Campo | Estado | URL |');
  lines.push('|---|---|---|---|---|');
  for (const item of broken) {
    lines.push(`| ${item.id} | ${item.id} | ${item.field} | ${item.status ?? item.error} | ${item.url} |`);
  }
  lines.push('');
}

if (redirected.length > 0) {
  lines.push('## Redirecciones detectadas', '');
  lines.push('| ID | Campo | URL original | Destino |');
  lines.push('|---|---|---|---|');
  for (const item of redirected) {
    lines.push(`| ${item.id} | ${item.field} | ${item.url} | ${item.finalUrl} |`);
  }
  lines.push('');
}

if (broken.length === 0 && redirected.length === 0) {
  lines.push('Todos los enlaces respondieron correctamente y sin redirecciones.', '');
}

mkdirSync(reportsDir, { recursive: true });
writeFileSync(join(reportsDir, 'links-report.md'), lines.join('\n'), 'utf8');

console.log(`Listo: ${results.length} verificados, ${broken.length} con problemas.`);
console.log(`Reporte: reports/links-report.md`);

// No falla la ejecución: los enlaces rotos se reportan para revisión humana.

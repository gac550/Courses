#!/usr/bin/env node
/**
 * Contrasta candidatos contra evidencia oficial (§15).
 *
 * Regla dura: ningún candidato entra como VERIFICADO automáticamente. El
 * crawler no puede confirmar por sí solo título, institución, modalidad de
 * acceso y credencial con el rigor que exige el repositorio, de modo que los
 * candidatos nuevos ingresan como PENDIENTE y quedan a la espera de revisión.
 *
 * Escribe data/discovery/verified.json con la clasificación resultante.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { classifyCandidates } from './lib/dedupe.mjs';
import { isIndexPage } from './lib/extract-lib.mjs';
import { makeId } from './lib/normalize.mjs';
import { isValidHttpUrl } from './lib/urls.mjs';
import { today } from './lib/dates.mjs';

const root = process.env.COURSES_ROOT ?? process.cwd();
const discoveryDir = join(root, 'data', 'discovery');
const extractedPath = join(discoveryDir, 'extracted.json');
const coursesPath = join(root, 'data', 'courses.json');

if (!existsSync(extractedPath)) {
  console.log('No hay candidatos extraídos. Ejecutar primero: npm run extract');
  process.exit(0);
}

const extracted = JSON.parse(readFileSync(extractedPath, 'utf8'));
const catalog = JSON.parse(readFileSync(coursesPath, 'utf8'));

const candidatos = extracted.courses ?? [];

if (candidatos.length === 0) {
  console.log('Sin candidatos que verificar.');
  process.exit(0);
}

/** Campos mínimos para que un candidato sea siquiera considerable. */
function tieneMinimos(candidate) {
  return Boolean(
    candidate.title
    && candidate.institution
    && isValidHttpUrl(candidate.url_official),
  );
}

const { nuevos, duplicados, ambiguos } = classifyCandidates(candidatos, catalog);

const aceptables = [];
const incompletos = [];

const indices = [];

for (const candidate of nuevos) {
  if (!tieneMinimos(candidate)) {
    incompletos.push({ url: candidate.url_official, motivo: 'faltan campos obligatorios' });
    continue;
  }

  // Un listado o buscador no es un curso: no debe entrar al catálogo.
  if (isIndexPage(candidate.url_official, candidate.title)) {
    indices.push({ url: candidate.url_official, title: candidate.title });
    continue;
  }

  const id = candidate.id ?? makeId(candidate);
  if (!id) {
    incompletos.push({ url: candidate.url_official, motivo: 'no se pudo generar un id estable' });
    continue;
  }

  // El crawler no confirma credencial ni acceso: se dejan en null y el registro
  // queda PENDIENTE hasta que una persona lo verifique contra fuente oficial.
  aceptables.push({
    id,
    title: candidate.title,
    institution: candidate.institution,
    institution_country: null,
    provider_type: 'institucion',
    platform: null,
    course_code: candidate.course_code ?? null,
    domain: null,
    topics: null,
    level: candidate.level ?? null,
    language: candidate.language ?? null,
    subtitles: null,
    duration_weeks: null,
    hours_per_week: null,
    pace: null,
    cost_access: null,
    credential_type: null,
    credential_free: null,
    credential_price_usd: null,
    credential_issuer: null,
    credential_verifiable: null,
    url_official: candidate.url_official,
    url_credential_info: null,
    url_syllabus: null,
    prerequisites: null,
    relevance_ppp_infra: null,
    verification_status: 'PENDIENTE',
    last_verified: null,
    source_of_truth: candidate.url_official,
    notes: 'Candidato descubierto automaticamente. Requiere verificacion humana contra '
      + 'fuente oficial de titulo, institucion, modalidad de acceso y credencial antes de '
      + 'pasar a VERIFICADO. Indicios detectados en la pagina: '
      + `gratuidad ${candidate.evidence?.mentionsFree ? 'mencionada' : 'no mencionada'}, `
      + `certificado ${candidate.evidence?.mentionsCertificate ? 'mencionado' : 'no mencionado'}. `
      + 'Los indicios NO son evidencia suficiente por si solos.',
    status: 'desconocido',
    enrollment_open: null,
    start_date: null,
    end_date: null,
    access_mode: null,
    discovered_at: candidate.discovered_at ?? today(),
    updated_at: today(),
    content_hash: null,
  });
}

mkdirSync(discoveryDir, { recursive: true });
writeFileSync(
  join(discoveryDir, 'verified.json'),
  `${JSON.stringify({
    generated_at: today(),
    accepted: aceptables,
    duplicates: duplicados.map((d) => ({ url: d.candidate.url_official, existing: d.existing.id, by: d.by })),
    ambiguous: ambiguos.map((a) => ({
      url: a.candidate.url_official,
      title: a.candidate.title,
      existing: a.existing.id,
      score: Number(a.score.toFixed(3)),
      note: 'No se fusiona automaticamente: requiere revision manual.',
    })),
    incomplete: incompletos,
    index_pages: indices,
  }, null, 2)}\n`,
);

console.log(`Candidatos: ${candidatos.length}`);
console.log(`  Nuevos aceptables (como PENDIENTE): ${aceptables.length}`);
console.log(`  Duplicados de cursos ya presentes:  ${duplicados.length}`);
console.log(`  Ambiguos para revisión manual:      ${ambiguos.length}`);
console.log(`  Incompletos descartados:            ${incompletos.length}`);
console.log(`  Páginas de índice descartadas:      ${indices.length}`);
console.log('Resultado: data/discovery/verified.json');

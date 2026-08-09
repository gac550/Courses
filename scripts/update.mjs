#!/usr/bin/env node
/**
 * Pipeline incremental completo (§21).
 *
 *   crawl → extract → verify → discover → diff → validate
 *
 * Regla dura: los candidatos nuevos NUNCA se incorporan como VERIFICADO. Se
 * añaden al catálogo como PENDIENTE y quedan a la espera de revisión humana
 * contra fuente oficial.
 *
 * Cada paso se ejecuta en su propio proceso, de modo que un fallo aislado no
 * derriba el resto del pipeline.
 */

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sortCourses } from './lib/sort.mjs';
import { today } from './lib/dates.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = process.env.COURSES_ROOT ?? process.cwd();

const PASOS = ['crawl', 'extract', 'verify', 'discover'];

function ejecutar(nombre) {
  return new Promise((resolve) => {
    const script = join(__dirname, `${nombre}.mjs`);

    if (!existsSync(script)) {
      console.log(`[${nombre}] no existe: se omite.`);
      resolve({ nombre, code: null, omitido: true });
      return;
    }

    console.log(`\n── ${nombre} ──`);

    // El binario de Electron corre como Node puro cuando se invoca desde la app.
    const child = spawn(process.execPath, [script], {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', COURSES_ROOT: root },
    });

    child.on('error', (error) => {
      console.error(`[${nombre}] error: ${error.message}`);
      resolve({ nombre, code: -1, omitido: false });
    });

    child.on('close', (code) => resolve({ nombre, code, omitido: false }));
  });
}

/** Incorpora al catálogo los candidatos aceptados, siempre como PENDIENTE. */
function incorporarCandidatos() {
  const verifiedPath = join(root, 'data', 'discovery', 'verified.json');
  if (!existsSync(verifiedPath)) return 0;

  const verified = JSON.parse(readFileSync(verifiedPath, 'utf8'));
  const aceptados = verified.accepted ?? [];
  if (aceptados.length === 0) return 0;

  const coursesPath = join(root, 'data', 'courses.json');
  const catalogo = JSON.parse(readFileSync(coursesPath, 'utf8'));
  const existentes = new Set(catalogo.map((c) => c.id));

  const nuevos = aceptados.filter((c) => !existentes.has(c.id));
  if (nuevos.length === 0) return 0;

  // Ningún candidato automático puede entrar como VERIFICADO.
  for (const curso of nuevos) curso.verification_status = 'PENDIENTE';

  const actualizado = sortCourses(catalogo.concat(nuevos));
  writeFileSync(coursesPath, `${JSON.stringify(actualizado, null, 2)}\n`);

  return nuevos.length;
}

console.log(`Pipeline incremental · ${today()}`);

const resultados = [];
for (const paso of PASOS) {
  const resultado = await ejecutar(paso);
  resultados.push(resultado);

  if (!resultado.omitido && resultado.code !== 0) {
    console.error(`\nEl paso ${paso} falló (código ${resultado.code}). Pipeline detenido.`);
    process.exit(1);
  }
}

console.log('\n── incorporación ──');
const incorporados = incorporarCandidatos();

if (incorporados > 0) {
  console.log(`${incorporados} cursos nuevos incorporados como PENDIENTE.`);
  console.log('Requieren verificacion humana contra fuente oficial antes de pasar a VERIFICADO.');
} else {
  console.log('Sin cursos nuevos que incorporar.');
}

const diff = await ejecutar('diff');
if (!diff.omitido && diff.code !== 0) {
  console.error('El reporte de cambios falló, pero el catálogo quedó actualizado.');
}

console.log('\nPipeline completado.');

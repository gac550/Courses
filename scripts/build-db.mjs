#!/usr/bin/env node
/**
 * Reconstruye data/courses.db desde data/courses.json.
 *
 * La base es un artefacto derivado: este script puede ejecutarse en cualquier
 * momento sin pérdida de información. Es idempotente.
 */

import { join } from 'node:path';
import { existsSync } from 'node:fs';

import { open, rebuildFrom, countCourses } from '../src/main/db.mjs';

const root = process.env.COURSES_ROOT ?? process.cwd();
const jsonPath = join(root, 'data', 'courses.json');
const dbPath = join(root, 'data', 'courses.db');

if (!existsSync(jsonPath)) {
  console.error(`No existe la fuente de verdad: ${jsonPath}`);
  process.exit(1);
}

const db = open(dbPath);
const inserted = rebuildFrom(db, jsonPath);

console.log(`Base reconstruida: ${inserted} cursos indexados (${countCourses(db)} en total).`);
db.close();

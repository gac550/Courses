import test from 'node:test';
import assert from 'node:assert/strict';

import { parseRobots, isAllowedByRules, clearRobotsCache } from '../scripts/lib/robots.mjs';
import { createFetcher } from '../scripts/lib/fetcher.mjs';
import {
  extractJsonLd, findCourseEntity, extractMeta, extractTitle,
  extractLinks, detectLevel, extractCourse, isIndexPage,
} from '../scripts/lib/extract-lib.mjs';
import { similarity, findDuplicate, classifyCandidates } from '../scripts/lib/dedupe.mjs';

/* --------------------------------------------------------------- robots.txt */

test('se respeta Disallow del user-agent aplicable', () => {
  const rules = parseRobots('User-agent: *\nDisallow: /admin\n', 'CoursesCatalogBot/0.1').rules;
  assert.equal(isAllowedByRules(rules, '/admin/panel'), false);
  assert.equal(isAllowedByRules(rules, '/courses/ai'), true);
});

test('una regla específica del bot tiene prioridad sobre el comodín', () => {
  const robots = parseRobots(
    'User-agent: *\nDisallow: /\n\nUser-agent: CoursesCatalogBot\nDisallow: /privado\n',
    'CoursesCatalogBot/0.1',
  );
  assert.equal(isAllowedByRules(robots.rules, '/courses'), true);
  assert.equal(isAllowedByRules(robots.rules, '/privado/x'), false);
});

test('gana la coincidencia más larga y, a igual longitud, Allow', () => {
  const rules = parseRobots(
    'User-agent: *\nDisallow: /courses\nAllow: /courses/publicos\n', '*',
  ).rules;
  assert.equal(isAllowedByRules(rules, '/courses/privado'), false);
  assert.equal(isAllowedByRules(rules, '/courses/publicos/ai'), true);
});

test('se interpretan comodines y anclaje final', () => {
  const rules = parseRobots('User-agent: *\nDisallow: /*.pdf$\n', '*').rules;
  assert.equal(isAllowedByRules(rules, '/docs/guia.pdf'), false);
  assert.equal(isAllowedByRules(rules, '/docs/guia.pdf.html'), true);
});

test('se lee crawl-delay en milisegundos', () => {
  assert.equal(parseRobots('User-agent: *\nCrawl-delay: 2\n', '*').crawlDelay, 2000);
});

test('un robots.txt vacío no prohíbe nada', () => {
  assert.equal(isAllowedByRules(parseRobots('', '*').rules, '/cualquier/ruta'), true);
});

/* ------------------------------------------------------------------ fetcher */

// La caché de robots.txt vive por origen y persiste entre tests: se limpia
// antes de cada caso para que cada uno ejerza la rama que le corresponde.
const fakeFetch = (respuestas) => {
  clearRobotsCache();
  const llamadas = [];
  const impl = async (url) => {
    llamadas.push(url);
    const key = Object.keys(respuestas).find((k) => url.includes(k));
    const r = respuestas[key] ?? { status: 404, body: '' };
    if (r.throws) throw Object.assign(new Error(r.throws), { name: r.throws });
    return {
      status: r.status,
      url,
      headers: { get: (h) => (h === 'content-type' ? 'text/html' : r.headers?.[h] ?? null) },
      text: async () => r.body ?? '',
    };
  };
  impl.llamadas = llamadas;
  return impl;
};

test('no se visita una ruta prohibida por robots.txt', async () => {
  const impl = fakeFetch({
    'robots.txt': { status: 200, body: 'User-agent: *\nDisallow: /privado\n' },
  });
  const fetcher = createFetcher({ delayMsPerHost: 0 }, { fetchImpl: impl });
  const result = await fetcher.get('https://ejemplo.test/privado/x');

  assert.equal(result.ok, false);
  assert.match(result.reason, /robots\.txt/);
  assert.ok(!impl.llamadas.includes('https://ejemplo.test/privado/x'));
});

test('un 403 se reporta para revisión manual, sin evadirlo', async () => {
  const impl = fakeFetch({
    'robots.txt': { status: 404 },
    '/curso': { status: 403 },
  });
  const fetcher = createFetcher({ delayMsPerHost: 0, retries: { max: 0 } }, { fetchImpl: impl });
  const result = await fetcher.get('https://ejemplo.test/curso');

  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.manualReview, true);
});

test('si robots.txt es inaccesible no se asume permiso', async () => {
  const impl = fakeFetch({ 'robots.txt': { throws: 'AbortError' } });
  const fetcher = createFetcher({ delayMsPerHost: 0 }, { fetchImpl: impl });
  const result = await fetcher.get('https://ejemplo.test/curso');

  assert.equal(result.ok, false);
  assert.equal(result.manualReview, true);
});

test('una descarga permitida devuelve el cuerpo', async () => {
  const impl = fakeFetch({
    'robots.txt': { status: 200, body: 'User-agent: *\nDisallow: /admin\n' },
    '/curso': { status: 200, body: '<html><title>Curso</title></html>' },
  });
  const fetcher = createFetcher({ delayMsPerHost: 0 }, { fetchImpl: impl });
  const result = await fetcher.get('https://ejemplo.test/curso');

  assert.equal(result.ok, true);
  assert.match(result.body, /Curso/);
});

test('un 500 se reintenta y luego se reporta', async () => {
  const impl = fakeFetch({ 'robots.txt': { status: 404 }, '/x': { status: 500 } });
  const fetcher = createFetcher(
    { delayMsPerHost: 0, retries: { max: 2, backoffMs: 1, backoffFactor: 1 } },
    { fetchImpl: impl },
  );
  const result = await fetcher.get('https://ejemplo.test/x');

  assert.equal(result.ok, false);
  assert.equal(result.status, 500);
  assert.equal(impl.llamadas.filter((u) => u.includes('/x')).length, 3, 'intento inicial + 2 reintentos');
});

/* ---------------------------------------------------------------- extractor */

const HTML_CURSO = `<html><head>
<title>Curso de prueba | Plataforma</title>
<meta property="og:title" content="Machine Learning Aplicado" />
<meta property="og:description" content="Curso sobre modelos predictivos" />
<meta property="og:url" content="https://ejemplo.test/curso/ml" />
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Course","name":"Machine Learning Aplicado",
 "courseCode":"ML-101","inLanguage":"es",
 "provider":{"@type":"Organization","name":"Universidad de Prueba"}}
</script></head><body>
<p>Este curso es free e incluye certificate al finalizar. Nivel intermediate.</p>
<a href="/curso/otro">Otro</a><a href="https://externo.test/x">Externo</a>
</body></html>`;

test('se extrae la entidad Course desde JSON-LD', () => {
  const entity = findCourseEntity(extractJsonLd(HTML_CURSO));
  assert.equal(entity.name, 'Machine Learning Aplicado');
  assert.equal(entity.courseCode, 'ML-101');
});

test('un JSON-LD malformado no rompe la extracción', () => {
  const html = '<script type="application/ld+json">{roto</script>';
  assert.deepEqual(extractJsonLd(html), []);
});

test('se leen los metadatos OpenGraph', () => {
  assert.equal(extractMeta(HTML_CURSO, 'og:title'), 'Machine Learning Aplicado');
  assert.equal(extractMeta(HTML_CURSO, 'og:inexistente'), null);
});

test('el título descarta el sufijo del sitio', () => {
  assert.equal(extractTitle(HTML_CURSO), 'Curso de prueba');
  assert.equal(
    extractTitle('<title>Nonlinear Dynamics I: Chaos | Mathematics | MIT OpenCourseWare</title>'),
    'Nonlinear Dynamics I: Chaos',
  );
});

test('un título sin separador se conserva íntegro', () => {
  assert.equal(extractTitle('<title>Introduction to Algorithms</title>'), 'Introduction to Algorithms');
});

test('las páginas de índice se reconocen y no son cursos', () => {
  assert.equal(isIndexPage('https://ocw.mit.edu/search', 'Search | MIT OpenCourseWare'), true);
  assert.equal(isIndexPage('https://cs50.harvard.edu/x/courses', 'Courses - CS50x 2026'), true);
  assert.equal(isIndexPage('https://open.hpi.de/courses', 'Kurse'), true);
});

test('una ficha de curso no se confunde con un índice', () => {
  assert.equal(isIndexPage('https://ocw.mit.edu/courses/6-006-introduction-to-algorithms-spring-2020/', 'Introduction to Algorithms'), false);
  assert.equal(isIndexPage('https://open.hpi.de/courses/python2025', 'Python for Beginners'), false);
});

test('los enlaces se resuelven a absolutos y se deduplican', () => {
  const links = extractLinks(HTML_CURSO, 'https://ejemplo.test/curso/ml');
  assert.ok(links.includes('https://ejemplo.test/curso/otro'));
  assert.ok(links.includes('https://externo.test/x'));
  assert.equal(new Set(links).size, links.length);
});

test('el nivel se detecta en español e inglés', () => {
  assert.equal(detectLevel('Introductory level'), 'introductorio');
  assert.equal(detectLevel('Nivel avanzado'), 'avanzado');
  assert.equal(detectLevel('sin indicios'), null);
});

test('extractCourse prioriza JSON-LD sobre OpenGraph', () => {
  const course = extractCourse(HTML_CURSO, 'https://ejemplo.test/curso/ml');
  assert.equal(course.title, 'Machine Learning Aplicado');
  assert.equal(course.institution, 'Universidad de Prueba');
  assert.equal(course.course_code, 'ML-101');
  assert.deepEqual(course.language, ['es']);
});

test('los indicios quedan como evidencia, no como datos confirmados', () => {
  const course = extractCourse(HTML_CURSO, 'https://ejemplo.test/curso/ml');
  assert.equal(course.evidence.mentionsFree, true);
  assert.equal(course.evidence.mentionsCertificate, true);
  assert.equal(course.credential_type, undefined, 'la credencial no se infiere aquí');
});

test('una página sin datos estructurados no inventa campos', () => {
  const course = extractCourse('<html><body>nada</body></html>', 'https://x.test/a');
  assert.equal(course.title, null);
  assert.equal(course.institution, null);
  assert.equal(course.course_code, null);
});

/* -------------------------------------------------------------- deduplicación */

const curso = (o) => ({
  id: 'x', title: 'Machine Learning', institution: 'Stanford University',
  url_official: 'https://ejemplo.test/ml', ...o,
});

test('la similitud detecta títulos equivalentes', () => {
  assert.equal(similarity('Machine Learning', 'machine learning'), 1);
  assert.ok(similarity('Machine Learning', 'Machine Learnings') > 0.9);
  assert.ok(similarity('Machine Learning', 'Historia del Arte') < 0.5);
});

test('una URL repetida se detecta como duplicado exacto', () => {
  const result = findDuplicate(curso({ title: 'Otro título' }), [curso()]);
  assert.equal(result.match, 'exact');
  assert.equal(result.by, 'url');
});

test('institución más código identifican el mismo curso', () => {
  const catalogo = [curso({ course_code: 'CS229', url_official: 'https://a.test/1' })];
  const result = findDuplicate(
    curso({ course_code: 'CS229', url_official: 'https://b.test/2', title: 'Distinto' }),
    catalogo,
  );
  assert.equal(result.match, 'exact');
  assert.equal(result.by, 'institution+code');
});

test('un parecido alto NO se fusiona: queda como ambiguo', () => {
  const catalogo = [curso({ title: 'Machine Learning Specialization' })];
  const result = findDuplicate(
    curso({ title: 'Machine Learning Specialisation', url_official: 'https://otro.test/x' }),
    catalogo,
  );
  assert.equal(result.match, 'ambiguous');
  assert.ok(result.score >= 0.88);
});

test('un curso distinto se reconoce como nuevo', () => {
  const result = findDuplicate(
    curso({ title: 'Historia del Arte', url_official: 'https://otro.test/arte' }),
    [curso()],
  );
  assert.equal(result.match, 'none');
});

test('cursos con igual título en instituciones distintas no son duplicados', () => {
  const result = findDuplicate(
    curso({ institution: 'MIT', url_official: 'https://mit.test/ml' }),
    [curso({ institution: 'Stanford University' })],
  );
  assert.equal(result.match, 'none');
});

test('classifyCandidates separa nuevos, duplicados y ambiguos', () => {
  const catalogo = [curso({ id: 'existente' })];
  const { nuevos, duplicados, ambiguos } = classifyCandidates([
    curso({ title: 'Nuevo Curso', url_official: 'https://nuevo.test/1' }),
    curso(),
    curso({ title: 'Machine Learnin', url_official: 'https://amb.test/1' }),
  ], catalogo);

  assert.equal(nuevos.length, 1);
  assert.equal(duplicados.length, 1);
  assert.equal(ambiguos.length, 1);
});

test('un duplicado dentro de la misma tanda no se cuenta dos veces', () => {
  const { nuevos } = classifyCandidates([
    curso({ url_official: 'https://nuevo.test/1' }),
    curso({ url_official: 'https://nuevo.test/1' }),
  ], []);
  assert.equal(nuevos.length, 1);
});

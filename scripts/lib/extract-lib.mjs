/**
 * Extracción de metadatos desde HTML.
 *
 * Orden de preferencia (§9): JSON-LD, Schema.org, OpenGraph, metadatos HTML y
 * estructura semántica. Los selectores frágiles son el último recurso.
 *
 * Todo lo que no pueda leerse queda como null: esta capa nunca infiere.
 */

const decodeEntities = (text) => String(text)
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#(\d+);/g, (_m, code) => String.fromCodePoint(Number(code)))
  .replace(/&#x([0-9a-f]+);/gi, (_m, code) => String.fromCodePoint(Number.parseInt(code, 16)))
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&');

const clean = (value) => {
  if (typeof value !== 'string') return null;
  const text = decodeEntities(value).replace(/\s+/g, ' ').trim();
  return text === '' ? null : text;
};

/** Extrae todos los bloques JSON-LD válidos. */
export function extractJsonLd(html) {
  const blocks = [];
  const pattern = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

  for (const match of String(html).matchAll(pattern)) {
    try {
      const parsed = JSON.parse(match[1].trim());
      const items = Array.isArray(parsed) ? parsed : [parsed];

      for (const item of items) {
        if (item && typeof item === 'object') {
          // @graph agrupa varias entidades en un solo bloque.
          if (Array.isArray(item['@graph'])) blocks.push(...item['@graph']);
          else blocks.push(item);
        }
      }
    } catch {
      // Un bloque malformado no invalida a los demás.
    }
  }

  return blocks;
}

/** Busca la entidad Course dentro de los bloques JSON-LD. */
export function findCourseEntity(blocks) {
  return blocks.find((block) => {
    const type = block?.['@type'];
    if (Array.isArray(type)) return type.includes('Course');
    return type === 'Course';
  }) ?? null;
}

export function extractMeta(html, property) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]*property=["']${escaped}["'][^>]*content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*property=["']${escaped}["']`, 'i'),
    new RegExp(`<meta[^>]*name=["']${escaped}["'][^>]*content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*name=["']${escaped}["']`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = String(html).match(pattern);
    if (match) return clean(match[1]);
  }
  return null;
}

/**
 * Título del documento sin el sufijo del sitio.
 *
 * Muchas páginas usan «Título | Sitio» o «Título - Sitio». Se conserva el
 * segmento más largo, que casi siempre es el título real del curso.
 */
export function extractTitle(html) {
  const match = String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const raw = match ? clean(match[1]) : null;
  if (!raw) return null;

  const parts = raw.split(/\s+[|·–—]\s+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return raw;

  return parts.reduce((a, b) => (b.length > a.length ? b : a));
}

/**
 * Detecta páginas de índice, búsqueda o listado que no son cursos.
 * Sin este filtro, entrarían al catálogo como si lo fueran.
 */
export function isIndexPage(url, title) {
  const path = (() => {
    try {
      return new URL(url).pathname.replace(/\/$/, '');
    } catch {
      return String(url);
    }
  })();

  // Rutas que son claramente listados, no fichas de curso.
  if (/\/(search|courses|cursos|catalog|catalogo|browse|explore|index|all)$/i.test(path)) return true;

  const name = clean(title);
  if (!name) return false;

  return /^(search|courses?|cursos?|catalog|catálogo|browse|explore|all courses|home)\b/i.test(name);
}

/** Texto visible, sin scripts ni estilos. Para búsqueda de indicios. */
export function extractText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Enlaces absolutos de la página, deduplicados. */
export function extractLinks(html, baseUrl) {
  const links = new Set();

  for (const match of String(html).matchAll(/<a[^>]*href=["']([^"'#]+)["']/gi)) {
    const href = decodeEntities(match[1]).trim();
    if (!href || href.startsWith('javascript:') || href.startsWith('mailto:')) continue;

    try {
      links.add(new URL(href, baseUrl).toString());
    } catch {
      // Enlace relativo inválido: se ignora.
    }
  }

  return [...links];
}

const LEVEL_MAP = [
  [/\b(introductory|beginner|introductorio|principiante|b[aá]sico)\b/i, 'introductorio'],
  [/\b(intermediate|intermedio)\b/i, 'intermedio'],
  [/\b(advanced|avanzado|graduate)\b/i, 'avanzado'],
];

export function detectLevel(text) {
  const source = clean(text);
  if (!source) return null;
  for (const [pattern, level] of LEVEL_MAP) {
    if (pattern.test(source)) return level;
  }
  return null;
}

/**
 * Extrae los metadatos de una página de curso.
 *
 * Devuelve un CANDIDATO, no un registro verificado: la decisión de aceptar cada
 * campo corresponde a verify.mjs contra la fuente oficial.
 */
export function extractCourse(html, url) {
  const blocks = extractJsonLd(html);
  const entity = findCourseEntity(blocks);
  const text = extractText(html);

  const provider = entity?.provider;
  const providerName = typeof provider === 'string'
    ? provider
    : clean(provider?.name);

  const title = clean(entity?.name)
    ?? extractMeta(html, 'og:title')
    ?? extractTitle(html);

  const description = clean(entity?.description)
    ?? extractMeta(html, 'og:description')
    ?? extractMeta(html, 'description');

  const language = clean(entity?.inLanguage) ?? extractMeta(html, 'og:locale');

  return {
    url_official: clean(extractMeta(html, 'og:url')) ?? url,
    title,
    description,
    institution: providerName,
    course_code: clean(entity?.courseCode),
    language: language ? [language.slice(0, 2).toLowerCase()] : null,
    level: detectLevel(entity?.educationalLevel) ?? detectLevel(text.slice(0, 4000)),
    // Indicios que verify.mjs debe confirmar contra fuente oficial.
    evidence: {
      hasJsonLd: blocks.length > 0,
      hasCourseEntity: Boolean(entity),
      mentionsFree: /\b(free|gratis|gratuito|sin costo)\b/i.test(text),
      mentionsCertificate: /\b(certificate|certificado|certification)\b/i.test(text),
      mentionsBadge: /\b(badge|insignia)\b/i.test(text),
      mentionsAudit: /\b(audit|auditar)\b/i.test(text),
    },
  };
}

/**
 * Lectura y evaluación de robots.txt.
 *
 * El crawler es respetuoso por diseño (§7): si un sitio prohíbe una ruta, no se
 * visita. Ante un robots.txt inaccesible o ilegible se aplica el criterio
 * conservador de permitir solo lo que no esté explícitamente prohibido, y todo
 * fallo queda registrado.
 */

const cache = new Map();

/** Convierte un patrón de robots.txt en expresión regular. */
function patternToRegExp(pattern) {
  let source = '';
  let anchorEnd = false;

  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === '*') {
      source += '.*';
    } else if (char === '$' && i === pattern.length - 1) {
      anchorEnd = true;
    } else {
      source += char.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    }
  }

  return new RegExp(`^${source}${anchorEnd ? '$' : ''}`);
}

/**
 * Interpreta un robots.txt y devuelve las reglas del user-agent indicado,
 * con las de `*` como respaldo.
 */
export function parseRobots(text, userAgent) {
  const groups = [];
  let current = null;

  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;

    const match = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!match) continue;

    const field = match[1].toLowerCase();
    const value = match[2].trim();

    if (field === 'user-agent') {
      // Varios user-agent seguidos comparten el mismo grupo de reglas.
      if (!current || current.rules.length > 0) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if (current && (field === 'allow' || field === 'disallow')) {
      if (value !== '' || field === 'disallow') {
        current.rules.push({ allow: field === 'allow', path: value });
      }
    } else if (current && field === 'crawl-delay') {
      const delay = Number.parseFloat(value);
      if (Number.isFinite(delay) && delay >= 0) current.crawlDelay = delay * 1000;
    }
  }

  const agent = String(userAgent).toLowerCase();
  const specific = groups.find((g) => g.agents.some((a) => a !== '*' && agent.includes(a)));
  const wildcard = groups.find((g) => g.agents.includes('*'));

  return specific ?? wildcard ?? { agents: ['*'], rules: [], crawlDelay: null };
}

/**
 * Evalúa una ruta contra las reglas.
 * Gana la coincidencia más larga; con igual longitud, prevalece Allow.
 */
export function isAllowedByRules(rules, pathname) {
  let best = null;

  for (const rule of rules) {
    if (rule.path === '') continue;
    if (!patternToRegExp(rule.path).test(pathname)) continue;

    const length = rule.path.length;
    if (!best || length > best.length || (length === best.length && rule.allow)) {
      best = { allow: rule.allow, length };
    }
  }

  return best ? best.allow : true;
}

/** Descarga y memoriza el robots.txt de un origen. */
export async function fetchRobots(origin, { userAgent, timeoutMs = 15000, fetchImpl = fetch } = {}) {
  if (cache.has(origin)) return cache.get(origin);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let result;
  try {
    const response = await fetchImpl(`${origin}/robots.txt`, {
      headers: { 'User-Agent': userAgent },
      signal: controller.signal,
      redirect: 'follow',
    });

    if (response.status >= 200 && response.status < 300) {
      result = parseRobots(await response.text(), userAgent);
    } else if (response.status === 404) {
      // Sin robots.txt: se permite todo, según la práctica estándar.
      result = { agents: ['*'], rules: [], crawlDelay: null };
    } else {
      // 401, 403 o error del servidor: se asume restricción total.
      result = { agents: ['*'], rules: [{ allow: false, path: '/' }], crawlDelay: null, blocked: true };
    }
  } catch {
    // Sin poder verificar, no se asume permiso.
    result = { agents: ['*'], rules: [{ allow: false, path: '/' }], crawlDelay: null, unreachable: true };
  } finally {
    clearTimeout(timer);
  }

  cache.set(origin, result);
  return result;
}

export function clearRobotsCache() {
  cache.clear();
}

/**
 * Cliente HTTP del crawler.
 *
 * Controlado y respetuoso (§7): concurrencia global y por host, pausa mínima
 * entre solicitudes al mismo host, timeout, reintentos con retroceso
 * exponencial y user-agent identificable. Sin evasión de ningún tipo: un 403 o
 * un desafío se reportan como MANUAL_REVIEW_REQUIRED.
 */

import { fetchRobots, isAllowedByRules } from './robots.mjs';

const DEFAULTS = {
  userAgent: 'CoursesCatalogBot/0.1 (+catalogo educativo verificable)',
  timeoutMs: 15000,
  concurrency: { global: 5, perHost: 2 },
  delayMsPerHost: 1500,
  retries: { max: 2, backoffMs: 2000, backoffFactor: 2 },
  respectRobotsTxt: true,
  maxRedirects: 5,
};

/** Semáforo simple: limita cuántas tareas corren a la vez. */
function createSemaphore(limit) {
  let active = 0;
  const queue = [];

  const release = () => {
    active -= 1;
    const next = queue.shift();
    if (next) next();
  };

  return {
    async acquire() {
      if (active < limit) {
        active += 1;
        return release;
      }
      await new Promise((resolve) => queue.push(resolve));
      active += 1;
      return release;
    },
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createFetcher(config = {}, { fetchImpl = fetch } = {}) {
  const options = {
    ...DEFAULTS,
    ...config,
    concurrency: { ...DEFAULTS.concurrency, ...(config.concurrency ?? {}) },
    retries: { ...DEFAULTS.retries, ...(config.retries ?? {}) },
  };

  const globalSemaphore = createSemaphore(options.concurrency.global);
  const hostSemaphores = new Map();
  const lastRequestAt = new Map();

  const hostSemaphore = (host) => {
    if (!hostSemaphores.has(host)) {
      hostSemaphores.set(host, createSemaphore(options.concurrency.perHost));
    }
    return hostSemaphores.get(host);
  };

  /** Espera lo necesario para respetar la pausa mínima del host. */
  async function throttle(host, extraDelay = 0) {
    const minDelay = Math.max(options.delayMsPerHost, extraDelay);
    const last = lastRequestAt.get(host) ?? 0;
    const elapsed = Date.now() - last;

    if (elapsed < minDelay) await sleep(minDelay - elapsed);
    lastRequestAt.set(host, Date.now());
  }

  async function request(url, { method = 'GET' } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);

    try {
      const response = await fetchImpl(url, {
        method,
        headers: {
          'User-Agent': options.userAgent,
          Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        },
        redirect: 'follow',
        signal: controller.signal,
      });
      return response;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Descarga una URL respetando robots.txt y los límites configurados.
   *
   * Devuelve siempre un objeto: nunca lanza por un fallo de red, para que el
   * pipeline pueda seguir y registrar el problema.
   */
  async function get(url, { method = 'GET' } = {}) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return { url, ok: false, status: null, reason: 'URL inválida', body: null };
    }

    const host = parsed.hostname;
    let crawlDelay = 0;

    if (options.respectRobotsTxt) {
      const robots = await fetchRobots(parsed.origin, {
        userAgent: options.userAgent,
        timeoutMs: options.timeoutMs,
        fetchImpl,
      });

      if (!isAllowedByRules(robots.rules, parsed.pathname)) {
        // Un robots.txt inaccesible o restringido no es lo mismo que una
        // prohibición explícita: el primero exige revisión humana.
        const needsReview = robots.unreachable === true || robots.blocked === true;

        return {
          url, ok: false, status: null, body: null,
          reason: robots.unreachable
            ? 'robots.txt inaccesible: no se asume permiso'
            : 'Prohibido por robots.txt',
          manualReview: needsReview,
        };
      }

      if (robots.crawlDelay) crawlDelay = robots.crawlDelay;
    }

    const releaseGlobal = await globalSemaphore.acquire();
    const releaseHost = await hostSemaphore(host).acquire();

    try {
      let attempt = 0;
      let delay = options.retries.backoffMs;

      for (;;) {
        await throttle(host, crawlDelay);

        let response;
        try {
          response = await request(url, { method });
        } catch (error) {
          const reason = error.name === 'AbortError'
            ? `Tiempo agotado tras ${options.timeoutMs} ms`
            : error.message;

          if (attempt >= options.retries.max) {
            return { url, ok: false, status: null, body: null, reason };
          }
          attempt += 1;
          await sleep(delay);
          delay *= options.retries.backoffFactor;
          continue;
        }

        // 429 y 5xx son transitorios: se reintenta con retroceso.
        if ((response.status === 429 || response.status >= 500) && attempt < options.retries.max) {
          const retryAfter = Number.parseInt(response.headers.get('retry-after') ?? '', 10);
          attempt += 1;
          await sleep(Number.isFinite(retryAfter) ? retryAfter * 1000 : delay);
          delay *= options.retries.backoffFactor;
          continue;
        }

        // 401, 403 y 429 persistente: el sitio impide el acceso automatizado.
        if (response.status === 401 || response.status === 403 || response.status === 429) {
          return {
            url, ok: false, status: response.status, body: null,
            reason: `El sitio impide el acceso automatizado (HTTP ${response.status})`,
            manualReview: true,
          };
        }

        if (response.status < 200 || response.status >= 300) {
          return {
            url, ok: false, status: response.status, body: null,
            reason: `HTTP ${response.status}`,
          };
        }

        const contentType = response.headers.get('content-type') ?? '';
        const body = method === 'HEAD' ? null : await response.text();

        return {
          url, ok: true, status: response.status, body, contentType,
          finalUrl: response.url && response.url !== url ? response.url : null,
        };
      }
    } finally {
      releaseHost();
      releaseGlobal();
    }
  }

  return { get, options };
}

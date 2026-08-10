/**
 * Renderer: interfaz del catálogo.
 *
 * Corre con sandbox y contextIsolation activos: sin acceso a Node ni al sistema
 * de archivos. Toda comunicación pasa por window.courses, expuesto por el
 * preload. El contenido del catálogo proviene de páginas crawleadas, así que
 * SIEMPRE se inserta con textContent, nunca con innerHTML.
 */

import { toCsv, toMarkdown, toJson, downloadText } from './export.js';

const api = window.courses;

const state = {
  filters: {},
  sort: 'recomendado',
  theme: 'light',
  rows: [],
  total: 0,
  stats: null,
  pipelineRunning: false,
};

const THEMES = new Set(['light', 'dark', 'auto']);
const DEFAULT_THEME = 'light';

/**
 * Aplica el tema al elemento raíz. Los estilos reaccionan al atributo
 * data-theme: aquí no se escribe ningún color.
 */
function applyTheme(theme) {
  const value = THEMES.has(theme) ? theme : DEFAULT_THEME;
  document.documentElement.setAttribute('data-theme', value);
  state.theme = value;
}

const SELECT_FILTERS = [
  { key: 'providerType', label: 'Origen', facet: 'providerType' },
  { key: 'domain', label: 'Dominio', facet: 'domain' },
  { key: 'institution', label: 'Institución', facet: 'institution' },
  { key: 'country', label: 'País', facet: 'country' },
  { key: 'platform', label: 'Plataforma', facet: 'platform' },
  { key: 'level', label: 'Nivel', facet: 'level' },
  { key: 'credentialType', label: 'Credencial', facet: 'credentialType' },
  { key: 'verificationStatus', label: 'Verificación', facet: 'verificationStatus' },
];

const DOMAIN_LABELS = {
  'ai-tecnica': 'IA técnica',
  'ai-negocio': 'IA de negocio',
  pmo: 'PMO y proyectos',
  finanzas: 'Finanzas y evaluación',
  gerencia: 'Gerencia y liderazgo',
  derecho: 'Derecho y contratos',
  sostenibilidad: 'Sostenibilidad y energía',
  datos: 'Datos y estadística',
  salud: 'Salud y bienestar',
  ciencias: 'Ingeniería y ciencias',
  humanidades: 'Humanidades y sociales',
  institucion: 'Universidades y organismos',
  'proveedor-ia': 'Proveedores de IA',
};

/** Nombres cortos para que el desplegable no corte la institución. */
const SHORT_NAMES = {
  'Massachusetts Institute of Technology': 'MIT',
  'University of California, Berkeley': 'UC Berkeley',
  'Banco Interamericano de Desarrollo': 'BID',
  'Hasso Plattner Institute': 'Hasso Plattner',
  'Harvard University': 'Harvard',
  'The Open University': 'Open University',
};

const el = (id) => document.getElementById(id);

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/* ---------------------------------------------------------------- URL state */

/** Los filtros activos viajan en la query string. Sin localStorage ni cookies. */
function readUrlState() {
  const params = new URLSearchParams(window.location.search);
  const filters = {};

  for (const { key } of SELECT_FILTERS) {
    const value = params.get(key);
    if (value) filters[key] = value;
  }

  const search = params.get('search');
  if (search) filters.search = search;

  const minRelevance = params.get('minRelevance');
  if (minRelevance) filters.minRelevance = Number.parseInt(minRelevance, 10);

  if (params.get('credentialFree') === '1') filters.credentialFree = true;
  if (params.get('credentialVerifiable') === '1') filters.credentialVerifiable = true;

  state.filters = filters;
  state.sort = params.get('sort') || 'recomendado';

  // Sin localStorage ni cookies: el tema viaja en la query string.
  applyTheme(params.get('theme') ?? DEFAULT_THEME);
}

function writeUrlState() {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(state.filters)) {
    if (value === true) params.set(key, '1');
    else if (value !== null && value !== undefined && value !== '') params.set(key, String(value));
  }
  if (state.sort !== 'recomendado') params.set('sort', state.sort);
  if (state.theme !== DEFAULT_THEME) params.set('theme', state.theme);

  const query = params.toString();
  window.history.replaceState(null, '', query ? `?${query}` : window.location.pathname);
}

/* ----------------------------------------------------------------- Render */

function statCard(value, label, modifier) {
  const node = document.createElement('div');
  node.className = modifier ? `stat stat--${modifier}` : 'stat';

  const valueNode = document.createElement('div');
  valueNode.className = 'stat__value';
  valueNode.textContent = new Intl.NumberFormat('es-419').format(value ?? 0);

  const labelNode = document.createElement('div');
  labelNode.className = 'stat__label';
  labelNode.textContent = label;

  node.append(valueNode, labelNode);
  return node;
}

/** Indicadores en la titlebar: compactos, solo los esenciales. */
async function renderDashboard() {
  const stats = await api.stats();
  state.stats = stats;

  el('dashboard').replaceChildren(
    statCard(stats.total, 'Cursos'),
    statCard(stats.fromInstitutions, 'Instituciones'),
    statCard(stats.fromAiProviders, 'Proveedores IA'),
    statCard(stats.freeCertificate + stats.freeBadge, 'Credencial gratis', 'free'),
    statCard(stats.needsReverify, 'Por reverificar', 'warn'),
  );

  renderStatusbar();
}

/** Sidebar derecha: composición del catálogo por origen, dominio y credencial. */
async function renderBreakdown() {
  const facets = await api.facets();
  const container = el('breakdown');
  const fragment = document.createDocumentFragment();

  const section = (heading, rows) => {
    if (!rows || rows.length === 0) return;

    const box = document.createElement('div');
    box.className = 'breakdown__section';

    const caption = document.createElement('div');
    caption.className = 'breakdown__heading';
    caption.textContent = heading;
    box.append(caption);

    for (const row of rows.slice(0, 8)) {
      const line = document.createElement('div');
      line.className = 'breakdown__row';

      const label = document.createElement('span');
      label.className = 'breakdown__label';
      label.textContent = DOMAIN_LABELS[row.value] ?? SHORT_NAMES[row.value] ?? row.value;
      label.title = row.value;

      const value = document.createElement('span');
      value.className = 'breakdown__value';
      value.textContent = row.n;

      line.append(label, value);
      box.append(line);
    }

    fragment.append(box);
  };

  section('Origen', facets.providerType);
  section('Dominio', facets.domain);
  section('Credencial', facets.credentialType);
  section('Plataforma', facets.platform);

  container.replaceChildren(fragment);
}

/** Statusbar: conteo, verificación y estado del pipeline. */
function renderStatusbar() {
  const format = (n) => new Intl.NumberFormat('es-419').format(n ?? 0);
  const total = state.stats?.total ?? 0;

  el('status-count').textContent = state.total === total
    ? `${format(total)} cursos`
    : `${format(state.total)} de ${format(total)} cursos`;

  const pending = state.stats?.needsReverify ?? 0;
  el('status-verification').textContent = pending === 0
    ? 'Verificaciones al día'
    : `${format(pending)} por reverificar`;
}

function setPipelineStatus(text, active = false) {
  const node = el('status-pipeline');
  node.textContent = text;
  node.classList.toggle('statusbar__item--active', active);
}

async function renderFilters() {
  const facets = await api.facets();
  const container = el('filter-selects');
  container.replaceChildren();

  for (const { key, label, facet } of SELECT_FILTERS) {
    const options = facets[facet] ?? [];
    if (options.length === 0) continue;

    const field = document.createElement('label');
    field.className = 'field';

    const caption = document.createElement('span');
    caption.className = 'field__label';
    caption.textContent = label;

    const select = document.createElement('select');
    select.className = 'field__input';
    select.id = `filter-${key}`;

    const any = document.createElement('option');
    any.value = '';
    any.textContent = 'Todas';
    select.append(any);

    for (const option of options) {
      const node = document.createElement('option');
      node.value = option.value;

      // Nombres largos de institución se abrevian para que quepan en el
      // desplegable, pero el título conserva el nombre completo.
      const etiqueta = DOMAIN_LABELS[option.value] ?? SHORT_NAMES[option.value] ?? option.value;
      node.textContent = `${etiqueta} (${option.n})`;
      node.title = `${option.value} — ${option.n} cursos`;

      if (state.filters[key] === option.value) node.selected = true;
      select.append(node);
    }

    select.addEventListener('change', () => {
      if (select.value) state.filters[key] = select.value;
      else delete state.filters[key];
      refresh();
    });

    field.append(caption, select);
    container.append(field);
  }
}

function badge(text, modifier) {
  const node = document.createElement('span');
  node.className = modifier ? `badge badge--${modifier}` : 'badge';
  node.textContent = text;
  return node;
}

function metaItem(key, value) {
  if (value === null || value === undefined || value === '') return null;

  const item = document.createElement('div');
  item.className = 'meta__item';

  const keyNode = document.createElement('span');
  keyNode.className = 'meta__key';
  keyNode.textContent = `${key}:`;

  const valueNode = document.createElement('span');
  valueNode.className = 'meta__value';
  valueNode.textContent = String(value);

  item.append(keyNode, valueNode);
  return item;
}

function externalLink(label, url, modifier) {
  if (!url) return null;

  const link = document.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.className = modifier ? `card__link card__link--${modifier}` : 'card__link';

  // Muestra el dominio de destino: el usuario sabe adónde va antes de pulsar.
  let host = null;
  try {
    host = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    host = null;
  }

  const text = document.createElement('span');
  text.textContent = label;
  link.append(text);

  if (host) {
    const domain = document.createElement('span');
    domain.className = 'card__link-host';
    domain.textContent = host;
    link.append(domain);
  }

  link.title = url;

  // El proceso principal abre el enlace en el navegador del sistema.
  link.addEventListener('click', (event) => {
    event.preventDefault();
    api.openExternal(url);
  });

  return link;
}

function credentialBadge(course) {
  const type = course.credential_type;
  if (!type) return badge('Sin credencial');

  const isFree = course.credential_free === true;
  const label = isFree ? type.toUpperCase() : type;
  return badge(label, isFree ? 'free' : 'paid');
}

function renderCard(course) {
  const card = document.createElement('article');
  card.className = 'card';

  const head = document.createElement('div');
  head.className = 'card__head';

  const titleBox = document.createElement('div');
  const title = document.createElement('h2');
  title.className = 'card__title';
  title.textContent = course.title;

  const institution = document.createElement('p');
  institution.className = 'card__institution';
  institution.textContent = [course.institution, course.institution_country, course.platform]
    .filter(Boolean)
    .join(' · ');

  titleBox.append(title, institution);
  head.append(titleBox);
  card.append(head);

  const badges = document.createElement('div');
  badges.className = 'badges';
  badges.append(credentialBadge(course));

  // Distingue a simple vista un proveedor de IA de una institución académica.
  if (course.provider_type === 'proveedor-ia') badges.append(badge('Proveedor de IA', 'provider'));

  if (course.domain) badges.append(badge(DOMAIN_LABELS[course.domain] ?? course.domain));
  if (course.level) badges.append(badge(course.level));

  const status = course.verification_status;
  if (status) {
    const modifier = status === 'VERIFICADO' ? 'free' : (status === 'PENDIENTE' ? '' : 'warn');
    badges.append(badge(status, modifier));
  }
  if (course.credential_verifiable === true) badges.append(badge('Verificable'));

  card.append(badges);

  const meta = document.createElement('div');
  meta.className = 'meta';

  const price = typeof course.credential_price_usd === 'number'
    ? new Intl.NumberFormat('es-419', { style: 'currency', currency: 'USD' })
        .format(course.credential_price_usd)
    : null;

  const items = [
    metaItem('Código', course.course_code),
    metaItem('Acceso', course.cost_access),
    metaItem('Precio credencial', price),
    metaItem('Emisor', course.credential_issuer),
    metaItem('Duración', course.duration_weeks ? `${course.duration_weeks} semanas` : null),
    metaItem('Horas/semana', course.hours_per_week),
    metaItem('Modalidad', course.pace),
    metaItem('Idioma', Array.isArray(course.language) ? course.language.join(', ') : null),
    metaItem('Subtítulos', Array.isArray(course.subtitles) ? course.subtitles.join(', ') : null),
    metaItem('Relevancia', course.relevance_ppp_infra),
    metaItem('Verificado', course.last_verified),
    metaItem('Estado', course.status),
    metaItem('Temas', Array.isArray(course.topics) ? course.topics.join(', ') : null),
  ].filter(Boolean);

  meta.append(...items);
  card.append(meta);

  if (course.notes) {
    const notes = document.createElement('p');
    notes.className = 'card__notes';
    notes.textContent = course.notes;
    card.append(notes);
  }

  const links = [
    externalLink('Ir al curso', course.url_official, 'primary'),
    externalLink('Programa', course.url_syllabus),
    externalLink('Credencial', course.url_credential_info),
    externalLink('Fuente de verificación', course.source_of_truth),
  ].filter(Boolean);

  if (links.length > 0) {
    const linkBox = document.createElement('div');
    linkBox.className = 'card__links';
    linkBox.append(...links);
    card.append(linkBox);
  }

  return card;
}

function renderEmpty(container) {
  const box = document.createElement('div');
  box.className = 'empty';

  const title = document.createElement('p');
  title.className = 'empty__title';

  const hint = document.createElement('p');

  if (state.total === 0 && Object.keys(state.filters).length === 0) {
    title.textContent = 'El catálogo está vacío';
    hint.textContent =
      'Usar «Actualizar catálogo» para ejecutar el pipeline de descubrimiento y verificación.';
  } else {
    title.textContent = 'Ningún curso coincide con los filtros';
    hint.textContent = 'Ajustar o limpiar los filtros para ver más resultados.';
  }

  box.append(title, hint);
  container.replaceChildren(box);
}

async function refresh() {
  writeUrlState();

  const result = await api.query({ ...state.filters, sort: state.sort });
  state.rows = result.rows;
  state.total = result.total;

  const container = el('cards');

  el('results-count').textContent = result.total === 1
    ? '1 curso'
    : `${new Intl.NumberFormat('es-419').format(result.total)} cursos`;

  syncRibbonState();
  renderStatusbar();

  if (result.rows.length === 0) {
    renderEmpty(container);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const course of result.rows) fragment.append(renderCard(course));
  container.replaceChildren(fragment);
}

/* --------------------------------------------------------------- Pipeline */

function appendLog(payload) {
  const log = el('pipeline-log');
  const line = document.createElement('div');

  line.className = payload.level === 'error'
    ? 'log-line log-line--error'
    : (payload.level === 'warn' ? 'log-line log-line--warn' : 'log-line');

  const prefix = payload.step ? `[${payload.step}] ` : '';
  line.textContent = `${prefix}${payload.message}`;

  log.append(line);
  log.scrollTop = log.scrollHeight;
}

async function runUpdate() {
  const button = el('btn-update');
  const dialog = el('pipeline');

  state.pipelineRunning = true;
  button.disabled = true;
  el('pipeline-log').replaceChildren();
  el('pipeline-state').textContent = 'En curso…';
  el('pipeline-done').disabled = true;
  el('pipeline-close').disabled = true;

  if (!dialog.open) dialog.showModal();
  setPipelineStatus('Actualizando el catálogo…', true);

  try {
    const result = await api.runPipeline({});
    appendLog({
      level: result.ok ? 'info' : 'error',
      message: result.ok
        ? 'Listo. Catálogo actualizado.'
        : `No se completó: ${result.error ?? 'error desconocido'}`,
    });

    if (result.ok) {
      await renderDashboard();
      await renderFilters();
      await renderBreakdown();
      await refresh();
    }
    setPipelineStatus(result.ok ? 'Catálogo actualizado' : 'La actualización no se completó');
    el('pipeline-state').textContent = result.ok ? 'Completada' : 'Con errores';
  } catch (error) {
    appendLog({ level: 'error', message: error.message });
    setPipelineStatus('Error en la actualización');
    el('pipeline-state').textContent = 'Con errores';
  } finally {
    state.pipelineRunning = false;
    button.disabled = false;
    el('pipeline-done').disabled = false;
    el('pipeline-close').disabled = false;
  }
}

/* ---------------------------------------------------------------- Export */

function exportView(format) {
  if (state.rows.length === 0) return;

  const stamp = new Date().toISOString().slice(0, 10);

  if (format === 'csv') {
    downloadText(`courses-${stamp}.csv`, 'text/csv', toCsv(state.rows));
  } else if (format === 'md') {
    downloadText(`courses-${stamp}.md`, 'text/markdown', toMarkdown(state.rows));
  } else {
    downloadText(`courses-${stamp}.json`, 'application/json', toJson(state.rows));
  }
}

/* ------------------------------------------------------------------ Init */

/**
 * Atajos del ribbon: alternan un filtro concreto y muestran su estado.
 * Volver a pulsar el mismo botón quita el filtro.
 */
const RIBBON_SHORTCUTS = [
  { attr: 'data-provider', key: 'providerType' },
  { attr: 'data-institution', key: 'institution' },
  { attr: 'data-domain', key: 'domain' },
];

function syncRibbonState() {
  for (const { attr, key } of RIBBON_SHORTCUTS) {
    for (const button of document.querySelectorAll(`[${attr}]`)) {
      const active = state.filters[key] === button.getAttribute(attr);
      button.setAttribute('aria-pressed', String(active));
    }
  }
}

function bindRibbonShortcuts() {
  for (const { attr, key } of RIBBON_SHORTCUTS) {
    for (const button of document.querySelectorAll(`[${attr}]`)) {
      const value = button.getAttribute(attr);
      button.setAttribute('aria-pressed', 'false');

      button.addEventListener('click', () => {
        if (state.filters[key] === value) delete state.filters[key];
        else state.filters[key] = value;

        // Los selectores de la sidebar reflejan el atajo aplicado.
        const select = el(`filter-${key}`);
        if (select) select.value = state.filters[key] ?? '';

        refresh();
      });
    }
  }
}

function bindControls() {
  const search = el('filter-search');
  search.value = state.filters.search ?? '';
  search.addEventListener(
    'input',
    debounce(() => {
      if (search.value.trim()) state.filters.search = search.value.trim();
      else delete state.filters.search;
      refresh();
    }, 220),
  );

  const minRelevance = el('filter-minRelevance');
  if (state.filters.minRelevance) minRelevance.value = String(state.filters.minRelevance);
  minRelevance.addEventListener('change', () => {
    if (minRelevance.value) state.filters.minRelevance = Number.parseInt(minRelevance.value, 10);
    else delete state.filters.minRelevance;
    refresh();
  });

  for (const key of ['credentialFree', 'credentialVerifiable']) {
    const box = el(`filter-${key}`);
    box.checked = state.filters[key] === true;
    box.addEventListener('change', () => {
      if (box.checked) state.filters[key] = true;
      else delete state.filters[key];
      refresh();
    });
  }

  const sort = el('sort');
  sort.value = state.sort;
  sort.addEventListener('change', () => {
    state.sort = sort.value;
    refresh();
  });

  const theme = el('theme');
  theme.value = state.theme;
  theme.addEventListener('change', () => {
    applyTheme(theme.value);
    writeUrlState();
  });

  // Limpia el estado en memoria y los controles, sin recargar la página: así el
  // tema elegido sobrevive y no se pierde la posición de scroll.
  el('btn-reset').addEventListener('click', () => {
    state.filters = {};
    state.sort = 'recomendado';

    el('filter-search').value = '';
    el('filter-minRelevance').value = '';
    el('filter-credentialFree').checked = false;
    el('filter-credentialVerifiable').checked = false;
    el('sort').value = 'recomendado';
    for (const select of document.querySelectorAll('#filter-selects select')) select.value = '';

    refresh();
  });

  el('btn-update').addEventListener('click', runUpdate);
  const dialog = el('pipeline');
  const closePipeline = () => dialog.close();

  el('pipeline-close').addEventListener('click', closePipeline);
  el('pipeline-done').addEventListener('click', closePipeline);

  // Escape y clic en el fondo cierran, salvo mientras el pipeline corre:
  // cerrar a medias perdería el registro de una ejecución en curso.
  dialog.addEventListener('cancel', (event) => {
    if (state.pipelineRunning) event.preventDefault();
  });

  dialog.addEventListener('click', (event) => {
    if (event.target === dialog && !state.pipelineRunning) dialog.close();
  });

  for (const button of document.querySelectorAll('[data-export]')) {
    button.addEventListener('click', () => exportView(button.dataset.export));
  }

  bindRibbonShortcuts();

  api.onPipelineProgress(appendLog);

  // El catálogo cambió en disco: se refresca la vista sin reiniciar la app.
  api.onCatalogChanged(async () => {
    await renderDashboard();
    await renderFilters();
    await renderBreakdown();
    await refresh();
  });
}

async function init() {
  readUrlState();
  bindControls();
  await renderDashboard();
  await renderFilters();
  await renderBreakdown();
  await refresh();
}

init().catch((error) => {
  const container = el('cards');
  const box = document.createElement('div');
  box.className = 'empty';

  const title = document.createElement('p');
  title.className = 'empty__title';
  title.textContent = 'No se pudo cargar el catálogo';

  const detail = document.createElement('p');
  detail.textContent = error.message;

  box.append(title, detail);
  container.replaceChildren(box);
});

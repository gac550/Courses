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
  rows: [],
  total: 0,
};

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
  institucion: 'Universidades y organismos',
  'proveedor-ia': 'Proveedores de IA',
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
}

function writeUrlState() {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(state.filters)) {
    if (value === true) params.set(key, '1');
    else if (value !== null && value !== undefined && value !== '') params.set(key, String(value));
  }
  if (state.sort !== 'recomendado') params.set('sort', state.sort);

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

async function renderDashboard() {
  const stats = await api.stats();
  const container = el('dashboard');
  container.replaceChildren(
    statCard(stats.total, 'Cursos'),
    statCard(stats.fromInstitutions, 'De universidades'),
    statCard(stats.fromAiProviders, 'De proveedores de IA'),
    statCard(stats.freeCertificate, 'Certificado gratuito', 'free'),
    statCard(stats.freeBadge, 'Badge gratuito', 'free'),
    statCard(stats.paidCertificate, 'Certificado pagado'),
    statCard(stats.noCredential, 'Sin credencial'),
    statCard(stats.institutions, 'Instituciones'),
    statCard(stats.needsReverify, 'Por reverificar', 'warn'),
  );
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
      node.textContent = `${DOMAIN_LABELS[option.value] ?? option.value} (${option.n})`;
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

function externalLink(label, url) {
  if (!url) return null;

  const link = document.createElement('a');
  link.href = url;
  link.textContent = label;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';

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
    externalLink('Curso', course.url_official),
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
  const panel = el('pipeline');

  button.disabled = true;
  button.textContent = 'Actualizando…';
  panel.hidden = false;
  el('pipeline-log').replaceChildren();

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
      await refresh();
    }
  } catch (error) {
    appendLog({ level: 'error', message: error.message });
  } finally {
    button.disabled = false;
    button.textContent = 'Actualizar catálogo';
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

  el('btn-reset').addEventListener('click', () => {
    state.filters = {};
    state.sort = 'recomendado';
    window.location.search = '';
  });

  el('btn-update').addEventListener('click', runUpdate);
  el('pipeline-close').addEventListener('click', () => {
    el('pipeline').hidden = true;
  });

  for (const button of document.querySelectorAll('[data-export]')) {
    button.addEventListener('click', () => exportView(button.dataset.export));
  }

  api.onPipelineProgress(appendLog);

  // El catálogo cambió en disco: se refresca la vista sin reiniciar la app.
  api.onCatalogChanged(async () => {
    await renderDashboard();
    await renderFilters();
    await refresh();
  });
}

async function init() {
  readUrlState();
  bindControls();
  await renderDashboard();
  await renderFilters();
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

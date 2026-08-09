/**
 * Exportación de la vista filtrada a CSV, Markdown y JSON.
 *
 * El CSV usa punto y coma como separador (§23), compatible con Excel en
 * configuraciones regionales de América Latina y Europa.
 */

const COLUMNS = [
  ['id', 'ID'],
  ['title', 'Título'],
  ['institution', 'Institución'],
  ['institution_country', 'País'],
  ['platform', 'Plataforma'],
  ['course_code', 'Código'],
  ['domain', 'Dominio'],
  ['level', 'Nivel'],
  ['duration_weeks', 'Semanas'],
  ['hours_per_week', 'Horas/semana'],
  ['pace', 'Modalidad'],
  ['cost_access', 'Acceso'],
  ['credential_type', 'Credencial'],
  ['credential_free', 'Credencial gratuita'],
  ['credential_price_usd', 'Precio USD'],
  ['credential_verifiable', 'Verificable'],
  ['relevance_ppp_infra', 'Relevancia'],
  ['verification_status', 'Verificación'],
  ['last_verified', 'Última verificación'],
  ['url_official', 'URL curso'],
  ['source_of_truth', 'Fuente de verdad'],
];

function cellValue(course, key) {
  const value = course[key];

  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'sí' : 'no';
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

/**
 * Escapa un campo CSV.
 *
 * El prefijo con comilla simple ante =, +, - y @ evita que una hoja de cálculo
 * interprete como fórmula un texto proveniente de una página crawleada.
 */
function csvEscape(value) {
  const text = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(courses) {
  const header = COLUMNS.map(([, label]) => csvEscape(label)).join(';');
  const rows = courses.map((course) =>
    COLUMNS.map(([key]) => csvEscape(cellValue(course, key))).join(';'),
  );

  // BOM: Excel reconoce UTF-8 y respeta los acentos.
  return `﻿${[header, ...rows].join('\r\n')}\r\n`;
}

function mdEscape(value) {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

export function toMarkdown(courses) {
  // La columna ID va primero, según la convención de tablas del workspace.
  const header = ['ID', 'Título', 'Institución', 'Credencial', 'Precio USD', 'Verificación', 'URL'];

  const lines = [
    `| ${header.join(' | ')} |`,
    `|${header.map(() => '---').join('|')}|`,
  ];

  for (const course of courses) {
    const price = typeof course.credential_price_usd === 'number'
      ? String(course.credential_price_usd)
      : '';

    const url = course.url_official ? `[abrir](${course.url_official})` : '';

    lines.push(
      `| ${[
        mdEscape(course.id ?? ''),
        mdEscape(course.title ?? ''),
        mdEscape(course.institution ?? ''),
        mdEscape(course.credential_type ?? 'sin credencial'),
        price,
        mdEscape(course.verification_status ?? ''),
        url,
      ].join(' | ')} |`,
    );
  }

  return `${lines.join('\n')}\n`;
}

export function toJson(courses) {
  return `${JSON.stringify(courses, null, 2)}\n`;
}

/** Descarga un texto como archivo, sin dependencias ni servidor. */
export function downloadText(filename, mime, content) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);
}

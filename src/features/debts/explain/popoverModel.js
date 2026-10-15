import { explainFacts } from '@finance-core';

// View model of the «¿Qué es esto?» popovers (spec: Explain popovers). Pure and read-only. A popover is the same topic the
// Telegram explanation covers: its figures come from the core facts (`explainFacts`, already formatted), its text is the
// reviewed copy of the core, and it ends with the same source line and the exact disclaimer. The web only adds short
// templates around those figures, so no number is computed here and no legal text is written here.

/** The disclaimer every explanation ends with (spec: Mandatory source line and disclaimer). Nia prints the same sentence. */
export const DISCLAIMER = 'Información educativa con tus datos; no es asesoría financiera.';

/** Figure of the debt views -> catalogue topic, and the title of its popover. */
export const FIGURES = Object.freeze({
  rate: { topic: 'rate_conventions', title: 'Tu tasa' },
  mora: { topic: 'mora', title: 'Intereses de mora' },
  charges: { topic: 'charges', title: 'Cargos, seguros e impuestos' },
  minimum: { topic: 'card_statement', title: 'Pago mínimo' },
  statement: { topic: 'card_statement', title: 'Extracto de la tarjeta' },
});

// The core function family each topic is built from, for the source line (the same words as the Telegram footer).
const FAMILY = {
  rate_conventions: 'conversión de tasas',
  mora: 'cálculo de mora',
  charges: 'cargos e impuestos',
  card_statement: 'extractos de tarjeta',
};

const CONVENTION = {
  EA: 'E.A., efectiva anual',
  NAMV: 'N.A.M.V., nominal anual mes vencido',
  MV: 'M.V., mensual vencida',
  NATV: 'N.A.T.V., nominal anual trimestre vencido',
  NATA: 'N.A.T.A., nominal anual trimestre anticipado',
  NAMA: 'N.A.M.A., nominal anual mes anticipado',
  ZERO: 'sin intereses',
  OTHER: 'con otra convención',
};

const hasNotice = (facts, code) => facts.notices.some((notice) => notice.code === code);
const approx = (facts, key) => `${facts.text[key]}${facts.approximate.includes(key) ? ' (aproximado)' : ''}`;
const days = (count) => `${count} ${count === '1' ? 'día' : 'días'}`;

// One template per topic, each returns the lines with the user's figures. Every figure is read from `facts.text`.
const LINES = {
  rate_conventions(facts) {
    const { text } = facts;
    return [`Tasa registrada: ${text.stated} (${CONVENTION[text.convention] || CONVENTION.OTHER})`, `En E.A.: ${approx(facts, 'ea')}`, `Mensual (M.V.): ${approx(facts, 'monthly')}`];
  },

  mora(facts) {
    const { text } = facts;
    if (text.mode === 'none') return ['Esta deuda no tiene mora configurada.'];
    const lines = [`Tasa de mora vigente: ${text.lateEA} E.A.`];
    if (text.late) lines.push(`Mora acumulada: ${text.late} por ${days(text.days)} de atraso sobre ${text.base} de capital vencido${facts.approximate.includes('late') ? ' (aproximado)' : ''}.`);
    else if (text.exampleLate) lines.push(`Ejemplo: ${days(text.exampleDays)} de atraso sobre ${text.exampleBase} serían ${text.exampleLate} de mora (aproximado).`);
    return lines;
  },

  charges(facts) {
    const { text, numbers } = facts;
    if (hasNotice(facts, 'no_statement_yet')) return ['Todavía no hay un extracto registrado: los cargos aparecen cuando lo registres.'];
    if (hasNotice(facts, 'no_charges')) return ['Esta deuda no tiene cargos ni seguros registrados.'];
    const lines = [];
    for (let index = 0; index < numbers.lines; index += 1) lines.push(`${text[`l${index}.label`]}: ${text[`l${index}.amount`]}`);
    if (text.hidden) lines.push(`Y ${text.hidden} cargos más.`);
    if (text.yearTotal) lines.push(`En las próximas ${text.yearRows} cuotas: ${approx(facts, 'yearTotal')}`);
    return lines;
  },

  card_statement(facts) {
    const { text } = facts;
    if (hasNotice(facts, 'no_statement_yet')) return [`Aún no hay un extracto registrado. Próximo corte: ${text.nextStatementOn}. Fecha límite de pago: ${text.nextDueOn}.`];
    const lines = [`Último extracto (corte del ${text.statementOn}): ${text.total}`, `Pago mínimo: ${text.minimum}`, `Pago total del extracto: ${text.payInFull}`, `Fecha límite de pago: ${text.dueOn}`];
    if (text.nextStatementOn) lines.push(`Próximo corte: ${text.nextStatementOn}`);
    return lines;
  },
};

function sourceLine(facts) {
  const who = facts.dataSource === 'debt' && facts.debt ? facts.debt.name : 'explicación general';
  return `Fuente: ${[who, FAMILY[facts.topic], ...facts.sources.map((source) => source.label)].join(' · ')}`;
}

/**
 * The popover of one figure, or null when there is nothing to show: an unknown figure, a topic that does not fit the debt
 * kind (the minimum of a loan), a topic whose copy is not released, or a debt that cannot be explained.
 * @param {string} figure One of the keys of FIGURES.
 * @param {{ debt: object, events: object[], today: string, copy?: object }} input `copy` is for tests; it defaults to the core copy.
 * @returns {({ figure: string, topic: string, title: string, lines: string[], paragraphs: string[], source: string, disclaimer: string } | null)}
 */
export function popoverOf(figure, { debt, events, today, copy }) {
  const spec = FIGURES[figure];
  if (!spec) return null;
  try {
    const facts = explainFacts(spec.topic, debt, events, debt.legal, today, copy ? { copy } : {});
    if (facts.status !== 'ok' && facts.status !== 'generic') return null;
    return {
      figure,
      topic: spec.topic,
      title: spec.title,
      lines: facts.status === 'ok' ? LINES[spec.topic](facts) : [],
      paragraphs: facts.copy,
      source: sourceLine(facts),
      disclaimer: DISCLAIMER,
    };
  } catch {
    return null;
  }
}

/** Every popover that applies to the debt, by figure. A figure with nothing to show is left out. */
export function popoversOf(input) {
  return Object.fromEntries(Object.keys(FIGURES).map((figure) => [figure, popoverOf(figure, input)]).filter(([, popover]) => popover));
}

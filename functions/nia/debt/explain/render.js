// Spanish rendering of the explain facts (design G1, G6). Each topic has a deterministic template over `facts`: every
// figure is read from `facts.text` (pre-formatted by the core) and the rest is fixed text or reviewed copy, so no template
// invents a number. The messages are split on paragraph boundaries into parts of at most `maxChars` characters, each one
// with the source footer. Pure and Node 16 safe.

export const TOPIC_LABELS = Object.freeze({
  rate_conventions: 'Tasas: E.A., N.A.M.V. y M.V.',
  usury_ibc: 'Usura e IBC',
  mora: 'Intereses de mora',
  payment_allocation: 'A dónde va mi pago',
  charges: 'Cargos, seguros y GMF',
  card_statement: 'Extracto y pago mínimo',
  card_interest_drop: 'Por qué bajan los intereses',
  restructure_whatif: 'Reestructurar una deuda',
  prepayment: 'Abonos extra y prepago',
});

export const UNDER_REVIEW_TEXT = 'Este tema está en revisión. Todavía no puedo explicarlo; lo haré cuando esté revisado.';
export const DISCLAIMER = 'Información educativa con tus datos; no es asesoría financiera.';
export const MAX_PART = 1200;

// Keyed by the kind of the debt the user asked about: a loan was asked a card-only topic, and the other way round.
const NOT_APPLICABLE_TEXT = {
  loan: 'Ese tema aplica solo a tarjetas de crédito, y esa deuda es un préstamo.',
  card: 'Ese tema aplica solo a préstamos, y esa deuda es una tarjeta de crédito.',
};

// The core function family each topic is built from, for the source line.
const FAMILY = {
  rate_conventions: 'conversión de tasas',
  usury_ibc: 'tasas de usura e IBC',
  mora: 'cálculo de mora',
  payment_allocation: 'aplicación de pagos',
  charges: 'cargos e impuestos',
};

// Related topics offered after an explanation (at most two).
const FOLLOW_UPS = {
  rate_conventions: ['usury_ibc', 'mora'],
  usury_ibc: ['rate_conventions', 'mora'],
  mora: ['usury_ibc', 'payment_allocation'],
  payment_allocation: ['mora', 'charges'],
  charges: ['payment_allocation', 'usury_ibc'],
};

const CONVENTION = {
  EA: 'E.A. (efectiva anual)',
  NAMV: 'N.A.M.V. (nominal anual, mes vencido)',
  MV: 'M.V. (mensual vencida)',
  NATV: 'N.A.T.V. (nominal anual, trimestre vencido)',
  NATA: 'N.A.T.A. (nominal anual, trimestre anticipado)',
  NAMA: 'N.A.M.A. (nominal anual, mes anticipado)',
  OTHER: 'con otra convención',
};
const MODALITY = {
  consumer: 'consumo y ordinario',
  low_amount: 'bajo monto',
  productive: 'productivo',
  productive_rural: 'productivo rural',
  productive_urban: 'productivo urbano',
  popular_rural: 'popular rural',
  popular_urban: 'popular urbano',
  mortgage: 'vivienda',
};
const ORIGIN = {
  ibc: 'Lo calculé con el IBC registrado en tu hogar.',
  override: 'Es la tasa de usura registrada en tu hogar.',
  default: 'Viene de la tabla que trae la app.',
};
const KIND = { insurance: 'seguro', fee: 'comisión o cuota', tax: 'impuesto', other: 'otro cargo' };

const INVITE = 'Si me dices de cuál deuda hablas, te lo muestro con tus números.';

// -- helpers ---------------------------------------------------------------------------------------------------------

const copyOf = (facts, key) => (facts.copyKeys ? facts.copy[facts.copyKeys.indexOf(key)] : undefined) || '';
const approx = (facts, key) => `${facts.text[key]}${facts.approximate.includes(key) ? ' (aproximado)' : ''}`;
const hasNotice = (facts, code) => facts.notices.some((notice) => notice.code === code);
const days = (count) => (count === 1 ? 'día' : 'días');
const whose = (facts) => (facts.dataSource === 'stated' ? 'La tasa que me diste' : 'Tu tasa');

function sourceLine(facts) {
  const who = facts.dataSource === 'debt' && facts.debt ? facts.debt.name : facts.dataSource === 'stated' ? 'tasa que me diste' : 'explicación general';
  const labels = facts.sources.map((source) => source.label);
  return `Fuente: ${[who, FAMILY[facts.topic], ...labels].join(' · ')}\n${DISCLAIMER}`;
}

// -- templates: one function per topic, each returns the paragraphs of the explanation -------------------------------

function rateConventions(facts) {
  const sample = copyOf(facts, 'rate_conventions.sample');
  if (facts.status === 'generic') return [sample, 'Si me dices de cuál deuda hablas o una tasa con su convención, te la convierto con tus números.'];
  const { text } = facts;
  const head = facts.dataSource === 'stated' ? 'La tasa que me diste es' : 'Tu tasa vigente es';
  if (text.convention === 'ZERO') return [sample, `${head} ${text.stated} E.A.: esta deuda no cobra intereses.`];
  const tag = (key) => (facts.approximate.includes(key) ? ', aproximado' : '');
  return [sample, `${head} ${text.stated} ${CONVENTION[text.convention]}. Equivale a ${text.monthly} mensual (M.V.${tag('monthly')}) y a ${text.ea} efectiva anual (E.A.${tag('ea')}).`];
}

function usuryIbc(facts) {
  const { text } = facts;
  const paragraphs = [copyOf(facts, 'usury_ibc.sample')];
  if (text.cap) {
    const ibc = text.ibc ? ` (IBC${facts.approximate.includes('ibc') ? ' aproximado' : ''} de ${text.ibc} E.A.)` : '';
    paragraphs.push(`Para el crédito de ${MODALITY[text.modality] || text.modality}, el tope de usura que tengo registrado para ${text.month} es ${text.cap} E.A.${ibc}. ${ORIGIN[text.origin] || ORIGIN.default}`);
  } else {
    paragraphs.push('No tengo registrado un tope de usura para esta modalidad, así que no puedo decirte cuál es.');
  }
  if (hasNotice(facts, 'usury_stale')) paragraphs.push(`Aviso: el último tope que tengo estuvo vigente hasta el ${text.lastValidTo}; te lo muestro como referencia, pero puede haber cambiado.`);
  if (hasNotice(facts, 'usury_unverified')) paragraphs.push('Ese valor no está verificado oficialmente.');
  if (text.rateEA) {
    const verdict = hasNotice(facts, 'usury_above_cap') ? ' y supera ese tope; conviene revisar el contrato con la entidad' : text.cap ? ' y está por debajo del tope' : '';
    paragraphs.push(`${whose(facts)} es ${text.rateEA} E.A.${verdict ? `${verdict}.` : ''}`);
  } else {
    paragraphs.push(INVITE);
  }
  paragraphs.push(copyOf(facts, 'legal.usury_ibc'));
  return paragraphs;
}

function moraPolicy(facts) {
  const { text } = facts;
  if (text.mode === 'none') return 'Según su configuración, esta deuda no cobra mora.';
  if (text.mode === 'fixed') return `La mora de esta deuda se cobra a una tasa fija, limitada por la usura: ${text.lateEA} E.A.`;
  if (text.mode === 'contract_multiple') return `La mora de esta deuda se cobra como un múltiplo de la tasa del contrato, limitada por la usura: ${text.lateEA} E.A.`;
  return `La mora de esta deuda se cobra a la tasa de usura vigente: ${text.lateEA} E.A.`;
}

function mora(facts) {
  const { text, numbers } = facts;
  const paragraphs = [copyOf(facts, 'mora.sample')];
  if (facts.status === 'generic') paragraphs.push(INVITE);
  else paragraphs.push(moraPolicy(facts));
  if (numbers.lateMinor !== undefined) {
    paragraphs.push(`Hoy llevas ${text.days} ${days(numbers.lateDays)} de atraso sobre ${text.base} de capital vencido, y la mora acumulada es ${text.late}.`);
  } else if (numbers.exampleLateMinor !== undefined) {
    paragraphs.push(`Ejemplo: con ${text.exampleDays} ${days(numbers.exampleDays)} de atraso sobre ${text.exampleBase} de capital vencido, la mora sería de ${approx(facts, 'exampleLate')}.`);
  }
  if (hasNotice(facts, 'late_cap_unknown')) paragraphs.push('No tengo registrado el tope de usura de esta modalidad, así que no pude aplicar ese límite.');
  if (hasNotice(facts, 'late_cap_stale')) paragraphs.push('El tope de usura que uso es el último que tengo registrado y puede haber cambiado.');
  if (hasNotice(facts, 'late_mortgage_unverified')) paragraphs.push('Además, los créditos de vivienda tienen reglas propias que esta guía no aplica; confirma la mora con tu banco.');
  paragraphs.push(copyOf(facts, 'legal.mora'));
  return paragraphs;
}

function paymentAllocation(facts) {
  const { text } = facts;
  const paragraphs = [copyOf(facts, 'payment_allocation.sample')];
  if (facts.status === 'generic') return [...paragraphs, 'Si me dices de cuál deuda hablas y qué valor pagarías, te muestro el reparto con tus números.'];
  if (hasNotice(facts, 'nothing_due')) return [...paragraphs, 'Ahora no tiene ninguna cuota pendiente, así que no hay un pago para repartir. Dime un valor y te muestro cómo se repartiría.'];
  const head = text.amountSource === 'stated' ? `Con un pago de ${text.payment} el ${text.paidOn}, el reparto sería:` : `Si pagas hoy (${text.paidOn}) lo que debe la próxima cuota, ${text.payment}, el reparto sería:`;
  const lines = [`• Cargos: ${text.charges}`];
  if (facts.numbers.taxes > 0) lines.push(`• Impuestos: ${text.taxes}`);
  lines.push(`• Mora: ${text.late}`, `• Intereses: ${text.interest}`, `• Capital: ${text.principal}`);
  if (facts.numbers.surplus > 0) lines.push(`• Sobrante: ${text.surplus}`);
  return [...paragraphs, `${head}\n${lines.join('\n')}`];
}

function chargeLine(text, key) {
  const pct = text[`${key}.pct`];
  const basis = {
    pctOfCharge: `${pct} de «${text[`${key}.ref`]}»`,
    pctOfSubtotal: `${pct} de la cuota con sus cargos`,
    pctOutstanding: `${pct} del saldo`,
    pctOriginal: `${pct} del valor inicial`,
  }[text[`${key}.basis`]];
  return `• ${text[`${key}.label`]} (${KIND[text[`${key}.kind`]] || KIND.other}): ${text[`${key}.amount`]}${basis ? `, ${basis}` : ''}`;
}

function charges(facts) {
  const { text, numbers } = facts;
  const paragraphs = [copyOf(facts, 'charges.sample')];
  if (facts.status === 'generic') {
    paragraphs.push(`Ejemplo del IVA: con una comisión de ${text.ivaBase} y un IVA de ${text.ivaPct}, el IVA es de ${text.iva}.`, INVITE);
  } else if (hasNotice(facts, 'no_charges')) {
    paragraphs.push('Esta deuda no tiene cargos, seguros ni impuestos registrados.');
  } else {
    const lines = Array.from({ length: numbers.lines }, (_, index) => chargeLine(text, `l${index}`));
    if (numbers.hidden) lines.push(`Y ${text.hidden} más.`);
    paragraphs.push(`Cargos de tu próxima cuota:\n${lines.join('\n')}`);
    paragraphs.push(`Suma aproximada de cargos e impuestos de las próximas ${text.yearRows} cuotas: ${text.yearTotal} (aproximado).`);
    if (lines.some((line) => line.includes(' de «'))) paragraphs.push('Un impuesto como el IVA se calcula sobre el cargo al que está ligado, por eso aparece junto a él.');
  }
  paragraphs.push(copyOf(facts, 'legal.gmf'), `Ejemplo del GMF: ${text.gmfRate} sobre ${text.gmfBase} son ${text.gmf}.`);
  return paragraphs;
}

const TEMPLATES = { rate_conventions: rateConventions, usury_ibc: usuryIbc, mora, payment_allocation: paymentAllocation, charges };

// -- splitter --------------------------------------------------------------------------------------------------------

// Cuts a text that is longer than `room` at the last space that does not follow a currency sign, so no figure is split.
function cutWords(text, room) {
  const pieces = [];
  let rest = text;
  while (rest.length > room) {
    let at = rest.lastIndexOf(' ', room);
    while (at > 0 && rest[at - 1] === '$') at = rest.lastIndexOf(' ', at - 1);
    if (at <= 0) at = room;
    pieces.push(rest.slice(0, at));
    rest = rest.slice(at).trimStart();
  }
  return rest ? [...pieces, rest] : pieces;
}

// A paragraph that fits stays whole. A longer one is cut into lines (a list) or sentences and repacked into pieces of at most `room`.
function breakUp(paragraph, room) {
  if (paragraph.length <= room) return [paragraph];
  const glue = paragraph.includes('\n') ? '\n' : ' ';
  const units = paragraph.split(glue === '\n' ? '\n' : /(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ¿¡«(])/).flatMap((unit) => cutWords(unit, room));
  const pieces = [];
  let current = '';
  for (const unit of units) {
    const next = current ? `${current}${glue}${unit}` : unit;
    if (next.length <= room) {
      current = next;
    } else {
      pieces.push(current);
      current = unit;
    }
  }
  return current ? [...pieces, current] : pieces;
}

function paginate(paragraphs, footer, maxChars) {
  const room = Math.max(200, maxChars - footer.length - 2);
  const parts = [];
  let current = '';
  for (const piece of paragraphs.flatMap((paragraph) => breakUp(paragraph, room))) {
    const next = current ? `${current}\n\n${piece}` : piece;
    if (next.length <= room) {
      current = next;
    } else {
      parts.push(current);
      current = piece;
    }
  }
  if (current) parts.push(current);
  return parts.map((body) => `${body}\n\n${footer}`);
}

/**
 * @param {object} facts `explainFacts(...)`.
 * @param {{ maxChars?: number }} [options]
 * @returns {{ parts: string[], followUps: string[] }} `parts` are the messages, each at most `maxChars` characters and each with
 *   the source footer; `followUps` are at most two related topics. A status with no template shows the "under review" text, which
 *   is always safe: it has no figure and no footer.
 */
export function renderExplain(facts, { maxChars = MAX_PART } = {}) {
  if (facts.status === 'not_applicable') return { parts: [NOT_APPLICABLE_TEXT[facts.debt && facts.debt.kind] || UNDER_REVIEW_TEXT], followUps: [] };
  const template = TEMPLATES[facts.topic];
  if (!template || (facts.status !== 'ok' && facts.status !== 'generic')) return { parts: [UNDER_REVIEW_TEXT], followUps: [] };
  const paragraphs = template(facts)
    .flatMap((paragraph) => paragraph.split('\n\n'))
    .filter((paragraph) => paragraph !== '');
  return { parts: paginate(paragraphs, sourceLine(facts), maxChars), followUps: FOLLOW_UPS[facts.topic] };
}

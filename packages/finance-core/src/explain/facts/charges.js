import { evaluateCharges } from '../../charges.js';
import { pesosText, percentText } from '../format.js';

// Facts of `charges` (spec: Charges topic): the charge lines of the next installment by kind, the sum over the next 12
// installments (approximate), the tax lines that point at the charge they tax, and the GMF example from the core. Without
// a loan the facts are generic and carry the examples only: GMF and IVA, both computed with `evaluateCharges`. A card has
// its own charge lines (S2), so it gets the generic answer for now. Pure and read-only.

const GMF_RATE_PCT = 0.4; // 4x1000 (Estatuto Tributario)
const GMF_EXAMPLE_BASE_MINOR = 400000;
const IVA_PCT = 19;
const IVA_EXAMPLE_FEE_MINOR = 10000;
const YEAR_ROWS = 12;
const MAX_LINES = 6;
const MAX_LABEL = 40;

const ONE_PERIOD = { period: 1, openingMinor: 0, installmentMinor: 0, originalMinor: 0, periodsPerYear: 12, unit: 1 };

function examples(withIva) {
  const gmf = evaluateCharges([{ id: 'gmf', kind: 'tax', label: 'GMF', basis: 'pctOfSubtotal', value: GMF_RATE_PCT }], { ...ONE_PERIOD, installmentMinor: GMF_EXAMPLE_BASE_MINOR }).taxesMinor;
  const numbers = { gmfRate: GMF_RATE_PCT, gmfBase: GMF_EXAMPLE_BASE_MINOR, gmf };
  const text = { gmfRate: percentText(GMF_RATE_PCT), gmfBase: pesosText(GMF_EXAMPLE_BASE_MINOR), gmf: pesosText(gmf) };
  if (withIva) {
    const fee = { id: 'fee', kind: 'fee', label: 'Comisión', basis: 'fixed', value: IVA_EXAMPLE_FEE_MINOR };
    const tax = { id: 'iva', kind: 'tax', label: 'IVA', basis: 'pctOfCharge', refId: 'fee', value: IVA_PCT };
    const iva = evaluateCharges([fee, tax], ONE_PERIOD).taxesMinor;
    Object.assign(numbers, { ivaPct: IVA_PCT, ivaBase: IVA_EXAMPLE_FEE_MINOR, iva });
    Object.assign(text, { ivaPct: percentText(IVA_PCT), ivaBase: pesosText(IVA_EXAMPLE_FEE_MINOR), iva: pesosText(iva) });
  }
  return { numbers, text };
}

function lineFacts(line, index, termsCharges) {
  const charge = termsCharges.find((item) => item.id === line.id) || {};
  const key = `l${index}`;
  const text = { [`${key}.label`]: String(line.label).slice(0, MAX_LABEL), [`${key}.kind`]: line.kind, [`${key}.amount`]: pesosText(line.amountMinor) };
  if (charge.basis) text[`${key}.basis`] = charge.basis;
  if (typeof charge.value === 'number' && charge.basis && charge.basis !== 'fixed') text[`${key}.pct`] = percentText(charge.value);
  if (charge.basis === 'pctOfCharge') {
    const target = termsCharges.find((item) => item.id === charge.refId);
    if (target) text[`${key}.ref`] = String(target.label || target.id).slice(0, MAX_LABEL);
  }
  return { numbers: { [key]: line.amountMinor }, text };
}

export function chargesFacts({ projection }) {
  if (!projection || projection.card) return { status: 'generic', ...examples(true) };
  const index = projection.plan.findIndex((row) => row.status !== 'paid');
  const next = index < 0 ? null : projection.plan[index];
  const lines = next ? next.charges : [];
  const shown = lines.slice(0, MAX_LINES);
  const result = { status: 'ok', dataSource: 'debt', ...examples(false), approximate: [], notices: [] };
  result.numbers.lines = shown.length;
  if (lines.length > shown.length) result.numbers.hidden = lines.length - shown.length;
  shown.forEach((line, position) => {
    const part = lineFacts(line, position, projection.terms.charges || []);
    Object.assign(result.numbers, part.numbers);
    Object.assign(result.text, part.text);
  });
  if (shown.length === 0) {
    result.notices.push({ code: 'no_charges' });
    return result;
  }
  const rows = projection.plan.slice(index, index + YEAR_ROWS);
  result.numbers.yearRows = rows.length;
  result.numbers.yearTotal = rows.reduce((sum, row) => sum + row.chargesMinor + row.taxesMinor, 0);
  result.text.yearRows = String(rows.length);
  result.text.yearTotal = pesosText(result.numbers.yearTotal);
  result.approximate.push('yearTotal');
  return result;
}

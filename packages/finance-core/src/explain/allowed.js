// The texts a rendered explanation may print numbers from (design G1): the pre-formatted figures of the facts, the reviewed
// copy texts, the source labels and the debt name (the footer prints it). The numeric guard of Nia and the property test of
// the renderer read their allowed numbers from these. Pure and Node 16 safe.

/**
 * @param {{ text?: object, copy?: string[], sources?: { label: string }[], debt?: ({ name: string } | null) }} facts
 *   `explainFacts(...)`.
 * @returns {string[]}
 */
export function allowedTexts(facts) {
  const labels = (facts.sources || []).map((source) => source.label);
  const name = facts.debt && facts.debt.name ? [facts.debt.name] : [];
  return [...Object.values(facts.text || {}), ...(facts.copy || []), ...labels, ...name];
}

// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { MENTIONS } from '../extract.js';
import { NOT_YET, unsupportedText } from './unsupported.js';

describe('unsupportedText', () => {
  it('explains each field in its own words and answers «no soportado aún» without pretending it was saved', () => {
    expect(NOT_YET).toBe('no soportado aún');
    const expected = { card_limit: 'cupo', advance_rate: 'avances', prepayment_penalty: 'penalización', allocation_order: 'orden', mora_base: 'mora' };

    for (const code of MENTIONS) {
      const text = unsupportedText([code]);
      expect(text).toContain('no soportado aún');
      expect(text.toLowerCase()).toContain(expected[code]);
      expect(text).toMatch(/no (lo |la )?guardo|sigo|se sigue/i);
      expect(text).not.toMatch(/guardé|registré|listo/i);
    }
  });

  it('lists several mentions in the catalogue order, one line each, and ignores what it does not know', () => {
    const text = unsupportedText(['mora_base', 'card_limit', 'nada']);
    const lines = text.split('\n');

    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('cupo');
    expect(lines[1]).toContain('mora');
  });

  it('is empty when there is nothing unsupported', () => {
    expect(unsupportedText([])).toBe('');
    expect(unsupportedText(undefined)).toBe('');
  });
});

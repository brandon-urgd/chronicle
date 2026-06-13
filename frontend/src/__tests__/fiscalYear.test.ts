import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { getFiscalYear, getFiscalQuarter } from '../utils/fiscalYear';

/**
 * Property 3: Fiscal year calculator consistency
 * Generate random dates and start months (1–12) via fast-check,
 * verify getFiscalYear and getFiscalQuarter match expected formula.
 *
 * **Validates: Requirements 6.1, 6.2**
 */
describe('Property 3: Fiscal year calculator consistency', () => {
  /* Arbitrary for a valid Date + startMonth pair */
  const dateArb = fc.date({
    min: new Date(2000, 0, 1),
    max: new Date(2099, 11, 31),
  });
  const startMonthArb = fc.integer({ min: 1, max: 12 });

  it('getFiscalYear matches expected formula: year if month >= startMonth, else year - 1', () => {
    fc.assert(
      fc.property(dateArb, startMonthArb, (date, startMonth) => {
        const month = date.getMonth() + 1; // 1-indexed
        const expectedFY = month >= startMonth ? date.getFullYear() : date.getFullYear() - 1;
        expect(getFiscalYear(date, startMonth)).toBe(expectedFY);
      }),
      { numRuns: 500 }
    );
  });

  it('getFiscalQuarter matches expected formula: floor(((month - startMonth + 12) % 12) / 3) + 1', () => {
    fc.assert(
      fc.property(dateArb, startMonthArb, (date, startMonth) => {
        const month = date.getMonth() + 1;
        const monthsIntoFY = ((month - startMonth) % 12 + 12) % 12;
        const expectedQ = Math.floor(monthsIntoFY / 3) + 1;
        expect(getFiscalQuarter(date, startMonth)).toBe(expectedQ);
      }),
      { numRuns: 500 }
    );
  });

  it('fiscal quarter is always between 1 and 4', () => {
    fc.assert(
      fc.property(dateArb, startMonthArb, (date, startMonth) => {
        fc.pre(!isNaN(date.getTime()));
        const q = getFiscalQuarter(date, startMonth);
        expect(q).toBeGreaterThanOrEqual(1);
        expect(q).toBeLessThanOrEqual(4);
      }),
      { numRuns: 500 }
    );
  });

  it('fiscal year is consistent: same month/year always produces same FY', () => {
    fc.assert(
      fc.property(startMonthArb, fc.integer({ min: 2000, max: 2099 }), fc.integer({ min: 0, max: 11 }), (startMonth, year, monthIdx) => {
        const d1 = new Date(year, monthIdx, 1);
        const d2 = new Date(year, monthIdx, 15);
        expect(getFiscalYear(d1, startMonth)).toBe(getFiscalYear(d2, startMonth));
        expect(getFiscalQuarter(d1, startMonth)).toBe(getFiscalQuarter(d2, startMonth));
      }),
      { numRuns: 300 }
    );
  });
});

import { VmiLanguage } from '../types/vmi.types';
import { calculateVmiScore } from './vmi-scoring.util';

describe('calculateVmiScore', () => {
  it.each([[0, 'RED'], [49.9, 'RED'], [49.99, 'RED'], [50, 'YELLOW'],
    [74.9, 'YELLOW'], [74.99, 'YELLOW'], [75, 'GREEN'], [100, 'GREEN']] as const)(
    'classifies %s as %s using the unrounded score', (value, band) => {
      const result = calculateVmiScore({ technical: value, problemSolving: value, communication: value }, VmiLanguage.VI);
      expect(result.rawScore).toBeCloseTo(value, 10);
      expect(result.band).toBe(band);
      expect(result.disclaimer).toContain('không khẳng định xác suất trúng tuyển');
      expect(result.recommendation.length).toBeGreaterThan(0);
    });

  it('weights the three component scores independently', () => {
    const result = calculateVmiScore({ technical: 80, problemSolving: 50, communication: 20 }, VmiLanguage.EN);
    expect(result.rawScore).toBe(59);
    expect(result.band).toBe('YELLOW');
    expect(result.disclaimer).toContain('does not predict hiring');
  });

  it.each([[49.999, 'RED'], [74.999, 'YELLOW']] as const)('does not round %s before classification', (value, band) => {
    const result = calculateVmiScore({ technical: value, problemSolving: value, communication: value }, VmiLanguage.EN);
    expect(result.rawScore).toBeCloseTo(value, 10);
    expect(result.band).toBe(band);
  });

  it.each([-1, 101, NaN, Infinity])('rejects invalid component %s', value => {
    for (const key of ['technical', 'problemSolving', 'communication']) {
      expect(() => calculateVmiScore({ technical: 50, problemSolving: 50, communication: 50, [key]: value }, VmiLanguage.VI)).toThrow();
    }
  });
});

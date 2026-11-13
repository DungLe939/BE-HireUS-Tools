import { cvTechnologyTerms, guardedTranscript, wordEditRatio } from './transcript-refine.util';

describe('deterministic transcript guard', () => {
  afterEach(() => jest.restoreAllMocks());
  it('measures word substitution, insertion and deletion with original token denominator', () => {
    expect(wordEditRatio('a b c d', 'a x c d')).toBe(.25);
    expect(wordEditRatio('a b c d', 'a b c d e')).toBe(.25);
    expect(wordEditRatio('a b c d', 'a b d')).toBe(.25);
  });
  it('uses Unicode-aware spelling comparison', () => {
    expect(wordEditRatio('Dữ liệu, REDIS!', 'dữ liệu Redis')).toBe(0);
  });
  it('bounds length before quadratic word comparison and keeps empty input', () => {
    expect(guardedTranscript('', 'invented')).toBe('');
    const raw = 'a '.repeat(11000);
    expect(guardedTranscript(raw, 'a')).toBe(raw);
  });
  it('rejects shortening independently of word edits', () => {
    expect(guardedTranscript('a b c d e extraordinarylongword', 'a b c d e x')).toBe('a b c d e extraordinarylongword');
  });
  it('extracts whole technology names and never CV prose or partial words', () => {
    expect(cvTechnologyTerms('Private CV: Redis, NestJS, JavaScript, Next.js. Restart server.')).toEqual(['Redis', 'JavaScript', 'Next.js', 'NestJS']);
    expect(cvTechnologyTerms('JavaScript transactions requestor')).toEqual(['JavaScript']);
  });
});

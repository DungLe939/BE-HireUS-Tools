/** No content or configuration values may be logged by the refinement path. */
export function refineConfiguration() {
  const setting = (name: string, fallback: number, min: number, max: number) => {
    const raw = process.env[name];
    const value = raw === undefined ? fallback : Number(raw);
    if (raw?.trim() === '' || !Number.isFinite(value) || value < min || value > max) throw new Error('Invalid refinement configuration.');
    return value;
  };
  const timeoutMs = setting('VMI_REFINE_TIMEOUT_MS', 4000, 1, 60000);
  if (!Number.isInteger(timeoutMs)) throw new Error('Invalid refinement configuration.');
  const config = { timeoutMs,
    maxWordEditRatio: setting('VMI_REFINE_MAX_WORD_EDIT_RATIO', 0.35, 0, 1),
    minLengthRatio: setting('VMI_REFINE_MIN_LENGTH_RATIO', 0.7, 0.01, 1),
    maxLengthRatio: setting('VMI_REFINE_MAX_LENGTH_RATIO', 1.3, 1, 2) };
  return config;
}

export function wordEditRatio(raw: string, refined: string): number {
  const words = (text: string) => text.normalize('NFC').toLocaleLowerCase().match(/[\p{L}\p{N}+#]+/gu) ?? [];
  const a = words(raw), b = words(refined);
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row.push(Math.min(row[j - 1] + 1, previous[j] + 1, previous[j - 1] + Number(a[i - 1] !== b[j - 1])));
    previous = row;
  }
  return previous[b.length] / Math.max(1, a.length);
}

export function guardedTranscript(raw: string, candidate: unknown): string {
  if (typeof candidate !== 'string' || !candidate.trim() || !raw.trim() || raw.length > 20000 || candidate.length > 20000) return raw;
  const text = candidate.trim();
  if (/^[{["`]|```/.test(text)) return raw;
  const config = refineConfiguration();
  const ratio = Array.from(text).length / Array.from(raw).length;
  if (ratio < config.minLengthRatio || ratio > config.maxLengthRatio || wordEditRatio(raw, text) > config.maxWordEditRatio) return raw;
  return text;
}

/** Race bounds HTTP/body reads and non-cooperative fake/custom providers alike. */
export async function withRefineDeadline<T>(operation: () => Promise<T>, timeoutMs: number, onTimeout?: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([Promise.resolve().then(operation), new Promise<never>((_, reject) => {
      timer = setTimeout(() => { onTimeout?.(); reject(new Error('Refinement timeout.')); }, timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

export function cvTechnologyTerms(summary: string): string[] {
  // Only canonical names found verbatim; never forward arbitrary CV prose.
  const terms = ['PostgreSQL', 'Redis', 'cache', 'index', 'transaction', 'ACID', 'REST API', 'GraphQL', 'endpoint', 'query',
    'caching', 'CI/CD', 'GitHub Actions', 'Jest', 'coverage', 'unit test', 'pipeline', 'request', 'Backend', 'TypeScript',
    'JavaScript', 'Python', 'Java', 'React', 'Next.js', 'NestJS', 'Node.js', 'Docker', 'Kubernetes', 'MySQL', 'MongoDB', 'Git'];
  return terms.filter(term => new RegExp(`(?<![\\p{L}\\p{N}])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'iu').test(summary));
}

#!/usr/bin/env node
// Private offline evaluation: stdin JSON lines, stdout result JSON lines.
// After npm run build: node --env-file=.env scripts/eval-stt-refine.cjs
const { GeminiAiProvider } = require('../dist/vmi/providers/gemini-ai.provider');
const { wordEditRatio } = require('../dist/vmi/utils/transcript-refine.util');
const readline = require('node:readline');
const originalFetch = globalThis.fetch;
let observation;
globalThis.fetch = async (...args) => {
  observation.called = true;
  try {
    const response = await originalFetch(...args);
    observation.status = response.status;
    if (response.ok) {
      try {
        const body = await response.clone().json();
        const candidate = body.candidates?.[0];
        if (candidate?.finishReason === 'STOP') observation.candidate = candidate.content.parts.filter(p => !p.thought).map(p => p.text).join('');
        else observation.invalid = true;
      } catch { observation.invalid = true; }
    }
    return response;
  } catch {
    observation.networkError = true;
    throw new Error('Evaluation transport failed.');
  }
};
(async () => {
  const provider = new GeminiAiProvider();
  for await (const line of readline.createInterface({ input: process.stdin })) {
    observation = { called: false };
    try {
      const input = JSON.parse(line);
      process.env.VMI_STT_REFINE_ENABLED = 'true';
      const began = performance.now();
      const text = await provider.refineTranscript(input);
      const latencyMs = performance.now() - began;
      const candidate = observation.candidate;
      const error = observation.networkError || observation.invalid || (observation.called && observation.status !== 200) ||
        (Boolean(input.rawText.trim()) && !observation.called) || (typeof candidate !== 'string' && Boolean(input.rawText.trim()));
      process.stdout.write(JSON.stringify({ text, latencyMs, status: observation.status ?? null, error: Boolean(error), configured: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_MODEL),
        rejected: typeof candidate === 'string' && candidate.trim() !== text && text === input.rawText,
        changed: text !== input.rawText, wordEditRatio: wordEditRatio(input.rawText, text),
        lengthRatio: input.rawText.length ? [...text].length / [...input.rawText].length : 1 }) + '\n');
    } catch { process.stdout.write(JSON.stringify({ error: true, status: null }) + '\n'); }
  }
})().catch(() => { process.exitCode = 1; });

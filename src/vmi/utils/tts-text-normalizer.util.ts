import { VmiLanguage } from '../types/vmi.types';

const digits = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];

function group(n: number, padded = false): string {
  const hundred = Math.floor(n / 100);
  const ten = Math.floor(n / 10) % 10;
  const unit = n % 10;
  const words: string[] = [];
  if (hundred || padded) words.push(digits[hundred], 'trăm');
  if (ten >= 2) words.push(digits[ten], 'mươi');
  else if (ten === 1) words.push('mười');
  else if (unit && (hundred || padded)) words.push('lẻ');
  if (unit) words.push(unit === 1 && ten >= 2 ? 'mốt' : unit === 5 && ten > 0 ? 'lăm' : digits[unit]);
  return words.join(' ');
}

function integer(raw: string): string {
  if (raw.length > 12 || (raw.length > 1 && raw.startsWith('0'))) return raw.split('').map(d => digits[Number(d)]).join(' ');
  let n = Number(raw);
  if (n === 0) return digits[0];
  const groups: number[] = [];
  while (n > 0) { groups.unshift(n % 1000); n = Math.floor(n / 1000); }
  return groups.flatMap((g, i) => g ? [group(g, i > 0 && g < 100), ['', 'nghìn', 'triệu', 'tỷ'][groups.length - i - 1]] : []).join(' ').trim();
}

// URL, labelled versions, semver suffixes, dates and IPv4 are opaque to TTS edits.
const protectedTokens = /(?:[a-z][a-z0-9+.-]*:\/\/|www\.)[^\s<>]+|(?:version|phiên bản)\s+v?\d+(?:\.\d+)+(?:[-+][\w.-]+)?|\bv\d+(?:\.\d+)+(?:[-+][\w.-]+)?|\b\d+\.\d+\.\d+(?:-[\w.-]+(?:\+[\w.-]+)?|\+[\w.-]+)|\b(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})\b|\b(?:\d{1,3}\.){3}\d{1,3}\b/giu;

function normalizeSegment(text: string, language: VmiLanguage): string {
  let value = text.replace(/(?<![\p{L}\p{N}_./:-])\d(?:[\d.,]*\d)?(?![\p{L}\p{N}_/:-]|[.,]\d)/gu, raw => {
    if (language === VmiLanguage.EN) {
      return /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(raw) ? raw.replace(/,/g, '') : raw;
    }
    let whole: string;
    let fraction: string | undefined;
    if (/^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(raw)) {
      [whole, fraction] = raw.split(','); whole = whole.replace(/\./g, '');
    } else if (/^\d+(?:,\d+)?$/.test(raw)) {
      [whole, fraction] = raw.split(',');
    } else if (/^\d+\.\d+$/.test(raw)) {
      [whole, fraction] = raw.split('.');
    } else return raw;
    if (whole.length > 12) return raw;
    return integer(whole) + (fraction ? ' phẩy ' + fraction.split('').map(d => digits[Number(d)]).join(' ') : '');
  });
  if (language === VmiLanguage.EN) return value;
  const terms: Record<string, string> = { 'REST API': 'rét ây pi ai', 'API': 'ây pi ai', 'SQL': 'ét kiu eo',
    'CI/CD': 'xi ai xi đi', 'HTTP': 'hát tê tê pê', 'HTTPS': 'hát tê tê pê ét', 'OOP': 'âu âu pi', 'CPU': 'xi pi iu' };
  value = value.replace(/\b(?:REST\s+API|CI\/CD|HTTPS|HTTP|API|SQL|OOP|CPU)\b/gi, term => terms[term.toUpperCase().replace(/\s+/g, ' ')]);
  return value.replace(/%/g, ' phần trăm ').replace(/&/g, ' và ').replace(/\+/g, ' cộng ');
}

/** A pronunciation copy only; saved questions and answers never change. */
export function normalizeTtsText(text: string, language: VmiLanguage): string {
  const value = text.normalize('NFC').replace(/\s+/gu, ' ').trim();
  const parts: string[] = [];
  let offset = 0;
  for (const match of value.matchAll(protectedTokens)) {
    parts.push(normalizeSegment(value.slice(offset, match.index), language));
    const token = match[0];
    const ipv4 = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(token);
    parts.push(ipv4 && token.split('.').some(n => Number(n) > 255) ? normalizeSegment(token, language) : token);
    offset = match.index + token.length;
  }
  parts.push(normalizeSegment(value.slice(offset), language));
  return parts.join('').replace(/\s+/gu, ' ').trim();
}

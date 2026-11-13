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

/** A small pronunciation aid, never applied to stored questions or answers. */
export function normalizeTtsText(text: string, language: VmiLanguage): string {
  let value = text.normalize('NFC').replace(/\s+/gu, ' ').trim();
  if (language !== VmiLanguage.VI) return value;
  const terms: Record<string, string> = { 'REST API': 'rét ây pi ai', 'API': 'ây pi ai', 'SQL': 'ét kiu eo',
    'CI/CD': 'xi ai xi đi', 'HTTP': 'hát tê tê pê', 'HTTPS': 'hát tê tê pê ét', 'OOP': 'âu âu pi', 'CPU': 'xi pi iu' };
  value = value.replace(/\b(?:REST\s+API|CI\/CD|HTTPS|HTTP|API|SQL|OOP|CPU)\b/gi, term => terms[term.toUpperCase().replace(/\s+/g, ' ')]);
  value = value.replace(/%/g, ' phần trăm ').replace(/&/g, ' và ').replace(/\+/g, ' cộng ');
  // Avoid rewriting identifiers, versions (1.2.3), dates, URLs and code-like tokens.
  value = value.replace(/(?<![\p{L}\p{N}_./:-])\d{1,12}(?:[.,]\d+)?(?![\p{L}\p{N}_./:-])/gu, number => {
    const [whole, fraction] = number.split(/[.,]/);
    return integer(whole) + (fraction ? ' phẩy ' + fraction.split('').map(d => digits[Number(d)]).join(' ') : '');
  });
  return value.replace(/\s+/gu, ' ').trim();
}

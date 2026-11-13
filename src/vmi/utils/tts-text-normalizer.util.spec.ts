import { normalizeTtsText } from './tts-text-normalizer.util';
import { VmiLanguage } from '../types/vmi.types';

describe('TTS pronunciation aid', () => {
  it.each([
    ['REST API và SQL, CI/CD', 'rét ây pi ai và ét kiu eo, xi ai xi đi'],
    ['HTTP HTTPS OOP CPU', 'hát tê tê pê hát tê tê pê ét âu âu pi xi pi iu'],
    ['0 5 10 15 21 25 105', 'không năm mười mười lăm hai mươi mốt hai mươi lăm một trăm lẻ năm'],
    ['1000 1001 1000000 1000000000', 'một nghìn một nghìn không trăm lẻ một một triệu một tỷ'],
    ['50% & 3+2', 'năm mươi phần trăm và ba cộng hai'],
    ['3.14 2,5', 'ba phẩy một bốn hai phẩy năm'],
    ['007', 'không không bảy'],
    ['RESTful PostgreSQL v1.2.3 2026/11/13', 'RESTful PostgreSQL v1.2.3 2026/11/13'],
    ['Tiếng Việt\n có dấu', 'Tiếng Việt có dấu'],
  ])('normalizes %s for vi without changing unrelated terms', (input, output) => {
    expect(normalizeTtsText(input, VmiLanguage.VI)).toBe(output);
  });
  it('leaves English numbers and technical terms for native NeMo normalization', () => {
    expect(normalizeTtsText('REST API 50%\n SQL', VmiLanguage.EN)).toBe('REST API 50% SQL');
  });
});

describe('language-specific numeric punctuation and protected tokens', () => {
  it.each([
    ['10.000', 'mười nghìn'], ['Có 10.000.', 'Có mười nghìn.'], ['1.250.000', 'một triệu hai trăm năm mươi nghìn'],
    ['2.500', 'hai nghìn năm trăm'], ['1.5', 'một phẩy năm'],
    ['3,5', 'ba phẩy năm'], ['10,000', 'mười phẩy không không không'],
    ['1.250,75', 'một nghìn hai trăm năm mươi phẩy bảy năm'],
    ['999.999.999.999', 'chín trăm chín mươi chín tỷ chín trăm chín mươi chín triệu chín trăm chín mươi chín nghìn chín trăm chín mươi chín'],
    ['0,005', 'không phẩy không không năm'], ['1.000.000.000.000', '1.000.000.000.000'],
    ['12.34.567', '12.34.567'], ['2.500%', 'hai nghìn năm trăm phần trăm'],
    ['1.000.5', '1.000.5'], ['12.34.56', '12.34.56'], ['-5', '-5'],
    ['1.300.000.000.000', '1.300.000.000.000'],
  ])('reads Vietnamese %s consistently', (input, expected) => {
    expect(normalizeTtsText(input, VmiLanguage.VI)).toBe(expected);
  });
  it.each([
    ['10,000', '10000'], ['1,250,000.75', '1250000.75'], ['3.5', '3.5'],
    ['1,25', '1,25'], ['999,999,999,999', '999999999999'],
  ])('canonicalizes English %s for native number normalization', (input, expected) => {
    expect(normalizeTtsText(input, VmiLanguage.EN)).toBe(expected);
  });
  it.each([
    'https://example.com/v1.2.3?q=10.000&rate=3,5#SQL', 'www.example.com/10,000',
    'v1.2.3', '1.2.3-rc.1+build.25', 'version 1.250.123', 'phiên bản 2.500.100',
    '2026-11-13', '13/11/2026', '13.11.2026', '192.168.1.1', '192.168.100.100',
    'a10.000 a_10.000 10.000ms',
  ])('preserves URL/version/date/IP/identifier %s', input => {
    for (const language of [VmiLanguage.VI, VmiLanguage.EN]) expect(normalizeTtsText(input, language)).toBe(input);
  });
});

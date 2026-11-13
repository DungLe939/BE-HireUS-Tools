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

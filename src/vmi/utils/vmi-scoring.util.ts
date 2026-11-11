import { VmiLanguage } from '../types/vmi.types';
import type { VmiReport } from '../types/vmi.types';

export function calculateVmiScore(scores: { technical: number; problemSolving: number; communication: number }, language: VmiLanguage): {
  rawScore: number; band: VmiReport['band']; recommendation: string; disclaimer: string;
} {
  for (const value of [scores.technical, scores.problemSolving, scores.communication]) {
    if (!Number.isFinite(value) || value < 0 || value > 100) throw new RangeError('Invalid component score.');
  }
  const rawScore = scores.technical * 0.5 + scores.problemSolving * 0.3 + scores.communication * 0.2;
  const band = rawScore < 50 ? 'RED' : rawScore < 75 ? 'YELLOW' : 'GREEN';
  const recommendations = language === VmiLanguage.VI ? {
    RED: 'Ôn tập lại khái niệm kỹ thuật cốt lõi và luyện bộ câu hỏi cơ bản trước khi phỏng vấn thực tế.',
    YELLOW: 'Rà soát chi tiết dự án trong CV và rèn luyện kỹ năng tóm tắt câu trả lời súc tích hơn.',
    GREEN: 'Thể hiện kiến thức vững và phản xạ giao tiếp tốt; sẵn sàng tham gia phỏng vấn kỹ thuật tại doanh nghiệp.',
  } : {
    RED: 'Review core technical concepts and practice basic interview questions before real interviews.',
    YELLOW: 'Review project details in your CV and practice concise answers.',
    GREEN: 'Shows solid knowledge and communication; ready to practice technical interviews with employers.',
  };
  return {
    rawScore, band,
    recommendation: recommendations[band],
    disclaimer: language === VmiLanguage.VI
      ? 'Kết quả chỉ mang tính chất tham khảo rèn luyện, không khẳng định xác suất trúng tuyển thực tế.'
      : 'This result is for training guidance only and does not predict hiring probability or guarantee recruitment outcomes.',
  };
}

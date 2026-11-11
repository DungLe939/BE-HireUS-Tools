export enum VmiPosition {
  FRONTEND = 'FRONTEND',
  BACKEND = 'BACKEND',
  FULLSTACK = 'FULLSTACK',
  MOBILE = 'MOBILE',
  AI_DATA = 'AI_DATA',
}

export enum VmiLevel {
  INTERN = 'INTERN',
  FRESHER = 'FRESHER',
}

export enum VmiLanguage {
  VI = 'vi',
  EN = 'en',
}

export enum VmiSessionStatus {
  SETUP = 'SETUP',
  IN_PROGRESS = 'IN_PROGRESS',
  ENDED = 'ENDED',
  EVALUATED = 'EVALUATED',
  REPORT_FAILED = 'REPORT_FAILED',
}

export enum VmiStage {
  OPENING = 'OPENING',
  TECHNICAL = 'TECHNICAL',
  CLOSING = 'CLOSING',
}

export interface CvSummary {
  id: string;
  summary: string;
}

export interface VmiTurn {
  questionId: string;
  questionText: string;
  stage: VmiStage;
  askedAt?: Date;
  answerText?: string;
  answeredAt?: Date;
  elapsedSeconds?: number;
  timedOut?: boolean;
}

export interface VmiReport {
  technical: number;
  problemSolving: number;
  communication: number;
  overallScore: number;
  band: 'RED' | 'YELLOW' | 'GREEN';
  strengths: string[];
  knowledgeGaps: string[];
  suggestedAnswers: string[];
  reviewTopics: string[];
  recommendation: string;
  disclaimer: string;
  createdAt: Date;
}

export interface VmiSession {
  id: string;
  userId: string;
  position: VmiPosition;
  level: VmiLevel;
  language: VmiLanguage;
  status: VmiSessionStatus;
  targetQuestionCount: number;
  cvId?: string;
  cvSnapshot?: CvSummary;
  turns: VmiTurn[];
  report?: VmiReport;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  endedAt?: Date;
}

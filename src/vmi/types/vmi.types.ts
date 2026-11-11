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

export interface InitInterviewContextInput {
  position: VmiPosition;
  level: VmiLevel;
  language: VmiLanguage;
  cvSnapshot?: CvSummary;
  /** Defaults to six questions when omitted. */
  targetQuestionCount?: number;
}

export interface VmiPlannedQuestion {
  stage: VmiStage;
  questionText: string;
  cvBased: boolean;
}

export interface InitInterviewContextOutput {
  context: string;
  questionPlan: VmiPlannedQuestion[];
  openingQuestion: VmiPlannedQuestion;
}

export interface GenerateNextQuestionInput extends InitInterviewContextInput {
  context: string;
  questionPlan: VmiPlannedQuestion[];
  transcript: VmiTurn[];
  nextQuestionIndex: number;
  stage: VmiStage;
  requireCvBased: boolean;
}

export interface EvaluateInterviewInput extends InitInterviewContextInput {
  context: string;
  questionPlan: VmiPlannedQuestion[];
  transcript: VmiTurn[];
}

export type EvaluateInterviewOutput = Pick<VmiReport,
  'technical' | 'problemSolving' | 'communication' | 'strengths' |
  'knowledgeGaps' | 'suggestedAnswers' | 'reviewTopics'>;

export interface VmiTurn {
  questionId: string;
  questionText: string;
  stage: VmiStage;
  askedAt?: Date;
  answerText?: string;
  answeredAt?: Date;
  elapsedSeconds?: number;
  timedOut?: boolean;
  cvBased?: boolean;
}

export interface VmiReport {
  technical: number;
  problemSolving: number;
  communication: number;
  /** Stored without rounding; only API responses round this value. */
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
  context?: string;
  questionPlan?: VmiPlannedQuestion[];
  pendingNextQuestion: boolean;
  lastAiError?: string;
  cvId?: string;
  cvSnapshot?: CvSummary;
  turns: VmiTurn[];
  report?: VmiReport;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  endedAt?: Date;
}

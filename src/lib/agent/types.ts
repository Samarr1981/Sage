export type AnswerQuality = 'strong' | 'medium' | 'weak';

export type InterviewType = 'behavioral' | 'technical' | 'mixed';

export type ExperienceLevel = 'junior' | 'mid-level' | 'senior';

export type AgentPhase =
  | 'idle'
  | 'generating_question'
  | 'speaking'
  | 'listening'
  | 'evaluating'
  | 'deciding'
  | 'concluding'
  | 'complete';

export interface TopicArea {
  id: string;
  name: string;
  covered: boolean;
  score: number | null;
  questionCount: number;
}

export interface ExchangeRecord {
  areaId: string;
  question: string;
  answer: string;
  quality: AnswerQuality;
  feedback: string;
  timestamp: number;
}

export interface WeakMoment {
  question: string;
  answer: string;
  whyWeak: string;
  howToImprove: string;
}

export interface FinalEvaluation {
  summary: string;
  areaScores: {
    areaName: string;
    score: number;
    feedback: string;
  }[];
  strengths: string[];
  weakMoments: WeakMoment[];
  areasForImprovement: string[];
  overallScore: number;
  readinessRating: string;
  recommendation: string;
}

export interface ExaminerState {
  topic: string;
  role: string;
  experienceLevel: ExperienceLevel;
  interviewType: InterviewType;
  sessionId: string;
  topicAreas: TopicArea[];
  currentAreaIndex: number;
  currentQuestion: string;
  currentAnswer: string;
  currentQuality: AnswerQuality | null;
  currentFeedback: string;
  exchanges: ExchangeRecord[];
  phase: AgentPhase;
  nextNode: string;
  followUpCount: number;
  finalEvaluation: FinalEvaluation | null;
  overallScore: number | null;
  error: string | null;
}
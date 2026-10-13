// SPDX-License-Identifier: MIT
/** Agent-neutral questions. Creating a question never pauses the conversation. */
export interface UserQuestion {
  id: string;
  question: string;
  options: { label: string; description: string }[];
  isSecret: boolean;
}

export type QuestionAnswers = Record<string, string[]>;
/** Durable history projection, independent of the runtime's pending request list. */
export interface MessageQuestion {
  id: string;
  source: 'coding' | 'conversation';
  title: string;
  details?: string;
  /** Original native prose, available for review without repeating its options. */
  sourceText?: string;
  questions: UserQuestion[];
  blocking: boolean;
  canSkip?: boolean;
  status: 'pending' | 'submitted' | 'answered' | 'skipped' | 'expired' | 'failed' | 'uncertain';
  answerMessageId?: string;
  answers?: QuestionAnswers;
  error?: string;
}
/** User-visible answer receipt. Native coding answers are never inbox deliveries. */
export interface MessageQuestionAnswer {
  requestId: string;
  source: 'coding' | 'conversation';
  title: string;
  questions: UserQuestion[];
  answers: QuestionAnswers;
  questionMessageId?: string;
  questionMessageSeq?: number;
  status: 'submitting' | 'received' | 'failed' | 'uncertain';
  error?: string;
}
export interface ConversationQuestion {
  id: string;
  conversationId: string;
  title: string;
  questions: UserQuestion[];
  status: 'pending' | 'answered' | 'skipped' | 'expired';
  createdAt: string;
  answerMessageId?: string;
  answers?: QuestionAnswers;
}

/** The UI shares this shape with native runtime questions; transport stays separate. */
export interface PendingQuestion {
  id: string;
  title: string;
  questions: UserQuestion[];
  details?: string;
  submitting: boolean;
  submitted?: boolean;
  error?: string | null;
  unavailableReason?: string | null;
  canSkip: boolean;
}

// SPDX-License-Identifier: MIT
/** Agent-neutral questions. Creating a question never pauses the conversation. */
export interface UserQuestion {
  id: string;
  question: string;
  options: { label: string; description: string }[];
  isSecret: boolean;
}

export type QuestionAnswers = Record<string, string[]>;
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

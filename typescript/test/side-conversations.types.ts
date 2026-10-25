import type { SideExchange, SideLease, SideResult, SideView } from '../contracts/side-conversations.js';
const identity = { generation: 'generation', sessionId: 'side', requestId: 'request', action: 'ask' as const };
const legacy: SideResult = { ...identity, status: 'completed', answer: 'complete' };
const running: SideResult = { ...identity, status: 'running', sequence: 1, answer: 'partial', model: 'native-model' };
const completed: SideResult = { ...identity, status: 'completed', sequence: 2, answer: 'complete', model: 'native-model' };
const exchange: SideExchange = { id: 'request', question: 'question', answer: 'partial', status: 'running', sequence: 1, model: 'native-model' };
const lease: SideLease = { generation: 'generation', commands: [], liveIds: [], resultSnapshots: true };
const view: SideView = { generation: 'generation', revision: 2, session: { id: 'side', conversationId: 'conversation', mode: 'codex-ephemeral', status: 'open', exchanges: [exchange], model: 'native-model' } };
void [legacy, running, completed, lease, view];

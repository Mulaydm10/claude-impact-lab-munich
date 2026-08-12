import { getTopic } from '../data/index.js';

let msgCounter = 0;
function nextId() {
  msgCounter += 1;
  return `m${msgCounter}`;
}

function pushMessage(messages, role, text) {
  return [...messages, { id: nextId(), role, text }];
}

export const initialState = {
  stage: 'awaiting_topic',
  topicId: null,
  answers: {},
  chatMessages: [
    { id: nextId(), role: 'assistant', text: 'Tell me a research topic, or pick one below.' },
  ],
  report: null,
  overrides: [],
  drawer: { open: false, sourceId: null },
  lastActor: '',
};

export function trustReducer(state, action) {
  switch (action.type) {
    case 'SELECT_TOPIC': {
      const topic = getTopic(action.topicId);
      if (!topic) return state;
      let messages = pushMessage(state.chatMessages, 'user', topic.title);
      messages = pushMessage(messages, 'assistant', topic.clarifyingQuestions[0].prompt);
      return {
        ...state,
        topicId: action.topicId,
        answers: {},
        report: null,
        stage: 'asking_q1',
        chatMessages: messages,
      };
    }

    case 'ANSWER_Q1': {
      const topic = getTopic(state.topicId);
      if (!topic) return state;
      const q1 = topic.clarifyingQuestions[0];
      const option = q1.options.find((o) => o.id === action.optionId);
      let messages = pushMessage(state.chatMessages, 'user', option.label);
      const q2 = topic.clarifyingQuestions[1];
      messages = pushMessage(messages, 'assistant', q2.prompt);
      return {
        ...state,
        answers: { ...state.answers, [q1.id]: action.optionId },
        stage: 'asking_q2',
        chatMessages: messages,
      };
    }

    case 'ANSWER_Q2': {
      const topic = getTopic(state.topicId);
      if (!topic) return state;
      const q2 = topic.clarifyingQuestions[1];
      const option = q2.options.find((o) => o.id === action.optionId);
      let messages = pushMessage(state.chatMessages, 'user', option.label);
      messages = pushMessage(messages, 'assistant', 'Researching…');
      return {
        ...state,
        answers: { ...state.answers, [q2.id]: action.optionId },
        stage: 'generating',
        chatMessages: messages,
      };
    }

    case 'REPORT_READY': {
      const messages = pushMessage(
        state.chatMessages,
        'assistant',
        "Here's what I found — check the trust rail on the right before you trust any of it.",
      );
      return { ...state, stage: 'done', report: action.report, chatMessages: messages };
    }

    case 'CHAT_FALLBACK': {
      const messages = pushMessage(
        state.chatMessages,
        'assistant',
        "I've got one scripted topic ready — pick it below:",
      );
      return { ...state, chatMessages: messages };
    }

    case 'RESET_CONVERSATION': {
      return {
        ...state,
        stage: 'awaiting_topic',
        topicId: null,
        answers: {},
        report: null,
        drawer: { open: false, sourceId: null },
        chatMessages: [
          { id: nextId(), role: 'assistant', text: 'Tell me a research topic, or pick one below.' },
        ],
        // overrides deliberately NOT cleared — ratings live on the source globally
      };
    }

    case 'OPEN_DRAWER':
      return { ...state, drawer: { open: true, sourceId: action.sourceId } };

    case 'CLOSE_DRAWER':
      return { ...state, drawer: { open: false, sourceId: null } };

    case 'RATE_SOURCE': {
      const override = {
        id: `ov${state.overrides.length + 1}`,
        sourceId: action.sourceId,
        band: action.band,
        actor: action.actor,
        reason: action.reason,
        timestamp: Date.now(),
      };
      return {
        ...state,
        overrides: [...state.overrides, override],
        lastActor: action.actor || state.lastActor,
      };
    }

    default:
      return state;
  }
}

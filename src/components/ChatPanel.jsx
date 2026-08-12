import { useEffect, useRef } from 'react';
import { useTrustStore } from '../store/TrustStoreContext.jsx';
import { getCurrentTopic } from '../store/selectors.js';
import { topics } from '../data/index.js';
import { generateReport } from '../lib/generateReport.js';

export default function ChatPanel() {
  const { state, dispatch } = useTrustStore();
  const topic = getCurrentTopic(state);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [state.chatMessages]);

  useEffect(() => {
    if (state.stage === 'generating' && topic) {
      const t = setTimeout(() => {
        const report = generateReport(topic, state.answers);
        dispatch({ type: 'REPORT_READY', report });
      }, 700);
      return () => clearTimeout(t);
    }
  }, [state.stage, topic, state.answers, dispatch]);

  function handleTextSubmit(e) {
    e.preventDefault();
    const input = e.target.elements.chatText;
    const text = input.value.trim().toLowerCase();
    input.value = '';
    if (!text || state.stage !== 'awaiting_topic') return;
    const match = topics.find((t) => t.matchKeywords.some((k) => text.includes(k)));
    if (match) {
      dispatch({ type: 'SELECT_TOPIC', topicId: match.id });
    } else {
      dispatch({ type: 'CHAT_FALLBACK' });
    }
  }

  return (
    <div className="chat-panel">
      <div className="chat-messages" ref={scrollRef}>
        {state.chatMessages.map((m) => (
          <div key={m.id} className={`chat-bubble ${m.role}`}>{m.text}</div>
        ))}

        {state.stage === 'awaiting_topic' && (
          <div className="chat-chips">
            {topics.map((t) => (
              <button key={t.id} className="chip" onClick={() => dispatch({ type: 'SELECT_TOPIC', topicId: t.id })}>
                {t.title}
              </button>
            ))}
          </div>
        )}

        {state.stage === 'asking_q1' && topic && (
          <div className="chat-chips">
            {topic.clarifyingQuestions[0].options.map((o) => (
              <button key={o.id} className="chip" onClick={() => dispatch({ type: 'ANSWER_Q1', optionId: o.id })}>
                {o.label}
              </button>
            ))}
          </div>
        )}

        {state.stage === 'asking_q2' && topic && (
          <div className="chat-chips">
            {topic.clarifyingQuestions[1].options.map((o) => (
              <button key={o.id} className="chip" onClick={() => dispatch({ type: 'ANSWER_Q2', optionId: o.id })}>
                {o.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <form className="chat-input-row" onSubmit={handleTextSubmit}>
        <input
          name="chatText"
          type="text"
          placeholder="Describe a research topic…"
          disabled={state.stage !== 'awaiting_topic'}
        />
        <button type="submit" disabled={state.stage !== 'awaiting_topic'}>Send</button>
      </form>

      {state.stage === 'done' && (
        <button className="chat-reset" onClick={() => dispatch({ type: 'RESET_CONVERSATION' })}>
          Start a new topic
        </button>
      )}
    </div>
  );
}

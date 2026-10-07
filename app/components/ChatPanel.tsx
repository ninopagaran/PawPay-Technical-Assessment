"use client";

import { useEffect, useRef, useState } from "react";
import { MAX_CHAT_MESSAGE_LENGTH } from "@/lib/types";

export interface ChatMessage {
  id: number;
  mine: boolean;
  text: string;
}

export default function ChatPanel({
  messages,
  connected,
  videoBusy,
  onSend,
  onStartVideo,
  onEnd,
}: {
  messages: ChatMessage[];
  connected: boolean;
  videoBusy: boolean;
  onSend: (text: string) => boolean;
  onStartVideo: () => void;
  onEnd: () => void;
}) {
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !connected) return;
    if (onSend(text)) setDraft("");
  }

  return (
    <aside className="chat-panel" aria-label="Conversation with a stranger">
      <header className="chat-header">
        <div className="chat-identity">
          <div className="chat-avatar" aria-hidden="true">
            <span />
          </div>
          <div>
            <p className="chat-kicker">Open frequency</p>
            <h2>Stranger</h2>
            <p className={`chat-status ${connected ? "is-connected" : ""}`}>
              <span aria-hidden="true" />
              {connected ? "Signal connected" : "Tuning the signal…"}
            </p>
          </div>
        </div>
        <div className="chat-header-actions">
          <button
            onClick={onStartVideo}
            disabled={!connected || videoBusy}
            className="chat-icon-button"
            aria-label={videoBusy ? "Video request in progress" : "Start video"}
            title={videoBusy ? "Video request in progress" : "Start video"}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M15 8.5 20 6v12l-5-2.5M4 6.75h11v10.5H4z" />
            </svg>
          </button>
          <button
            onClick={onEnd}
            className="chat-icon-button chat-end-button"
            aria-label="End conversation"
            title="End conversation"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6.6 14.9c3.55-2.15 7.25-2.15 10.8 0l1.6-2.8c-4.6-2.8-9.4-2.8-14 0z" />
              <path d="M7 14.8v3M17 14.8v3" />
            </svg>
          </button>
        </div>
      </header>

      <div className="chat-timeline" role="log" aria-live="polite">
        <div className="chat-session-marker">
          <span />
          <p>Connected for this moment only</p>
          <span />
        </div>

        {messages.length === 0 && (
          <div className="chat-empty">
            <div className="chat-empty-mark" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <h3>Break the silence.</h3>
            <p>
              Say hello to someone sharing the same night. Messages disappear
              when either of you leaves.
            </p>
          </div>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`chat-message-row ${m.mine ? "is-mine" : "is-theirs"}`}
          >
            <div className="chat-message">
              <span className="chat-message-label">
                {m.mine ? "You" : "Stranger"}
              </span>
              <p>{m.text}</p>
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <footer className="chat-composer-wrap">
        <form onSubmit={submit} className="chat-composer">
          <label htmlFor="chat-message" className="sr-only">
            Message to stranger
          </label>
          <input
            id="chat-message"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={MAX_CHAT_MESSAGE_LENGTH}
            placeholder={connected ? "Write into the night…" : "Connecting…"}
            disabled={!connected}
            autoComplete="off"
          />
          <button
            type="submit"
            disabled={!connected || !draft.trim()}
            aria-label="Send message"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m5 12 14-7-4.5 14-3-5.5z" />
              <path d="m11.5 13.5 3-3" />
            </svg>
          </button>
        </form>
        <div className="chat-composer-meta">
          <span>Peer to peer · Never stored</span>
          <span>{draft.length}/{MAX_CHAT_MESSAGE_LENGTH}</span>
        </div>
      </footer>
    </aside>
  );
}

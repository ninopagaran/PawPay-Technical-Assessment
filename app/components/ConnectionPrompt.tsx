"use client";

import { useEffect, useId, useRef } from "react";

// Reusable centered prompt for "someone wants to connect" and
// "someone wants to start video".
export default function ConnectionPrompt({
  title,
  subtitle,
  acceptLabel,
  declineLabel,
  onAccept,
  onDecline,
}: {
  title: string;
  subtitle?: string;
  acceptLabel: string;
  declineLabel: string;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const acceptRef = useRef<HTMLButtonElement>(null);
  const declineRef = useRef<HTMLButtonElement>(null);
  const onDeclineRef = useRef(onDecline);

  useEffect(() => {
    onDeclineRef.current = onDecline;
  });

  useEffect(() => {
    const previousFocus = document.activeElement;
    declineRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onDeclineRef.current();
        return;
      }

      if (event.key !== "Tab") return;
      const first = declineRef.current;
      const last = acceptRef.current;
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, []);

  return (
    <div className="connection-backdrop">
      <section
        className="connection-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <div className="connection-orbit" aria-hidden="true">
          <span className="connection-orbit-core" />
          <span className="connection-orbit-ring connection-orbit-ring-one" />
          <span className="connection-orbit-ring connection-orbit-ring-two" />
        </div>

        <p className="connection-kicker">Incoming signal</p>
        <h2 id={titleId}>{title}</h2>
        {subtitle && (
          <p id={descriptionId} className="connection-copy">
            {subtitle}
          </p>
        )}
        {!subtitle && (
          <p id={descriptionId} className="connection-copy">
            No name, no profile. Just someone reaching out right now.
          </p>
        )}

        <div className="connection-actions">
          <button
            ref={declineRef}
            type="button"
            onClick={onDecline}
            className="connection-button connection-button-secondary"
          >
            {declineLabel}
          </button>
          <button
            ref={acceptRef}
            type="button"
            onClick={onAccept}
            className="connection-button connection-button-primary"
          >
            <span>{acceptLabel}</span>
            <span aria-hidden="true">↗</span>
          </button>
        </div>

        <p className="connection-footnote">
          Press Esc to decline · Nothing is recorded
        </p>
      </section>
    </div>
  );
}

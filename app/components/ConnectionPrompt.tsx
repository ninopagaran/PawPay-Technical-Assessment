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
  const onDeclineRef = useRef(onDecline);

  useEffect(() => {
    onDeclineRef.current = onDecline;
  });

  useEffect(() => {
    acceptRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDeclineRef.current();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="connection-backdrop">
      <section
        className="connection-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? descriptionId : undefined}
      >
        <div className="connection-orbit" aria-hidden="true">
          <span className="connection-orbit-core" />
          <span className="connection-orbit-ring connection-orbit-ring-one" />
          <span className="connection-orbit-ring connection-orbit-ring-two" />
        </div>

        <p className="connection-kicker">Incoming signal</p>
        <h2 id={titleId}>{title}</h2>
        {subtitle && <p id={descriptionId} className="connection-copy">{subtitle}</p>}
        {!subtitle && (
          <p className="connection-copy">
            No name, no profile. Just someone reaching out right now.
          </p>
        )}

        <div className="connection-actions">
          <button
            onClick={onDecline}
            className="connection-button connection-button-secondary"
          >
            {declineLabel}
          </button>
          <button
            ref={acceptRef}
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

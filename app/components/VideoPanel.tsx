"use client";

import { useEffect, useRef } from "react";

export default function VideoPanel({
  localStream,
  remoteStream,
  onEnd,
}: {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  onEnd: () => void;
}) {
  const localRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (localRef.current && localRef.current.srcObject !== localStream) {
      localRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteRef.current && remoteRef.current.srcObject !== remoteStream) {
      remoteRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  return (
    <section className="video-stage" aria-label="Video call">
      <header className="video-header">
        <div className="wordmark wordmark-video">
          <span className="wordmark-signal" aria-hidden="true" />
          <span>Pulse</span>
        </div>
        <div className="video-live-state">
          <span aria-hidden="true" />
          Live with a stranger
        </div>
      </header>

      <div className="video-canvas">
        <video
          ref={remoteRef}
          autoPlay
          playsInline
          className="video-remote"
          aria-label="Stranger's video"
        />
        {!remoteStream && (
          <div className="video-waiting" role="status">
            <div className="video-waiting-signal" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <p>Waiting for their camera</p>
            <span>The conversation is still connected</span>
          </div>
        )}

        <div className="video-local-frame">
          <span className="video-local-label">You</span>
          <video
            ref={localRef}
            autoPlay
            playsInline
            muted
            className="video-local"
            aria-label="Your video"
          />
        </div>
      </div>

      <footer className="video-controls">
        <div className="video-control-note">
          <span>Encrypted peer connection</span>
          <small>Video never touches our server</small>
        </div>
        <button
          onClick={onEnd}
          className="video-end"
        >
          <span className="video-end-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M6.6 14.9c3.55-2.15 7.25-2.15 10.8 0l1.6-2.8c-4.6-2.8-9.4-2.8-14 0z" />
              <path d="M7 14.8v3M17 14.8v3" />
            </svg>
          </span>
          End video
        </button>
        <div className="video-control-note video-control-note-right">
          <span>Anonymous session</span>
          <small>Closing it leaves no history</small>
        </div>
      </footer>
    </section>
  );
}

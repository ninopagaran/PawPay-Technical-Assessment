"use client";

import { useEffect, useRef, useState } from "react";
import EntryGate from "./components/EntryGate";
import WorldMap from "./components/WorldMap";
import ConnectionPrompt from "./components/ConnectionPrompt";
import ChatPanel, { type ChatMessage } from "./components/ChatPanel";
import VideoPanel from "./components/VideoPanel";
import {
  join,
  leave,
  poll,
  PresenceExpiredError,
  sendSignal,
} from "@/lib/api";
import { PeerSession, type DescType, type PeerControl } from "@/lib/webrtc";
import { POLL_INTERVAL_MS } from "@/lib/presence";
import { type PeerDot, type SignalMsg } from "@/lib/types";
import {
  compareConversationSparkEvents,
  getConversationSpark,
  pickConversationSpark,
  type ConversationSparkEvent,
} from "@/lib/conversation-sparks";

type Conn =
  | { kind: "idle" }
  | { kind: "requesting"; peerId: string }
  | { kind: "incoming"; peerId: string }
  | { kind: "connecting"; peerId: string }
  | { kind: "connected"; peerId: string };

type VideoState = "none" | "requesting" | "incoming" | "active";
type SharedSpark = { event: ConversationSparkEvent; mine: boolean };

const REQUEST_TIMEOUT_MS = 30_000;
const CONNECTION_TIMEOUT_MS = 30_000;
const VIDEO_REQUEST_TIMEOUT_MS = 30_000;

export default function Home() {
  const [phase, setPhase] = useState<"gate" | "live">("gate");
  const [sessionId] = useState(() => crypto.randomUUID());
  const [sessionToken] = useState(() => crypto.randomUUID());
  const [peers, setPeers] = useState<PeerDot[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sharedSpark, setSharedSpark] = useState<SharedSpark | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [myLocation, setMyLocation] = useState<{ lat: number; lng: number } | null>(
    null,
  );

  const [conn, _setConn] = useState<Conn>({ kind: "idle" });
  const connRef = useRef<Conn>(conn);
  const setConn = (c: Conn) => {
    connRef.current = c;
    _setConn(c);
  };

  const [video, _setVideo] = useState<VideoState>("none");
  const videoRef = useRef<VideoState>(video);
  const setVideo = (v: VideoState) => {
    videoRef.current = v;
    _setVideo(v);
  };

  const peerRef = useRef<PeerSession | null>(null);
  const msgId = useRef(0);
  const requestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoRequestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollFailureCount = useRef(0);
  const sparkClock = useRef(0);

  function showNotice(text: string) {
    setNotice(text);
    window.setTimeout(() => setNotice(null), 3500);
  }

  function addMessage(mine: boolean, text: string) {
    setMessages((prev) => [...prev, { id: msgId.current++, mine, text }]);
  }

  function clearVideoRequestTimer() {
    if (videoRequestTimer.current) clearTimeout(videoRequestTimer.current);
    videoRequestTimer.current = null;
  }

  function teardown(message?: string) {
    if (requestTimer.current) clearTimeout(requestTimer.current);
    if (connectionTimer.current) clearTimeout(connectionTimer.current);
    clearVideoRequestTimer();
    requestTimer.current = null;
    connectionTimer.current = null;
    peerRef.current?.close();
    peerRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setVideo("none");
    setMessages([]);
    setSharedSpark(null);
    sparkClock.current = 0;
    setConn({ kind: "idle" });
    if (message) showNotice(message);
  }

  function sendSignalQuietly(
    peerId: string,
    type: SignalMsg["type"],
    payload?: string,
  ) {
    void sendSignal(sessionId, sessionToken, peerId, type, payload).catch(
      () => {},
    );
  }

  function failPeerConnection(peerId: string, message: string) {
    const c = connRef.current;
    if (
      (c.kind === "connecting" || c.kind === "connected") &&
      c.peerId === peerId
    ) {
      sendSignalQuietly(peerId, "end");
      teardown(message);
    }
  }

  function startPeer(peerId: string, initiator: boolean) {
    const ps = new PeerSession(initiator, {
      onSignal: (type: DescType, payload: string) =>
        sendSignal(sessionId, sessionToken, peerId, type, payload),
      onError: () =>
        failPeerConnection(peerId, "Connection setup failed."),
      onChat: (text) => addMessage(false, text),
      onSpark: (event) => {
        if (event.author !== peerId) return;
        sparkClock.current = Math.max(sparkClock.current, event.clock);
        setSharedSpark((current) =>
          !current ||
          compareConversationSparkEvents(event, current.event) > 0
            ? { event, mine: false }
            : current,
        );
      },
      onControl: (ctrl) => handleControl(ctrl),
      onRemoteStream: (stream) => setRemoteStream(stream),
      onConnectionState: (state) => {
        if (state === "failed") {
          sendSignalQuietly(peerId, "end");
          teardown("Connection failed (network).");
        }
      },
      onChannelOpen: () => {
        if (connectionTimer.current) clearTimeout(connectionTimer.current);
        connectionTimer.current = null;
        setConn({ kind: "connected", peerId });
      },
      onChannelClose: () => {
        const c = connRef.current;
        if (
          (c.kind === "connecting" || c.kind === "connected") &&
          c.peerId === peerId
        ) {
          sendSignalQuietly(peerId, "end");
          teardown("Connection closed.");
        }
      },
    });
    peerRef.current = ps;
    connectionTimer.current = setTimeout(() => {
      const c = connRef.current;
      if (c.kind === "connecting" && c.peerId === peerId) {
        sendSignalQuietly(peerId, "end");
        teardown("Connection timed out.");
      }
    }, CONNECTION_TIMEOUT_MS);
  }

  function handleControl(ctrl: PeerControl) {
    const ps = peerRef.current;
    switch (ctrl) {
      case "video-request":
        if (videoRef.current === "none") setVideo("incoming");
        break;
      case "video-accept":
        if (videoRef.current === "requesting" && ps) {
          clearVideoRequestTimer();
          ps.startVideo()
            .then((stream) => {
              if (
                peerRef.current !== ps ||
                videoRef.current !== "requesting"
              ) {
                ps.stopVideo();
                return;
              }
              setLocalStream(stream);
              setVideo("active");
            })
            .catch(() => {
              if (
                peerRef.current !== ps ||
                videoRef.current !== "requesting"
              ) {
                return;
              }
              setVideo("none");
              ps.sendControl("video-end");
              showNotice("Camera unavailable.");
            });
        }
        break;
      case "video-decline":
        if (videoRef.current === "requesting") {
          clearVideoRequestTimer();
          setVideo("none");
          showNotice("Video declined.");
        }
        break;
      case "video-end":
        clearVideoRequestTimer();
        ps?.stopVideo();
        setLocalStream(null);
        setRemoteStream(null);
        setVideo("none");
        break;
    }
  }

  function requestConnection(peerId: string) {
    if (connRef.current.kind !== "idle") return;
    setConn({ kind: "requesting", peerId });
    void sendSignal(sessionId, sessionToken, peerId, "request").catch(() => {
      const c = connRef.current;
      if (c.kind === "requesting" && c.peerId === peerId) {
        teardown("Couldn't send request.");
      }
    });
    requestTimer.current = setTimeout(() => {
      if (
        connRef.current.kind === "requesting" &&
        connRef.current.peerId === peerId
      ) {
        sendSignalQuietly(peerId, "end");
        teardown("No answer.");
      }
    }, REQUEST_TIMEOUT_MS);
  }

  function cancelRequest() {
    if (connRef.current.kind === "requesting") {
      sendSignalQuietly(connRef.current.peerId, "end");
    }
    teardown();
  }

  function acceptIncoming() {
    if (connRef.current.kind !== "incoming") return;
    const peerId = connRef.current.peerId;
    startPeer(peerId, false);
    setConn({ kind: "connecting", peerId });
    void sendSignal(sessionId, sessionToken, peerId, "accept").catch(() => {
      failPeerConnection(peerId, "Couldn't accept request.");
    });
  }

  function declineIncoming() {
    if (connRef.current.kind !== "incoming") return;
    const peerId = connRef.current.peerId;
    void sendSignal(sessionId, sessionToken, peerId, "decline")
      .then(() => {
        const c = connRef.current;
        if (c.kind === "incoming" && c.peerId === peerId) {
          setConn({ kind: "idle" });
        }
      })
      .catch(() => showNotice("Couldn't decline. Please try again."));
  }

  function endConnection() {
    const c = connRef.current;
    if (c.kind === "connecting" || c.kind === "connected") {
      sendSignalQuietly(c.peerId, "end");
    }
    teardown();
  }

  function shareConversationSpark() {
    const ps = peerRef.current;
    if (!ps || connRef.current.kind !== "connected") return;

    const event: ConversationSparkEvent = {
      id: pickConversationSpark(sharedSpark?.event.id),
      clock: sparkClock.current + 1,
      author: sessionId,
    };
    if (!ps.sendSpark(event)) {
      showNotice("Couldn't share a spark.");
      return;
    }

    sparkClock.current = event.clock;
    setSharedSpark({ event, mine: true });
  }

  function startVideoRequest() {
    const ps = peerRef.current;
    if (videoRef.current !== "none" || !ps) return;
    if (!ps.sendControl("video-request")) {
      showNotice("Couldn't send video request.");
      return;
    }
    setVideo("requesting");
    videoRequestTimer.current = setTimeout(() => {
      if (peerRef.current === ps && videoRef.current === "requesting") {
        ps.sendControl("video-end");
        setVideo("none");
        showNotice("No answer for video.");
      }
    }, VIDEO_REQUEST_TIMEOUT_MS);
  }

  function acceptVideo() {
    const ps = peerRef.current;
    if (!ps || videoRef.current !== "incoming") return;
    ps.startVideo()
      .then((stream) => {
        if (peerRef.current !== ps || videoRef.current !== "incoming") {
          ps.stopVideo();
          return;
        }
        setLocalStream(stream);
        if (!ps.sendControl("video-accept")) {
          ps.stopVideo();
          setLocalStream(null);
          setVideo("none");
          showNotice("Video request ended.");
          return;
        }
        setVideo("active");
      })
      .catch(() => {
        if (peerRef.current !== ps || videoRef.current !== "incoming") return;
        ps.sendControl("video-decline");
        setVideo("none");
        showNotice("Camera unavailable.");
      });
  }

  function declineVideo() {
    const ps = peerRef.current;
    ps?.stopVideo();
    ps?.sendControl("video-decline");
    clearVideoRequestTimer();
    setVideo("none");
  }

  function endVideo() {
    const ps = peerRef.current;
    ps?.stopVideo();
    ps?.sendControl("video-end");
    clearVideoRequestTimer();
    setLocalStream(null);
    setRemoteStream(null);
    setVideo("none");
  }

  function processSignal(sig: SignalMsg) {
    switch (sig.type) {
      case "request": {
        if (connRef.current.kind === "idle") {
          setConn({ kind: "incoming", peerId: sig.fromId });
        } else {
          sendSignalQuietly(sig.fromId, "decline");
        }
        break;
      }
      case "accept": {
        const c = connRef.current;
        if (c.kind === "requesting" && c.peerId === sig.fromId) {
          if (requestTimer.current) clearTimeout(requestTimer.current);
          requestTimer.current = null;
          startPeer(sig.fromId, true);
          setConn({ kind: "connecting", peerId: sig.fromId });
        }
        break;
      }
      case "decline": {
        const c = connRef.current;
        if (c.kind === "requesting" && c.peerId === sig.fromId) {
          if (requestTimer.current) clearTimeout(requestTimer.current);
          requestTimer.current = null;
          teardown("Request declined.");
        }
        break;
      }
      case "offer":
      case "answer":
      case "ice": {
        const c = connRef.current;
        const peerId =
          c.kind === "connecting" || c.kind === "connected" ? c.peerId : null;
        const ps = peerRef.current;
        if (ps && peerId === sig.fromId) {
          void ps
            .handleSignal(sig.type as DescType, sig.payload ?? "")
            .catch(() => {
              if (peerRef.current === ps) {
                failPeerConnection(sig.fromId, "Connection setup failed.");
              }
            });
        }
        break;
      }
      case "end": {
        const c = connRef.current;
        if (
          (c.kind === "requesting" ||
            c.kind === "incoming" ||
            c.kind === "connecting" ||
            c.kind === "connected") &&
          c.peerId === sig.fromId
        ) {
          if (c.kind === "incoming") setConn({ kind: "idle" });
          else teardown("Stranger disconnected.");
        }
        break;
      }
    }
  }

  const processSignalRef = useRef(processSignal);
  const teardownRef = useRef(teardown);
  useEffect(() => {
    processSignalRef.current = processSignal;
    teardownRef.current = teardown;
  });

  useEffect(() => {
    if (phase !== "live" || !sessionId || !myLocation) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const recordPollFailure = () => {
      pollFailureCount.current += 1;
      if (pollFailureCount.current === 3) {
        setPeers([]);
        showNotice("Connection lost. Retrying…");
      }
    };

    const tick = async () => {
      try {
        const data = await poll(sessionId, sessionToken);
        if (!active) return;
        const wasOffline = pollFailureCount.current >= 3;
        pollFailureCount.current = 0;
        setPeers(data.peers);
        for (const s of data.signals) processSignalRef.current(s);
        if (wasOffline) showNotice("Back online.");
      } catch (error) {
        if (!active) return;
        if (error instanceof PresenceExpiredError) {
          const c = connRef.current;
          const peerId = c.kind === "idle" ? null : c.peerId;
          if (peerId) {
            try {
              await sendSignal(sessionId, sessionToken, peerId, "end");
            } catch {}
            teardownRef.current();
          }
          setPeers([]);
          try {
            await join(
              sessionId,
              sessionToken,
              myLocation.lat,
              myLocation.lng,
            );
            if (!active) return;
            pollFailureCount.current = 0;
            showNotice(
              peerId
                ? "Session restored. Previous connection ended."
                : "Session restored.",
            );
          } catch {
            recordPollFailure();
          }
        } else {
          recordPollFailure();
        }
      }
      if (active) timer = setTimeout(tick, POLL_INTERVAL_MS);
    };
    tick();

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [phase, sessionId, sessionToken, myLocation]);

  useEffect(() => {
    if (!sessionId || phase !== "live") return;
    const onLeave = () => {
      leave(sessionId, sessionToken);
    };
    window.addEventListener("pagehide", onLeave);
    window.addEventListener("beforeunload", onLeave);
    return () => {
      window.removeEventListener("pagehide", onLeave);
      window.removeEventListener("beforeunload", onLeave);
    };
  }, [sessionId, sessionToken, phase]);

  async function handleReady(lat: number, lng: number) {
    await join(sessionId, sessionToken, lat, lng);
    setMyLocation({ lat, lng });
    setPhase("live");
  }

  if (phase === "gate") {
    return <EntryGate onReady={handleReady} />;
  }

  const inChat = conn.kind === "connecting" || conn.kind === "connected";

  return (
    <main className="fixed inset-0 overflow-hidden">
      <WorldMap
        peers={peers}
        me={myLocation}
        onPeerClick={requestConnection}
        canConnect={conn.kind === "idle"}
      />

      {notice && (
        <div
          className="signal-toast signal-toast-notice"
          role="status"
          aria-live="polite"
        >
          {notice}
        </div>
      )}

      {conn.kind === "requesting" && (
        <div className="signal-toast signal-toast-request" role="status">
          <span className="signal-toast-radar" aria-hidden="true">
            <span />
          </span>
          <div>
            <strong>Signal sent</strong>
            <span>Waiting for an answer…</span>
          </div>
          <button
            onClick={cancelRequest}
            className="signal-toast-action"
          >
            Cancel
          </button>
        </div>
      )}

      {conn.kind === "incoming" && (
        <ConnectionPrompt
          title="A stranger wants to connect"
          acceptLabel="Accept"
          declineLabel="Decline"
          onAccept={acceptIncoming}
          onDecline={declineIncoming}
        />
      )}

      {inChat && (
        <ChatPanel
          messages={messages}
          spark={
            sharedSpark
              ? {
                  value: getConversationSpark(sharedSpark.event.id),
                  mine: sharedSpark.mine,
                  key: `${sharedSpark.event.clock}:${sharedSpark.event.author}`,
                }
              : null
          }
          connected={conn.kind === "connected"}
          videoBusy={video !== "none"}
          onSend={(text) => {
            if (!peerRef.current?.sendChat(text)) {
              showNotice("Message not sent.");
              return false;
            }
            addMessage(true, text);
            return true;
          }}
          onNewSpark={shareConversationSpark}
          onStartVideo={startVideoRequest}
          onEnd={endConnection}
        />
      )}

      {video === "requesting" && (
        <div className="signal-toast signal-toast-video" role="status">
          <span className="signal-toast-live" aria-hidden="true" />
          <span>Waiting for video permission…</span>
        </div>
      )}

      {video === "incoming" && (
        <ConnectionPrompt
          title="Start video call?"
          subtitle="The stranger wants to turn on video."
          acceptLabel="Accept"
          declineLabel="Decline"
          onAccept={acceptVideo}
          onDecline={declineVideo}
        />
      )}

      {video === "active" && (
        <VideoPanel
          localStream={localStream}
          remoteStream={remoteStream}
          onEnd={endVideo}
        />
      )}
    </main>
  );
}

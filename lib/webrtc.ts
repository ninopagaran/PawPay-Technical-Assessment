import { MAX_CHAT_MESSAGE_LENGTH } from "@/lib/types";

export type DescType = "offer" | "answer" | "ice";
export type PeerControl =
  | "video-request"
  | "video-accept"
  | "video-decline"
  | "video-end";

interface PeerCallbacks {
  onSignal: (type: DescType, payload: string) => Promise<void>;
  onError: () => void;
  onChat: (text: string) => void;
  onControl: (ctrl: PeerControl) => void;
  onRemoteStream: (stream: MediaStream | null) => void;
  onConnectionState: (state: RTCPeerConnectionState) => void;
  onChannelOpen: () => void;
  onChannelClose: () => void;
}

const ICE_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

export class PeerSession {
  private pc: RTCPeerConnection;
  private dc: RTCDataChannel | null = null;
  private readonly polite: boolean;
  private makingOffer = false;
  private ignoreOffer = false;
  private localStream: MediaStream | null = null;
  private pendingLocalStream: Promise<MediaStream> | null = null;
  private videoGeneration = 0;
  private closed = false;
  private readonly cb: PeerCallbacks;
  private pendingCandidates: RTCIceCandidateInit[] = [];

  constructor(initiator: boolean, cb: PeerCallbacks) {
    this.cb = cb;
    this.polite = !initiator;
    this.pc = new RTCPeerConnection(ICE_CONFIG);

    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        void this.cb
          .onSignal("ice", JSON.stringify(candidate))
          .catch(() => this.cb.onError());
      }
    };

    this.pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true;
        await this.pc.setLocalDescription();
        if (this.pc.localDescription) {
          await this.cb.onSignal(
            "offer",
            JSON.stringify(this.pc.localDescription),
          );
        }
      } catch {
        if (!this.closed) this.cb.onError();
      } finally {
        this.makingOffer = false;
      }
    };

    this.pc.ontrack = ({ streams }) => {
      this.cb.onRemoteStream(streams[0] ?? null);
    };

    this.pc.onconnectionstatechange = () => {
      this.cb.onConnectionState(this.pc.connectionState);
    };

    if (initiator) {
      this.dc = this.pc.createDataChannel("chat");
      this.wireDataChannel(this.dc);
    } else {
      this.pc.ondatachannel = (e) => {
        this.dc = e.channel;
        this.wireDataChannel(this.dc);
      };
    }
  }

  private wireDataChannel(dc: RTCDataChannel) {
    dc.onopen = () => {
      if (!this.closed) this.cb.onChannelOpen();
    };
    dc.onclose = () => {
      if (!this.closed) this.cb.onChannelClose();
    };
    dc.onerror = () => {
      if (!this.closed) this.cb.onChannelClose();
    };
    dc.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data as string);
        if (
          msg.t === "chat" &&
          typeof msg.text === "string" &&
          msg.text.length <= MAX_CHAT_MESSAGE_LENGTH
        ) {
          this.cb.onChat(msg.text);
        } else if (msg.t === "ctrl" && typeof msg.ctrl === "string") {
          this.cb.onControl(msg.ctrl as PeerControl);
        }
      } catch {}
    };
  }

  async handleSignal(type: DescType, payload: string) {
    if (this.closed) return;
    const data = JSON.parse(payload);

    if (type === "ice") {
      if (!this.pc.remoteDescription) {
        this.pendingCandidates.push(data);
        return;
      }
      try {
        await this.pc.addIceCandidate(data);
      } catch {}
      return;
    }

    const desc = data as RTCSessionDescriptionInit;
    const offerCollision =
      desc.type === "offer" &&
      (this.makingOffer || this.pc.signalingState !== "stable");
    this.ignoreOffer = !this.polite && offerCollision;
    if (this.ignoreOffer) return;

    await this.pc.setRemoteDescription(desc);
    await this.flushPendingCandidates();
    if (desc.type === "offer") {
      await this.pc.setLocalDescription();
      if (this.pc.localDescription) {
        await this.cb.onSignal(
          "answer",
          JSON.stringify(this.pc.localDescription),
        );
      }
    }
  }

  private async flushPendingCandidates() {
    if (this.pendingCandidates.length === 0) return;
    const queued = this.pendingCandidates;
    this.pendingCandidates = [];
    for (const candidate of queued) {
      try {
        await this.pc.addIceCandidate(candidate);
      } catch {}
    }
  }

  sendChat(text: string): boolean {
    if (!text || text.length > MAX_CHAT_MESSAGE_LENGTH) return false;
    return this.safeSend({ t: "chat", text });
  }

  sendControl(ctrl: PeerControl): boolean {
    return this.safeSend({ t: "ctrl", ctrl });
  }

  private safeSend(obj: unknown): boolean {
    if (!this.dc || this.dc.readyState !== "open") return false;
    try {
      this.dc.send(JSON.stringify(obj));
      return true;
    } catch {
      return false;
    }
  }

  async startVideo(): Promise<MediaStream> {
    if (this.localStream) return this.localStream;
    if (this.pendingLocalStream) return this.pendingLocalStream;

    const generation = this.videoGeneration;
    const pending = navigator.mediaDevices
      .getUserMedia({
        video: true,
        audio: true,
      })
      .then((stream) => {
        if (this.closed || generation !== this.videoGeneration) {
          for (const track of stream.getTracks()) track.stop();
          throw new Error("video request was cancelled");
        }
        this.localStream = stream;
        for (const track of stream.getTracks()) {
          this.pc.addTrack(track, stream);
        }
        return stream;
      })
      .finally(() => {
        if (this.pendingLocalStream === pending) {
          this.pendingLocalStream = null;
        }
      });

    this.pendingLocalStream = pending;
    return pending;
  }

  stopVideo() {
    this.videoGeneration += 1;
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) track.stop();
      for (const sender of this.pc.getSenders()) {
        if (sender.track) {
          try {
            this.pc.removeTrack(sender);
          } catch {}
        }
      }
      this.localStream = null;
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.stopVideo();
    if (this.dc) {
      try {
        this.dc.close();
      } catch {}
    }
    try {
      this.pc.close();
    } catch {}
  }
}

import { SignalingClient } from './signaling';

export type WebRtcOptions = {
  baseUrl: string;
  roomId: string;
  getUserMediaConstraints?: MediaStreamConstraints;
  enableMedia?: boolean; // default true; when false, data-channel only
  dataChannelLabel?: string; // default 'control'
};

export class WebRtcController {
  private pc: RTCPeerConnection;
  private signaling: SignalingClient;
  private makingOffer = false;
  private ignoreOffer = false;
  private polite = false;
  private initiator = false;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream = new MediaStream();
  private isClosed = false;
  private dataChannel: RTCDataChannel | null = null;
  private onData?: (data: ArrayBuffer | string) => void;
  private reconnectTimer: number | null = null;

  private options: WebRtcOptions;

  constructor(options: WebRtcOptions) {
    this.options = options;
    this.pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });

    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.signaling.sendCandidate(candidate.toJSON());
    };

    this.pc.ontrack = (event) => {
      // Attach track to remote stream (handle both stream-based and track-based)
      if (event.streams && event.streams[0]) {
        event.streams[0].getTracks().forEach((t) => this.remoteStream.addTrack(t));
      } else if (event.track) {
        this.remoteStream.addTrack(event.track);
      }
    };

    this.pc.addEventListener('iceconnectionstatechange', () => {
      if (this.pc.iceConnectionState === 'failed') {
        // Auto-reconnect using ICE restart per MDN
        // https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/restartIce
        this.pc.restartIce();
        void this.negotiate();
      } else if (this.pc.iceConnectionState === 'disconnected') {
        if (this.reconnectTimer == null) {
          this.reconnectTimer = window.setTimeout(() => {
            this.reconnectTimer = null;
            if (!this.isClosed && this.pc.iceConnectionState === 'disconnected') {
              this.pc.restartIce();
              void this.negotiate();
            }
          }, 1500);
        }
      }
    });

    this.pc.addEventListener('connectionstatechange', () => {
      const s = this.pc.connectionState;
      // eslint-disable-next-line no-console
      console.debug('[pc] connectionstate', s);
      if (s === 'failed') {
        this.pc.restartIce();
        void this.negotiate();
      }
    });

    this.pc.ondatachannel = (event) => {
      this.dataChannel = event.channel;
      this.dataChannel.binaryType = 'arraybuffer';
      this.bindDataChannel();
    };

    this.signaling = new SignalingClient(options.baseUrl, options.roomId, {
      onOffer: async ({ sdp, polite }) => {
        this.polite = polite;
        const offerCollision = this.makingOffer || this.pc.signalingState !== 'stable';
        this.ignoreOffer = !this.polite && offerCollision;
        if (this.ignoreOffer) return;
        await this.pc.setRemoteDescription(sdp);
        await this.ensureLocalStream();
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        this.signaling.sendAnswer(answer);
      },
      onAnswer: async ({ sdp }) => {
        if (this.pc.signalingState === 'have-local-offer') {
          await this.pc.setRemoteDescription(sdp);
        }
      },
      onCandidate: async ({ candidate }) => {
        try {
          await this.pc.addIceCandidate(candidate);
        } catch (err) {
          if (!this.ignoreOffer) throw err;
        }
      },
      onPeerLeft: () => {
        // Reset for a clean renegotiation when peer rejoins
        this.remoteStream.getTracks().forEach((t) => this.remoteStream.removeTrack(t));
        this.dataChannel = null;
      },
      onRoomFull: () => {
        console.warn('Room full');
      },
      onPeerReady: () => {
        if (this.initiator) {
          if (!this.dataChannel) {
            const label = this.options.dataChannelLabel ?? 'control';
            try {
              this.dataChannel = this.pc.createDataChannel(label);
              this.dataChannel.binaryType = 'arraybuffer';
              this.bindDataChannel();
            } catch {
              // ignore transient errors
            }
          }
          void this.negotiate();
        }
      },
      onRole: ({ initiator, polite }) => {
        this.initiator = initiator;
        this.polite = polite;
        if (this.initiator) {
          // Kick off negotiation as soon as we know our role
          if (!this.dataChannel) {
            const label = this.options.dataChannelLabel ?? 'control';
            this.dataChannel = this.pc.createDataChannel(label);
            this.dataChannel.binaryType = 'arraybuffer';
            this.bindDataChannel();
          }
          void this.negotiate();
        }
      },
    });

    this.pc.onnegotiationneeded = async () => {
      if (this.isClosed) return;
      await this.negotiate();
    };
  }

  private bindDataChannel(): void {
    if (!this.dataChannel) return;
    this.dataChannel.onopen = () => {
      // eslint-disable-next-line no-console
      console.log('[dc] open');
    };
    this.dataChannel.onmessage = (ev) => {
      if (this.onData) this.onData(ev.data);
    };
    this.dataChannel.onclose = () => {
      // eslint-disable-next-line no-console
      console.log('[dc] close');
      // Recreate DC if we are the initiator and still active
      if (!this.isClosed && this.initiator) {
        const label = this.options.dataChannelLabel ?? 'control';
        try {
          this.dataChannel = this.pc.createDataChannel(label);
          this.dataChannel.binaryType = 'arraybuffer';
          this.bindDataChannel();
          void this.negotiate();
        } catch {
          // ignore transient errors
        }
      }
    };
  }

  getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  getRemoteStream(): MediaStream {
    return this.remoteStream;
  }

  async ensureLocalStream(): Promise<void> {
    if (this.localStream || this.isClosed) return;
    if (this.options.enableMedia === false) return; // data-channel only mode
    const constraints: MediaStreamConstraints =
      this.options.getUserMediaConstraints ?? { audio: true, video: true };
    this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
    if (this.isClosed) return;
    this.localStream.getTracks().forEach((track) => {
      if (this.isClosed) return;
      this.pc.addTrack(track, this.localStream!);
    });
  }

  async negotiate(): Promise<void> {
    try {
      if (this.isClosed) return;
      this.makingOffer = true;
      await this.ensureLocalStream();
      if (this.isClosed) return;
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      this.signaling.sendOffer(offer);
    } finally {
      this.makingOffer = false;
    }
  }

  async close(): Promise<void> {
    this.isClosed = true;
    this.signaling.disconnect();
    this.pc.getSenders().forEach((s) => s.track && s.track.stop());
    this.pc.close();
  }

  setDataHandler(handler: (data: ArrayBuffer | string) => void): void {
    this.onData = handler;
  }

  sendData(buffer: ArrayBuffer): boolean {
    const dc = this.dataChannel;
    if (!dc || dc.readyState !== 'open') {
      // Attempt self-heal: recreate DC if initiator and renegotiate
      if (!this.isClosed && this.initiator) {
        try {
          if (!this.dataChannel || this.dataChannel.readyState === 'closed') {
            const label = this.options.dataChannelLabel ?? 'control';
            this.dataChannel = this.pc.createDataChannel(label);
            this.dataChannel.binaryType = 'arraybuffer';
            this.bindDataChannel();
            void this.negotiate();
          }
        } catch {
          // ignore
        }
      }
      return false;
    }
    dc.send(buffer);
    return true;
  }
}



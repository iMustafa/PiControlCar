import { io, Socket } from 'socket.io-client';

export type SignalingEvents = {
  onOffer: (payload: { sdp: RTCSessionDescriptionInit; polite: boolean }) => void;
  onAnswer: (payload: { sdp: RTCSessionDescriptionInit }) => void;
  onCandidate: (payload: { candidate: RTCIceCandidateInit }) => void;
  onPeerLeft: () => void;
  onRoomFull: () => void;
  onPeerReady: () => void;
  onRole: (payload: { initiator: boolean; polite: boolean }) => void;
};

export class SignalingClient {
  private socket: Socket;
  private roomId: string;

  constructor(baseUrl: string, roomId: string, handlers: SignalingEvents) {
    this.roomId = roomId;
    this.socket = io(baseUrl, {
      // Allow polling fallback; enable reconnection
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
      timeout: 20000,
      withCredentials: false,
    });

    this.socket.on('signal:offer', handlers.onOffer);
    this.socket.on('signal:answer', handlers.onAnswer);
    this.socket.on('signal:candidate', handlers.onCandidate);
    this.socket.on('peer:left', handlers.onPeerLeft);
    this.socket.on('room:full', handlers.onRoomFull);
    this.socket.on('peer:ready', handlers.onPeerReady);
    this.socket.on('room:role', handlers.onRole);
    this.socket.on('connect', () => {
      this.socket.emit('room:join', roomId);
    });
    this.socket.on('connect_error', (err) => {
      console.warn('signaling connect_error', err.message);
    });
  }

  sendOffer(sdp: RTCSessionDescriptionInit) {
    this.socket.emit('signal:offer', { sdp, roomId: this.roomId });
  }

  sendAnswer(sdp: RTCSessionDescriptionInit) {
    this.socket.emit('signal:answer', { sdp, roomId: this.roomId });
  }

  sendCandidate(candidate: RTCIceCandidateInit) {
    this.socket.emit('signal:candidate', { candidate, roomId: this.roomId });
  }

  disconnect() {
    this.socket.disconnect();
  }
}



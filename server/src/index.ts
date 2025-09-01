import express = require('express');
import http = require('http');
import cors = require('cors');
import { Server, Socket } from 'socket.io';

type RoomId = string;

interface ServerToClientEvents {
  'signal:offer': (payload: { sdp: RTCSessionDescriptionInit; polite: boolean }) => void;
  'signal:answer': (payload: { sdp: RTCSessionDescriptionInit }) => void;
  'signal:candidate': (payload: { candidate: RTCIceCandidateInit }) => void;
  'room:full': () => void;
  'peer:left': () => void;
  'peer:ready': () => void;
  'room:role': (payload: { initiator: boolean; polite: boolean }) => void;
}

interface ClientToServerEvents {
  'room:join': (roomId: RoomId) => void;
  'signal:offer': (payload: { sdp: RTCSessionDescriptionInit; roomId: RoomId }) => void;
  'signal:answer': (payload: { sdp: RTCSessionDescriptionInit; roomId: RoomId }) => void;
  'signal:candidate': (payload: { candidate: RTCIceCandidateInit; roomId: RoomId }) => void;
}

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

// In-memory room map: roomId -> Set of socket ids
const roomIdToSockets = new Map<RoomId, Set<string>>();

function getOrCreateRoom(roomId: RoomId): Set<string> {
  let set = roomIdToSockets.get(roomId);
  if (!set) {
    set = new Set<string>();
    roomIdToSockets.set(roomId, set);
  }
  return set;
}

io.on('connection', (socket: Socket<ClientToServerEvents, ServerToClientEvents>) => {
  let joinedRoom: RoomId | null = null;

  socket.on('room:join', (roomId) => {
    const room = getOrCreateRoom(roomId);
    if (room.size >= 2) {
      socket.emit('room:full');
      return;
    }
    joinedRoom = roomId;
    room.add(socket.id);
    socket.join(roomId);
    // Assign roles: first joiner is initiator/non-polite, second is non-initiator/polite
    const isFirst = room.size === 1;
    const isSecond = room.size === 2;
    if (isFirst) {
      socket.emit('room:role', { initiator: true, polite: false });
    } else if (isSecond) {
      socket.emit('room:role', { initiator: false, polite: true });
    }
    if (room.size === 2) {
      // Notify both peers to start negotiation
      io.to(roomId).emit('peer:ready');
    }
  });

  socket.on('signal:offer', ({ sdp, roomId }) => {
    const room = roomIdToSockets.get(roomId);
    if (!room) return;
    const firstId = [...room][0];
    const others = [...room].filter((id) => id !== socket.id);
    others.forEach((id) => {
      const polite = id !== firstId; // second joiner is polite
      io.to(id).emit('signal:offer', { sdp, polite });
    });
  });

  socket.on('signal:answer', ({ sdp, roomId }) => {
    const room = roomIdToSockets.get(roomId);
    if (!room) return;
    const others = [...room].filter((id) => id !== socket.id);
    others.forEach((id) => io.to(id).emit('signal:answer', { sdp }));
  });

  socket.on('signal:candidate', ({ candidate, roomId }) => {
    const room = roomIdToSockets.get(roomId);
    if (!room) return;
    const others = [...room].filter((id) => id !== socket.id);
    others.forEach((id) => io.to(id).emit('signal:candidate', { candidate }));
  });

  socket.on('disconnect', () => {
    if (joinedRoom) {
      const room = roomIdToSockets.get(joinedRoom);
      if (room) {
        room.delete(socket.id);
        const others = [...room];
        if (others.length === 0) {
          roomIdToSockets.delete(joinedRoom);
        } else {
          others.forEach((id) => io.to(id).emit('peer:left'));
        }
      }
    }
  });
});

const PORT = process.env.PORT ? Number(process.env.PORT) : 5174;
server.listen(PORT, () => {
  console.log(`signaling server listening on http://localhost:${PORT}`);
});



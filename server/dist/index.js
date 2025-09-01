import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server } from 'socket.io';
const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
});
// In-memory room map: roomId -> Set of socket ids
const roomIdToSockets = new Map();
function getOrCreateRoom(roomId) {
    let set = roomIdToSockets.get(roomId);
    if (!set) {
        set = new Set();
        roomIdToSockets.set(roomId, set);
    }
    return set;
}
io.on('connection', (socket) => {
    let joinedRoom = null;
    socket.on('room:join', (roomId) => {
        const room = getOrCreateRoom(roomId);
        if (room.size >= 2) {
            socket.emit('room:full');
            return;
        }
        joinedRoom = roomId;
        room.add(socket.id);
        socket.join(roomId);
    });
    socket.on('signal:offer', ({ sdp, roomId }) => {
        const room = roomIdToSockets.get(roomId);
        if (!room)
            return;
        const firstId = [...room][0];
        const others = [...room].filter((id) => id !== socket.id);
        others.forEach((id) => {
            const polite = id !== firstId; // second joiner is polite
            io.to(id).emit('signal:offer', { sdp, polite });
        });
    });
    socket.on('signal:answer', ({ sdp, roomId }) => {
        const room = roomIdToSockets.get(roomId);
        if (!room)
            return;
        const others = [...room].filter((id) => id !== socket.id);
        others.forEach((id) => io.to(id).emit('signal:answer', { sdp }));
    });
    socket.on('signal:candidate', ({ candidate, roomId }) => {
        const room = roomIdToSockets.get(roomId);
        if (!room)
            return;
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
                }
                else {
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
//# sourceMappingURL=index.js.map
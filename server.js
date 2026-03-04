// ================================
// iDev Meet - server.js (CORRIGIDO v2)
// ================================

const express = require('express');
const http = require('http');
const { ExpressPeerServer } = require('peer');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

const peerServer = ExpressPeerServer(server, {
  path: '/myapp',
  debug: true
});
app.use('/peerjs', peerServer);

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000
});

let rooms = {};

io.on('connection', (socket) => {
  console.log('✅ Conectado:', socket.id);

  // ✅ FIX PRINCIPAL: atualiza o participant na sala com peerId e notifica todos
  socket.on('register-peer', ({ peerId }) => {
    socket.peerId = peerId;
    console.log(`📝 Peer registrado ${socket.id}: ${peerId}`);

    for (const roomName of socket.rooms) {
      if (roomName === socket.id) continue;
      const room = rooms[roomName];
      if (!room) continue;

      if (room.participants[socket.id]) {
        room.participants[socket.id].peerId = peerId;
      }

      socket.to(roomName).emit('peer-registered', {
        socketId: socket.id,
        peerId
      });
    }
  });

  socket.on('create-room', ({ roomName, password, creator }) => {
    if (rooms[roomName]) return socket.emit('room-error', 'Sala já existe!');

    rooms[roomName] = { password, creator, participants: {} };
    rooms[roomName].participants[socket.id] = { name: creator, peerId: socket.peerId || null };
    socket.join(roomName);

    socket.emit('room-joined', {
      name: roomName, creator,
      participants: getParticipantsList(roomName)
    });
    broadcastRoomsList();
  });

  // ✅ FIX: não espera peerId — entra imediatamente, peerId vem depois via register-peer
  socket.on('join-room', ({ roomName, password, userName }) => {
    const room = rooms[roomName];
    if (!room) return socket.emit('room-error', 'Sala não existe!');
    if (room.password !== password) return socket.emit('room-error', 'Senha incorreta!');
    if (Object.keys(room.participants).length >= 10) return socket.emit('room-error', 'Sala cheia!');

    room.participants[socket.id] = { name: userName, peerId: socket.peerId || null };
    socket.join(roomName);

    console.log(`✅ ${userName} entrou em ${roomName}`);

    socket.to(roomName).emit('user-connected', {
      socketId: socket.id, name: userName, peerId: socket.peerId || null
    });

    socket.emit('room-joined', {
      name: roomName, creator: room.creator,
      participants: getParticipantsList(roomName)
    });

    broadcastRoomsList();
  });

  socket.on('leave-room', () => leaveRooms(socket));
  socket.on('disconnect', () => { leaveRooms(socket); });

  socket.on('chat-message', ({ room, message, sender, senderName }) => {
    socket.to(room).emit('chat-message', { message, sender, senderName });
  });

  socket.on('host-mute', ({ room, userId, mute }) => {
    io.to(userId).emit('user-muted', { userId, muted: mute });
  });

  socket.on('host-screen-block', ({ room, userId, block }) => {
    io.to(userId).emit('screen-blocked', { userId, blocked: block });
  });

  socket.on('host-kick', ({ room, userId }) => {
    io.to(userId).emit('user-kicked');
    const roomObj = rooms[room];
    if (roomObj?.participants[userId]) {
      delete roomObj.participants[userId];
      io.to(room).emit('user-disconnected', userId);
    }
  });

  socket.on('raise-hand', ({ room, raised, userName }) => {
    socket.to(room).emit(raised ? 'hand-raised' : 'hand-lowered', { userId: socket.id, userName });
  });

  socket.on('speaking-status', ({ room, speaking }) => {
    socket.to(room).emit('user-speaking', { userId: socket.id, speaking });
  });

  socket.on('screen-sharing-started', ({ room }) => {
    socket.to(room).emit('screen-sharing-started', { userId: socket.id });
  });

  socket.on('screen-sharing-stopped', ({ room }) => {
    socket.to(room).emit('screen-sharing-stopped', { userId: socket.id });
  });

  socket.on('delete-room', ({ roomName }) => {
    const room = rooms[roomName];
    if (room && room.participants[socket.id]?.name === room.creator) {
      io.to(roomName).emit('room-deleted', roomName);
      delete rooms[roomName];
      broadcastRoomsList();
    }
  });

  socket.on('get-rooms', () => socket.emit('rooms-list', getRoomsList()));

  function leaveRooms(socket) {
    for (const roomName of socket.rooms) {
      if (roomName === socket.id) continue;
      const room = rooms[roomName];
      if (!room) continue;
      delete room.participants[socket.id];
      socket.to(roomName).emit('user-disconnected', socket.id);
      if (Object.keys(room.participants).length === 0) delete rooms[roomName];
    }
    broadcastRoomsList();
  }

  function getParticipantsList(roomName) {
    const room = rooms[roomName];
    if (!room) return [];
    return Object.entries(room.participants).map(([id, p]) => ({
      socketId: id, name: p.name, peerId: p.peerId
    }));
  }

  function getRoomsList() {
    return Object.keys(rooms).map(name => ({
      name, creator: rooms[name].creator,
      participants: Object.keys(rooms[name].participants).length
    }));
  }

  function broadcastRoomsList() {
    io.emit('rooms-list', getRoomsList());
  }
});

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 iDev Meet porta ${PORT}`));

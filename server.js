// ================================
// iDev Meet - server.js (v4 - TURN próprio com credencial temporária)
// ================================

const express = require('express');
const http = require('http');
const { ExpressPeerServer } = require('peer');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);

// ================================
// Configuração TURN
// Deve ser igual ao static-auth-secret do /etc/turnserver.conf
// ================================
const TURN_SECRET = process.env.TURN_SECRET || '3Ttech3248';
const TURN_DOMAIN = process.env.TURN_DOMAIN || 'iver.space';

// ================================
// Endpoint que gera credencial TURN temporária (válida por 1h)
// O cliente chama isso ao entrar na sala
// ================================
app.get('/api/turn-credentials', (req, res) => {
  const ttl = 3600; // 1 hora
  const timestamp = Math.floor(Date.now() / 1000) + ttl;
  const username = `${timestamp}:idevmeet`;
  const credential = crypto
    .createHmac('sha1', TURN_SECRET)
    .update(username)
    .digest('base64');

  res.json({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      {
        urls: `turn:${TURN_DOMAIN}:3478`,
        username,
        credential
      },
      {
        urls: `turn:${TURN_DOMAIN}:3478?transport=tcp`,
        username,
        credential
      },
      {
        urls: `turns:${TURN_DOMAIN}:5349`,
        username,
        credential
      }
    ]
  });
});

// ================================
// PeerJS
// ================================
const peerServer = ExpressPeerServer(server, {
  path: '/myapp',
  debug: true
});
app.use('/peerjs', peerServer);

// ================================
// Socket.IO
// ================================
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

let rooms = {};
let pendingJoins = {};

io.on('connection', (socket) => {
  console.log('✅ Conectado:', socket.id);

  socket.on('register-peer', ({ peerId }) => {
    socket.peerId = peerId;
    console.log(`📝 Peer registrado: ${socket.id} -> ${peerId}`);

    if (pendingJoins[socket.id]) {
      const { roomName, userName } = pendingJoins[socket.id];
      delete pendingJoins[socket.id];
      completeJoin(socket, roomName, userName);
      return;
    }

    for (const roomName of Object.keys(rooms)) {
      const room = rooms[roomName];
      if (!room?.participants[socket.id]) continue;
      room.participants[socket.id].peerId = peerId;
      socket.to(roomName).emit('peer-registered', { socketId: socket.id, peerId });
    }
  });

  socket.on('create-room', ({ roomName, password, creator }) => {
    if (rooms[roomName]) return socket.emit('room-error', 'Sala já existe!');
    rooms[roomName] = { password, creator, participants: {} };
    rooms[roomName].participants[socket.id] = { name: creator, peerId: socket.peerId || null };
    socket.join(roomName);
    socket.emit('room-joined', { name: roomName, creator, participants: participantsList(roomName) });
    broadcastRooms();
  });

  socket.on('join-room', ({ roomName, password, userName }) => {
    const room = rooms[roomName];
    if (!room) return socket.emit('room-error', 'Sala não existe!');
    if (room.password !== password) return socket.emit('room-error', 'Senha incorreta!');

    if (socket.peerId) {
      completeJoin(socket, roomName, userName);
    } else {
      console.log(`⏳ ${userName} aguardando peerId para entrar em ${roomName}`);
      pendingJoins[socket.id] = { roomName, userName };
      setTimeout(() => {
        if (pendingJoins[socket.id]) {
          console.log(`⚠️ Timeout: ${userName} entrando sem peerId`);
          delete pendingJoins[socket.id];
          completeJoin(socket, roomName, userName);
        }
      }, 10000);
    }
  });

  function completeJoin(socket, roomName, userName) {
    const room = rooms[roomName];
    if (!room) return socket.emit('room-error', 'Sala não existe mais!');
    room.participants[socket.id] = { name: userName, peerId: socket.peerId || null };
    socket.join(roomName);
    console.log(`✅ ${userName} entrou em "${roomName}" | peerId: ${socket.peerId}`);
    socket.to(roomName).emit('user-connected', { socketId: socket.id, name: userName, peerId: socket.peerId });
    socket.emit('room-joined', { name: roomName, creator: room.creator, participants: participantsList(roomName) });
    broadcastRooms();
  }

  socket.on('leave-room', () => leaveRooms(socket));
  socket.on('disconnect', () => { delete pendingJoins[socket.id]; leaveRooms(socket); console.log('❌ Desconectado:', socket.id); });

  socket.on('chat-message', ({ room, message, sender, senderName }) => socket.to(room).emit('chat-message', { message, sender, senderName }));
  socket.on('host-mute', ({ room, userId, mute }) => io.to(userId).emit('user-muted', { userId, muted: mute }));
  socket.on('host-screen-block', ({ room, userId, block }) => io.to(userId).emit('screen-blocked', { userId, blocked: block }));
  socket.on('host-kick', ({ room, userId }) => {
    io.to(userId).emit('user-kicked');
    const roomObj = rooms[room];
    if (roomObj?.participants[userId]) { delete roomObj.participants[userId]; io.to(room).emit('user-disconnected', userId); }
  });
  socket.on('raise-hand', ({ room, raised, userName }) => socket.to(room).emit(raised ? 'hand-raised' : 'hand-lowered', { userId: socket.id, userName }));
  socket.on('speaking-status', ({ room, speaking }) => socket.to(room).emit('user-speaking', { userId: socket.id, speaking }));
  socket.on('screen-sharing-started', ({ room }) => socket.to(room).emit('screen-sharing-started', { userId: socket.id }));
  socket.on('screen-sharing-stopped', ({ room }) => socket.to(room).emit('screen-sharing-stopped', { userId: socket.id }));
  socket.on('delete-room', ({ roomName }) => {
    const room = rooms[roomName];
    if (room && room.participants[socket.id]?.name === room.creator) {
      io.to(roomName).emit('room-deleted', roomName);
      delete rooms[roomName];
      broadcastRooms();
    }
  });
  socket.on('get-rooms', () => socket.emit('rooms-list', roomsListData()));

  function leaveRooms(socket) {
    for (const roomName of Object.keys(rooms)) {
      const room = rooms[roomName];
      if (!room?.participants[socket.id]) continue;
      delete room.participants[socket.id];
      socket.to(roomName).emit('user-disconnected', socket.id);
      if (Object.keys(room.participants).length === 0) delete rooms[roomName];
    }
    broadcastRooms();
  }

  function participantsList(roomName) {
    const room = rooms[roomName];
    if (!room) return [];
    return Object.keys(room.participants).map(id => ({ socketId: id, name: room.participants[id].name, peerId: room.participants[id].peerId }));
  }

  function roomsListData() {
    return Object.keys(rooms).map(name => ({ name, creator: rooms[name].creator, participants: Object.keys(rooms[name].participants).length }));
  }

  function broadcastRooms() {
    io.emit('rooms-list', roomsListData());
  }
});

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 iDev Meet na porta ${PORT}`));

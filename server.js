// ================================
// iDev Meet - server.js (CORRIGIDO)
// ================================

const express = require('express');
const http = require('http');
const { ExpressPeerServer } = require('peer');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

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
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

let rooms = {};

io.on('connection', (socket) => {
  console.log('✅ Usuário conectado:', socket.id);

  // ✅ FIX: register-peer agora notifica a sala inteira
  socket.on('register-peer', ({ peerId }) => {
    socket.peerId = peerId;
    console.log(`Peer registrado para ${socket.id}: ${peerId}`);

    // Notifica todos na sala que este peer está pronto
    for (const roomName of Object.keys(socket.rooms)) {
      if (roomName === socket.id) continue;
      socket.to(roomName).emit('peer-registered', {
        socketId: socket.id,
        peerId: peerId
      });
    }
  });

  // Criar sala
  socket.on('create-room', ({ roomName, password, creator }) => {
    if (rooms[roomName]) {
      socket.emit('room-error', 'Sala já existe!');
      return;
    }

    rooms[roomName] = {
      password,
      creator,
      participants: {}
    };
    rooms[roomName].participants[socket.id] = { name: creator, peerId: socket.peerId };
    socket.join(roomName);

    socket.emit('room-joined', {
      name: roomName,
      creator: creator,
      participants: Object.keys(rooms[roomName].participants).map(id => ({
        socketId: id,
        name: rooms[roomName].participants[id].name,
        peerId: rooms[roomName].participants[id].peerId
      }))
    });

    io.emit('rooms-list', Object.keys(rooms).map(name => ({
      name,
      creator: rooms[name].creator,
      participants: Object.keys(rooms[name].participants).length
    })));
  });

  // Entrar na sala
  socket.on('join-room', ({ roomName, password, userName }) => {
    const room = rooms[roomName];
    if (!room) return socket.emit('room-error', 'Sala não existe!');
    if (room.password !== password) return socket.emit('room-error', 'Senha incorreta!');

    // Aguarda peerId com fallback
    const doJoin = () => {
      if (!socket.peerId) socket.peerId = null;
      completeJoin(socket, room, roomName, userName);
    };

    if (socket.peerId) {
      doJoin();
    } else {
      setTimeout(() => {
        if (!socket.peerId) {
          console.log(`⚠️ ${socket.id} entrou sem peerId`);
        }
        doJoin();
      }, 1500);
    }
  });

  function completeJoin(socket, room, roomName, userName) {
    room.participants[socket.id] = { name: userName, peerId: socket.peerId };
    socket.join(roomName);

    console.log(`✅ ${userName} entrou em ${roomName} com peerId ${socket.peerId}`);

    // Notifica participantes existentes
    socket.to(roomName).emit('user-connected', {
      socketId: socket.id,
      name: userName,
      peerId: socket.peerId
    });

    // Envia lista completa para quem entrou
    socket.emit('room-joined', {
      name: roomName,
      creator: room.creator,
      participants: Object.keys(room.participants).map(id => ({
        socketId: id,
        name: room.participants[id].name,
        peerId: room.participants[id].peerId
      }))
    });

    // Atualiza lista de salas
    io.emit('rooms-list', Object.keys(rooms).map(name => ({
      name,
      creator: rooms[name].creator,
      participants: Object.keys(rooms[name].participants).length
    })));
  }

  // Sair da sala
  socket.on('leave-room', () => leaveRooms(socket));
  socket.on('disconnect', () => {
    leaveRooms(socket);
    console.log('❌ Desconectado:', socket.id);
  });

  // Chat
  socket.on('chat-message', ({ room, message, sender, senderName }) => {
    socket.to(room).emit('chat-message', { message, sender, senderName });
  });

  // Host actions
  socket.on('host-mute', ({ room, userId, mute }) => {
    io.to(userId).emit('user-muted', { userId, muted: mute });
  });

  socket.on('host-screen-block', ({ room, userId, block }) => {
    io.to(userId).emit('screen-blocked', { userId, blocked: block });
  });

  socket.on('host-kick', ({ room, userId }) => {
    io.to(userId).emit('user-kicked');
    const roomObj = rooms[room];
    if (roomObj && roomObj.participants[userId]) {
      delete roomObj.participants[userId];
      io.to(room).emit('user-disconnected', userId);
    }
  });

  // Raise hand
  socket.on('raise-hand', ({ room, raised, userName }) => {
    socket.to(room).emit(raised ? 'hand-raised' : 'hand-lowered', {
      userId: socket.id,
      userName
    });
  });

  // Speaking
  socket.on('speaking-status', ({ room, speaking }) => {
    socket.to(room).emit('user-speaking', { userId: socket.id, speaking });
  });

  // Screen sharing
  socket.on('screen-sharing-started', ({ room }) => {
    socket.to(room).emit('screen-sharing-started', { userId: socket.id });
  });

  socket.on('screen-sharing-stopped', ({ room }) => {
    socket.to(room).emit('screen-sharing-stopped', { userId: socket.id });
  });

  // Delete room
  socket.on('delete-room', ({ roomName, userId }) => {
    const room = rooms[roomName];
    if (room && room.creator === room.participants[socket.id]?.name) {
      io.to(roomName).emit('room-deleted', roomName);
      delete rooms[roomName];
      io.emit('rooms-list', Object.keys(rooms).map(name => ({
        name,
        creator: rooms[name].creator,
        participants: Object.keys(rooms[name].participants).length
      })));
    }
  });

  socket.on('get-rooms', () => {
    socket.emit('rooms-list', Object.keys(rooms).map(name => ({
      name,
      creator: rooms[name].creator,
      participants: Object.keys(rooms[name].participants).length
    })));
  });

  function leaveRooms(socket) {
    for (const roomName of Object.keys(socket.rooms)) {
      if (roomName === socket.id) continue;
      const room = rooms[roomName];
      if (!room) continue;

      delete room.participants[socket.id];
      socket.to(roomName).emit('user-disconnected', socket.id);

      if (Object.keys(room.participants).length === 0) {
        delete rooms[roomName];
      }
    }

    io.emit('rooms-list', Object.keys(rooms).map(name => ({
      name,
      creator: rooms[name].creator,
      participants: Object.keys(rooms[name].participants).length
    })));
  }
});

// ================================
// Arquivos estáticos
// ================================
app.use(express.static(path.join(__dirname, 'public')));

// ================================
// Iniciar
// ================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 iDev Meet rodando na porta ${PORT}`));

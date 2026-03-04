const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { ExpressPeerServer } = require("peer");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Configuração do PeerJS com STUN servers
const peerServer = ExpressPeerServer(server, {
  debug: true,
  path: "/myapp",
  proxied: true,
  allow_discovery: true,
  // Configuração para ajudar na conexão através de NAT/firewalls
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun3.l.google.com:19302" },
    { urls: "stun:stun4.l.google.com:19302" }
  ]
});

app.use("/peerjs", peerServer);
app.use(express.static("public"));

// Store rooms
const rooms = new Map(); // roomName -> { password, creator, participants: Map() }

io.on("connection", (socket) => {
  console.log("👤 Usuário conectado:", socket.id);

  socket.emit("rooms-list", getRoomsList());

  socket.on("create-room", ({ roomName, password, creator, creatorId }) => {
    if (rooms.has(roomName)) {
      socket.emit("room-error", "Sala já existe!");
      return;
    }

    rooms.set(roomName, {
      password,
      creator,
      creatorId,
      participants: new Map(), // socketId -> { name, peerId }
    });

    console.log(`🏠 Sala criada: ${roomName}`);
    io.emit("rooms-list", getRoomsList());
  });

  socket.on("join-room", ({ roomName, password, userName }) => {
    const room = rooms.get(roomName);

    if (!room) {
      socket.emit("room-error", "Sala não encontrada!");
      return;
    }

    if (room.password !== password) {
      socket.emit("room-error", "Senha incorreta!");
      return;
    }

    if (room.participants.size >= 5) {
      socket.emit("room-error", "Sala cheia (máx 5 pessoas)");
      return;
    }

    socket.join(roomName);
    
    // Armazena o peerId junto com o socketId
    room.participants.set(socket.id, {
      name: userName,
      peerId: null // Será atualizado quando o peer conectar
    });
    
    socket.data.room = roomName;
    socket.data.userName = userName;

    // Envia lista de participantes com seus peerIds
    const participantsList = Array.from(room.participants.entries()).map(([id, data]) => ({
      socketId: id,
      name: data.name,
      peerId: data.peerId
    }));
    
    socket.emit("room-joined", {
      name: roomName,
      creator: room.creator,
      participants: participantsList
    });

    // Notifica os outros
    socket.to(roomName).emit("user-connected", {
      socketId: socket.id,
      name: userName,
      peerId: null
    });

    io.emit("rooms-list", getRoomsList());
  });

  // Novo evento para registrar peerId
  socket.on("register-peer", ({ peerId }) => {
    const roomName = socket.data.room;
    if (!roomName) return;
    
    const room = rooms.get(roomName);
    if (room && room.participants.has(socket.id)) {
      const participant = room.participants.get(socket.id);
      participant.peerId = peerId;
      
      // Notifica todos na sala sobre o peerId
      io.to(roomName).emit("peer-registered", {
        socketId: socket.id,
        peerId: peerId
      });
    }
  });

  socket.on("chat-message", ({ room, message, senderName }) => {
    io.to(room).emit("chat-message", { message, senderName });
  });

  socket.on("leave-room", () => {
    const roomName = socket.data.room;
    if (roomName) leaveRoom(socket, roomName);
  });

  socket.on("disconnect", () => {
    rooms.forEach((room, roomName) => {
      if (room.participants.has(socket.id)) {
        leaveRoom(socket, roomName);
      }
    });
  });
});

function leaveRoom(socket, roomName) {
  const room = rooms.get(roomName);
  if (room) {
    room.participants.delete(socket.id);
    socket.to(roomName).emit("user-disconnected", socket.id);
    
    if (room.participants.size === 0) {
      rooms.delete(roomName);
    }
    
    io.emit("rooms-list", getRoomsList());
  }
}

function getRoomsList() {
  return Array.from(rooms.entries()).map(([name, data]) => ({
    name,
    creator: data.creator,
    participants: data.participants.size,
  }));
}

const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";

server.listen(PORT, HOST, () => {
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
  console.log(`📢 PeerJS server em /peerjs`);
  console.log(`🌐 Acesse de outros dispositivos usando o IP da máquina`);
});
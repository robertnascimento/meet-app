const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));
app.use(express.json());

const rooms = {}; 
// Estrutura:
// {
//   nomeSala: {
//     password: "123",
//     users: []
//   }
// }

io.on("connection", (socket) => {
  console.log("Usuário conectado:", socket.id);

  // 🔥 Criar sala
  socket.on("create-room", ({ roomName, password }) => {
    if (rooms[roomName]) {
      socket.emit("room-error", "Sala já existe.");
      return;
    }

    rooms[roomName] = {
      password,
      users: []
    };

    io.emit("rooms-list", Object.keys(rooms));
  });

  // 🔥 Enviar lista de salas
  socket.on("get-rooms", () => {
    socket.emit("rooms-list", Object.keys(rooms));
  });

  // 🔥 Entrar na sala
  socket.on("join-room", ({ roomName, password }) => {
    const room = rooms[roomName];

    if (!room) {
      socket.emit("room-error", "Sala não existe.");
      return;
    }

    if (room.password !== password) {
      socket.emit("room-error", "Senha incorreta.");
      return;
    }

    socket.join(roomName);
    room.users.push(socket.id);

    socket.emit("room-joined", roomName);
    socket.to(roomName).emit("user-connected");
  });

  socket.on("offer", ({ offer, roomName }) => {
    socket.to(roomName).emit("offer", offer);
  });

  socket.on("answer", ({ answer, roomName }) => {
    socket.to(roomName).emit("answer", answer);
  });

  socket.on("ice-candidate", ({ candidate, roomName }) => {
    socket.to(roomName).emit("ice-candidate", candidate);
  });

  socket.on("disconnect", () => {
    console.log("Usuário desconectado:", socket.id);
  });
});

server.listen(3000, () => {
  console.log("Servidor rodando na porta 3000 🚀");
});
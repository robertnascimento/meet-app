const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mediasoup = require("mediasoup");
const { v4: uuidv4 } = require("uuid");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

let worker;
let rooms = {}; 
// rooms = {
//   roomId: {
//     router,
//     peers: Map()
//   }
// }

(async () => {
  worker = await mediasoup.createWorker({
    rtcMinPort: 40000,
    rtcMaxPort: 49999
  });

  console.log("Mediasoup Worker criado");
})();

io.on("connection", (socket) => {
  console.log("Usuário conectado:", socket.id);

  socket.on("join-room", async ({ roomName }) => {
    if (!rooms[roomName]) {
      const router = await worker.createRouter({
        mediaCodecs: [
          {
            kind: "audio",
            mimeType: "audio/opus",
            clockRate: 48000,
            channels: 2
          },
          {
            kind: "video",
            mimeType: "video/VP8",
            clockRate: 90000
          }
        ]
      });

      rooms[roomName] = {
        router,
        peers: new Map()
      };
    }

    const room = rooms[roomName];

    if (room.peers.size >= 10) {
      socket.emit("room-error", "Sala cheia (máx 10 usuários)");
      return;
    }

    room.peers.set(socket.id, {
      transports: [],
      producers: [],
      consumers: []
    });

    socket.emit("router-rtp-capabilities", room.router.rtpCapabilities);
  });

  socket.on("create-transport", async ({ roomName }, callback) => {
    const room = rooms[roomName];
    const transport = await room.router.createWebRtcTransport({
      listenIps: [{ ip: "0.0.0.0", announcedIp: "18.119.70.109" }],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true
    });

    room.peers.get(socket.id).transports.push(transport);

    callback({
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters
    });
  });

  socket.on("disconnect", () => {
    for (const roomName in rooms) {
      const room = rooms[roomName];
      if (room.peers.has(socket.id)) {
        room.peers.delete(socket.id);
      }
    }
  });
});

server.listen(3000, () => {
  console.log("Servidor SFU rodando 🚀");
});
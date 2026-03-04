const socket = io();

let currentRoom = null;

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");

let localStream;
let peerConnection;
let videoEnabled = false;
let audioEnabled = true;

const config = {
  iceTransportPolicy: "relay",
  iceServers: [
    {
      urls: "turn:iver.space:3478",
      username: "user",
      credential: "meusegredoturn123"
    }
  ]
};

socket.emit("get-rooms");

socket.on("rooms-list", (rooms) => {
  const list = document.getElementById("roomsList");
  list.innerHTML = "";

  rooms.forEach((room) => {
    const li = document.createElement("li");
    li.innerHTML = `
      ${room}
      <button onclick="joinRoomPrompt('${room}')">Entrar</button>
    `;
    list.appendChild(li);
  });
});

function createRoom() {
  const roomName = document.getElementById("roomName").value;
  const password = document.getElementById("roomPassword").value;

  socket.emit("create-room", { roomName, password });
}

function joinRoomPrompt(roomName) {
  const password = prompt("Digite a senha da sala:");
  socket.emit("join-room", { roomName, password });
}

socket.on("room-error", (msg) => {
  alert(msg);
});

socket.on("room-joined", async (roomName) => {
  currentRoom = roomName;

  document.getElementById("home").style.display = "none";
  document.getElementById("meeting").style.display = "block";

  localStream = await navigator.mediaDevices.getUserMedia({
    video: false,
    audio: true,
  });

  localVideo.srcObject = localStream;
});

async function toggleCamera() {
  videoEnabled = !videoEnabled;

  if (videoEnabled) {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    const videoTrack = stream.getVideoTracks()[0];

    localStream.addTrack(videoTrack);
    localVideo.srcObject = localStream;

    const sender = peerConnection
      .getSenders()
      .find((s) => s.track && s.track.kind === "video");

    if (sender) {
      await sender.replaceTrack(videoTrack);
    } else {
      peerConnection.addTrack(videoTrack, localStream);
    }

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    socket.emit("offer", { offer, roomName: currentRoom });

    document.getElementById("camBtn").innerText = "Desligar Câmera";
  } else {
    const videoTrack = localStream.getVideoTracks()[0];

    if (videoTrack) {
      videoTrack.stop();
      localStream.removeTrack(videoTrack);
    }

    const sender = peerConnection
      .getSenders()
      .find((s) => s.track && s.track.kind === "video");

    if (sender) {
      sender.replaceTrack(null);
    }

    document.getElementById("camBtn").innerText = "Ligar Câmera";
  }
}

function toggleMic() {
  audioEnabled = !audioEnabled;

  localStream.getAudioTracks().forEach((track) => {
    track.enabled = audioEnabled;
  });

  document.getElementById("micBtn").innerText = audioEnabled
    ? "Mutar Mic"
    : "Desmutar Mic";
}

socket.on("user-connected", async () => {
  await createOffer();
});

socket.on("offer", async (offer) => {
  await createAnswer(offer);
});

socket.on("answer", async (answer) => {
  await peerConnection.setRemoteDescription(answer);
});

socket.on("ice-candidate", async (candidate) => {
  if (peerConnection) {
    await peerConnection.addIceCandidate(candidate);
  }
});

async function createPeerConnection() {
  if (!localStream) {
    console.log("Aguardando mídia...");
    return;
  }

  if (peerConnection) {
    console.log("PeerConnection já existe");
    return;
  }

  peerConnection = new RTCPeerConnection(config);

  localStream.getTracks().forEach((track) => {
    peerConnection.addTrack(track, localStream);
  });

  peerConnection.ontrack = (event) => {
    console.log("Track recebida:", event.streams[0]);
    remoteVideo.srcObject = event.streams[0];
  };

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("ice-candidate", {
        candidate: event.candidate,
        roomName: currentRoom,
      });
    }
  };
}

async function createOffer() {
  await createPeerConnection();

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);

  socket.emit("offer", { offer, roomName: currentRoom });
}

async function createAnswer(offer) {
  await createPeerConnection();

  await peerConnection.setRemoteDescription(offer);

  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);

  socket.emit("answer", { answer, roomName: currentRoom });
}

const socket = io();
const roomId = "sala123";

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");

let localStream;
let peerConnection;
let videoEnabled = false;
let audioEnabled = true;

const config = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" }
  ]
};

async function joinRoom() {
  localStream = await navigator.mediaDevices.getUserMedia({
    video: false,
    audio: true
  });

  localVideo.srcObject = localStream;
  socket.emit("join-room", roomId);
}

function toggleCamera() {
  videoEnabled = !videoEnabled;

  if (videoEnabled) {
    navigator.mediaDevices.getUserMedia({ video: true })
      .then(stream => {
        const videoTrack = stream.getVideoTracks()[0];
        localStream.addTrack(videoTrack);
        localVideo.srcObject = localStream;

        if (peerConnection) {
          peerConnection.addTrack(videoTrack, localStream);
        }

        document.getElementById("camBtn").innerText = "Desligar Câmera";
      });
  } else {
    localStream.getVideoTracks().forEach(track => {
      track.stop();
      localStream.removeTrack(track);
    });

    document.getElementById("camBtn").innerText = "Ligar Câmera";
  }
}

function toggleMic() {
  audioEnabled = !audioEnabled;

  localStream.getAudioTracks().forEach(track => {
    track.enabled = audioEnabled;
  });

  document.getElementById("micBtn").innerText =
    audioEnabled ? "Mutar Mic" : "Desmutar Mic";
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
  peerConnection = new RTCPeerConnection(config);

  localStream.getTracks().forEach(track => {
    peerConnection.addTrack(track, localStream);
  });

  peerConnection.ontrack = (event) => {
    remoteVideo.srcObject = event.streams[0];
  };

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("ice-candidate", {
        candidate: event.candidate,
        roomId
      });
    }
  };
}

async function createOffer() {
  await createPeerConnection();

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);

  socket.emit("offer", { offer, roomId });
}

async function createAnswer(offer) {
  await createPeerConnection();

  await peerConnection.setRemoteDescription(offer);

  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);

  socket.emit("answer", { answer, roomId });
}
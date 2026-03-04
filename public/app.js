// ================================
// iDev Meet - app.js (CORRIGIDO)
// ================================

const socket = io('https://iver.space');
let localStream = null;
let peers = {};
let chatVisible = false;

let chatMinimized = true;
let participantsMinimized = true;
let unreadMessages = 0;
let currentRoom = null;
let videoEnabled = false;
let audioEnabled = true;
let screenSharing = false;
let screenSharingStream = null;
let userName = '';
let userCreatedRoom = false;
let userRooms = new Set();
let roomCreator = null;
let raisedHand = false;
let audioContext = null;
let analyser = null;
let audioVisualizerInterval = null;
let soundsEnabled = true;
let layoutMode = 'grid';
let participants = new Map();
let mutedByHost = new Map();
let screenBlockedByHost = new Map();
let joinSound, leaveSound, messageSound, raiseHandSound;

// DOM
const localVideo = document.getElementById("localVideo");
const roomsList = document.getElementById("roomsList");
const homeSection = document.getElementById("home");
const meetingSection = document.getElementById("meeting");
const roomNameDisplay = document.getElementById("roomNameDisplay");
const nameModal = document.getElementById("nameModal");
const userProfile = document.getElementById("userProfile");
const displayName = document.getElementById("displayName");
const videoContainer = document.querySelector('.video-container');

// Áudios
try {
  joinSound = new Audio('/sounds/join.mp3');
  leaveSound = new Audio('/sounds/leave.mp3');
  messageSound = new Audio('/sounds/message.mp3');
  raiseHandSound = new Audio('/sounds/raise-hand.mp3');
} catch (e) {
  joinSound = leaveSound = messageSound = raiseHandSound = { play: () => {} };
}

// ================================
// ✅ PeerJS — path correto com /myapp
// ================================
const peer = new Peer(undefined, {
  host: 'iver.space',
  port: 443,
  path: '/peerjs/myapp',
  secure: true,
  debug: 2,
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      // ✅ TURN server — essencial para conexões atrás de NAT/AWS
      // Se não tiver TURN próprio, use um serviço como Metered ou Twilio
      // { urls: 'turn:seu-turn-server:3478', username: 'user', credential: 'pass' }
    ]
  }
});

peer.on('open', (id) => {
  console.log('🔄 Peer conectado com ID:', id);
  window.myPeerId = id;

  if (currentRoom) {
    socket.emit('register-peer', { peerId: id });
    setTimeout(tryCallPendingPeers, 2000);
  }
});

// ================================
// ✅ FIX CRÍTICO: peer.on('call') usava 'peerId' indefinido
// Agora usa 'call.peer' corretamente
// ================================
peer.on('call', (call) => {
  console.log('📞 Recebendo chamada de:', call.peer);

  if (!localStream) {
    console.log('⚠️ Sem stream local, respondendo sem stream');
    call.answer();
  } else {
    call.answer(localStream);
  }

  // ✅ CORRIGIDO: era 'peerId' (undefined), agora é 'call.peer'
  call.on('stream', (remoteStream) => {
    console.log('✅ Stream recebido de:', call.peer);
    setupStreamListeners(remoteStream, call.peer);
    addRemoteVideo(call.peer, remoteStream);
  });

  call.on('close', () => {
    console.log('🔇 Chamada encerrada com:', call.peer);
    removeRemoteVideo(call.peer);
    delete peers[call.peer];
  });

  call.on('error', (err) => {
    console.error('❌ Erro na chamada recebida:', err);
  });

  peers[call.peer] = call;
});

peer.on('error', (err) => {
  console.error('❌ PeerJS erro:', err.type, err);
  if (err.type === 'unavailable-id' || err.type === 'invalid-id' || err.type === 'disconnected') {
    setTimeout(() => peer.reconnect(), 3000);
  }
});

// ================================
// Session Storage: Nome
// ================================
const savedName = sessionStorage.getItem('userName');
if (savedName) {
  userName = savedName;
  nameModal.style.display = 'none';
  userProfile.style.display = 'flex';
  displayName.textContent = userName;
  socket.emit("get-rooms");
} else {
  nameModal.style.display = 'flex';
}

// ================================
// Navegação
// ================================
document.querySelectorAll('nav a').forEach(link => {
  link.addEventListener('click', e => {
    e.preventDefault();
    const targetId = link.getAttribute('href').substring(1);
    document.querySelectorAll('nav a').forEach(a => a.classList.remove('active'));
    link.classList.add('active');
    document.querySelectorAll('.section').forEach(sec => sec.classList.remove('active'));
    const target = document.getElementById(targetId);
    if (target) target.classList.add('active');
  });
});

document.addEventListener('keydown', e => {
  if (e.ctrlKey) {
    switch (e.key.toLowerCase()) {
      case 'd': e.preventDefault(); toggleMic(); break;
      case 'e': e.preventDefault(); toggleCamera(); break;
      case 'k': e.preventDefault(); toggleChat(); break;
      case 'h': e.preventDefault(); toggleRaiseHand(); break;
    }
  }
});

// ================================
// Usuário
// ================================
function setUserName() {
  const nameInput = document.getElementById("userName");
  const name = nameInput.value.trim();
  if (!name) return showNotification("Informe seu nome!", 'warning');

  userName = name;
  sessionStorage.setItem('userName', userName);
  nameModal.style.display = 'none';
  userProfile.style.display = 'flex';
  displayName.textContent = userName;
  socket.emit("get-rooms");
  showNotification(`Bem-vindo, ${userName}!`, 'success');
}

// ================================
// Vídeo Remoto
// ================================
function addRemoteVideo(peerId, stream) {
  console.log('🎥 Adicionando vídeo remoto para:', peerId);

  let videoWrapper = document.getElementById(`video-${peerId}`);

  if (videoWrapper) {
    const existingVideo = videoWrapper.querySelector('video');
    if (existingVideo) {
      existingVideo.srcObject = stream;
      existingVideo.play().catch(e => console.log('Erro ao dar play:', e));
    }
    return;
  }

  videoWrapper = document.createElement('div');
  videoWrapper.className = 'video-wrapper';
  videoWrapper.id = `video-${peerId}`;

  const video = document.createElement('video');
  video.autoplay = true;
  video.playsInline = true;
  video.srcObject = stream;
  video.muted = false; // ✅ Áudio habilitado para remoto

  const label = document.createElement('div');
  label.className = 'video-label';
  label.innerHTML = `<i class="fas fa-user"></i> ${getNameByPeerId(peerId) || 'Participante'}`;

  videoWrapper.appendChild(video);
  videoWrapper.appendChild(label);
  videoContainer.appendChild(videoWrapper);

  // Play com retry
  const tryPlay = () => {
    video.play()
      .then(() => console.log('✅ Play iniciado para:', peerId))
      .catch(e => {
        console.log('⏳ Retry play para:', peerId, e);
        setTimeout(tryPlay, 500);
      });
  };
  setTimeout(tryPlay, 100);
}

function removeRemoteVideo(peerId) {
  const el = document.getElementById(`video-${peerId}`);
  if (el) el.remove();
}

function getNameByPeerId(peerId) {
  let name = null;
  participants.forEach((p) => {
    if (p.peerId === peerId) name = p.name;
  });
  return name;
}

function setupStreamListeners(stream, peerId) {
  stream.getTracks().forEach(track => {
    track.onended = () => console.log(`🔇 Track de ${peerId} encerrada`);
    track.onmute = () => console.log(`🔇 Track de ${peerId} mutada`);
    track.onunmute = () => console.log(`🎤 Track de ${peerId} desmutada`);
  });
}

// ================================
// callPeer — com retry
// ================================
function callPeer(peerId) {
  if (!peerId) return;
  if (peers[peerId]) {
    console.log('ℹ️ Já conectado com', peerId);
    return;
  }

  if (!localStream) {
    console.log('⏳ Aguardando stream local para chamar', peerId);
    setTimeout(() => callPeer(peerId), 1000);
    return;
  }

  console.log('📞 Chamando peer:', peerId);

  try {
    const call = peer.call(peerId, localStream);

    // ✅ CORRIGIDO: usava 'peerId' do escopo externo, agora captura corretamente
    call.on('stream', (remoteStream) => {
      console.log('✅ Stream recebido de:', peerId);
      setupStreamListeners(remoteStream, peerId);
      addRemoteVideo(peerId, remoteStream);
    });

    call.on('close', () => {
      console.log('🔇 Chamada encerrada com:', peerId);
      removeRemoteVideo(peerId);
      delete peers[peerId];
    });

    call.on('error', (err) => {
      console.error('❌ Erro na chamada para', peerId, ':', err);
      delete peers[peerId];
    });

    peers[peerId] = call;
  } catch (err) {
    console.error('❌ Erro ao iniciar chamada:', err);
  }
}

function tryCallPendingPeers() {
  if (!window.myPeerId) return;

  participants.forEach((participant, socketId) => {
    if (socketId !== socket.id && participant.peerId && !peers[participant.peerId]) {
      console.log('📞 Chamando peer pendente:', participant.peerId);
      callPeer(participant.peerId);
    }
  });
}

// ================================
// Media
// ================================
async function initializeMedia() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    videoEnabled = true;
    audioEnabled = true;
    localVideo.srcObject = localStream;
    updateMediaButtons();
    startAudioVisualization();
    console.log('✅ Mídia inicializada');
  } catch (err) {
    console.error("Erro mídia:", err);
    // Tenta só áudio
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
      audioEnabled = true;
      videoEnabled = false;
      localVideo.srcObject = localStream;
      updateMediaButtons();
      showNotification("Câmera não disponível, usando só áudio", 'warning');
    } catch (e) {
      showNotification("Erro ao acessar câmera/microfone: " + err.message, 'error');
    }
  }
}

function startAudioVisualization() {
  if (audioContext || !localStream) return;

  audioContext = new (window.AudioContext || window.webkitAudioContext)();
  analyser = audioContext.createAnalyser();
  const source = audioContext.createMediaStreamSource(localStream);
  source.connect(analyser);
  analyser.fftSize = 256;

  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  audioVisualizerInterval = setInterval(() => {
    analyser.getByteFrequencyData(dataArray);
    const avg = dataArray.reduce((a, b) => a + b) / bufferLength;
    const speaking = avg > 30;
    const wrapper = document.querySelector('.video-wrapper:first-child');
    if (wrapper) {
      wrapper.classList.toggle('speaking', speaking);
      socket.emit("speaking-status", { room: currentRoom, speaking });
    }
  }, 100);
}

// ================================
// Toggle Video/Audio/Screen
// ================================
async function toggleCamera() {
  if (screenBlockedByHost.get(socket.id) && !videoEnabled) {
    return showNotification("Bloqueado de usar câmera", 'warning');
  }

  videoEnabled = !videoEnabled;
  updateCameraUI();

  try {
    const oldTrack = localStream?.getVideoTracks()[0];

    if (videoEnabled) {
      const newStream = await navigator.mediaDevices.getUserMedia({ video: true });
      const newTrack = newStream.getVideoTracks()[0];

      if (oldTrack) {
        oldTrack.stop();
        localStream.removeTrack(oldTrack);
      }
      localStream.addTrack(newTrack);
      localVideo.srcObject = localStream;

      Object.values(peers).forEach(call => {
        const sender = call.peerConnection?.getSenders().find(s => s.track?.kind === 'video');
        if (sender) sender.replaceTrack(newTrack);
      });
    } else if (oldTrack) {
      oldTrack.enabled = false;
      Object.values(peers).forEach(call => {
        const sender = call.peerConnection?.getSenders().find(s => s.track?.kind === 'video');
        if (sender) sender.replaceTrack(null).catch(() => {});
      });
    }
  } catch (err) {
    console.error(err);
    videoEnabled = !videoEnabled;
    showNotification("Erro alternando câmera", 'error');
  }
}

function toggleMic() {
  if (mutedByHost.get(socket.id) && audioEnabled) {
    return showNotification("Você está mutado pelo host", 'warning');
  }
  audioEnabled = !audioEnabled;
  localStream?.getAudioTracks().forEach(t => t.enabled = audioEnabled);
  updateMicUI();
}

async function shareScreen() {
  if (screenBlockedByHost.get(socket.id)) {
    return showNotification("Bloqueado de compartilhar tela", 'warning');
  }

  try {
    if (!screenSharing) {
      screenSharingStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      const screenTrack = screenSharingStream.getVideoTracks()[0];

      screenTrack.onended = stopScreenSharing;

      Object.values(peers).forEach(call => {
        const sender = call.peerConnection?.getSenders().find(s => s.track?.kind === 'video');
        if (sender) sender.replaceTrack(screenTrack);
      });

      localVideo.srcObject = screenSharingStream;
      videoContainer.classList.add('screensharing', 'local-share');
      screenSharing = true;
      showNotification("Compartilhando tela", 'success');
      socket.emit("screen-sharing-started", { room: currentRoom });
    } else {
      stopScreenSharing();
    }
  } catch (err) {
    if (err.name !== 'NotAllowedError') {
      showNotification("Erro ao compartilhar tela", 'error');
    }
    console.error(err);
  }
}

function stopScreenSharing() {
  screenSharingStream?.getTracks().forEach(t => t.stop());

  if (localStream) {
    const track = localStream.getVideoTracks()[0];
    Object.values(peers).forEach(call => {
      const sender = call.peerConnection?.getSenders().find(s => s.track?.kind === 'video');
      if (sender && track) sender.replaceTrack(track);
    });
    localVideo.srcObject = localStream;
  }

  videoContainer.classList.remove('screensharing', 'local-share');
  screenSharing = false;
  socket.emit("screen-sharing-stopped", { room: currentRoom });
}

// ================================
// UI helpers
// ================================
function updateCameraUI() {
  document.querySelectorAll('#camBtn').forEach(btn => {
    if (btn.querySelector('span')) {
      btn.innerHTML = videoEnabled
        ? '<i class="fas fa-video"></i><span>Desligar Câmera</span>'
        : '<i class="fas fa-video-slash"></i><span>Ligar Câmera</span>';
    } else {
      btn.innerHTML = videoEnabled
        ? '<i class="fas fa-video"></i>'
        : '<i class="fas fa-video-slash"></i>';
      btn.classList.toggle('off', !videoEnabled);
    }
  });
}

function updateMicUI() {
  document.querySelectorAll('#micBtn').forEach(btn => {
    if (btn.querySelector('span')) {
      btn.innerHTML = audioEnabled
        ? '<i class="fas fa-microphone"></i><span>Mutar Mic</span>'
        : '<i class="fas fa-microphone-slash"></i><span>Desmutar Mic</span>';
    } else {
      btn.innerHTML = audioEnabled
        ? '<i class="fas fa-microphone"></i>'
        : '<i class="fas fa-microphone-slash"></i>';
      btn.classList.toggle('off', !audioEnabled);
    }
  });
}

function updateMediaButtons() {
  updateCameraUI();
  updateMicUI();
}

// ================================
// Room Functions
// ================================
function createRoom() {
  if (!userName) return showNotification("Informe seu nome primeiro!", 'warning');

  const roomName = document.getElementById("roomName").value.trim();
  const password = document.getElementById("roomPassword").value;

  if (!roomName || !password) return showNotification("Preencha todos os campos!", 'warning');

  socket.emit("create-room", { roomName, password, creator: userName, creatorId: socket.id });
  userCreatedRoom = true;
  userRooms.add(roomName);
  updateCreateRoomUI();
}

function joinRoomPrompt(roomName) {
  if (!userName) return showNotification("Informe seu nome primeiro!", 'warning');

  const password = prompt(`Digite a senha da sala "${roomName}":`);
  if (!password) return;

  socket.emit('join-room', { roomName, password, userName });
}

function joinRoomFromUrl() {
  const urlParams = new URLSearchParams(window.location.search);
  const room = urlParams.get('room');

  if (room && !currentRoom && userName) {
    const password = prompt(`Digite a senha da sala "${room}":`);
    if (password) socket.emit("join-room", { roomName: room, password, userName });
  }
}

function createInviteLink() {
  if (!currentRoom) return;

  const existingInvite = document.querySelector('.invite-container');
  if (existingInvite) existingInvite.remove();

  const inviteUrl = `${window.location.origin}?room=${currentRoom}`;
  const meetingHeader = document.querySelector('.meeting-header');
  const inviteContainer = document.createElement('div');
  inviteContainer.className = 'invite-container';
  inviteContainer.innerHTML = `
    <div class="invite-link">
      <input type="text" id="inviteLink" value="${inviteUrl}" readonly />
      <button onclick="copyInviteLink()" class="btn-copy">
        <i class="fas fa-copy"></i>
      </button>
    </div>
  `;
  meetingHeader.appendChild(inviteContainer);
}

function copyInviteLink() {
  const inviteInput = document.getElementById("inviteLink");
  inviteInput.select();
  document.execCommand('copy');
  showNotification("Link copiado!", 'success');
}

function deleteRoom(roomName) {
  if (userRooms.has(roomName)) {
    if (confirm("Tem certeza que deseja excluir esta sala?")) {
      socket.emit("delete-room", { roomName, userId: socket.id });
      userRooms.delete(roomName);
      userCreatedRoom = false;
      updateCreateRoomUI();
    }
  }
}

function updateCreateRoomUI() {
  const createRoomCard = document.querySelector('.create-room-card');
  if (createRoomCard) createRoomCard.classList.toggle('disabled', userCreatedRoom);
}

function displayRooms(rooms) {
  roomsList.innerHTML = "";

  if (rooms.length === 0) {
    roomsList.innerHTML = '<div class="no-rooms">Nenhuma sala disponível no momento</div>';
    return;
  }

  rooms.forEach((room) => {
    const roomCard = document.createElement("div");
    roomCard.className = "room-card";
    const isCreator = userRooms.has(room.name);

    roomCard.innerHTML = `
      <div class="room-info">
        <i class="fas fa-door-open"></i>
        <span>${room.name}</span>
        <span class="creator-badge"><i class="fas fa-crown"></i> ${room.creator || 'Anônimo'}</span>
        <span class="participant-count"><i class="fas fa-user"></i> ${room.participants || 0}/10</span>
      </div>
      <div class="room-actions">
        <button onclick="joinRoomPrompt('${room.name}')" class="btn-enter" ${!userName ? 'disabled' : ''}>
          <i class="fas fa-sign-in-alt"></i> Entrar
        </button>
        ${isCreator ? `<button onclick="deleteRoom('${room.name}')" class="btn-delete"><i class="fas fa-trash"></i></button>` : ''}
      </div>
    `;
    roomsList.appendChild(roomCard);
  });
}

// ================================
// ✅ FIX CHAT: usa display block/none em vez de classe minimized
// ================================
function toggleChat() {
  chatVisible = !chatVisible;
  const chatPanel = document.getElementById("chatPanel");
  const chatBtn = document.getElementById('toggleChat');

  chatPanel.style.display = chatVisible ? 'flex' : 'none';

  if (chatBtn) chatBtn.classList.toggle('active', chatVisible);

  if (chatVisible) {
    unreadMessages = 0;
    updateChatBadge();
    // Foca no input
    setTimeout(() => document.getElementById('chatInput')?.focus(), 100);
  }
}

function sendMessage() {
  const input = document.getElementById("chatInput");
  const message = input.value.trim();

  if (message && currentRoom) {
    socket.emit("chat-message", {
      room: currentRoom,
      message: message,
      sender: socket.id,
      senderName: userName
    });
    displayMessage(message, 'own', 'Você');
    input.value = '';
  }
}

// Enviar com Enter
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.activeElement?.id === 'chatInput') {
    sendMessage();
  }
});

function updateChatBadge() {
  const chatBadge = document.getElementById('chatBadge');
  if (chatBadge) {
    chatBadge.textContent = unreadMessages;
    chatBadge.style.display = unreadMessages > 0 ? 'flex' : 'none';
  }
}

function displayMessage(message, type, senderName) {
  const chatMessages = document.getElementById("chatMessages");
  const messageDiv = document.createElement("div");
  messageDiv.className = `message ${type}`;
  messageDiv.innerHTML = `
    <div class="sender">${senderName}</div>
    <div class="text">${message}</div>
  `;
  chatMessages.appendChild(messageDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ================================
// Raise Hand
// ================================
function toggleRaiseHand() {
  raisedHand = !raisedHand;
  socket.emit("raise-hand", { room: currentRoom, raised: raisedHand, userName });

  if (raisedHand) {
    showNotification("Você levantou a mão", 'info');
    const localWrapper = document.querySelector('.video-wrapper:first-child');
    if (localWrapper && !document.getElementById('handIndicator')) {
      const handIndicator = document.createElement('div');
      handIndicator.className = 'raised-hand-indicator';
      handIndicator.innerHTML = '<i class="fas fa-hand-paper"></i> Mão levantada';
      handIndicator.id = 'handIndicator';
      localWrapper.appendChild(handIndicator);
    }
  } else {
    document.getElementById('handIndicator')?.remove();
  }
}

// ================================
// Participantes
// ================================
function addParticipantsPanel() {
  document.getElementById('participantsPanel')?.remove();

  const panel = document.createElement('div');
  panel.className = 'participants-panel minimized';
  panel.id = 'participantsPanel';
  panel.innerHTML = `
    <div class="participants-header">
      <h3><i class="fas fa-users"></i> Participantes</h3>
      <span class="participants-count" id="participantsCount">1</span>
      <button onclick="toggleParticipantsPanel()" class="btn-close"><i class="fas fa-times"></i></button>
    </div>
    <div class="participants-list" id="participantsList"></div>
  `;
  document.body.appendChild(panel);
  addPanelToggles();
}

function addPanelToggles() {
  document.querySelector('.panel-toggle')?.remove();

  const toggleContainer = document.createElement('div');
  toggleContainer.className = 'panel-toggle';
  toggleContainer.innerHTML = `
    <button onclick="toggleParticipantsPanel()" class="panel-toggle-btn" id="toggleParticipants" title="Participantes">
      <i class="fas fa-users"></i>
      <span class="badge" id="participantsBadge" style="display:none;">0</span>
    </button>
    <button onclick="toggleChat()" class="panel-toggle-btn" id="toggleChat" title="Chat">
      <i class="fas fa-comment"></i>
      <span class="badge" id="chatBadge" style="display:none;">0</span>
    </button>
  `;
  document.body.appendChild(toggleContainer);
}

function toggleParticipantsPanel() {
  const panel = document.getElementById('participantsPanel');
  const btn = document.getElementById('toggleParticipants');
  participantsMinimized = !participantsMinimized;
  panel.classList.toggle('minimized', participantsMinimized);
  btn.classList.toggle('active', !participantsMinimized);
}

function updateParticipantsList() {
  const list = document.getElementById('participantsList');
  const count = document.getElementById('participantsCount');
  if (!list) return;

  const totalParticipants = participants.size + 1;
  if (count) count.textContent = totalParticipants;

  let html = `
    <div class="participant-item">
      <i class="fas fa-user"></i>
      <div class="participant-info">
        <div class="participant-name">
          ${userName} (Você)
          ${userCreatedRoom ? '<i class="fas fa-crown" style="color:#ffc107;"></i>' : ''}
        </div>
        <div class="participant-status">
          ${videoEnabled ? '📹' : '🚫'} ${audioEnabled ? '🎤' : '🔇'} ${raisedHand ? '✋' : ''}
        </div>
      </div>
    </div>
  `;

  participants.forEach((participant, id) => {
    html += `
      <div class="participant-item" data-id="${id}">
        <i class="fas fa-user"></i>
        <div class="participant-info">
          <div class="participant-name">${participant.name}</div>
          <div class="participant-status">
            ${participant.videoEnabled ? '📹' : '🚫'}
            ${participant.audioEnabled ? '🎤' : '🔇'}
            ${participant.handRaised ? '✋' : ''}
          </div>
        </div>
      </div>
    `;
  });

  list.innerHTML = html;
}

function addHostButton() {
  if (!userCreatedRoom) return;
  const toggleContainer = document.querySelector('.panel-toggle');
  if (toggleContainer && !document.querySelector('.host-btn')) {
    const hostBtn = document.createElement('button');
    hostBtn.onclick = showHostPanel;
    hostBtn.className = 'panel-toggle-btn host-btn';
    hostBtn.title = 'Controles do Host';
    hostBtn.innerHTML = '<i class="fas fa-crown"></i>';
    toggleContainer.appendChild(hostBtn);
  }
}

function showHostPanel() {
  document.getElementById('hostModal')?.remove();

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.id = 'hostModal';
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <i class="fas fa-crown"></i>
        <h2>Controles do Host</h2>
        <button onclick="document.getElementById('hostModal').remove()" style="position:absolute;top:1rem;right:1rem;background:none;border:none;font-size:1.2rem;cursor:pointer;">
          <i class="fas fa-times"></i>
        </button>
      </div>
      <div class="host-controls-list" id="hostControlsList"></div>
    </div>
  `;
  document.body.appendChild(modal);
  updateHostControlsList();
}

function updateHostControlsList() {
  const list = document.getElementById('hostControlsList');
  if (!list) return;

  let html = '<h3>Participantes</h3>';
  participants.forEach((participant, id) => {
    const isMuted = mutedByHost.get(id);
    const isBlocked = screenBlockedByHost.get(id);
    html += `
      <div class="participant-item" style="margin-bottom:1rem;padding:1rem;background:#f8f9fa;border-radius:8px;">
        <strong>${participant.name}</strong>
        <div style="display:flex;gap:0.5rem;margin-top:0.5rem;">
          <button onclick="toggleMuteParticipant('${id}')" style="padding:0.5rem;border-radius:5px;border:none;cursor:pointer;background:${isMuted ? '#dc3545' : '#6c757d'};color:#fff;">
            <i class="fas ${isMuted ? 'fa-microphone-slash' : 'fa-microphone'}"></i>
          </button>
          <button onclick="toggleScreenBlock('${id}')" style="padding:0.5rem;border-radius:5px;border:none;cursor:pointer;background:${isBlocked ? '#dc3545' : '#6c757d'};color:#fff;">
            <i class="fas fa-desktop"></i>
          </button>
          <button onclick="kickParticipant('${id}')" style="padding:0.5rem;border-radius:5px;border:none;cursor:pointer;background:#dc3545;color:#fff;">
            <i class="fas fa-user-slash"></i>
          </button>
        </div>
      </div>
    `;
  });

  list.innerHTML = html;
}

// Host actions
function toggleMuteParticipant(userId) {
  const muted = !mutedByHost.get(userId);
  mutedByHost.set(userId, muted);
  socket.emit("host-mute", { room: currentRoom, userId, mute: muted });
  updateHostControlsList();
}

function toggleScreenBlock(userId) {
  const blocked = !screenBlockedByHost.get(userId);
  screenBlockedByHost.set(userId, blocked);
  socket.emit("host-screen-block", { room: currentRoom, userId, block: blocked });
  updateHostControlsList();
}

function kickParticipant(userId) {
  if (confirm("Expulsar este participante?")) {
    socket.emit("host-kick", { room: currentRoom, userId });
  }
}

// Layout
function toggleLayout() {
  layoutMode = layoutMode === 'grid' ? 'speaker' : 'grid';
  const container = document.querySelector('.video-container');
  container.classList.toggle('grid-layout', layoutMode === 'grid');

  document.querySelectorAll('.layout-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.layout === layoutMode);
  });
}

// Sound
function toggleSounds() {
  soundsEnabled = !soundsEnabled;
}

function playSound(audio) {
  if (soundsEnabled && audio?.play) {
    audio.play().catch(() => {});
  }
}

// ================================
// ✅ Socket Events — room-joined SEM duplicata
// ================================
socket.on("rooms-list", displayRooms);

socket.on("room-error", (msg) => {
  showNotification(msg, 'error');
  if (msg.includes('já criou') || msg.includes('existe')) {
    userCreatedRoom = false;
    userRooms.clear();
    updateCreateRoomUI();
  }
});

// ✅ Único handler para room-joined
socket.on("room-joined", async (roomData) => {
  console.log('🎯 Entrando na sala:', roomData);
  currentRoom = roomData.name;
  roomCreator = roomData.creator;
  roomNameDisplay.textContent = `Sala: ${roomData.name}`;

  homeSection.classList.remove('active');
  meetingSection.classList.add('active');
  meetingSection.style.display = 'flex';

  createInviteLink();
  addParticipantsPanel();

  await initializeMedia();

  // Registra peerId
  const registerPeer = (id) => {
    console.log('📝 Registrando peer:', id);
    socket.emit('register-peer', { peerId: id });
  };

  if (window.myPeerId) {
    registerPeer(window.myPeerId);
  } else {
    peer.once('open', registerPeer);
  }

  // Chama participantes existentes
  setTimeout(() => {
    if (roomData.participants?.length > 0) {
      roomData.participants.forEach(p => {
        if (p.socketId !== socket.id && p.peerId) {
          console.log('📞 Chamando participante existente:', p.peerId);
          callPeer(p.peerId);
        }
      });
    }
    addHostButton();
  }, 2500);
});

socket.on("user-connected", ({ socketId, name, peerId }) => {
  console.log('👤 Usuário conectado:', { socketId, name, peerId });
  showToast(`${name} entrou na sala`, 'info');
  playSound(joinSound);

  window.userNames = window.userNames || {};
  window.userNames[socketId] = name;

  participants.set(socketId, { name, speaking: false, handRaised: false, videoEnabled: false, audioEnabled: true, peerId });
  updateParticipantsList();

  if (peerId) {
    setTimeout(() => callPeer(peerId), 1500);
  }
});

socket.on("user-disconnected", (userId) => {
  const name = getUserName(userId);
  showToast(`${name} saiu da sala`, 'info');
  playSound(leaveSound);

  const participant = participants.get(userId);
  if (participant?.peerId) {
    removeRemoteVideo(participant.peerId);
    if (peers[participant.peerId]) {
      peers[participant.peerId].close();
      delete peers[participant.peerId];
    }
  }
  removeRemoteVideo(userId);

  participants.delete(userId);
  updateParticipantsList();
});

socket.on("peer-registered", ({ socketId, peerId }) => {
  console.log(`✅ Peer registrado: ${socketId} -> ${peerId}`);

  const participant = participants.get(socketId);
  if (participant) {
    participant.peerId = peerId;
    updateParticipantsList();
  } else {
    window.userNames = window.userNames || {};
    participants.set(socketId, {
      name: window.userNames[socketId] || 'Participante',
      speaking: false, handRaised: false,
      videoEnabled: false, audioEnabled: true, peerId
    });
    updateParticipantsList();
  }

  if (socketId !== socket.id) {
    setTimeout(() => callPeer(peerId), 800);
  }
});

socket.on("chat-message", (data) => {
  displayMessage(data.message, 'other', data.senderName || 'Anônimo');

  if (!chatVisible) {
    unreadMessages++;
    updateChatBadge();
  }
  playSound(messageSound);
});

socket.on("user-muted", ({ userId, muted }) => {
  const participant = participants.get(userId);
  if (participant) { participant.audioEnabled = !muted; updateParticipantsList(); }

  if (userId === socket.id) {
    audioEnabled = !muted;
    localStream?.getAudioTracks().forEach(t => t.enabled = audioEnabled);
    updateMicUI();
    showNotification(muted ? "Você foi mutado pelo host" : "Você foi desmutado", muted ? 'warning' : 'info');
  }
});

socket.on("screen-blocked", ({ userId, blocked }) => {
  if (userId === socket.id) {
    screenBlockedByHost.set(socket.id, blocked);
    if (blocked && screenSharing) stopScreenSharing();
    if (blocked) showNotification("Você foi bloqueado de compartilhar tela", 'warning');
  }
});

socket.on("screen-sharing-started", ({ userId }) => {
  if (userId !== socket.id) videoContainer.classList.add('screensharing');
});

socket.on("screen-sharing-stopped", ({ userId }) => {
  if (userId !== socket.id && !screenSharing) videoContainer.classList.remove('screensharing');
});

socket.on("hand-raised", ({ userId, userName: uName }) => {
  const p = participants.get(userId);
  if (p) { p.handRaised = true; updateParticipantsList(); }
  showToast(`${uName} levantou a mão ✋`, 'info');
  playSound(raiseHandSound);
});

socket.on("hand-lowered", ({ userId }) => {
  const p = participants.get(userId);
  if (p) { p.handRaised = false; updateParticipantsList(); }
});

socket.on("user-speaking", ({ userId, speaking }) => {
  const wrapper = document.getElementById(`video-${userId}`);
  if (wrapper) wrapper.classList.toggle('speaking', speaking);
});

socket.on("room-deleted", (roomName) => {
  if (currentRoom === roomName) {
    leaveRoom();
    showNotification("A sala foi fechada pelo criador", 'warning');
  }
});

socket.on("user-kicked", () => {
  showNotification("Você foi removido da sala", 'error');
  leaveRoom();
});

// ================================
// Leave Room
// ================================
function leaveRoom() {
  Object.values(peers).forEach(call => call.close());
  peers = {};

  localStream?.getTracks().forEach(t => t.stop());
  localStream = null;

  screenSharingStream?.getTracks().forEach(t => t.stop());

  if (audioVisualizerInterval) { clearInterval(audioVisualizerInterval); audioVisualizerInterval = null; }
  if (audioContext) { audioContext.close(); audioContext = null; }

  if (currentRoom && userRooms.has(currentRoom)) {
    userCreatedRoom = false;
    userRooms.delete(currentRoom);
    updateCreateRoomUI();
  }

  document.getElementById('participantsPanel')?.remove();
  document.querySelector('.panel-toggle')?.remove();

  document.querySelectorAll('.video-wrapper:not(:first-child)').forEach(el => el.remove());

  // Reseta vídeo local
  if (localVideo) localVideo.srcObject = null;

  // Esconde chat se aberto
  const chatPanel = document.getElementById('chatPanel');
  if (chatPanel) chatPanel.style.display = 'none';
  chatVisible = false;

  currentRoom = null;
  participants.clear();

  meetingSection.classList.remove('active');
  meetingSection.style.display = 'none';
  homeSection.classList.add('active');

  socket.emit("leave-room");
}

// ================================
// Utilities
// ================================
function getUserName(userId) {
  return window.userNames?.[userId] || participants.get(userId)?.name || 'Anônimo';
}

function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  const icons = { error: 'fa-exclamation-circle', success: 'fa-check-circle', warning: 'fa-exclamation-triangle', info: 'fa-info-circle' };
  notification.innerHTML = `<i class="fas ${icons[type] || icons.info}"></i><span>${message}</span>`;
  document.body.appendChild(notification);
  setTimeout(() => notification.remove(), 3000);
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast-notification ${type}`;
  const icons = { error: 'fa-exclamation-circle', success: 'fa-check-circle', info: 'fa-info-circle' };
  toast.innerHTML = `<i class="fas ${icons[type] || icons.info}"></i><span>${message}</span>`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ================================
// Sound/Layout toggles
// ================================
const soundToggle = document.createElement('div');
soundToggle.className = 'sound-toggle';
soundToggle.innerHTML = `
  <button onclick="toggleSounds()" class="active" data-sound="on"><i class="fas fa-volume-up"></i></button>
  <button onclick="toggleSounds()" data-sound="off"><i class="fas fa-volume-mute"></i></button>
`;
document.body.appendChild(soundToggle);

// ================================
// Init
// ================================
window.addEventListener('load', () => {
  if (userName) joinRoomFromUrl();
});

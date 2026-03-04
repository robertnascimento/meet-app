// ================================
// iDev Meet - app.js (SEM VALIDAÇÃO DE CRIAÇÃO)
// ================================

const socket = io();
let localStream = null;
let peers = {}; // Conexões com outros participantes
let chatVisible = false;

// States
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

// DOM Elements
const localVideo = document.getElementById("localVideo");
const roomsList = document.getElementById("roomsList");
const homeSection = document.getElementById("home");
const meetingSection = document.getElementById("meeting");
const roomNameDisplay = document.getElementById("roomNameDisplay");
const nameModal = document.getElementById("nameModal");
const userProfile = document.getElementById("userProfile");
const displayName = document.getElementById("displayName");
const videoContainer = document.querySelector('.video-container');

// ================================
// Áudios
// ================================
try {
  joinSound = new Audio('/sounds/join.mp3');
  leaveSound = new Audio('/sounds/leave.mp3');
  messageSound = new Audio('/sounds/message.mp3');
  raiseHandSound = new Audio('/sounds/raise-hand.mp3');
} catch (e) {
  console.warn("Áudio não disponível:", e);
  joinSound = leaveSound = messageSound = raiseHandSound = { play: () => {} };
}

// ================================
// PeerJS
// ================================
const peer = new Peer(undefined, {
  host: 'iver.space',
  port: 443,
  path: '/peerjs/myapp',
  secure: true,
  debug: 3
});

peer.on('open', id => {
  console.log('✅ PeerJS conectado com ID:', id);
  window.myPeerId = id;
  if (currentRoom) socket.emit('register-peer', { peerId: id });
});

peer.on('call', call => {
  if (!localStream) {
    call.answer();
    return;
  }
  call.answer(localStream);
  call.on('stream', remoteStream => addRemoteVideo(call.peer, remoteStream));
  call.on('error', err => console.error('Erro na chamada:', err));
  peers[call.peer] = call;
});

peer.on('error', err => {
  console.error('❌ PeerJS erro:', err);
  if (err.type === 'unavailable-id' || err.type === 'invalid-id') {
    setTimeout(() => peer.reconnect(), 2000);
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
// Navegação e shortcuts
// ================================
document.querySelectorAll('nav a').forEach(link => {
  link.addEventListener('click', e => {
    e.preventDefault();
    const targetId = link.getAttribute('href').substring(1);
    document.querySelectorAll('nav a').forEach(a => a.classList.remove('active'));
    link.classList.add('active');
    document.querySelectorAll('.section').forEach(sec => sec.classList.remove('active'));
    document.getElementById(targetId).classList.add('active');
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
// Funções de Vídeo Remoto
// ================================
function addRemoteVideo(peerId, stream) {
  const oldVideo = document.getElementById(`video-${peerId}`);
  if (oldVideo) oldVideo.remove();

  const videoWrapper = document.createElement('div');
  videoWrapper.className = 'video-wrapper';
  videoWrapper.id = `video-${peerId}`;
  
  const video = document.createElement('video');
  video.id = `remote-video-${peerId}`;
  video.autoplay = true;
  video.playsInline = true;
  video.srcObject = stream;
  
  const label = document.createElement('div');
  label.className = 'video-label';
  label.innerHTML = `<i class="fas fa-user"></i> ${getUserName(peerId) || 'Participante'}`;
  
  videoWrapper.appendChild(video);
  videoWrapper.appendChild(label);
  videoContainer.appendChild(videoWrapper);
}

function updateCameraUI() {
  const camBtn = document.getElementById("camBtn");
  const overlayCamBtn = document.querySelector('.video-controls-overlay #camBtn');
  
  if (videoEnabled) {
    camBtn.innerHTML = '<i class="fas fa-video"></i><span>Desligar Câmera</span>';
    if (overlayCamBtn) overlayCamBtn.classList.remove('off');
  } else {
    camBtn.innerHTML = '<i class="fas fa-video"></i><span>Ligar Câmera</span>';
    if (overlayCamBtn) overlayCamBtn.classList.add('off');
  }
}

function updateMicUI() {
  const micBtn = document.getElementById("micBtn");
  const overlayMicBtn = document.querySelector('.video-controls-overlay #micBtn');
  
  if (audioEnabled) {
    micBtn.innerHTML = '<i class="fas fa-microphone"></i><span>Mutar Mic</span>';
    if (overlayMicBtn) {
      overlayMicBtn.classList.remove('off');
      overlayMicBtn.innerHTML = '<i class="fas fa-microphone"></i>';
    }
  } else {
    micBtn.innerHTML = '<i class="fas fa-microphone-slash"></i><span>Desmutar Mic</span>';
    if (overlayMicBtn) {
      overlayMicBtn.classList.add('off');
      overlayMicBtn.innerHTML = '<i class="fas fa-microphone-slash"></i>';
    }
  }
}

function callPeer(peerId) {
  if (!peerId || !localStream) {
    console.log('Aguardando peerId ou stream local');
    return;
  }
  
  console.log('📞 Chamando peer:', peerId);
  
  if (peers[peerId]) {
    console.log('Já existe conexão com', peerId);
    return;
  }
  
  const call = peer.call(peerId, localStream);
  
  call.on('stream', (remoteStream) => {
    console.log('📹 Stream recebido de:', peerId);
    addRemoteVideo(peerId, remoteStream);
  });
  
  call.on('error', (err) => {
    console.error('Erro na chamada:', err);
  });
  
  peers[peerId] = call;
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
  } catch (err) {
    console.error("Erro media:", err);
    showNotification("Erro ao acessar câmera/microfone", 'error');
  }
}

function startAudioVisualization() {
  if (!audioContext && localStream) {
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
    const oldTrack = localStream.getVideoTracks()[0];
    if (videoEnabled) {
      const newTrack = (await navigator.mediaDevices.getUserMedia({ video: true })).getVideoTracks()[0];
      if (oldTrack) { oldTrack.stop(); localStream.removeTrack(oldTrack); }
      localStream.addTrack(newTrack);
      localVideo.srcObject = localStream;
      Object.values(peers).forEach(call => {
        const sender = call.peerConnection.getSenders().find(s => s.track?.kind==='video');
        if (sender) sender.replaceTrack(newTrack);
      });
    } else if (oldTrack) {
      oldTrack.stop();
      localStream.removeTrack(oldTrack);
      Object.values(peers).forEach(call => {
        const sender = call.peerConnection.getSenders().find(s => s.track?.kind==='video');
        if (sender) sender.replaceTrack(null);
      });
    }
  } catch(err) {
    console.error(err);
    showNotification("Erro alternando câmera", 'error');
  }
}

function toggleMic() {
  if (mutedByHost.get(socket.id) && audioEnabled) return showNotification("Você está mutado", 'warning');
  audioEnabled = !audioEnabled;
  localStream?.getAudioTracks().forEach(t => t.enabled = audioEnabled);
  updateMicUI();
}

async function shareScreen() {
  if (screenBlockedByHost.get(socket.id)) return showNotification("Bloqueado de compartilhar tela", 'warning');

  try {
    if (!screenSharing) {
      screenSharingStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      const screenTrack = screenSharingStream.getVideoTracks()[0];
      screenTrack.onended = stopScreenSharing;
      Object.values(peers).forEach(call => {
        const sender = call.peerConnection.getSenders().find(s => s.track?.kind==='video');
        if (sender) sender.replaceTrack(screenTrack);
      });
      localVideo.srcObject = screenSharingStream;
      videoContainer.classList.add('screensharing','local-share');
      screenSharing = true;
      showNotification("Compartilhando tela", 'success');
      socket.emit("screen-sharing-started", { room: currentRoom });
    } else stopScreenSharing();
  } catch (err) {
    console.error(err);
    showNotification("Erro compartilhando tela", 'error');
  }
}

function stopScreenSharing() {
  screenSharingStream?.getTracks().forEach(t => t.stop());
  if (videoEnabled && localStream) {
    const track = localStream.getVideoTracks()[0];
    Object.values(peers).forEach(call => {
      const sender = call.peerConnection.getSenders().find(s => s.track?.kind==='video');
      if (sender) sender.replaceTrack(track);
    });
    localVideo.srcObject = localStream;
  }
  videoContainer.classList.remove('screensharing','local-share');
  screenSharing = false;
  socket.emit("screen-sharing-stopped", { room: currentRoom });
}

// ================================
// Room Functions
// ================================
function createRoom() {
  if (!userName) {
    showNotification("Você precisa informar seu nome primeiro!", 'warning');
    return;
  }

  const roomName = document.getElementById("roomName").value;
  const password = document.getElementById("roomPassword").value;

  if (!roomName || !password) {
    showNotification("Preencha todos os campos!", 'warning');
    return;
  }

  socket.emit("create-room", { 
    roomName, 
    password,
    creator: userName,
    creatorId: socket.id
  });

  // UI temporária até o server confirmar
  userCreatedRoom = true;
  userRooms.add(roomName);
  updateCreateRoomUI();
}

function joinRoomPrompt(roomName) {
  if (!userName) {
    showNotification("Você precisa informar seu nome primeiro!", 'warning');
    return;
  }
  
  const password = prompt(`Digite a senha da sala "${roomName}":`);
  if (!password) return;
  
  socket.emit('join-room', { 
    roomName, 
    password, 
    userName 
  });
}

function joinRoomFromUrl() {
  const urlParams = new URLSearchParams(window.location.search);
  const room = urlParams.get('room');
  
  if (room && !currentRoom && userName) {
    const password = prompt(`Digite a senha da sala "${room}":`);
    if (password) {
      socket.emit("join-room", {
        roomName: room,
        password: password,
        userName: userName
      });
    }
  }
}

function createInviteLink() {
  if (currentRoom) {
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
  if (userCreatedRoom) {
    createRoomCard.classList.add('disabled');
  } else {
    createRoomCard.classList.remove('disabled');
  }
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
        <span class="creator-badge">
          <i class="fas fa-crown"></i> ${room.creator || 'Anônimo'}
        </span>
        <span class="participant-count">
          <i class="fas fa-user"></i> ${room.participants || 0}/10
        </span>
      </div>
      <div class="room-actions">
        <button onclick="joinRoomPrompt('${room.name}')" class="btn-enter" ${!userName ? 'disabled' : ''}>
          <i class="fas fa-sign-in-alt"></i> Entrar
        </button>
        ${isCreator ? `
          <button onclick="deleteRoom('${room.name}')" class="btn-delete">
            <i class="fas fa-trash"></i>
          </button>
        ` : ''}
      </div>
    `;
    roomsList.appendChild(roomCard);
  });
}

// ================================
// Raise Hand
// ================================
function toggleRaiseHand() {
  raisedHand = !raisedHand;
  
  socket.emit("raise-hand", {
    room: currentRoom,
    raised: raisedHand,
    userName: userName
  });
  
  if (raisedHand) {
    showNotification("Você levantou a mão", 'info');
    
    const localWrapper = document.querySelector('.video-wrapper:first-child');
    const handIndicator = document.createElement('div');
    handIndicator.className = 'raised-hand-indicator';
    handIndicator.innerHTML = '<i class="fas fa-hand"></i> Mão levantada';
    handIndicator.id = 'handIndicator';
    localWrapper.appendChild(handIndicator);
  } else {
    const handIndicator = document.getElementById('handIndicator');
    if (handIndicator) handIndicator.remove();
  }
}

// ================================
// Painel de Participantes
// ================================
function addParticipantsPanel() {
  const panel = document.createElement('div');
  panel.className = 'participants-panel minimized';
  panel.id = 'participantsPanel';
  panel.innerHTML = `
    <div class="participants-header">
      <h3><i class="fas fa-users"></i> Participantes</h3>
      <span class="participants-count" id="participantsCount">1</span>
      <button onclick="toggleParticipantsPanel()" class="btn-close">
        <i class="fas fa-times"></i>
      </button>
    </div>
    <div class="participants-list" id="participantsList"></div>
  `;
  
  document.body.appendChild(panel);
  
  addPanelToggles();
}

function addPanelToggles() {
  const existingToggles = document.querySelector('.panel-toggle');
  if (existingToggles) existingToggles.remove();
  
  const toggleContainer = document.createElement('div');
  toggleContainer.className = 'panel-toggle';
  toggleContainer.innerHTML = `
    <button onclick="toggleParticipantsPanel()" class="panel-toggle-btn" id="toggleParticipants" title="Participantes">
      <i class="fas fa-users"></i>
      <span class="badge" id="participantsBadge" style="display: none;">0</span>
    </button>
    <button onclick="toggleChat()" class="panel-toggle-btn" id="toggleChat" title="Chat">
      <i class="fas fa-comment"></i>
      <span class="badge" id="chatBadge" style="display: none;">0</span>
    </button>
  `;
  
  document.body.appendChild(toggleContainer);
}

function toggleParticipantsPanel() {
  const panel = document.getElementById('participantsPanel');
  const btn = document.getElementById('toggleParticipants');
  
  if (participantsMinimized) {
    panel.classList.remove('minimized');
    btn.classList.add('active');
    participantsMinimized = false;
  } else {
    panel.classList.add('minimized');
    btn.classList.remove('active');
    participantsMinimized = true;
  }
}

function showHostPanel() {
  if (!userCreatedRoom) return;
  
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.id = 'hostModal';
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <i class="fas fa-crown"></i>
        <h2>Controles do Host</h2>
        <button onclick="closeHostModal()" style="position: absolute; top: 1rem; right: 1rem; background: none; border: none; font-size: 1.2rem; cursor: pointer;">
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
    const isScreenBlocked = screenBlockedByHost.get(id);
    
    html += `
      <div class="participant-item" style="margin-bottom: 1rem; padding: 1rem; background: #f8f9fa; border-radius: 8px;">
        <div style="display: flex; align-items: center; gap: 1rem; width: 100%;">
          <i class="fas fa-user" style="font-size: 1.5rem;"></i>
          <div style="flex: 1;">
            <strong>${participant.name}</strong>
          </div>
          <div style="display: flex; gap: 0.5rem;">
            <button onclick="toggleMuteParticipant('${id}')" class="btn-control ${isMuted ? 'btn-danger' : 'btn-secondary'}" style="padding: 0.5rem; border-radius: 5px; border: none; cursor: pointer;">
              <i class="fas ${isMuted ? 'fa-microphone-slash' : 'fa-microphone'}"></i>
            </button>
            <button onclick="toggleScreenBlock('${id}')" class="btn-control ${isScreenBlocked ? 'btn-danger' : 'btn-secondary'}" style="padding: 0.5rem; border-radius: 5px; border: none; cursor: pointer;">
              <i class="fas fa-desktop"></i>
            </button>
            <button onclick="kickParticipant('${id}')" class="btn-control btn-danger" style="padding: 0.5rem; border-radius: 5px; border: none; cursor: pointer;">
              <i class="fas fa-user-slash"></i>
            </button>
          </div>
        </div>
      </div>
    `;
  });
  
  list.innerHTML = html;
}

function closeHostModal() {
  const modal = document.getElementById('hostModal');
  if (modal) modal.remove();
}

function addHostButton() {
  if (userCreatedRoom) {
    const toggleContainer = document.querySelector('.panel-toggle');
    if (toggleContainer) {
      const hostBtn = document.createElement('button');
      hostBtn.onclick = showHostPanel;
      hostBtn.className = 'panel-toggle-btn';
      hostBtn.title = 'Controles do Host';
      hostBtn.innerHTML = '<i class="fas fa-crown"></i>';
      toggleContainer.appendChild(hostBtn);
    }
  }
}

function updateParticipantsList() {
  const list = document.getElementById('participantsList');
  const count = document.getElementById('participantsCount');
  const participantsBadge = document.getElementById('participantsBadge');
  
  if (!list) return;
  
  const totalParticipants = participants.size + 1;
  count.textContent = totalParticipants;
  
  if (participantsBadge) {
    participantsBadge.textContent = totalParticipants;
    participantsBadge.style.display = 'block';
  }
  
  let html = '';
  
  html += `
    <div class="participant-item">
      <i class="fas fa-user"></i>
      <div class="participant-info">
        <div class="participant-name">
          ${userName} (Você)
          ${userCreatedRoom ? '<i class="fas fa-crown" style="color: #ffc107;"></i>' : ''}
        </div>
        <div class="participant-status">
          ${videoEnabled ? '📹' : '🚫'} ${audioEnabled ? '🎤' : '🔇'}
          ${raisedHand ? '✋' : ''}
        </div>
      </div>
    </div>
  `;
  
  participants.forEach((participant, id) => {
    const isCreator = id === roomCreator;
    
    html += `
      <div class="participant-item" data-id="${id}">
        <i class="fas fa-user"></i>
        <div class="participant-info">
          <div class="participant-name">
            ${participant.name}
            ${isCreator ? '<i class="fas fa-crown" style="color: #ffc107;"></i>' : ''}
          </div>
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

// ================================
// Host actions
// ================================
function toggleMuteParticipant(userId) {
  const currentlyMuted = mutedByHost.get(userId);
  mutedByHost.set(userId, !currentlyMuted);
  
  socket.emit("host-mute", {
    room: currentRoom,
    userId: userId,
    mute: !currentlyMuted
  });
  
  updateParticipantsList();
}

function toggleScreenBlock(userId) {
  const currentlyBlocked = screenBlockedByHost.get(userId);
  screenBlockedByHost.set(userId, !currentlyBlocked);
  
  socket.emit("host-screen-block", {
    room: currentRoom,
    userId: userId,
    block: !currentlyBlocked
  });
  
  updateParticipantsList();
}

function kickParticipant(userId) {
  if (confirm("Tem certeza que deseja expulsar este participante?")) {
    socket.emit("host-kick", {
      room: currentRoom,
      userId: userId
    });
  }
}

// ================================
// Layout
// ================================
function toggleLayout() {
  layoutMode = layoutMode === 'grid' ? 'speaker' : 'grid';
  
  const container = document.querySelector('.video-container');
  if (layoutMode === 'grid') {
    container.classList.add('grid-layout');
  } else {
    container.classList.remove('grid-layout');
  }
  
  document.querySelectorAll('.layout-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.layout === layoutMode);
  });
}

// ================================
// Sound
// ================================
function toggleSounds() {
  soundsEnabled = !soundsEnabled;
  
  document.querySelectorAll('.sound-toggle button').forEach(btn => {
    btn.classList.toggle('active', 
      (btn.dataset.sound === 'on' && soundsEnabled) || 
      (btn.dataset.sound === 'off' && !soundsEnabled)
    );
  });
}

function playSound(audio) {
  if (soundsEnabled && audio && typeof audio.play === 'function') {
    audio.play().catch(e => console.log("Audio play failed:", e));
  }
}

// ================================
// Chat
// ================================
function toggleChat() {
  chatVisible = !chatVisible;
  const chatPanel = document.getElementById("chatPanel");
  const chatBtn = document.getElementById('toggleChat');
  
  if (chatVisible) {
    chatPanel.classList.remove('minimized');
    chatBtn.classList.add('active');
    unreadMessages = 0;
    updateChatBadge();
  } else {
    chatPanel.classList.add('minimized');
    chatBtn.classList.remove('active');
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

function updateChatBadge() {
  const chatBadge = document.getElementById('chatBadge');
  if (chatBadge) {
    if (unreadMessages > 0) {
      chatBadge.textContent = unreadMessages;
      chatBadge.style.display = 'flex';
    } else {
      chatBadge.style.display = 'none';
    }
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
// Socket Events
// ================================

socket.on("rooms-list", (rooms) => {
  displayRooms(rooms);
});

socket.on("room-error", (msg) => {
  showNotification(msg, 'error');
  if (msg.includes("já criou")) {
    userCreatedRoom = false;
    userRooms.clear();
    updateCreateRoomUI();
  }
});

socket.on("user-connected", ({ socketId, name, peerId }) => {
  showToast(`${name} entrou na sala`, 'info');
  if (soundsEnabled) playSound(joinSound);
  
  window.userNames = window.userNames || {};
  window.userNames[socketId] = name;
  
  participants.set(socketId, {
    name: name,
    speaking: false,
    handRaised: false,
    videoEnabled: false,
    audioEnabled: true,
    peerId: peerId
  });
  updateParticipantsList();
  
  if (peerId) {
    setTimeout(() => callPeer(peerId), 1000);
  }
});

socket.on("user-disconnected", (userId) => {
  const userName = getUserName(userId);
  showToast(`${userName} saiu da sala`, 'info');
  if (soundsEnabled) playSound(leaveSound);
  
  const videoWrapper = document.getElementById(`video-${userId}`);
  if (videoWrapper) videoWrapper.remove();
  
  participants.delete(userId);
  updateParticipantsList();
  
  if (peers[userId]) {
    peers[userId].close();
    delete peers[userId];
  }
});

socket.on("peer-registered", ({ socketId, peerId }) => {
  console.log(`Peer registrado: ${socketId} -> ${peerId}`);
  
  const participant = participants.get(socketId);
  if (participant) {
    participant.peerId = peerId;
    updateParticipantsList();
  }
  
  if (socketId !== socket.id) {
    callPeer(peerId);
  }
});

socket.on("user-name", ({ userId, name }) => {
  if (!window.userNames) window.userNames = {};
  window.userNames[userId] = name;
  
  participants.set(userId, {
    name: name,
    speaking: false,
    handRaised: false,
    videoEnabled: false,
    audioEnabled: true
  });
  updateParticipantsList();
});

socket.on("hand-raised", ({ userId, userName }) => {
  const participant = participants.get(userId);
  if (participant) {
    participant.handRaised = true;
    updateParticipantsList();
  }
  showToast(`${userName} levantou a mão`, 'info');
  if (soundsEnabled) playSound(raiseHandSound);
});

socket.on("hand-lowered", ({ userId }) => {
  const participant = participants.get(userId);
  if (participant) {
    participant.handRaised = false;
    updateParticipantsList();
  }
});

socket.on("chat-message", (data) => {
  displayMessage(data.message, 'other', data.senderName || 'Anônimo');
  
  if (!chatVisible) {
    unreadMessages++;
    updateChatBadge();
  }
  
  if (soundsEnabled) playSound(messageSound);
});

socket.on("user-muted", ({ userId, muted }) => {
  const participant = participants.get(userId);
  if (participant) {
    participant.audioEnabled = !muted;
    updateParticipantsList();
  }
  
  if (userId === socket.id) {
    if (muted) {
      audioEnabled = false;
      updateMicUI();
      showNotification("Você foi mutado pelo host", 'warning');
    } else {
      audioEnabled = true;
      updateMicUI();
    }
  }
});

socket.on("screen-blocked", ({ userId, blocked }) => {
  if (userId === socket.id && blocked) {
    screenBlockedByHost.set(socket.id, true);
    if (screenSharing) {
      stopScreenSharing();
    }
    showNotification("Você foi bloqueado de compartilhar tela", 'warning');
  }
});

socket.on("screen-sharing-started", ({ userId }) => {
  if (userId !== socket.id) {
    videoContainer.classList.add('screensharing');
    
    const remoteWrapper = document.getElementById(`video-${userId}`);
    if (remoteWrapper) {
      remoteWrapper.classList.add('remote-share');
    }
  }
});

socket.on("screen-sharing-stopped", ({ userId }) => {
  if (userId !== socket.id) {
    if (!screenSharing) {
      videoContainer.classList.remove('screensharing');
    }
    
    const remoteWrapper = document.getElementById(`video-${userId}`);
    if (remoteWrapper) {
      remoteWrapper.classList.remove('remote-share');
    }
  }
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
// Utility Functions
// ================================
function getUserName(userId) {
  return window.userNames?.[userId] || 'Anônimo';
}

function leaveRoom() {
  Object.values(peers).forEach(call => call.close());
  peers = {};
  
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  
  if (screenSharingStream) {
    screenSharingStream.getTracks().forEach(track => track.stop());
  }
  
  if (audioVisualizerInterval) {
    clearInterval(audioVisualizerInterval);
  }
  
  if (currentRoom && userRooms.has(currentRoom)) {
    userCreatedRoom = false;
    userRooms.delete(currentRoom);
    updateCreateRoomUI();
  }
  
  const panel = document.getElementById('participantsPanel');
  if (panel) panel.remove();
  
  document.querySelectorAll('.video-wrapper:not(:first-child)').forEach(el => el.remove());
  
  currentRoom = null;
  meetingSection.classList.remove('active');
  homeSection.classList.add('active');
  meetingSection.style.display = 'none';
  
  socket.emit("leave-room");
}

function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.innerHTML = `
    <i class="fas ${type === 'error' ? 'fa-exclamation-circle' : type === 'success' ? 'fa-check-circle' : 'fa-info-circle'}"></i>
    <span>${message}</span>
  `;
  
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.remove();
  }, 3000);
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast-notification ${type}`;
  toast.innerHTML = `
    <i class="fas ${type === 'error' ? 'fa-exclamation-circle' : type === 'success' ? 'fa-check-circle' : 'fa-info-circle'}"></i>
    <span>${message}</span>
  `;
  
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.remove();
  }, 3000);
}

function updateMediaButtons() {
  updateCameraUI();
  updateMicUI();
}

// ================================
// Init
// ================================
window.addEventListener('load', () => {
  if (userName) joinRoomFromUrl();
});

// Layout toggle
const layoutToggle = document.createElement('div');
layoutToggle.className = 'layout-toggle';
layoutToggle.innerHTML = `
  <button onclick="toggleLayout()" class="layout-btn active" data-layout="grid">
    <i class="fas fa-th"></i>
  </button>
  <button onclick="toggleLayout()" class="layout-btn" data-layout="speaker">
    <i class="fas fa-user"></i>
  </button>
`;

// Sound toggle
const soundToggle = document.createElement('div');
soundToggle.className = 'sound-toggle';
soundToggle.innerHTML = `
  <button onclick="toggleSounds()" class="active" data-sound="on">
    <i class="fas fa-volume-up"></i>
  </button>
  <button onclick="toggleSounds()" data-sound="off">
    <i class="fas fa-volume-mute"></i>
  </button>
`;

document.body.appendChild(soundToggle);

// Este é o CORRETO - mantenha ele (linha ~260)
socket.on("room-joined", async (roomData) => {
  currentRoom = roomData.name;
  roomCreator = roomData.creator;
  roomNameDisplay.textContent = `Sala: ${roomData.name}`;
  
  homeSection.classList.remove('active');
  meetingSection.classList.add('active');
  meetingSection.style.display = 'flex';
  
  createInviteLink();
  addParticipantsPanel();
  addHostButton();
  
  await initializeMedia();
  
  if (window.myPeerId) {
    socket.emit('register-peer', { peerId: window.myPeerId });
  }
  
  // Chama outros participantes
  setTimeout(() => {
    if (roomData.participants) {
      roomData.participants.forEach(p => {
        if (p.socketId !== socket.id && p.peerId) {
          callPeer(p.peerId);
        }
      });
    }
  }, 2000);
});
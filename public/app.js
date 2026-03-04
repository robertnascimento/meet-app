// ================================
// iDev Meet - app.js (v4 - TURN próprio)
// ================================

const socket = io('https://iver.space');
let localStream = null;
let peers = {};
let chatVisible = false;
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
let audioVisualizerInterval = null;
let audioContext = null;
let soundsEnabled = true;
let participants = new Map();
let mutedByHost = new Map();
let screenBlockedByHost = new Map();
let iceServersConfig = [{ urls: 'stun:stun.l.google.com:19302' }]; // fallback

// Sons
const silentAudio = { play: () => Promise.resolve() };
let joinSound = silentAudio, leaveSound = silentAudio, messageSound = silentAudio, raiseHandSound = silentAudio;
['join','leave','message','raise-hand'].forEach((name, i) => {
  const a = new Audio(`/sounds/${name}.mp3`);
  a.onerror = () => {};
  [joinSound, leaveSound, messageSound, raiseHandSound][i] = a;
});

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

// ================================
// ✅ Busca credenciais TURN do servidor (temporárias e seguras)
// Chama antes de criar o PeerJS para ter as credenciais prontas
// ================================
async function fetchTurnCredentials() {
  try {
    const res = await fetch('/api/turn-credentials');
    const data = await res.json();
    iceServersConfig = data.iceServers;
    console.log('✅ Credenciais TURN obtidas:', iceServersConfig.map(s => s.urls));
  } catch (e) {
    console.warn('⚠️ Falha ao buscar TURN credentials, usando apenas STUN:', e);
    iceServersConfig = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ];
  }
}

// ================================
// PeerJS — criado após buscar as credenciais TURN
// ================================
let peer;

async function initPeer() {
  await fetchTurnCredentials();

  peer = new Peer(undefined, {
    host: 'iver.space',
    port: 443,
    path: '/peerjs/myapp',
    secure: true,
    debug: 2,
    config: { iceServers: iceServersConfig }
  });

  peer.on('open', (id) => {
    console.log('🔄 Peer conectado com ID:', id);
    window.myPeerId = id;
    socket.emit('register-peer', { peerId: id });
  });

  peer.on('call', (call) => {
    console.log('📞 Chamada recebida de:', call.peer);
    call.answer(localStream || undefined);

    call.on('stream', (remoteStream) => {
      console.log('✅ Stream recebido de:', call.peer);
      setupStreamListeners(remoteStream, call.peer);
      addRemoteVideo(call.peer, remoteStream);
    });

    call.on('close', () => { removeRemoteVideo(call.peer); delete peers[call.peer]; });
    call.on('error', (err) => console.error('❌ Erro chamada recebida:', err));

    peers[call.peer] = call;
  });

  peer.on('error', (err) => {
    console.error('❌ PeerJS erro:', err.type, err);
    if (['unavailable-id','invalid-id','disconnected','network'].includes(err.type)) {
      setTimeout(() => { try { peer.reconnect(); } catch(e) {} }, 3000);
    }
  });
}

// Inicia o peer imediatamente
initPeer();

// ================================
// Session Storage
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

// Navegação
document.querySelectorAll('nav a').forEach(link => {
  link.addEventListener('click', e => {
    e.preventDefault();
    const targetId = link.getAttribute('href').substring(1);
    document.querySelectorAll('nav a').forEach(a => a.classList.remove('active'));
    link.classList.add('active');
    document.querySelectorAll('.section').forEach(sec => sec.classList.remove('active'));
    document.getElementById(targetId)?.classList.add('active');
  });
});

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.activeElement?.id === 'chatInput') { sendMessage(); return; }
  if (!e.ctrlKey) return;
  switch (e.key.toLowerCase()) {
    case 'd': e.preventDefault(); toggleMic(); break;
    case 'e': e.preventDefault(); toggleCamera(); break;
    case 'k': e.preventDefault(); toggleChat(); break;
    case 'h': e.preventDefault(); toggleRaiseHand(); break;
  }
});

// ================================
// Usuário
// ================================
function setUserName() {
  const name = document.getElementById("userName").value.trim();
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
  let wrapper = document.getElementById(`video-${peerId}`);
  if (wrapper) {
    const v = wrapper.querySelector('video');
    if (v) { v.srcObject = stream; v.play().catch(() => {}); }
    return;
  }

  wrapper = document.createElement('div');
  wrapper.className = 'video-wrapper';
  wrapper.id = `video-${peerId}`;

  const video = document.createElement('video');
  video.autoplay = true;
  video.playsInline = true;
  video.muted = false;
  video.srcObject = stream;

  const label = document.createElement('div');
  label.className = 'video-label';
  label.innerHTML = `<i class="fas fa-user"></i> ${getNameByPeerId(peerId) || 'Participante'}`;

  wrapper.appendChild(video);
  wrapper.appendChild(label);
  videoContainer.appendChild(wrapper);

  const tryPlay = () => video.play().catch(() => setTimeout(tryPlay, 500));
  setTimeout(tryPlay, 100);
}

function removeRemoteVideo(peerId) { document.getElementById(`video-${peerId}`)?.remove(); }

function getNameByPeerId(peerId) {
  let name = null;
  participants.forEach(p => { if (p.peerId === peerId) name = p.name; });
  return name;
}

function setupStreamListeners(stream, peerId) {
  stream.getTracks().forEach(track => {
    track.onended = () => console.log(`Track de ${peerId} encerrada`);
  });
}

// ================================
// callPeer
// ================================
function callPeer(peerId) {
  if (!peerId || peers[peerId]) return;
  if (!localStream) { setTimeout(() => callPeer(peerId), 800); return; }

  console.log('📞 Chamando:', peerId);
  try {
    const call = peer.call(peerId, localStream);

    call.on('stream', (remoteStream) => {
      setupStreamListeners(remoteStream, peerId);
      addRemoteVideo(peerId, remoteStream);
    });

    call.on('close', () => { removeRemoteVideo(peerId); delete peers[peerId]; });
    call.on('error', (err) => { console.error('❌ Erro chamada:', peerId, err); delete peers[peerId]; });

    peers[peerId] = call;
  } catch (err) {
    console.error('❌ Erro ao iniciar chamada:', err);
  }
}

function tryCallPendingPeers() {
  participants.forEach((p, socketId) => {
    if (socketId !== socket.id && p.peerId && !peers[p.peerId]) callPeer(p.peerId);
  });
}

// ================================
// Media
// ================================
async function initializeMedia() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    videoEnabled = true; audioEnabled = true;
  } catch (err) {
    console.warn("Câmera indisponível:", err);
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
      videoEnabled = false; audioEnabled = true;
      showNotification("Câmera não disponível, usando só áudio", 'warning');
    } catch (e) {
      showNotification("Sem acesso a câmera/microfone", 'error');
      return;
    }
  }
  localVideo.srcObject = localStream;
  updateMediaButtons();
  startAudioVisualization();
}

function startAudioVisualization() {
  if (audioContext || !localStream) return;
  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = audioContext.createAnalyser();
    audioContext.createMediaStreamSource(localStream).connect(analyser);
    analyser.fftSize = 256;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    audioVisualizerInterval = setInterval(() => {
      analyser.getByteFrequencyData(dataArray);
      const avg = dataArray.reduce((a, b) => a + b) / dataArray.length;
      const speaking = avg > 30;
      document.querySelector('.video-wrapper:first-child')?.classList.toggle('speaking', speaking);
      if (currentRoom) socket.emit("speaking-status", { room: currentRoom, speaking });
    }, 100);
  } catch(e) {}
}

// ================================
// Toggle Camera/Mic/Screen
// ================================
async function toggleCamera() {
  if (screenBlockedByHost.get(socket.id) && !videoEnabled) return showNotification("Bloqueado de usar câmera", 'warning');
  videoEnabled = !videoEnabled;
  updateCameraUI();
  try {
    const oldTrack = localStream?.getVideoTracks()[0];
    if (videoEnabled) {
      const newStream = await navigator.mediaDevices.getUserMedia({ video: true });
      const newTrack = newStream.getVideoTracks()[0];
      if (oldTrack) { oldTrack.stop(); localStream.removeTrack(oldTrack); }
      localStream.addTrack(newTrack);
      localVideo.srcObject = localStream;
      Object.values(peers).forEach(call => {
        call.peerConnection?.getSenders().find(s => s.track?.kind === 'video')?.replaceTrack(newTrack);
      });
    } else if (oldTrack) { oldTrack.enabled = false; }
  } catch (err) { videoEnabled = !videoEnabled; showNotification("Erro alternando câmera", 'error'); }
}

function toggleMic() {
  if (mutedByHost.get(socket.id) && audioEnabled) return showNotification("Você está mutado pelo host", 'warning');
  audioEnabled = !audioEnabled;
  localStream?.getAudioTracks().forEach(t => t.enabled = audioEnabled);
  updateMicUI();
}

async function shareScreen() {
  if (screenBlockedByHost.get(socket.id)) return showNotification("Bloqueado de compartilhar tela", 'warning');
  try {
    if (!screenSharing) {
      const ss = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      screenSharingStream = ss;
      const track = ss.getVideoTracks()[0];
      track.onended = stopScreenSharing;
      Object.values(peers).forEach(call => call.peerConnection?.getSenders().find(s => s.track?.kind === 'video')?.replaceTrack(track));
      localVideo.srcObject = ss;
      videoContainer.classList.add('screensharing','local-share');
      screenSharing = true;
      showNotification("Compartilhando tela", 'success');
      socket.emit("screen-sharing-started", { room: currentRoom });
    } else stopScreenSharing();
  } catch (err) { if (err.name !== 'NotAllowedError') showNotification("Erro ao compartilhar tela", 'error'); }
}

function stopScreenSharing() {
  screenSharingStream?.getTracks().forEach(t => t.stop());
  if (localStream) {
    const track = localStream.getVideoTracks()[0];
    Object.values(peers).forEach(call => call.peerConnection?.getSenders().find(s => s.track?.kind === 'video')?.replaceTrack(track));
    localVideo.srcObject = localStream;
  }
  videoContainer.classList.remove('screensharing','local-share');
  screenSharing = false;
  socket.emit("screen-sharing-stopped", { room: currentRoom });
}

function updateCameraUI() {
  document.querySelectorAll('#camBtn').forEach(btn => {
    const hasSpan = !!btn.querySelector('span');
    btn.innerHTML = videoEnabled
      ? `<i class="fas fa-video"></i>${hasSpan ? '<span>Desligar Câmera</span>' : ''}`
      : `<i class="fas fa-video-slash"></i>${hasSpan ? '<span>Ligar Câmera</span>' : ''}`;
    btn.classList.toggle('off', !videoEnabled);
  });
}

function updateMicUI() {
  document.querySelectorAll('#micBtn').forEach(btn => {
    const hasSpan = !!btn.querySelector('span');
    btn.innerHTML = audioEnabled
      ? `<i class="fas fa-microphone"></i>${hasSpan ? '<span>Mutar Mic</span>' : ''}`
      : `<i class="fas fa-microphone-slash"></i>${hasSpan ? '<span>Desmutar Mic</span>' : ''}`;
    btn.classList.toggle('off', !audioEnabled);
  });
}

function updateMediaButtons() { updateCameraUI(); updateMicUI(); }

// ================================
// Rooms
// ================================
function createRoom() {
  if (!userName) return showNotification("Informe seu nome primeiro!", 'warning');
  const roomName = document.getElementById("roomName").value.trim();
  const password = document.getElementById("roomPassword").value;
  if (!roomName || !password) return showNotification("Preencha todos os campos!", 'warning');
  socket.emit("create-room", { roomName, password, creator: userName });
  userCreatedRoom = true;
  userRooms.add(roomName);
  updateCreateRoomUI();
}

function joinRoomPrompt(roomName) {
  if (!userName) return showNotification("Informe seu nome primeiro!", 'warning');
  const password = prompt(`Senha da sala "${roomName}":`);
  if (!password) return;
  socket.emit('join-room', { roomName, password, userName });
}

function joinRoomFromUrl() {
  const room = new URLSearchParams(window.location.search).get('room');
  if (room && !currentRoom && userName) {
    const password = prompt(`Senha da sala "${room}":`);
    if (password) socket.emit("join-room", { roomName: room, password, userName });
  }
}

function createInviteLink() {
  if (!currentRoom) return;
  document.querySelector('.invite-container')?.remove();
  const c = document.createElement('div');
  c.className = 'invite-container';
  c.innerHTML = `<div class="invite-link">
    <input type="text" id="inviteLink" value="${location.origin}?room=${currentRoom}" readonly />
    <button onclick="copyInviteLink()" class="btn-copy"><i class="fas fa-copy"></i></button>
  </div>`;
  document.querySelector('.meeting-header').appendChild(c);
}

function copyInviteLink() {
  document.getElementById("inviteLink").select();
  document.execCommand('copy');
  showNotification("Link copiado!", 'success');
}

function deleteRoom(roomName) {
  if (!userRooms.has(roomName) || !confirm("Excluir esta sala?")) return;
  socket.emit("delete-room", { roomName });
  userRooms.delete(roomName);
  userCreatedRoom = false;
  updateCreateRoomUI();
}

function updateCreateRoomUI() {
  document.querySelector('.create-room-card')?.classList.toggle('disabled', userCreatedRoom);
}

function displayRooms(rooms) {
  if (!roomsList) return;
  roomsList.innerHTML = rooms.length === 0
    ? '<div class="no-rooms">Nenhuma sala disponível</div>'
    : '';
  rooms.forEach(room => {
    const card = document.createElement("div");
    card.className = "room-card";
    card.innerHTML = `
      <div class="room-info">
        <i class="fas fa-door-open"></i><span>${room.name}</span>
        <span class="creator-badge"><i class="fas fa-crown"></i> ${room.creator || 'Anônimo'}</span>
        <span class="participant-count"><i class="fas fa-user"></i> ${room.participants || 0}/10</span>
      </div>
      <div class="room-actions">
        <button onclick="joinRoomPrompt('${room.name}')" class="btn-enter" ${!userName ? 'disabled' : ''}>
          <i class="fas fa-sign-in-alt"></i> Entrar
        </button>
        ${userRooms.has(room.name) ? `<button onclick="deleteRoom('${room.name}')" class="btn-delete"><i class="fas fa-trash"></i></button>` : ''}
      </div>`;
    roomsList.appendChild(card);
  });
}

// ================================
// Chat
// ================================
function toggleChat() {
  chatVisible = !chatVisible;
  const panel = document.getElementById("chatPanel");
  panel.style.display = chatVisible ? 'flex' : 'none';
  document.getElementById('toggleChat')?.classList.toggle('active', chatVisible);
  if (chatVisible) { unreadMessages = 0; updateChatBadge(); setTimeout(() => document.getElementById('chatInput')?.focus(), 100); }
}

function sendMessage() {
  const input = document.getElementById("chatInput");
  const message = input.value.trim();
  if (!message || !currentRoom) return;
  socket.emit("chat-message", { room: currentRoom, message, sender: socket.id, senderName: userName });
  displayMessage(message, 'own', 'Você');
  input.value = '';
}

function updateChatBadge() {
  const badge = document.getElementById('chatBadge');
  if (badge) { badge.textContent = unreadMessages; badge.style.display = unreadMessages > 0 ? 'flex' : 'none'; }
}

function displayMessage(message, type, senderName) {
  const chatMessages = document.getElementById("chatMessages");
  const div = document.createElement("div");
  div.className = `message ${type}`;
  div.innerHTML = `<div class="sender">${senderName}</div><div class="text">${message}</div>`;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ================================
// Raise Hand
// ================================
function toggleRaiseHand() {
  raisedHand = !raisedHand;
  socket.emit("raise-hand", { room: currentRoom, raised: raisedHand, userName });
  if (raisedHand) {
    showNotification("Você levantou a mão ✋", 'info');
    const wrapper = document.querySelector('.video-wrapper:first-child');
    if (wrapper && !document.getElementById('handIndicator')) {
      const el = document.createElement('div');
      el.className = 'raised-hand-indicator';
      el.innerHTML = '<i class="fas fa-hand-paper"></i> Mão levantada';
      el.id = 'handIndicator';
      wrapper.appendChild(el);
    }
  } else document.getElementById('handIndicator')?.remove();
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
    <div class="participants-list" id="participantsList"></div>`;
  document.body.appendChild(panel);
  addPanelToggles();
}

function addPanelToggles() {
  document.querySelector('.panel-toggle')?.remove();
  const c = document.createElement('div');
  c.className = 'panel-toggle';
  c.innerHTML = `
    <button onclick="toggleParticipantsPanel()" class="panel-toggle-btn" id="toggleParticipants" title="Participantes">
      <i class="fas fa-users"></i><span class="badge" id="participantsBadge" style="display:none;"></span>
    </button>
    <button onclick="toggleChat()" class="panel-toggle-btn" id="toggleChat" title="Chat">
      <i class="fas fa-comment"></i><span class="badge" id="chatBadge" style="display:none;"></span>
    </button>`;
  document.body.appendChild(c);
}

function toggleParticipantsPanel() {
  const panel = document.getElementById('participantsPanel');
  const btn = document.getElementById('toggleParticipants');
  participantsMinimized = !participantsMinimized;
  panel.classList.toggle('minimized', participantsMinimized);
  btn?.classList.toggle('active', !participantsMinimized);
}

function updateParticipantsList() {
  const list = document.getElementById('participantsList');
  const count = document.getElementById('participantsCount');
  if (!list) return;
  if (count) count.textContent = participants.size + 1;

  let html = `<div class="participant-item">
    <i class="fas fa-user"></i>
    <div class="participant-info">
      <div class="participant-name">${userName} (Você) ${userCreatedRoom ? '<i class="fas fa-crown" style="color:#ffc107;"></i>' : ''}</div>
      <div class="participant-status">${videoEnabled?'📹':'🚫'} ${audioEnabled?'🎤':'🔇'} ${raisedHand?'✋':''}</div>
    </div>
  </div>`;

  participants.forEach((p, id) => {
    html += `<div class="participant-item" data-id="${id}">
      <i class="fas fa-user"></i>
      <div class="participant-info">
        <div class="participant-name">${p.name}</div>
        <div class="participant-status">${p.videoEnabled?'📹':'🚫'} ${p.audioEnabled?'🎤':'🔇'} ${p.handRaised?'✋':''}</div>
      </div>
    </div>`;
  });
  list.innerHTML = html;
}

function addHostButton() {
  if (!userCreatedRoom) return;
  const c = document.querySelector('.panel-toggle');
  if (c && !c.querySelector('.host-btn')) {
    const btn = document.createElement('button');
    btn.onclick = showHostPanel;
    btn.className = 'panel-toggle-btn host-btn';
    btn.title = 'Controles do Host';
    btn.innerHTML = '<i class="fas fa-crown"></i>';
    c.appendChild(btn);
  }
}

function showHostPanel() {
  document.getElementById('hostModal')?.remove();
  const modal = document.createElement('div');
  modal.className = 'modal'; modal.id = 'hostModal'; modal.style.display = 'flex';
  modal.innerHTML = `<div class="modal-content">
    <div class="modal-header"><i class="fas fa-crown"></i><h2>Controles do Host</h2>
      <button onclick="document.getElementById('hostModal').remove()" style="position:absolute;top:1rem;right:1rem;background:none;border:none;font-size:1.2rem;cursor:pointer;"><i class="fas fa-times"></i></button>
    </div>
    <div class="host-controls-list" id="hostControlsList"></div>
  </div>`;
  document.body.appendChild(modal);
  updateHostControlsList();
}

function updateHostControlsList() {
  const list = document.getElementById('hostControlsList');
  if (!list) return;
  let html = '<h3>Participantes</h3>';
  participants.forEach((p, id) => {
    const m = mutedByHost.get(id), b = screenBlockedByHost.get(id);
    html += `<div style="margin-bottom:1rem;padding:1rem;background:#f8f9fa;border-radius:8px;">
      <strong>${p.name}</strong>
      <div style="display:flex;gap:.5rem;margin-top:.5rem;">
        <button onclick="toggleMuteParticipant('${id}')" style="padding:.5rem;border-radius:5px;border:none;cursor:pointer;background:${m?'#dc3545':'#6c757d'};color:#fff;"><i class="fas ${m?'fa-microphone-slash':'fa-microphone'}"></i></button>
        <button onclick="toggleScreenBlock('${id}')" style="padding:.5rem;border-radius:5px;border:none;cursor:pointer;background:${b?'#dc3545':'#6c757d'};color:#fff;"><i class="fas fa-desktop"></i></button>
        <button onclick="kickParticipant('${id}')" style="padding:.5rem;border-radius:5px;border:none;cursor:pointer;background:#dc3545;color:#fff;"><i class="fas fa-user-slash"></i></button>
      </div>
    </div>`;
  });
  list.innerHTML = html;
}

function toggleMuteParticipant(userId) {
  const muted = !mutedByHost.get(userId); mutedByHost.set(userId, muted);
  socket.emit("host-mute", { room: currentRoom, userId, mute: muted }); updateHostControlsList();
}
function toggleScreenBlock(userId) {
  const blocked = !screenBlockedByHost.get(userId); screenBlockedByHost.set(userId, blocked);
  socket.emit("host-screen-block", { room: currentRoom, userId, block: blocked }); updateHostControlsList();
}
function kickParticipant(userId) {
  if (confirm("Expulsar este participante?")) socket.emit("host-kick", { room: currentRoom, userId });
}
function toggleLayout() {
  layoutMode = (layoutMode === 'grid') ? 'speaker' : 'grid';
  document.querySelector('.video-container')?.classList.toggle('grid-layout', layoutMode === 'grid');
}
function toggleSounds() { soundsEnabled = !soundsEnabled; }
function playSound(audio) { if (soundsEnabled && audio?.play) audio.play().catch(() => {}); }

// ================================
// Socket Events
// ================================
socket.on("rooms-list", displayRooms);
socket.on("room-error", (msg) => {
  showNotification(msg, 'error');
  if (msg.includes('existe') || msg.includes('criou')) { userCreatedRoom = false; userRooms.clear(); updateCreateRoomUI(); }
});

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
  addHostButton();

  if (roomData.participants?.length > 0) {
    roomData.participants.forEach(p => {
      if (p.socketId === socket.id) return;
      window.userNames = window.userNames || {};
      window.userNames[p.socketId] = p.name;
      participants.set(p.socketId, { name: p.name, peerId: p.peerId, speaking: false, handRaised: false, videoEnabled: false, audioEnabled: true });
      if (p.peerId) setTimeout(() => callPeer(p.peerId), 1000);
    });
    updateParticipantsList();
  }
});

socket.on("user-connected", ({ socketId, name, peerId }) => {
  console.log('👤 Novo usuário:', { socketId, name, peerId });
  showToast(`${name} entrou na sala`, 'info');
  playSound(joinSound);
  window.userNames = window.userNames || {};
  window.userNames[socketId] = name;
  participants.set(socketId, { name, peerId, speaking: false, handRaised: false, videoEnabled: false, audioEnabled: true });
  updateParticipantsList();
  if (peerId) setTimeout(() => callPeer(peerId), 1500);
  else console.log('⏳ Aguardando peerId de', name);
});

socket.on("user-disconnected", (userId) => {
  const name = getUserName(userId);
  showToast(`${name} saiu da sala`, 'info');
  playSound(leaveSound);
  const p = participants.get(userId);
  if (p?.peerId) { removeRemoteVideo(p.peerId); if (peers[p.peerId]) { peers[p.peerId].close(); delete peers[p.peerId]; } }
  removeRemoteVideo(userId);
  participants.delete(userId);
  updateParticipantsList();
});

socket.on("peer-registered", ({ socketId, peerId }) => {
  console.log(`✅ Peer registrado: ${socketId} -> ${peerId}`);
  const p = participants.get(socketId);
  if (p) { p.peerId = peerId; updateParticipantsList(); }
  else { participants.set(socketId, { name: window.userNames?.[socketId] || 'Participante', peerId, speaking: false, handRaised: false, videoEnabled: false, audioEnabled: true }); updateParticipantsList(); }
  if (socketId !== socket.id) setTimeout(() => callPeer(peerId), 800);
});

socket.on("chat-message", (data) => {
  displayMessage(data.message, 'other', data.senderName || 'Anônimo');
  if (!chatVisible) { unreadMessages++; updateChatBadge(); }
  playSound(messageSound);
});

socket.on("user-muted", ({ userId, muted }) => {
  const p = participants.get(userId);
  if (p) { p.audioEnabled = !muted; updateParticipantsList(); }
  if (userId === socket.id) {
    audioEnabled = !muted;
    localStream?.getAudioTracks().forEach(t => t.enabled = audioEnabled);
    updateMicUI();
    showNotification(muted ? "Você foi mutado pelo host" : "Você foi desmutado", muted ? 'warning' : 'info');
  }
});

socket.on("screen-blocked", ({ userId, blocked }) => {
  if (userId === socket.id) { screenBlockedByHost.set(socket.id, blocked); if (blocked && screenSharing) stopScreenSharing(); if (blocked) showNotification("Bloqueado de compartilhar tela", 'warning'); }
});
socket.on("screen-sharing-started", ({ userId }) => { if (userId !== socket.id) videoContainer.classList.add('screensharing'); });
socket.on("screen-sharing-stopped", ({ userId }) => { if (userId !== socket.id && !screenSharing) videoContainer.classList.remove('screensharing'); });
socket.on("hand-raised", ({ userId, userName: uName }) => { const p = participants.get(userId); if (p) { p.handRaised = true; updateParticipantsList(); } showToast(`${uName} levantou a mão ✋`, 'info'); playSound(raiseHandSound); });
socket.on("hand-lowered", ({ userId }) => { const p = participants.get(userId); if (p) { p.handRaised = false; updateParticipantsList(); } });
socket.on("user-speaking", ({ userId, speaking }) => { const p = participants.get(userId); if (p?.peerId) document.getElementById(`video-${p.peerId}`)?.classList.toggle('speaking', speaking); });
socket.on("room-deleted", (roomName) => { if (currentRoom === roomName) { leaveRoom(); showNotification("Sala fechada pelo criador", 'warning'); } });
socket.on("user-kicked", () => { showNotification("Você foi removido da sala", 'error'); leaveRoom(); });

// ================================
// Leave
// ================================
function leaveRoom() {
  Object.values(peers).forEach(call => call.close());
  peers = {};
  localStream?.getTracks().forEach(t => t.stop()); localStream = null;
  screenSharingStream?.getTracks().forEach(t => t.stop());
  if (audioVisualizerInterval) { clearInterval(audioVisualizerInterval); audioVisualizerInterval = null; }
  if (audioContext) { audioContext.close().catch(() => {}); audioContext = null; }
  if (currentRoom && userRooms.has(currentRoom)) { userCreatedRoom = false; userRooms.delete(currentRoom); updateCreateRoomUI(); }
  document.getElementById('participantsPanel')?.remove();
  document.querySelector('.panel-toggle')?.remove();
  document.querySelectorAll('.video-wrapper:not(:first-child)').forEach(el => el.remove());
  if (localVideo) localVideo.srcObject = null;
  const chatPanel = document.getElementById('chatPanel');
  if (chatPanel) chatPanel.style.display = 'none';
  chatVisible = false; participants.clear(); currentRoom = null;
  meetingSection.classList.remove('active'); meetingSection.style.display = 'none';
  homeSection.classList.add('active');
  socket.emit("leave-room");
}

function getUserName(userId) { return window.userNames?.[userId] || participants.get(userId)?.name || 'Anônimo'; }

function showNotification(message, type = 'info') {
  const n = document.createElement('div');
  n.className = `notification ${type}`;
  const icons = { error:'fa-exclamation-circle', success:'fa-check-circle', warning:'fa-exclamation-triangle', info:'fa-info-circle' };
  n.innerHTML = `<i class="fas ${icons[type]}"></i><span>${message}</span>`;
  document.body.appendChild(n);
  setTimeout(() => n.remove(), 3000);
}

function showToast(message, type = 'info') {
  const t = document.createElement('div');
  t.className = `toast-notification ${type}`;
  const icons = { error:'fa-exclamation-circle', success:'fa-check-circle', info:'fa-info-circle' };
  t.innerHTML = `<i class="fas ${icons[type]||'fa-info-circle'}"></i><span>${message}</span>`;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

window.addEventListener('load', () => { if (userName) joinRoomFromUrl(); });

const soundToggle = document.createElement('div');
soundToggle.className = 'sound-toggle';
soundToggle.innerHTML = `
  <button onclick="toggleSounds()" class="active" data-sound="on"><i class="fas fa-volume-up"></i></button>
  <button onclick="toggleSounds()" data-sound="off"><i class="fas fa-volume-mute"></i></button>`;
document.body.appendChild(soundToggle);

// client.js
// Requires: forge loaded in chat.html via CDN
(function () {
  // Parse query params
  function qp(name) {
    return new URLSearchParams(location.search).get(name) || '';
  }
  const username = qp('username') || 'Anonymous';
  const room = qp('room') || 'General';

  // UI refs
  const chatBox = document.getElementById('chat-box');
  const msgInput = document.getElementById('msg');
  const sendBtn = document.getElementById('sendBtn');
  const title = document.getElementById('title');
  const sub = document.getElementById('sub');
  const roomsSelect = document.getElementById('roomsSelect');
  const newRoomInput = document.getElementById('newRoom');
  const createRoomBtn = document.getElementById('createRoomBtn');

  title.innerText = `Secure Chat — ${room}`;
  sub.innerText = `You are: ${username} • Room: ${room}`;

  // Socket.IO connection
  const socket = io();

  // Crypto vars
  let serverPublicKeyPem = null;
  let aesKeyBytes = null; // raw bytes (forge)
  let aesBase64 = null; // base64 string of key (for storage)
  let currentRoom = room;

  function appendMessage(text, meta = '', me = false) {
    const el = document.createElement('div');
    el.className = 'msg' + (me ? ' me' : '');
    if (meta) el.innerHTML = `<div class="meta">${meta}</div>` + escapeHtml(text);
    else el.innerHTML = escapeHtml(text);
    chatBox.appendChild(el);
    chatBox.scrollTop = chatBox.scrollHeight;
  }
  function escapeHtml(s){ return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  socket.on('connect', () => {
    console.log('Connected to server');
    // send join to server with username and room
    socket.emit('message', { type: 'join', username, room });
  });

  socket.on('connect_error', (error) => {
    console.error('Connection error:', error);
    sub.innerText = 'Connection failed. Please refresh the page.';
  });

  socket.on('message', (msg) => {
    console.log('Received message:', msg);

    if (msg.type === 'public_key') {
      serverPublicKeyPem = msg.key;
      console.log('Received server public key');
      // Immediately generate AES for our room and send encrypted_aes
      generateAndSendAESKey(currentRoom);
    }

    else if (msg.type === 'rooms_list') {
      // populate room dropdown
      roomsSelect.innerHTML = '';
      msg.rooms.forEach(r => {
        const opt = document.createElement('option'); opt.value = r; opt.innerText = r;
        roomsSelect.appendChild(opt);
      });
      // ensure current room selected
      if (roomsSelect.querySelector(`option[value="${currentRoom}"]`)) roomsSelect.value = currentRoom;
    }

    else if (msg.type === 'room_key') {
      // Server provides the current room AES key as base64 (note: server-trusted model)
      if (msg.room === currentRoom) {
        aesBase64 = msg.aes;
        aesKeyBytes = forge.util.createBuffer(forge.util.decode64(aesBase64)).getBytes();
        appendMessage('🔐 Room key received and set.', 'system', false);
        sub.innerText = `You are: ${username} • Room: ${currentRoom} • Ready`;
      }
    }

    else if (msg.type === 'user_joined') {
      appendMessage(`${msg.username} joined the room.`, 'system');
    }

    else if (msg.type === 'user_left') {
      appendMessage(`${msg.username} left the room.`, 'system');
    }

    else if (msg.type === 'chat_message') {
      if (msg.room !== currentRoom) return; // ignore
      // decrypt using AES key (CBC) with provided iv
      try {
        if (!aesKeyBytes) {
          appendMessage('Received encrypted message but AES key is not set.', 'system');
          return;
        }
        const ivBytes = forge.util.decode64(msg.iv);
        const encryptedBytes = forge.util.decode64(msg.encrypted);

        const decipher = forge.cipher.createDecipher('AES-CBC', aesKeyBytes);
        decipher.start({ iv: ivBytes });
        decipher.update(forge.util.createBuffer(encryptedBytes));
        const ok = decipher.finish();
        const plaintext = ok ? decipher.output.toString() : '[decryption failed]';
        appendMessage(plaintext, `${msg.sender} • ${new Date(msg.timestamp).toLocaleTimeString()}`, msg.sender === username);
      } catch (e) {
        console.error('Decryption error', e);
      }
    }
  };

  // Create AES key, encrypt with server RSA, send to server
  function generateAndSendAESKey(roomName) {
    if (!serverPublicKeyPem) {
      console.warn('Server public key not received yet.');
      return;
    }
    try {
      console.log('Generating AES key for room:', roomName);
      // AES-128 key: 16 bytes
      const keyBytes = forge.random.getBytesSync(16);
      aesKeyBytes = keyBytes;
      aesBase64 = forge.util.encode64(keyBytes);

      // encrypt with RSA public key
      const pub = forge.pki.publicKeyFromPem(serverPublicKeyPem);
      const encrypted = pub.encrypt(keyBytes, 'RSA-OAEP');
      const encryptedB64 = forge.util.encode64(encrypted);

      socket.emit('message', {
        type: 'encrypted_aes',
        room: roomName,
        data: encryptedB64
      });
      appendMessage('Generated AES key and sent to server (encrypted).', 'system');
      console.log('AES key sent to server');
    } catch (error) {
      console.error('Error generating/sending AES key:', error);
      appendMessage('Error setting up encryption. Please refresh.', 'system');
    }
  }

  // Send chat message (encrypt first)
  async function sendMessage() {
    const text = msgInput.value.trim();
    if (!text) return;
    if (!aesKeyBytes) return alert('Room AES key not set yet. Wait a moment.');

    // New IV per message
    const iv = forge.random.getBytesSync(16);
    const cipher = forge.cipher.createCipher('AES-CBC', aesKeyBytes);
    cipher.start({ iv: iv });
    cipher.update(forge.util.createBuffer(text, 'utf8'));
    cipher.finish();
    const encrypted = cipher.output.getBytes();

    socket.emit('message', {
      type: 'chat_message',
      room: currentRoom,
      encrypted: forge.util.encode64(encrypted),
      iv: forge.util.encode64(iv)
    });

    // local echo
    appendMessage(text, `Me • ${new Date().toLocaleTimeString()}`, true);
    msgInput.value = '';
  }

  // UI events
  sendBtn.addEventListener('click', sendMessage);
  msgInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage(); });

  // Rooms select change
  roomsSelect.addEventListener('change', () => {
    const newRoom = roomsSelect.value;
    if (!newRoom) return;
    joinRoom(newRoom);
  });

  createRoomBtn.addEventListener('click', () => {
    const r = newRoomInput.value.trim();
    if (!r) return alert('Enter room name to create.');
    socket.emit('message', { type: 'create_room', room: r });
    newRoomInput.value = '';
  });

  function joinRoom(newRoom) {
    // Switch room locally and notify server by sending join + generate new AES key
    currentRoom = newRoom;
    title.innerText = `Secure Chat — ${currentRoom}`;
    sub.innerText = `You are: ${username} • Room: ${currentRoom}`;
    // Clear chat area
    chatBox.innerHTML = '';
    // Send join
    socket.emit('message', { type: 'join', username, room: currentRoom });
    // Generate and send a fresh AES key for this room (so server stores it)
    generateAndSendAESKey(currentRoom);
  }

  // small helper: if page loaded and server public key hasn't arrived, we'll still send join; client will send AES when public key arrives.
  // Ensure we join initial room
  window.addEventListener('load', () => {
    // populate UI room select with currentRoom as selected
    const opt = document.createElement('option'); opt.value = currentRoom; opt.innerText = currentRoom; roomsSelect.appendChild(opt);
    roomsSelect.value = currentRoom;
  });

})();

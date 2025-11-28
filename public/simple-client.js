// Simple client without encryption for testing
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

  title.innerText = `Secure Chat — ${room}`;
  sub.innerText = `You are: ${username} • Room: ${room} • Loading...`;
  
  // Test if page loaded
  console.log('Page loaded, username:', username, 'room:', room);
  appendMessage('Page loaded successfully', 'system');
  
  // Check if forge is available
  if (typeof forge === 'undefined') {
    appendMessage('⚠️ Encryption library not loaded - messages will be plain text', 'system');
  } else {
    appendMessage('🔧 Encryption library loaded', 'system');
  }

  // Socket.IO connection
  const socket = io();

  // Crypto vars
  let serverPublicKeyPem = null;
  let aesKeyBytes = null;
  let aesBase64 = null;

  function appendMessage(text, meta = '', me = false) {
    const el = document.createElement('div');
    el.className = 'msg' + (me ? ' me' : '');
    if (meta) el.innerHTML = `<div class="meta">${meta}</div>` + escapeHtml(text);
    else el.innerHTML = escapeHtml(text);
    chatBox.appendChild(el);
    chatBox.scrollTop = chatBox.scrollHeight;
  }
  
  function escapeHtml(s){ 
    return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); 
  }

  socket.on('connect', () => {
    console.log('Connected to server');
    sub.innerText = `You are: ${username} • Room: ${room} • Connected`;
    appendMessage('Connected to server', 'system');
    socket.emit('join-room', { username, room });
  });

  socket.on('public-key', (data) => {
    serverPublicKeyPem = data.key;
    console.log('Received server public key');
    generateAndSendAESKey();
  });

  socket.on('room-key', (data) => {
    if (data.room === room) {
      aesBase64 = data.aes;
      aesKeyBytes = forge.util.createBuffer(forge.util.decode64(aesBase64)).getBytes();
      appendMessage('🔐 Encryption enabled', 'system');
      sub.innerText = `You are: ${username} • Room: ${room} • Encrypted`;
    }
  });

  socket.on('connect_error', (error) => {
    console.error('Connection failed:', error);
    sub.innerText = 'Connection failed - check if server is running';
    appendMessage('Failed to connect to server', 'system');
  });

  socket.on('disconnect', () => {
    console.log('Disconnected from server');
    sub.innerText = 'Disconnected from server';
    appendMessage('Disconnected from server', 'system');
  });

  socket.on('message', (data) => {
    if (data.encrypted && data.iv) {
      // Decrypt message
      if (!aesKeyBytes) {
        appendMessage('[Encrypted message - key not ready]', `${data.username} • ${new Date(data.timestamp).toLocaleTimeString()}`);
        return;
      }
      try {
        const ivBytes = forge.util.decode64(data.iv);
        const encryptedBytes = forge.util.decode64(data.encrypted);
        const decipher = forge.cipher.createDecipher('AES-CBC', aesKeyBytes);
        decipher.start({ iv: ivBytes });
        decipher.update(forge.util.createBuffer(encryptedBytes));
        const ok = decipher.finish();
        const plaintext = ok ? decipher.output.toString() : '[decryption failed]';
        appendMessage(plaintext, `${data.username} • ${new Date(data.timestamp).toLocaleTimeString()}`, data.username === username);
      } catch (e) {
        appendMessage('[Decryption error]', `${data.username} • ${new Date(data.timestamp).toLocaleTimeString()}`);
      }
    } else {
      // Plain text message
      appendMessage(data.message, `${data.username} • ${new Date(data.timestamp).toLocaleTimeString()}`, data.username === username);
    }
  });

  socket.on('user-joined', (data) => {
    appendMessage(`${data.username} joined the room.`, 'system');
  });

  socket.on('user-left', (data) => {
    appendMessage(`${data.username} left the room.`, 'system');
  });

  function sendMessage() {
    const text = msgInput.value.trim();
    if (!text) return;

    if (aesKeyBytes) {
      // Send encrypted message
      const iv = forge.random.getBytesSync(16);
      const cipher = forge.cipher.createCipher('AES-CBC', aesKeyBytes);
      cipher.start({ iv: iv });
      cipher.update(forge.util.createBuffer(text, 'utf8'));
      cipher.finish();
      const encrypted = cipher.output.getBytes();

      socket.emit('send-message', {
        username,
        room,
        encrypted: forge.util.encode64(encrypted),
        iv: forge.util.encode64(iv),
        timestamp: new Date().toISOString()
      });
    } else {
      // Send plain text if encryption not ready
      socket.emit('send-message', {
        username,
        room,
        message: text,
        timestamp: new Date().toISOString()
      });
    }

    msgInput.value = '';
  }

  function generateAndSendAESKey() {
    if (!serverPublicKeyPem) return;
    
    try {
      const keyBytes = forge.random.getBytesSync(16);
      aesKeyBytes = keyBytes;
      aesBase64 = forge.util.encode64(keyBytes);

      const pub = forge.pki.publicKeyFromPem(serverPublicKeyPem);
      const encrypted = pub.encrypt(keyBytes, 'RSA-OAEP');
      const encryptedB64 = forge.util.encode64(encrypted);

      socket.emit('encrypted-aes', {
        room: room,
        data: encryptedB64
      });
      
      appendMessage('🔑 Generated encryption key', 'system');
    } catch (error) {
      console.error('Error generating AES key:', error);
    }
  }

  sendBtn.addEventListener('click', sendMessage);
  msgInput.addEventListener('keydown', (e) => { 
    if (e.key === 'Enter') sendMessage(); 
  });

  // Room creation functionality
  const createRoomBtn = document.getElementById('createRoomBtn');
  const newRoomInput = document.getElementById('newRoom');
  
  if (createRoomBtn && newRoomInput) {
    createRoomBtn.addEventListener('click', () => {
      const roomName = newRoomInput.value.trim();
      if (!roomName) {
        alert('Enter a room name');
        return;
      }
      // Redirect to new room
      const url = `chat.html?username=${encodeURIComponent(username)}&room=${encodeURIComponent(roomName)}`;
      location.href = url;
    });
  }

})();
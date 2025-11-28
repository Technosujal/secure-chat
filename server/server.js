const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const generateRSAKeys = require('./rsaKeys');
const forge = require('node-forge');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Generate RSA keys for the server
const { publicKeyPem, privateKeyPem } = generateRSAKeys();
const rooms = new Map(); // room -> { users: Set, aesKey: string }

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '..', 'public')));

// Redirect root to login page
app.get('/', (req, res) => {
  res.redirect('/login.html');
});

io.on('connection', (socket) => {
  console.log('User connected');
  let currentUser = null;
  let currentRoom = null;
  
  // Send server public key immediately
  socket.emit('message', { type: 'public_key', key: publicKeyPem });
  
  socket.on('message', (data) => {
    if (data.type === 'join') {
      currentUser = data.username;
      currentRoom = data.room;
      
      // Initialize room if it doesn't exist
      if (!rooms.has(currentRoom)) {
        rooms.set(currentRoom, { users: new Set(), aesKey: null });
      }
      
      const room = rooms.get(currentRoom);
      room.users.add(currentUser);
      socket.join(currentRoom);
      
      // Send existing AES key if available
      if (room.aesKey) {
        socket.emit('message', { type: 'room_key', room: currentRoom, aes: room.aesKey });
      }
      
      // Notify others
      socket.to(currentRoom).emit('message', { type: 'user_joined', username: currentUser });
      
      // Send rooms list
      socket.emit('message', { type: 'rooms_list', rooms: Array.from(rooms.keys()) });
    }
    
    else if (data.type === 'encrypted_aes') {
      // Decrypt AES key and store for the room
      try {
        const privateKey = forge.pki.privateKeyFromPem(privateKeyPem);
        const encryptedBytes = forge.util.decode64(data.data);
        const decryptedKey = privateKey.decrypt(encryptedBytes, 'RSA-OAEP');
        const aesBase64 = forge.util.encode64(decryptedKey);
        
        if (rooms.has(data.room)) {
          rooms.get(data.room).aesKey = aesBase64;
          // Send key to all users in room
          io.to(data.room).emit('message', { type: 'room_key', room: data.room, aes: aesBase64 });
        }
      } catch (e) {
        console.error('Failed to decrypt AES key:', e);
      }
    }
    
    else if (data.type === 'chat_message') {
      // Forward encrypted message to room
      socket.to(data.room).emit('message', {
        type: 'chat_message',
        room: data.room,
        sender: currentUser,
        encrypted: data.encrypted,
        iv: data.iv,
        timestamp: new Date().toISOString()
      });
    }
    
    else if (data.type === 'create_room') {
      if (!rooms.has(data.room)) {
        rooms.set(data.room, { users: new Set(), aesKey: null });
        io.emit('message', { type: 'rooms_list', rooms: Array.from(rooms.keys()) });
      }
    }
  });
  
  socket.on('disconnect', () => {
    console.log('User disconnected');
    if (currentUser && currentRoom && rooms.has(currentRoom)) {
      const room = rooms.get(currentRoom);
      room.users.delete(currentUser);
      socket.to(currentRoom).emit('message', { type: 'user_left', username: currentUser });
      
      // Clean up empty rooms
      if (room.users.size === 0) {
        rooms.delete(currentRoom);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
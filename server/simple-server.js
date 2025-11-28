const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const generateRSAKeys = require('./rsaKeys');
const forge = require('node-forge');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '..', 'public')));

// Redirect root to login page
app.get('/', (req, res) => {
  res.redirect('/login.html');
});

const { publicKeyPem, privateKeyPem } = generateRSAKeys();
const rooms = new Map();

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join-room', (data) => {
    socket.join(data.room);
    const roomUsers = {};
    
    // Fixed: Correct way to get room clients in Socket.IO v4+
    const room = io.sockets.adapter.rooms.get(data.room);
    if (room) {
      room.forEach(clientId => {
        const clientSocket = io.sockets.sockets.get(clientId);
        if (clientSocket && clientSocket.userData) {
          roomUsers[clientId] = clientSocket.userData.user;
        }
      });
    }

    socket.userData = { user: data.user, room: data.room };
    roomUsers[socket.id] = data.user; // Add current user
    
    io.to(data.room).emit('users-list', roomUsers);
    socket.to(data.room).emit('user-joined', { user: data.user });
  });

  socket.on('send-message', (data) => {
    io.to(data.room).emit('message', {
      user: data.user,
      message: data.message,
      timestamp: data.timestamp
    });
  });

  socket.on('typing', (data) => {
    socket.to(data.room).emit('typing', { user: data.user });
  });

  socket.on('stop-typing', (data) => {
    socket.to(data.room).emit('stop-typing');
  });

  socket.on('leave-room', (data) => {
    socket.leave(data.room);
  });

  socket.on('disconnect', () => {
    if (socket.userData) {
      io.to(socket.userData.room).emit('user-left', { 
        user: socket.userData.user 
      });
    }
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
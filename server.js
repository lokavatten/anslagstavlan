const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// In-memory room storage
const rooms = new Map();

// Serve static files
app.use(express.static(path.join(__dirname)));

// Serve index.html on all routes (for SPA)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Socket.io connection
io.on('connection', (socket) => {
  let currentRoom = null;

  socket.on('join-room', (roomId) => {
    // Leave previous room if any
    if (currentRoom) {
      socket.leave(currentRoom);
      updateRoomUserCount(currentRoom);
    }

    // Join new room
    currentRoom = roomId;
    socket.join(roomId);

    // Initialize room if it doesn't exist
    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        messages: [],
        userCount: 0,
        cleanupTimer: null
      });
    }

    const room = rooms.get(roomId);
    room.userCount += 1;

    // Clear cleanup timer if exists
    if (room.cleanupTimer) {
      clearTimeout(room.cleanupTimer);
      room.cleanupTimer = null;
    }

    // Send current room state to the joining user
    socket.emit('room-state', {
      messages: room.messages,
      userCount: room.userCount
    });

    // Notify others in room that user count changed
    io.to(roomId).emit('user-count', room.userCount);
  });

  socket.on('new-message', (data) => {
    if (!currentRoom) return;

    const room = rooms.get(currentRoom);
    if (!room) return;

    const message = {
      id: data.id,
      text: data.text,
      timestamp: data.timestamp,
      file: data.file ? {
        name: data.file.name,
        type: data.file.type,
        size: data.file.size
      } : null
    };

    room.messages.push(message);

    // Broadcast to all users in room
    io.to(currentRoom).emit('new-message', message);
  });

  socket.on('delete-message', (id) => {
    if (!currentRoom) return;

    const room = rooms.get(currentRoom);
    if (!room) return;

    room.messages = room.messages.filter(m => m.id !== id);
    io.to(currentRoom).emit('delete-message', id);
  });

  socket.on('clear-board', () => {
    if (!currentRoom) return;

    const room = rooms.get(currentRoom);
    if (!room) return;

    room.messages = [];
    io.to(currentRoom).emit('clear-board');
  });

  socket.on('edit-message', ({ id, text }) => {
    if (!currentRoom) return;

    const room = rooms.get(currentRoom);
    if (!room) return;

    const msg = room.messages.find(m => m.id === id);
    if (msg) {
      msg.text = text;
      io.to(currentRoom).emit('edit-message', { id, text });
    }
  });

  socket.on('disconnect', () => {
    if (!currentRoom) return;

    const room = rooms.get(currentRoom);
    if (!room) return;

    room.userCount -= 1;
    io.to(currentRoom).emit('user-count', room.userCount);

    // Schedule cleanup if room is empty
    if (room.userCount === 0) {
      room.cleanupTimer = setTimeout(() => {
        rooms.delete(currentRoom);
      }, 30000); // 30 second grace period
    }
  });
});

// Start server
const PORT = process.env.PORT || 3005;
server.listen(PORT, () => {
  console.log(`Flyktig Tavla server running on http://localhost:${PORT}`);
});

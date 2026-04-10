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
  },
  maxHttpBufferSize: 11 * 1024 * 1024 // 11 MB to allow 10 MB files
});

// In-memory room storage
const rooms = new Map();

// Serve static files
app.use(express.static(path.join(__dirname)));

// API endpoint for stats
app.get('/api/stats', (req, res) => {
  const stats = {
    totalRooms: rooms.size,
    totalUsers: Array.from(rooms.values()).reduce((sum, room) => sum + room.userCount, 0),
    rooms: Array.from(rooms.entries()).map(([roomId, room]) => ({
      id: roomId,
      title: room.title,
      userCount: room.userCount,
      messageCount: room.messages.length,
      url: `${req.protocol}://${req.get('host')}/#${roomId}`
    }))
  };
  res.json(stats);
});

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
        cleanupTimer: null,
        title: 'Flyktig tavla'
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
      userCount: room.userCount,
      title: room.title
    });

    // Notify others in room that user count changed
    io.to(roomId).emit('user-count', room.userCount);
  });

  socket.on('new-message', (data) => {
    if (!currentRoom) return;

    const room = rooms.get(currentRoom);
    if (!room) return;

    console.log('Server received message:', data.text ? data.text.slice(0, 50) : '(no text)');
    if (data.file) {
      console.log('Server received file:', data.file.name, 'Size:', data.file.size);
    }

    const message = {
      id: data.id,
      text: data.text,
      timestamp: data.timestamp,
      file: data.file ? {
        name: data.file.name,
        type: data.file.type,
        size: data.file.size,
        data: data.file.data, // base64 data for download
        isImage: data.file.isImage // preserve image flag
      } : null
    };

    room.messages.push(message);

    console.log('Broadcasting message to room:', currentRoom);
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

  socket.on('board-title-change', (newTitle) => {
    if (!currentRoom) return;

    const room = rooms.get(currentRoom);
    if (!room) return;

    console.log('Board title changed in room', currentRoom, ':', newTitle);

    // Save the new title to the room
    room.title = newTitle;

    // Broadcast to all users in room (including sender)
    io.to(currentRoom).emit('board-title-change', newTitle);
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

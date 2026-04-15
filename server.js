const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// === SOCKET.IO CONFIGURATION ===
// maxHttpBufferSize: 15 MB handles ~10 MB files after base64 encoding (~33% overhead).
// Example: 10 MB file → 13.3 MB base64 + metadata < 15 MB ✓
// CORS open for development; restrict to your domain in production.
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  maxHttpBufferSize: 15 * 1024 * 1024
});

// === IN-MEMORY ROOM STORAGE ===
// Map<roomId: string, room: { messages[], userCount, title, pin, cleanupTimer }>
// Rooms are lazy-created on first join-room and auto-deleted when empty after 30s grace period.
// No database, no persistence — data lives as long as at least one user is present.
const rooms = new Map();

// Serve static files
app.use(express.static(path.join(__dirname)));

// === REST API ===

/**
 * GET /api/stats
 * Returns metadata about all active rooms. Does NOT expose PINs.
 * Used by the /stats page to populate the room list.
 */
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
      // NOTE: PIN is intentionally omitted. PINs are only sent via room-state to members.
    }))
  };
  res.json(stats);
});

/**
 * POST /api/verify-pin
 * Verifies the PIN for a room. Called when user enters PIN from the /stats page.
 * Success → user can navigate to the room. Failure → show error message.
 */
app.post('/api/verify-pin', express.json(), (req, res) => {
  const { roomId, pin } = req.body;
  const room = rooms.get(roomId);

  if (!room) {
    return res.json({ success: false, error: 'Tavlan finns inte' });
  }

  if (room.pin !== pin) {
    return res.json({ success: false, error: 'Fel PIN' });
  }

  res.json({ success: true });
});

// Serve index.html on all routes (for SPA)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/help', (req, res) => {
  res.sendFile(path.join(__dirname, 'help.html'));
});

app.get('/*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// === SOCKET.IO EVENT HANDLERS ===
io.on('connection', (socket) => {
  let currentRoom = null;

  /**
   * join-room event
   * User wants to join (or switch to) a room. Lazy-creates the room if needed.
   * Emits:
   *   - room-state (to this socket only): full current state + PIN
   *   - user-count (to all in room): updated user count
   */
  socket.on('join-room', (roomId) => {
    // Leave previous room if any
    if (currentRoom) {
      socket.leave(currentRoom);
      updateRoomUserCount(currentRoom);
    }

    // Join new room
    currentRoom = roomId;
    socket.join(roomId);

    // Initialize room if it doesn't exist (lazy creation).
    // PIN is generated once and never changes for this room's lifetime.
    if (!rooms.has(roomId)) {
      const pin = Math.floor(1000 + Math.random() * 9000).toString();
      rooms.set(roomId, {
        messages: [],
        userCount: 0,
        cleanupTimer: null,
        title: 'Flyktig tavla',
        pin: pin
      });
    }

    const room = rooms.get(roomId);
    room.userCount += 1;

    // If this room was pending deletion, cancel it.
    // This 30-second grace period allows a disconnected user to rejoin without losing data.
    if (room.cleanupTimer) {
      clearTimeout(room.cleanupTimer);
      room.cleanupTimer = null;
    }

    // Send current room state to ONLY this socket (not broadcast).
    // This includes the PIN, which is shown to board members in the share modal.
    socket.emit('room-state', {
      messages: room.messages,
      userCount: room.userCount,
      title: room.title,
      pin: room.pin
    });

    // Notify ALL in room about the new user count.
    io.to(roomId).emit('user-count', room.userCount);
  });

  /**
   * new-message event
   * User posts a message, optionally with a file attachment.
   * Files arrive as base64-encoded data URIs (~33% larger than original).
   *
   * Validation: Server-side file size check as a second layer of defense.
   * If file exceeds 15 MB, emit upload-error to sender only; do NOT broadcast/save.
   */
  socket.on('new-message', (data) => {
    if (!currentRoom) return;

    const room = rooms.get(currentRoom);
    if (!room) return;

    console.log('Server received message:', data.text ? data.text.slice(0, 50) : '(no text)');
    if (data.file) {
      console.log('Server received file:', data.file.name, 'Size:', data.file.size);

      // Server-side file size validation (second layer, for defense in depth).
      // Measure the actual UTF-8 byte length of the base64 string.
      const base64Size = Buffer.byteLength(data.file.data, 'utf8');
      const base64SizeInMB = base64Size / (1024 * 1024);
      const maxSize = 15; // MB, matches client validation and Socket.io maxHttpBufferSize

      if (base64SizeInMB > maxSize) {
        console.log(`File rejected: ${(base64SizeInMB).toFixed(2)} MB exceeds ${maxSize} MB limit`);
        socket.emit('upload-error', `Servern avvisade filen: ${(base64SizeInMB).toFixed(2)} MB är för stor.`);
        return; // Do NOT save or broadcast
      }
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

  /**
   * delete-message event
   * Remove a single message by ID. Broadcast deletion to all.
   */
  socket.on('delete-message', (id) => {
    if (!currentRoom) return;

    const room = rooms.get(currentRoom);
    if (!room) return;

    room.messages = room.messages.filter(m => m.id !== id);
    io.to(currentRoom).emit('delete-message', id);
  });

  /**
   * clear-board event
   * Delete all messages in the room. Broadcast to all.
   */
  socket.on('clear-board', () => {
    if (!currentRoom) return;

    const room = rooms.get(currentRoom);
    if (!room) return;

    room.messages = [];
    io.to(currentRoom).emit('clear-board');
  });

  /**
   * edit-message event
   * Update text of an existing message. Broadcast change to all.
   */
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

  /**
   * board-title-change event
   * Update the room's display title. Broadcast to all.
   */
  socket.on('board-title-change', (newTitle) => {
    if (!currentRoom) return;

    const room = rooms.get(currentRoom);
    if (!room) return;

    console.log('Board title changed in room', currentRoom, ':', newTitle);

    // Update room state
    room.title = newTitle;

    // Broadcast to all users (including sender for confirmation)
    io.to(currentRoom).emit('board-title-change', newTitle);
  });

  /**
   * disconnect event
   * User leaves the room (browser close, refresh, navigation, timeout, etc.).
   * Decrease user count. If room is now empty, start a 30-second cleanup timer.
   * This allows a user who refreshed or had network hiccups to rejoin without losing data.
   */
  socket.on('disconnect', () => {
    if (!currentRoom) return;

    const room = rooms.get(currentRoom);
    if (!room) return;

    room.userCount -= 1;
    io.to(currentRoom).emit('user-count', room.userCount);

    // Schedule cleanup if room is now empty.
    // Grace period: 3 hours. Allows users to return after a lunch break or short pause,
    // as long as they remember the URL. If anyone rejoins before timer fires, cleanup is cancelled.
    if (room.userCount === 0) {
      room.cleanupTimer = setTimeout(() => {
        rooms.delete(currentRoom);
        console.log('Room cleaned up after grace period:', currentRoom);
      }, 3 * 60 * 60 * 1000); // 3 hours
    }
  });
});

// === START SERVER ===
const PORT = process.env.PORT || 3005;
server.listen(PORT, () => {
  console.log(`🎯 Flyktig Tavla server running on http://localhost:${PORT}`);
  console.log(`💾 All data is stored in-memory. Rooms are deleted when empty (30s grace period).`);
});

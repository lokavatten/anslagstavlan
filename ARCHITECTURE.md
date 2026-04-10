# Flyktig Tavla – Arkitektur-dokumentation

En djupgående beskrivning av systemet, data-flöden, säkerhet och design-beslut.

## Systemöversikt

Flyktig Tavla är en minimal två-fil-arkitektur:

```
┌─────────────────────────────────────────────┐
│  Web Client (Browser)                       │
│  ┌────────────────────────────────────────┐ │
│  │ React App (index.html)                 │ │
│  │ - 863 rader JSX + CSS + Socket.io      │ │
│  │ - Två komponenter: StatsPage, App      │ │
│  │ - State management för 24 variabler    │ │
│  └────────────────────────────────────────┘ │
│                   │                          │
│                   │ Socket.io                │
│                   ▼                          │
│  ┌────────────────────────────────────────┐ │
│  │ Socket.io Client                       │ │
│  │ (connect, emit, on)                    │ │
│  └────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
              HTTP + WebSocket
┌─────────────────────────────────────────────┐
│  Node.js Server (server.js)                 │
│  ┌────────────────────────────────────────┐ │
│  │ Express App                            │ │
│  │ - GET / * → index.html (SPA)           │ │
│  │ - POST /api/verify-pin → JSON          │ │
│  │ - GET /api/stats → JSON                │ │
│  │ - Static serve: /socket.io/socket.io.js│ │
│  └────────────────────────────────────────┘ │
│                   │                          │
│                   ▼                          │
│  ┌────────────────────────────────────────┐ │
│  │ Socket.io Server + Event Handlers      │ │
│  │ 6 socket events, 8 broadcast events    │ │
│  └────────────────────────────────────────┘ │
│                   │                          │
│                   ▼                          │
│  ┌────────────────────────────────────────┐ │
│  │ In-Memory Room Storage                 │ │
│  │ Map<roomId, { messages[], userCount,  │ │
│  │              title, pin, cleanupTimer, │ │
│  │              cleanupTimer }>            │ │
│  │ - ~5 KB per room (típ.)                │ │
│  │ - Raderas när alla lämnar (30s timer)  │ │
│  └────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

### Teknik-stack

| Komponent | Teknologi | Varför |
|-----------|-----------|--------|
| Backend-runtime | Node.js | Nästan är det enda som körde JavaScript på server 2014. Bra för realtid-events. |
| HTTP-server | Express.js | Minimalistisk. 4 rader för att sätta upp en SPA server. |
| Realtid | Socket.io | Fallback från WebSocket → polling för gamla browsers. Duplex-kommunikation. |
| Frontend-framework | React (CDN) | Komponentbaserad UI. CDN-laddning undviker build-steg. |
| JS-transpiler | Babel Standalone | Gör det möjligt att skriva JSX direkt i HTML utan build-tool. |
| CSS | Tailwind CSS (CDN) | Snabb UI-utveckling. Utility-first klassnamn. |
| Ikon-bibliotek | Lucide (CDN) | SVG-ikoner, moderna, licensfria. |
| Data-lagring | In-memory `Map()` | Temporär design. Inget SQL, inget ORM, inget väl. |

---

## Room Lifecycle

### 1. Skapande (vid första `join-room`)

```javascript
// server.js, rad 79-88
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
```

**Lazy creation**: Rummet skapas inte förrän någon försöker ansluta till det. På klienten skapas ett slumpmässigt `roomId` med `Math.random().toString(36).slice(2, 8)` (6 alfanumeriska tecken).

**PIN-generering**: En 4-siffrig kod (1000–9999) genereras på servern och lagras. PIN förändras aldrig för rummets livstid.

### 2. User Join-flöde

```javascript
// server.js, rad 67-109
socket.on('join-room', (roomId) => {
  // 1. Lämna tidigare rum (om någon)
  if (currentRoom) {
    socket.leave(currentRoom);
    updateRoomUserCount(currentRoom);  // minskar count
  }

  // 2. Gå med i nytt rum
  currentRoom = roomId;
  socket.join(roomId);

  // 3. Skapa rummet om det inte finns
  if (!rooms.has(roomId)) { /* ... */ }

  // 4. Öka userCount och cancel cleanup
  const room = rooms.get(roomId);
  room.userCount += 1;
  if (room.cleanupTimer) {
    clearTimeout(room.cleanupTimer);
    room.cleanupTimer = null;
  }

  // 5. Skicka nuvarande tillstånd tillbaka till denna socket BARA
  socket.emit('room-state', { messages, userCount, title, pin });

  // 6. Berätta för alla i rummet att userCount ändrades
  io.to(roomId).emit('user-count', room.userCount);
});
```

**Viktigt**: `socket.emit('room-state', ...)` går bara till den anslutande socketen. `io.to(roomId).emit('user-count', ...)` går till ALLA i rummet.

### 3. Disconnect & Cleanup

```javascript
// server.js, rad 190-205
socket.on('disconnect', () => {
  if (!currentRoom) return;
  const room = rooms.get(currentRoom);
  if (!room) return;

  room.userCount -= 1;
  io.to(currentRoom).emit('user-count', room.userCount);

  // Om rummet är tomt, starta cleanup-timer
  if (room.userCount === 0) {
    room.cleanupTimer = setTimeout(() => {
      rooms.delete(currentRoom);  // <-- Radera rummets hela data
    }, 30000);  // <-- 30 sekunders grace period
  }
});
```

**Grace period**: Om en användare kopplas från (nätverk-avbrott, refresh), hinner andra ansluta igen inom 30 sekunder utan att förlora data. Efter 30 sekunder är rummet borta för gott.

---

## Socket.io Event-referens

### Client → Server Events

| Event | Payload | Där | Vad händer |
|-------|---------|-----|-----------|
| `join-room` | `roomId: string` | rad 67 server | User ansluter/skapas rum, skicka room-state tillbaka, broadcast user-count |
| `new-message` | `{ id, text, file, timestamp }` | rad 111 server | Validera filstorlek på server. Spara i `room.messages[]`. Broadcast till alla. |
| `delete-message` | `id: number` | rad 142 server | Filtrera `room.messages` på ID. Broadcast delete till alla. |
| `clear-board` | _(ingen payload)_ | rad 152 server | Töm `room.messages = []`. Broadcast till alla. |
| `edit-message` | `{ id, text }` | rad 162 server | Uppdatera text på meddelande med ID. Broadcast edit till alla. |
| `board-title-change` | `newTitle: string` | rad 175 server | Uppdatera `room.title`. Broadcast ny titel till alla. |

### Server → Client Events (Broadcast)

| Event | Payload | Var skickad | Vad |
|-------|---------|-------------|-----|
| `room-state` | `{ messages[], userCount, title, pin }` | `socket.emit` (endast denna socket) | Skickas bara till en ny user för att ge dem nuvarande state. Innehåller PIN! |
| `user-count` | `count: number` | `io.to(roomId).emit` (alla i rummet) | Nytt användarantal. Broadcast när någon join/disconnect. |
| `new-message` | `message: { id, text, timestamp, file }` | `io.to(roomId).emit` (alla i rummet) | Nytt inlägg. Broadcast till alla inklusive avsändare. |
| `delete-message` | `id: number` | `io.to(roomId).emit` (alla i rummet) | Radera visst meddelande. |
| `clear-board` | _(ingen payload)_ | `io.to(roomId).emit` (alla i rummet) | Töm alla meddelanden. |
| `edit-message` | `{ id, text }` | `io.to(roomId).emit` (alla i rummet) | Uppdatera text på meddelande. |
| `board-title-change` | `newTitle: string` | `io.to(roomId).emit` (alla i rummet) | Ny titel för tavlan. |
| `upload-error` | `errorMessage: string` | `socket.emit` (endast denna socket) | Servern avvisade en fil (för stor). Skickas bara till avsändaren. |
| `error` | `error` | Socket.io-nivå | Generiska Socket.io-fel (timeout, etc.). Fångad av klient för error-state. |

---

## Filöverförings-flöde (End-to-End)

### Steg 1: Användare väljer fil
```javascript
// index.html, rad 835
<input type="file" onChange={(e) => setFile(e.target.files[0])} />
```
Filen sparas i `file`-state. En förhandsgranskning visas i footern.

### Steg 2: Klient-validering PRE-ENCODING (10 MB gräns)
```javascript
// index.html, rad 455
if (file && file.size > 10 * 1024 * 1024) {
  setUploadError('Filen är för stor. Max 10 MB.');
  return;
}
```
Kontrollerar fil-storleken innan någon encoding. Denna gräns är user-friendly och ett tidigt rött ljus.

### Steg 3: FileReader läser filen som Base64
```javascript
// index.html, rad 517
const reader = new FileReader();
reader.readAsDataURL(file);  // <-- asynkron, tar ett tag för stora filer
reader.onload = (event) => { /* steg 4+ */ };
```
`readAsDataURL` konverterar fil-bytes till en data URI med base64-encoding: `data:image/png;base64,iVBORw0K...`

### Steg 4: Klient-validering POST-ENCODING (15 MB gräns)
```javascript
// index.html, rad 476-487
const base64Data = event.target.result;  // data:... string
const base64Blob = new Blob([base64Data]);
const base64SizeBytes = base64Blob.size;
const base64SizeInMB = base64SizeBytes / (1024 * 1024);

if (base64SizeInMB > 15) {  // Socket.io buffer limit
  setUploadError(`Kodad storlek: ${base64SizeInMB.toFixed(2)} MB (max 15 MB).`);
  return;
}
```

**Varför en `Blob`?** En `Blob` räknar den faktiska UTF-8-byte-storleken av strängen, inte `string.length` (som räknar JavaScript-tecken). Basen64-string är ~33% större än originaldata.

**Exempel**: 
- Original: 9.0 MB
- Base64: 12.0 MB (×1.33)
- JavaScript: `"data:..."` prefix + 12 MB
- Total: ~12 MB < 15 MB ✓

### Steg 5: Konstruera meddelande-objekt
```javascript
// index.html, rad 493-499
newMsg.file = {
  name: file.name,
  type: file.type,
  size: (file.size / 1024).toFixed(1) + " KB",
  data: base64Data,  // <-- hela data URI
  isImage: file.type.startsWith('image/')
};
```

Detaljerad fil-metadata sparas tillsammans med base64-datat.

### Steg 6: Socket.io emit
```javascript
// index.html, rad 505
socketRef.current.emit('new-message', newMsg);
```

Socket.io serialiserar objektet (base64-datat ingår) och skickar det via WebSocket. Buffer-storleken kontrolleras av Socket.io:s `maxHttpBufferSize: 15 * 1024 * 1024`.

### Steg 7: Server mottar och validerar filstorlek (15 MB gräns)
```javascript
// server.js, rad 118-130
if (data.file) {
  const base64Size = Buffer.byteLength(data.file.data, 'utf8');
  const base64SizeInMB = base64Size / (1024 * 1024);
  
  if (base64SizeInMB > 15) {
    socket.emit('upload-error', 
      `Servern avvisade filen: ${base64SizeInMB.toFixed(2)} MB är för stor.`
    );
    return;  // <-- avbryt, spara inte
  }
}
```

Servern mäter samma sak (Buffer.byteLength) för att verifiera. Långsamt nätverk kan få ett meddelande att börja skickas men ej slutföras innan Socket.io timeout — detta är sällsynt men det är varför vi har två lager validering.

### Steg 8: Server sparar meddelande
```javascript
// server.js, rad 131-140
const message = {
  id: data.id,
  text: data.text,
  timestamp: data.timestamp,
  file: { name, type, size, data, isImage }  // <-- base64 är nu sparad på server
};
room.messages.push(message);
```

Hela base64-datat sparas i minnesminnena. Det finns ingen filsystem-skrivning.

### Steg 9: Server broadcast till alla
```javascript
// server.js, rad 149
io.to(currentRoom).emit('new-message', message);
```

Alla i rummet (inklusive avsändaren) mottar meddelandet med base64-datat.

### Steg 10: Klient renderar
```javascript
// index.html, rad 750-751 (för bilder)
{msg.file.isImage && <img src={msg.file.data} alt={...} />}

// eller index.html, rad 762 (för andra filer)
{!msg.file.isImage && <button onClick={download}>Download</button>}
```

**Bilder**: Renderas direkt som `<img src="data:image/png;base64,...">`  
**Andra filer**: En download-knapp uses `fetch(data:...)` → blob → download

---

## PIN-System

### Syfte
En lightweight åtkomstkontroll: om du ser ett rum på statistik-sidan, måste du veta PIN för att öppna det. Direktlänkar (`#roomid` i URL) kräver dock ingen PIN.

### Generering & Lagring

```javascript
// server.js, rad 80
const pin = Math.floor(1000 + Math.random() * 9000).toString();
// Resultat: "1234", "5678", osv. (4 siffror)

rooms.set(roomId, { ..., pin: pin });  // Sparas i rummet
```

PIN är unik per rum och genereras vid skapande. Den ändras aldrig.

### Exponering till Klient

```javascript
// server.js, rad 104
socket.emit('room-state', { ..., pin: room.pin });

// index.html, rad 337-338
socket.on('room-state', (state) => {
  if (state.pin) setBoardPin(state.pin);
});
```

PIN skickas i `room-state` till alla som ansluter. Det visas i Share-modal (index.html rad 902).

**Notera**: PIN är INTE hemligt — alla som är på tavlan ser det och kan dela det. PIN är bara ett lightweight skydd för slumpmässig åtkomst från stats-sidan.

### Verifieringsflöde (Stats-vägen)

```
Användare
    ↓
[klicka på rum på /stats]
    ↓
<PIN-modal öppnas>
    ↓
[mata in 4 siffror]
    ↓
POST /api/verify-pin { roomId, pin }
    ↓
Server: jämför pin === room.pin
    ↓
Success: ja             →  Navigera till /#roomId
         nej            →  Visa felmeddelande
```

**Kod**:
```javascript
// server.js, rad 39-52
app.post('/api/verify-pin', express.json(), (req, res) => {
  const { roomId, pin } = req.body;
  const room = rooms.get(roomId);
  if (!room) 
    return res.json({ success: false, error: 'Tavlan finns inte' });
  if (room.pin !== pin) 
    return res.json({ success: false, error: 'Fel PIN' });
  res.json({ success: true });
});

// index.html, rad 48-68 (StatsPage component)
const handleVerifyPin = async () => {
  const res = await fetch('/api/verify-pin', { 
    method: 'POST', 
    body: JSON.stringify({ roomId: pinModal.roomId, pin: pinInput }) 
  });
  const data = await res.json();
  if (data.success) {
    window.location.href = `/#${pinModal.roomId}`;
  } else {
    setPinError(data.error);
  }
};
```

### Bypass-notering

**PIN skyddar INTE direktlänkar.** Om du redan vet ett `roomId` kan du gå direkt till `http://localhost:3005/#abc123` utan att mata in PIN. Socket.io-eventet `join-room` frågande inte efter PIN.

PIN är bara för att förhindra att några klickar omkring på stats-sidan och slumpar in på dina tavlor.

---

## React-komponentstruktur

### `Icon` component (rad 30-37)

En wrapper för Lucide icons via CDN.

```javascript
const Icon = ({ name, size = 20, className = "" }) => {
  useEffect(() => {
    if (window.lucide) window.lucide.createIcons();
  }, [name]);
  return <i data-lucide={name} style={{...}} className={className}></i>;
};
```

Lucide måste initialiseras efter rendering för att `<i>` elementet blir en SVG.

### `StatsPage` component (rad 39-223)

En fristående sida som listas alla aktiva rum.

**State**:
- `stats` — färsk data från `/api/stats`
- `loading` — spinnervisning under initial fetch
- `pinModal` — `{ roomId }` när PIN-modal är öppen
- `pinInput`, `pinError`, `pinLoading` — formulärkontroller

**Livscykel**:
1. Mount: Fetch stats från `/api/stats`
2. Poll: `setInterval(fetchStats, 2000)` - uppdatera var 2:e sekund
3. Click rum: Öppna PIN-modal
4. PIN-modal: Verifiering via `/api/verify-pin`
5. Unmount: Rensa interval

### `App` component (rad 225–912)

Huvudkomponenten. Hanterar routing, Socket.io, and all UI för själva tavlan.

**Routing-logic**:
```javascript
// rad 564-518
const pathName = window.location.pathname;
if (pathName === '/stats') {
  return <StatsPage />;  // <-- Rendera denna istället
}
// annars, rendera tavl-UI...
```

Denna testa `pathname` direkt i render (inte bara `currentPage` state) för att undvika race-conditions.

**Sub-strukturer** (inte separata komponenter, bara JSX-sektioner):

1. **Header** (rad 571-636)
   - Logo, titel (redigerbar), user-count badge
   - Display-mode toggle (Normal/Dynamic)
   - Image-size quick-select (100%/50%/25%)
   - Clear-board, Share knappar

2. **Board/Main** (rad 644-792)
   - Responsiv grid: 1 col (mobil) → 2 col → 3 col
   - Message cards med edit/delete buttons
   - Inline-editering av text
   - File-rendering (bilder vs ikoner)
   - Download-knappar

3. **Footer/Compose** (rad 795-864)
   - Textarea för nytt inlägg
   - Hidden filpicker (paperclip label)
   - File-förhandsgranskning
   - Send-knapp
   - Upload-error banner
   - Nav-links (Stats, version)

4. **Modals**
   - Expand Message Modal (fulltext för långt meddelande)
   - Share Modal (QR, PIN, copy-link)
   - (PIN-modal finns i StatsPage, inte App)

### State-variabel-tabell (App component)

| Variabel | Typ | Initial | Syfte |
|----------|-----|---------|-------|
| `messages` | `[]` | `[]` | Meddelanden på tavlan |
| `newMessage` | `string` | `''` | Textarea-värde för nytt inlägg |
| `boardTitle` | `string` | `'Flyktig tavla'` | Tavlans title (i header, browser tab) |
| `isEditingTitle` | `boolean` | `false` | Är titeln i edit-mode? |
| `file` | `File | null` | `null` | Vald fil, pending send |
| `showShareModal` | `boolean` | `false` | Är Share-modal synlig? |
| `copied` | `boolean` | `false` | "Kopierat!"-indikatör (auto-reset 2s) |
| `userCount` | `number` | `0` | Live användar-räkning |
| `roomId` | `string | null` | `null` | Rum-ID från URL hash |
| `editingId` | `number | null` | `null` | Meddelande-ID under edit, eller null |
| `editText` | `string` | `''` | Textarea-värde för edit |
| `showVersion` | `boolean` | `false` | Visa version-nummer? (unused rendering) |
| `imageSize` | `'full' | 'half' | 'small'` | `'full'` | Bildskalering |
| `displayMode` | `'normal' | 'dynamic'` | `'normal'` | Text-clamp vs scroll |
| `expandedMessageId` | `number | null` | `null` | Vilken msg är i expand-modal? |
| `currentPage` | `'board' | 'stats'` | `'board'` | Client-side route |
| `boardPin` | `string` | `''` | PIN från room-state |
| `pinModal` | `{ roomId } | null` | `null` | PIN-modal state (App-version) |
| `pinInput` | `string` | `''` | PIN-input-värde |
| `pinError` | `string` | `''` | PIN-fel-meddelande |
| `pinLoading` | `boolean` | `false` | PIN-verifikation i gång? |
| `uploadError` | `string` | `''` | Filöverförings-fel-meddelande |

### Refs

| Ref | Typ | Syfte |
|-----|-----|-------|
| `socketRef` | Socket.io socket | Hålls genom lifetime för emit/on |
| `messagesEndRef` | DOM ref | `scrollIntoView` när nytt meddelande |
| `titleInputRef` | DOM ref | Focus + select när editar titel |

---

## Säkerhet & Validering

### Vad som valideras

| Vad | Där | Hur |
|-----|-----|-----|
| **Filstorlek (original)** | Klient | `file.size > 10 MB` → avbryt, visa error |
| **Filstorlek (base64)** | Klient | `Blob.size > 15 MB` → avbryt, visa error |
| **Filstorlek (base64, server)** | Server | `Buffer.byteLength > 15 MB` → emit upload-error, inte spara |
| **PIN-längd** | Klient | `.slice(0, 4)` → max 4 siffror |
| **PIN-värde** | Server | `room.pin === pinInput` → returnera success/failure |
| **Room-existens** | Server | `rooms.has(roomId)` för `/api/verify-pin` |
| **XSS** | Klient | React JSX escapes HTML automatiskt |

### Vad som INTE valideras

| Vad | Risk | Mitigering |
|-----|------|-----------|
| **Användar-autentisering** | Vem som helst kan ansluta till ett rum-ID | Låg risk för privat användning. Direktlänken är "hemlig" - dela diskret. |
| **Rate limiting** | DoS-attack: spam 1000 meddelanden/sec | Inte implementerat. Lämpligt för workshop/klassrum, inte offentlig server. |
| **Filtyp-validering** | Malware upload | Alla filtyper accepteras. Lämpligt för betrodd grupp. |
| **CORS-header** | `origin: "*"` — vilken domän som helst kan göra requests | Utvecklarvänligt. I produktion, sätt `origin: "https://mydomain.com"` |
| **Ingen audit-log** | Vem gjorde vad spåras inte | Lämpligt för kortlivade tavlor. Lägg till vid behov. |

### Designöversikt: Temporär = Säker

Huvudfilosofin: **Data försvinner när rummet tömms.** Det finns ingen långsiktig lagringstjänst, inget datalager som måste förvalskas, inget GDPR-problem. Perfekt för:
- Klassrumsföreläsningar (live anteckningar, tas bort när lektionen slutar)
- Workshop (samarbets-whiteboard under dagen, raderas på kvällen)
- Möte (snabbt noter-deling, inget att rensa upp senare)

Inte lämpligt för:
- Producerade data som behöver sparas
- Känslig information (hem-hem addresser, lösenord, osv.)
- Multi-användar-audits

---

## Optimeringar & Design-beslut

### Optimistisk uppdatering (edit-message)

```javascript
// index.html, rad 494-502
const saveEdit = (id) => {
  // Uppdatera lokalt OMEDELBAR
  setMessages(prev => prev.map(m => m.id === id ? { ...m, text: editText } : m));
  setEditingId(null);
  // Skicka till server
  if (socketRef.current) {
    socketRef.current.emit('edit-message', { id, text: editText });
  }
};
```

UI uppdateras innan servern svarar. Om nätverket är långsamt märks det inte. Server-broadcast säkerställer att alla får samma version.

### Image-size toggle

```javascript
// index.html, rad 271-275
const toggleImageSize = () => {
  if (imageSize === 'full') setImageSize('half');
  else if (imageSize === 'half') setImageSize('small');
  else setImageSize('full');  // <-- wrap-around
};
```

Cyklar genom: `full → half → small → full`. Använder CSS `width` för att skala proportionellt (`height: auto`).

### Current page routing

```javascript
// index.html, rad 564
const pathName = window.location.pathname;
console.log('Rendering - currentPage:', currentPage, 'pathname:', pathName);
if (pathName === '/stats') {
  return <StatsPage />;
}
```

Testa `pathname` direkt i render, inte bara `currentPage`-state, för att undvika race-conditions mellan `popstate` event och initial render.

### Socket disconnect vid stats

```javascript
// index.html, rad 307-313
if (currentPage === 'stats') {
  if (socketRef.current) {
    socketRef.current.disconnect();
    socketRef.current = null;
  }
  return;
}
```

Koppla bort från Socket.io när du går till stats-sidan. Om användar återgår till ett rum, reconnect och rejoin automatiskt.

---

## Lokal utveckling & felsökning

### Testa flera användare
```bash
# Terminal 1
npm start

# Terminal 2-N
open http://localhost:3005/#myroom
open http://localhost:3005/#myroom
```

Öppna samma URL i flera fönster/tabs för att simulera flera användare. Meddelanden synkas i realtid.

### Console-loggning

Koden har strategisk `console.log`:
```
Server: "Socket received: new-message"
Client: "Sending file: photo.png Size: 5.2 MB IsImage: true"
Client: "Base64 Blob size: 6,900,000 bytes ≈ 6.58 MB"
```

Använd Developer Tools (F12) för att felsöka Socket.io-kommunikation.

### Stress-test filöverföring

```javascript
// I browser console:
// Testa boundary: skapa en 9.9 MB fil och gör en POST till /api/stats
// för att se hur socketen hanterar stora payloads.
```

---

## Framtida utökningsmöjligheter

| Feature | Komplexitet | Notering |
|---------|-------------|---------|
| Persistent storage (Redis, PostgreSQL) | Medel | Lägg till `saveToDisk()` in cleanup-timer. Låt rooms överleva server-restart. |
| Autentisering (Google OAuth, JWT) | Medel-Högt | Lägg till `userId` i socket, koppla meddelanden till användare. |
| Rate limiting | Låg | Lägg till `counter` per `socketId`. Droppa events från spammers. |
| Typing indicators | Låg | Ny socket event: `typing`, `stopTyping`. Visa "X skriver..." |
| Rich text / Markdown | Låg | Byte textarea för en editor (Quill, Slate), rendera markdown. |
| Permissions (read-only tavlor, osv.) | Medel | Lägg till `permission` i room object. Validera innan `delete-message`. |
| Admin dashboard | Högt | Separat `/admin` route med alla rum, force-delete, statistics. |
| Video/audio call | Högt | Integrera med WebRTC (Jitsi, daily.co). Använd Socket.io för signaling. |

---

## Kontakt & Feedback

Se README.md för information om licensen och skapandet.

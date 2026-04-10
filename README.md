# Flyktig tavla

En realtids-samarbetstavla för att snabbt dela anteckningar och filer med andra.

## Version 1.1.0

### ✨ Features (v1.1)
- **Redigera anteckningar** – Klicka på texten eller använd redigera-knappen för att uppdatera befintliga inlägg
- **Optimistisk uppdatering** – Ändringar uppdateras omedelbar lokalt, även med nätverksfördröjning
- **QR-kod delning** – Dela tavlan via QR-kod direkt från share-modal
- **Filöverföring** – Ladda upp och dela filer upp till 10 MB med andra användare
- **Mobil-optimering** – Fullständig responsiv design för smartphones och tablets
  - Edit/Delete-knappar alltid synliga på touch-enheter
  - Kompakt layout för små skärmar
  - Share-modal fungerar korrekt på mobil

### ✨ Features (v1.0)
- **Realtids-samarbete** – Flera användare kan ansluta till samma tavla via URL-hash
- **Skapa och ta bort anteckningar** – Enkelt gränssnitt för att lägga till eller ta bort inlägg
- **Användarräkning** – Se hur många som är aktiva på tavlan
- **Tavlorensning** – Automatisk borttagning av tomma tavlor efter 30 sekunder
- **Redigerbar titel** – Ändra tavlans namn genom att klicka på rubriken
- **Rensa tavlan** – Radera alla inlägg på en gång
- **WebSocket-anslutning** – Socket.io för snabb synkronisering mellan klienter

## Installation

```bash
npm install
npm start
```

Öppna webbläsaren på `http://localhost:3005`

## Teknologi

- **Backend:** Node.js, Express.js, Socket.io
- **Frontend:** React (CDN), Tailwind CSS, Lucide Icons
- **Realtid:** Socket.io för WebSocket-kommunikation
- **Lagring:** In-memory (session-baserad)

## Användning

1. Öppna appen
2. Dela länken eller QR-koden med andra
3. Skriv anteckningar – de uppdateras realtid för alla användare
4. Ladda upp filer via paperclip-ikonen
5. Redigera inlägg genom att klicka på texten eller redigera-knappen
6. Ta bort inlägg med krysset eller rensa hela tavlan

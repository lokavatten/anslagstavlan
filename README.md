# Flyktig Tavla

En realtids-samarbetstavla för att snabbt dela anteckningar och filer med andra, helt utan lagring eller datainsamling.

> **Design-filosofi**: Varje tavla är temporär och raderas när alla användare lämnar. Ingen data sparas, ingen databas, ingen integritetsproblematik.

## Version 1.1.0

### ✨ Features (v1.1)
- **Redigera anteckningar** – Klicka på texten eller använd redigera-knappen för att uppdatera befintliga inlägg
- **Optimistisk uppdatering** – Ändringar uppdateras omedelbar lokalt, även med nätverksfördröjning
- **QR-kod delning** – Dela tavlan via QR-kod direkt från share-modal
- **Filöverföring** – Ladda upp och dela filer upp till 10 MB med andra användare
- **Robust felhantering** – Tvåskiktad filvalidering (klient + server) med användarvänd feedback för för stora filer
- **PIN-skydd** – Varje tavla får en autogenererad 4-siffrig PIN som visas för tavlans medlemmar; krävs vid åtkomst från statistik-sidan
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

### Miljövariabler

| Variabel | Default | Beskrivning |
|----------|---------|-------------|
| `PORT` | `3005` | Porten servern lyssnar på |

Exempel: `PORT=8080 npm start`

## Teknologi

| Lager | Teknologi | Val & Motivering |
|---|---|---|
| **Backend** | Node.js, Express.js, Socket.io | Minimalt, inget SQL/databas — allt i serverminnet. Socket.io för bidirektionell realtidskommunikation. |
| **Frontend** | React (CDN), Babel Standalone | React för komponentbaserad UI utan build-steg. CDN-laddning möjliggör ingen deploy-pipeline. |
| **Styling** | Tailwind CSS (CDN) | Snabb UI-utveckling utan CSS-filer. CDN för enkelhet. |
| **Ikoner** | Lucide Icons (CDN) | Moderna, söka-vänliga SVG-ikoner, laden globalt. |
| **Lagring** | In-memory `Map()` | Temporär design: data raderas när rummet tömms. Ingen persistering = ingen säkerhetshöjning krävs. |

## Användning

### För slutanvändaren

1. Öppna appen
2. Dela länken eller QR-koden från "Dela"-knappen med andra
3. Skriv anteckningar – de uppdateras realtid för alla användare
4. Ladda upp filer via paperclip-ikonen
5. Redigera inlägg genom att klicka på texten eller redigera-knappen
6. Ta bort inlägg med krysset eller rensa hela tavlan med sopkan

### För utvecklare

- **Arkitektur-detaljer**: Se [`ARCHITECTURE.md`](./ARCHITECTURE.md) för systemöversikt, Socket.io event-referens, data-flöden och säkerhet
- **Lokal testning**: Öppna flera instanser av `http://localhost:3005` (eller `http://localhost:3005/#roomid`) för att simulera flera användare
- **Stats-sidan**: Gå till `/stats` för en lista över alla aktiva tavlor och användarräkningar

## Arkitektur – Snabbkurs

Projektet är två HTML/JavaScript-filer:

- **`server.js`** (213 rader): Node.js-server med Express och Socket.io. Hanterar rumlagring (in-memory `Map`), Socket.io-events, och två REST-endpoints (`/api/stats`, `/api/verify-pin`).
- **`index.html`** (863 rader): En enda React-SPA som laddar allt (React, Babel, Tailwind, Lucide, Socket.io client) via CDN. Två komponenter: `StatsPage` (lista över rum) och `App` (själva tavlan).

**Data-flöde**: Klient emitterar Socket.io-events → Server sparar/spredar → Klient mottar och uppdaterar UI. Inga databaskall, inga Rest-endpoints förutom stats-checkin.

**Filöverföring**: Klienten läser filen som base64 och skickar via Socket.io. Server lagrar raw base64, klienten renderar `<img src="data:...">` direkt.

För djupgående beskrivning, se [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## Kända begränsningar

| Begränsning | Orsak | Lösning |
|---|---|---|
| **Ingen autentisering** | Intentionellt. Enkel URL = enkel delning. | Dela länken diskret. PIN skyddar stats-åtkomst. |
| **Open CORS** (`origin: "*"`) | Utvecklarvänlig, enkel testning | Begränsa i produktion till ditt domän |
| **Inga rate limits** | Ingen spam-skydd | Kan accepteras för privat/invitaterad användning |
| **Filstorlek max 10 MB** | Socket.io-buffergräns (15 MB efter base64-encoding ~33%) | Öka `maxHttpBufferSize` i `server.js` vid behov |
| **Ingen filvalidering** | Alla filtyper accepteras | Inte ett problem för privat tavla; sätt upp proxy/filter i produktion |
| **PIN visas till alla på tavlan** | Designbeslut: användarvänd transparent | PIN är bara ett lightweight skydd, inte hemligt |
| **Ingen tillgänglighetslogg** | Ingen audit trail på vem som gjorde vad | Lämpligt för kortlivade, samtalsbaserade tavlor |

## Säkerhet

Se [`ARCHITECTURE.md`](./ARCHITECTURE.md) för fullständig säkerhets- och validerings-referens.

**Summa**: Projektet är utformat för **privat, invitaterad användning** — lämpligt för klassrum, möten, workshop. Inte lämpligt för publika eller känsliga data utan ytterligare skydd.

## Om detta projekt som case study för AI-verktyg

Flyktig Tavla byggdes iterativt med AI-assistans från konceptet "en temporär samarbetstavla" till en produktionsklar app med:

- ✅ Realtids-synkronisering mellan användare
- ✅ Filöverföring (med base64-encoding och buffergränshantering)
- ✅ Responsiv mobil-design
- ✅ Pin-baserad åtkomstkontroll
- ✅ Robust felhantering på två nivåer (klient + server)
- ✅ In-memory rumlivscykel med automatisk rensning

Koden och dokumentationen visar hur AI kan assistera med:
1. Arkitektoniska beslut (varför Socket.io istället för polling?)
2. Säkerhet (tvåskiktad filvalidering, buffergränsar)
3. UX-detaljer (optimistisk uppdatering, mobiloptimering)
4. Problemlösning (base64-overhead, PIN-flöde)

Se [`ARCHITECTURE.md`](./ARCHITECTURE.md) för en djupgående walkthrough av systemet.

---

**Licens**: Fri att använda, modifiera och distribuera.

**Skapad med**: Node.js, Express, Socket.io, React, Tailwind CSS, Lucide Icons — och AI-assistans.

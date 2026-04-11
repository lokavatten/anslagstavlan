# Flyktig Tavla – RAM-användning & Skalning

En analys av minnesanvändning per tavla, meddelande och användare.

---

## RAM per Komponent

### Room Object (tom tavla, utan meddelanden)

```javascript
{
  messages: [],           // ~100 bytes (tom array)
  userCount: 0,           // 8 bytes
  cleanupTimer: null,     // 8 bytes
  title: 'Flyktig tavla', // ~30 bytes
  pin: '1234'             // ~10 bytes
  // JavaScript object overhead: ~150 bytes
}
```

**Total per tom tavla: ~350 bytes**

---

### Meddelanden

#### Textmeddelande (utan fil)

| Komponent | Storlek | Noter |
|-----------|---------|-------|
| `id` (Number) | 8 bytes | Timestamp |
| `text` (String) | ~200 bytes | Genomsnittlig text |
| `timestamp` (String) | ~10 bytes | "14:32" |
| `file` (null) | 0 bytes | — |
| Object overhead | ~200 bytes | JS struktur |
| **Totalt** | **~420 bytes** | Per textmeddelande |

#### Filmeddelande (med fil)

| Komponent | Storlek | Noter |
|-----------|---------|-------|
| Textmeddelande-overhead | ~420 bytes | Se ovan |
| `file.name` (String) | ~50 bytes | Filnamn |
| `file.type` (String) | ~30 bytes | "image/png" osv |
| `file.size` (String) | ~20 bytes | "5250.5 KB" |
| `file.data` (Base64 String) | **original × 1.33** | **DETTA ÄR STORT** |
| `file.isImage` (boolean) | 1 byte | — |
| File object overhead | ~100 bytes | — |
| **Totalt** | **420 bytes + base64-storlek** | Per filmeddelande |

---

## Exempel: RAM-användning per Fil

| Original Filstorlek | Base64 Storlek | Med Meddelande Overhead |
|---|---|---|
| 1 MB | 1.33 MB | **1.33 MB** |
| 5 MB | 6.65 MB | **6.65 MB** |
| 10 MB | 13.3 MB | **13.3 MB** |

**OBS**: Socket.io buffer limit är 15 MB, så max ~11 MB original file.

---

## Scenarier: RAM-användning per Tavla

### Scenario A: Bara Textmeddelanden

| Tavlor | Meddelanden/tavla | Total Meddelanden | RAM-användning |
|---|---|---|---|
| 1 | 10 | 10 | ~4.5 KB |
| 1 | 100 | 100 | ~42 KB |
| 1 | 1000 | 1000 | ~420 KB |
| 10 | 100 | 1000 | ~424 KB |
| 100 | 100 | 10000 | ~4.24 MB |
| 1000 | 100 | 100000 | ~42.4 MB |

**Formel**: `(tavlor × 350 bytes) + (meddelanden × 420 bytes)`

### Scenario B: Med Filer (Genomsnittlig 5 MB fil per tavla)

| Tavlor | Filer/tavla | Total Filer | Total Filstorlek | RAM-användning |
|---|---|---|---|---|
| 1 | 1 | 1 | 5 MB | **~6.65 MB** |
| 1 | 5 | 5 | 25 MB | **~33.25 MB** |
| 5 | 1 | 5 | 25 MB | **~33.27 MB** |
| 5 | 5 | 25 | 125 MB | **~166.3 MB** |
| 10 | 10 | 100 | 500 MB | **~665 MB** |
| 50 | 10 | 500 | 2.5 GB | **~3.33 GB** |

**Formel**: `(tavlor × 350 bytes) + (filer × original-storlek × 1.33)`

### Scenario C: Realistisk Blandning

**Antaganden**:
- Genomsnitt 50 textmeddelanden per tavla
- Genomsnitt 3 filer per tavla (2 MB vardera)
- Max 1000 aktiva tavlor

| Tavlor | Textmeddelanden | Filer | RAM-användning |
|---|---|---|---|
| 10 | 500 | 30 | ~80 MB |
| 50 | 2500 | 150 | ~400 MB |
| 100 | 5000 | 300 | ~800 MB |
| 500 | 25000 | 1500 | **~4 GB** |
| 1000 | 50000 | 3000 | **~8 GB** |

---

## Socket.io/Node.js Overhead

### Per Socket (ansluten användare)

| Komponent | Storlek |
|-----------|---------|
| Socket.io internal structures | ~20-50 KB |
| Event listeners | ~5 KB |
| **Total per användare** | **~30-60 KB** |

**Exempel**: 100 samtidigt anslutna användare = 3-6 MB Socket.io overhead

---

## Praktiska Rekommendationer

### ✅ Säker att köra

| Setup | RAM-krav | Status |
|-------|----------|--------|
| Klassrum (30 användare, 1 tavla, 100 meddelanden) | ~50 MB | ✅ Lätt |
| Workshop dag (10 tavlor, 50 meddelanden vardera, 50 användare) | ~250 MB | ✅ Lätt |
| Multi-workshop (50 tavlor, 100 meddelanden vardera) | ~1.2 GB | ✅ Acceptabelt |

### ⚠️ Observera

| Setup | RAM-krav | Status |
|-------|----------|--------|
| Högaktiv server (200 tavlor med filer) | ~2-4 GB | ⚠️ Övervakning rekommenderas |
| Många stora filer (500 tavlor, 5 filer à 10 MB) | ~7-10 GB | ⚠️ Kräver dedikerad server |

### ❌ Inte lämpligt

| Setup | RAM-krav | Status |
|---|---|---|
| Production SaaS (10 000+ tavlor) | >50 GB | ❌ Behöver databas + Redis |
| Persistent lagring (samme tavla dag efter dag) | N/A | ❌ Behöver PostgreSQL |

---

## Optimeringar (om RAM blir problem)

| Optimering | Effekt | Komplexitet |
|---|---|---|
| Öka cleanup-timeout från 30s → 5s | -10-20% RAM | Låg (1-rad ändring) |
| Begränsa meddelanden per tavla (t.ex max 100) | -50% RAM | Medel (logik i handler) |
| Komprimera base64 eller lagra checksums | -20% RAM | Högt (kryptering) |
| Flytta filer till externa tjänst (S3, etc.) | -80% RAM för filer | Högt (ny arkitektur) |
| Implementera Redis cache | Flexibel skalning | Högt (new infrastructure) |

---

## Sammanfattning

| Metrik | Värde |
|---|---|
| **Per tom tavla** | ~350 bytes |
| **Per textmeddelande** | ~420 bytes |
| **Per användar-session** | ~30-60 KB |
| **Praktisk gräns (1 server)** | ~4-5 GB = ~1000 aktiva tavlor |
| **Rekommenderad gräns** | ~2 GB = ~500 aktiva tavlor |

**Slutsats**: Perfekt för klassrum, workshops, möten. **Inte** för persistent SaaS eller massiva simultana användare. För större skala: lägg till databas (PostgreSQL), cache (Redis), och fillagring (S3).

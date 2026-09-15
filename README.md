# 🚀 OVH / Kimsufi / SoYouStart Telegram Verfügbarkeits-Notifier

Ein Telegram-Bot in **TypeScript** auf der **Bun**-Runtime, der Nutzer in Echtzeit benachrichtigt, sobald ausgewählte Dedicated Server von **Kimsufi**, **So You Start** oder **OVH** in bestimmten Ländern wieder lieferbar sind.

Da begehrte Dedicated Server oft innerhalb von Sekunden vergriffen sind, pollt ein leichtgewichtiger Background-Job alle **10 Sekunden** die offizielle OVH-Verfügbarkeits-API und benachrichtigt registrierte Nutzer sofort mit Direktlink zum Shop.

---

## 🛠 Tech-Stack

- **Runtime:** [Bun](https://bun.com) (kein Node.js, native TS-Ausführung)
- **Telegram Bot Framework:** [grammY](https://grammy.dev) (Inline-Keyboards, State Machine, Long-Polling)
- **Datenbank & ORM:** PostgreSQL mit [Drizzle ORM](https://orm.drizzle.team) und dem `postgres` (postgres-js) Treiber
- **Migrationen:** `drizzle-kit` (automatisches Anwenden beim App-Start)
- **HTTP-Client:** Natives Bun `fetch` (OVH Public REST APIs, keine API-Keys für Read-Zugriff nötig)

---

## 📦 Schnellstart (Lokale Entwicklung)

### 1. Abhängigkeiten installieren

```bash
bun install
```

### 2. Umgebungsvariablen einrichten

Kopiere die `.env`-Vorlage oder passe sie an:

```env
# Dein Telegram Bot Token von @BotFather
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz

# PostgreSQL Verbindungs-URL (entspricht der compose.yaml)
DATABASE_URL=postgresql://dev:dev@localhost:5432/ovh_notifier

# OVH Tochtergesellschaft für Preise/Währung (Standard: DE)
OVH_SUBSIDIARY=DE

# Erlaubte Telegram Chat-IDs (optional, kommagetrennt für Private Bot Mode)
ALLOWED_CHAT_IDS=529504314
```

### 3. Entwicklungs-Datenbank starten

Starte die PostgreSQL-Datenbank via Docker:

```bash
docker compose up -d
```

### 4. Datenbank-Migrationen ausführen

```bash
bun run db:generate
bun run db:migrate
```

_(Hinweis: Der Bot wendet ausstehende Migrationen aus `./drizzle` auch beim Start automatisch an)._

### 5. Bot starten

```bash
# Im Entwicklungsmodus (mit Hot-Reload)
bun run dev

# Oder im Standard-Modus
bun run start
```

---

## 📱 Bot Conversation-Flow

1. **`/start`:**
   - Begrüßung und Anlegen/Upsert des Telegram-Nutzers in der Datenbank.
   - Buttons: `➕ Neue Notification` und `📋 Meine Notifications anzeigen`.

2. **Schritt 1 (Länder-Auswahl):**
   - Dynamisch aus den aktiven Datacentern der OVH-API ermittelt (z. B. 🇩🇪 DE, 🇫🇷 FR, 🇨🇦 CA, 🇵🇱 PL, 🇬🇧 GB, 🇦🇺 AU, 🇸🇬 SG).
   - Multi-Select über Inline-Keyboard (`✅`-Markierung), Update per `ctx.editMessageText(...)`.

3. **Schritt 2 (Marken/Kategorien):**
   - Auswahl zwischen **Kimsufi**, **So You Start** und **OVH**.
   - Beliebig kombinierbar mit Zurück- und Weiter-Navigation.

4. **Schritt 3 (Server-Auswahl):**
   - Listet passende Server zweizeilig mit CPU, RAM, Speicher und monatlichem Preis auf:

     ```
     [1] KS-5 | Intel Xeon E3-1270v6
         32 GB DDR4 ECC 2400 MHz | 2x 2TB HDD | 18,48 €

     [2] KS-6 | AMD Epyc 7351P
         128 GB DDR4 ECC | 2x 4TB HDD | 39,49 €
     ```

   - Kompakte Nummerntastatur (5 Ziffern pro Zeile) mit Checkmark-Feedback.

5. **Schritt 4 (Zusammenfassung & Bestätigung):**
   - Zeigt die gewählten Länder, Kategorien und Servermodelle.
   - Bei Klick auf `✅ Bestätigen` wird für jede (Land × Server)-Kombination eine Zeile in die PostgreSQL-Tabelle `subscriptions` eingefügt.

6. **Meine Notifications verwalten:**
   - Zeigt alle aktiven Alarme des Nutzers.
   - Jeder Eintrag kann per Klick auf `🗑️ Löschen` sofort entfernt werden.

---

## ⚡ Background-Job (10-Sekunden-Takt)

1. Lädt alle aktiven Subscriptions aus der Datenbank (`notifications_enabled = true`).
2. Fragt die OVH-Verfügbarkeits-API ab (`Promise.allSettled`, bricht bei Netzwerkproblemen nicht ab).
3. Gleicht jede Subscription mit den Datacentern des gewählten Landes ab (`availability !== "unavailable"`).
4. **Bei Verfügbarkeit:**
   - Sendet eine Telegram-Nachricht mit Modellname, Land, Specs, Preis und Direktlink zum Bestellprozess.
   - Löscht die Subscription sofort aus der Datenbank (Einmalige Benachrichtigung, kein Spam).

---

## 🐳 Docker (Produktionsbetrieb)

Das Multi-Stage-Build `Dockerfile` basiert auf dem offiziellen `oven/bun:1`-Image:

```bash
# Docker Image bauen
docker build -t telegram-ovh-bot .

# Container starten (mit externer PostgreSQL-DB)
docker run -d \
  --name ovh-notifier \
  -e TELEGRAM_BOT_TOKEN="dein-token" \
  -e DATABASE_URL="postgresql://user:pass@db-host:5432/ovh_notifier" \
  --restart unless-stopped \
  telegram-ovh-bot
```

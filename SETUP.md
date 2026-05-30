# Setup Guide

Full reference for configuring your self-hosted Dental Voice Receptionist.

---

## 1. Infrastructure `.env`

Copy `server/.env.example` to `server/.env` and set:

| Variable | Required | Description |
|---|---|---|
| `SIMULATION_MODE` | Yes | `true` = no real calls (dev/test); `false` = live |
| `BASE_URL` | Production | Public HTTPS URL of your server (ngrok/cloudflared tunnel) |
| `CORS_ORIGIN` | Optional | Frontend URL (default `http://localhost:3000`) |
| `DATABASE_URL` | Docker auto-set | Postgres connection string |
| `ENCRYPTION_KEY` | Auto-generated | 64-char hex key — auto-created on first boot |
| `JWT_SECRET` | Auto-generated | Random string — auto-created on first boot |
| `LOG_LEVEL` | Optional | `debug` / `info` / `warn` / `error` |
| `SENTRY_DSN` | Optional | Sentry error tracking DSN |

> `ENCRYPTION_KEY` and `JWT_SECRET` are written to a Docker volume on first boot. You can find them at `docker exec dental-voice-receptionist-server-1 cat /app/data/secrets.env`.

---

## 2. Provider API keys (dashboard-managed)

All provider keys are entered in the clinic dashboard at **Settings → API Keys**. They are AES-256-GCM encrypted before storage and never returned to the browser.

### Anthropic (Claude LLM)
1. Sign up at https://console.anthropic.com/
2. Create an API key.
3. Paste it in Settings → API Keys → Anthropic API Key.

### Deepgram (Speech-to-Text)
1. Sign up at https://console.deepgram.com/
2. Create a project and generate an API key.
3. Paste it in Settings → API Keys → Deepgram API Key.

### Inworld (Text-to-Speech)
1. Sign up at https://studio.inworld.ai/
2. Generate an API key from your workspace settings.
3. Set Voice ID (e.g., `Ashley`) and Model ID (e.g., `inworld-tts-1.5-max`).

### Telnyx (Telephony + SMS)
1. Sign up at https://portal.telnyx.com/
2. Create a Voice API application (TeXML), note the **Connection ID**.
3. Under the connection, set the webhook URL to `BASE_URL/webhook/voice`.
4. Purchase a phone number and assign it to the connection.
5. In Settings → API Keys, enter: API Key, Connection ID, From Number, Webhook Secret.

### SendGrid (Email)
1. Sign up at https://app.sendgrid.com/
2. Create a Sender Identity (verify your domain or email).
3. Generate an API key with Mail Send permissions.
4. Paste it in Settings → API Keys → SendGrid API Key.

Alternatively, use Gmail with an App Password (Google Account → Security → App Passwords).

---

## 3. Google Calendar OAuth

1. Go to https://console.cloud.google.com/ → Create a project.
2. Enable the **Google Calendar API**.
3. Create OAuth 2.0 credentials (Web Application type).
4. Add `BASE_URL/api/calendar/oauth/callback` as an authorised redirect URI.
5. Enter Client ID and Client Secret in Settings → API Keys → Google Calendar OAuth.
6. Visit Settings and click **Connect Google Calendar** to complete the OAuth flow.

---

## 4. Adding users

```bash
docker exec -it dental-voice-receptionist-server-1 npx tsx cli/create-user.ts
```

Follow the prompts to create clinic admin or staff accounts.

---

## 5. Customising the AI receptionist

Configure your clinic in the dashboard — **Settings**:
- Clinic name, address, phone number
- Hours of operation
- Providers and their schedules
- Services offered
- Insurance plans accepted
- Emergency escalation number
- AI greeting and system-prompt overrides

The voice AI builds its instructions from these settings on every call. Compliance rules (no diagnosis, no treatment advice, emergency escalation) are enforced in code.

---

## 6. Changing the seeded demo password

The seeded admin password is `admin123`. Change it immediately:

Settings → Account → Change Password (in the dashboard), or:

```bash
docker exec -it dental-voice-receptionist-server-1 npx tsx cli/create-user.ts
```

---

## 7. Tunnel for webhooks

Telnyx delivers call events via HTTP webhook. Your server must be publicly reachable.

**ngrok (easiest):**
```bash
ngrok http 3001
# Copy the https://.... URL to BASE_URL in .env and to Telnyx webhook settings
```

**cloudflared (persistent, free):**
```bash
cloudflared tunnel login
cloudflared tunnel create dental-voice
cloudflared tunnel route dns dental-voice your-subdomain.yourdomain.com
cloudflared tunnel run dental-voice
```

---

## 8. Production checklist

- [ ] `SIMULATION_MODE=false` in `.env`
- [ ] `BASE_URL` set to your public tunnel/domain
- [ ] All provider keys entered in dashboard and showing "Connected"
- [ ] Google Calendar connected
- [ ] Telnyx webhook URL updated to `BASE_URL/webhook/voice`
- [ ] Clinic configured in the dashboard (name, hours, providers, services, escalation number)
- [ ] Seeded passwords changed
- [ ] Test call placed successfully

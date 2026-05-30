# Dental Voice Receptionist

An open-source, self-hosted AI phone receptionist for dental clinics. It answers real phone calls 24/7, books appointments into Google Calendar, sends SMS/email confirmations, and escalates emergencies — all running on **your own** computer with **your own** API keys.

> You host it, you own the data, and you bring your own provider keys. There is no central server and no per-seat fee.

---

## What it does

- 📞 Answers inbound calls with a natural AI voice
- 📅 Books, reschedules, and cancels appointments in Google Calendar
- 🚨 Detects dental emergencies and transfers to your on-call team
- 💬 Sends SMS/email confirmations and reminders
- 📊 Logs every call with transcripts and analytics in a web dashboard

## How it works

```
Caller → Telnyx (phone) → your server → Deepgram (speech-to-text)
       → Claude (the brain) → Inworld (voice) → back to the caller
       ↳ books Google Calendar + sends SMS/email
```

Everything runs in Docker on a machine you control. The machine just needs to be reachable from the internet (via a free tunnel) so the phone network can deliver calls.

## What you need

- A computer or small VPS that stays on (it's a phone line — if it's off, calls aren't answered)
- **Docker Desktop**
- Your own API keys: **Anthropic**, **Deepgram**, **Inworld**, **Telnyx** (and optionally **SendGrid** + **Google Cloud**)
- A tunnel (**ngrok** or **cloudflared**) so Telnyx can reach your server

## What it costs

The software is **free**. You pay the providers directly for what you use — roughly **250 calls ≈ $30** in usage, plus a Telnyx phone number (~$1–2/month). No fees to the maintainers.

---

## Quickstart — one command

```bash
git clone https://github.com/sajidkhan001/dental-voice-receptionist
cd dental-voice-receptionist
docker compose up
```

On first boot it generates its own security keys, sets up the database, and seeds a demo clinic. Open **http://localhost:3000** and log in:

| Role | Email | Password |
|------|-------|----------|
| Superadmin | `admin@test.com` | `admin123` |
| Clinic admin | `clinic@test.com` | `clinic123` |

> **Change these passwords immediately.**

## Set it up (about 15 minutes)

1. **Add your API keys** in the dashboard — **Settings → API Keys** (encrypted at rest, never stored in plain text or in `.env`).
2. **Start a tunnel** so Telnyx can reach you: `ngrok http 3001`, then set that HTTPS URL as `BASE_URL`.
3. **Point Telnyx at your server** — set the connection webhook to `BASE_URL/webhook/voice` and paste your Connection ID into Settings.
4. **Connect Google Calendar** and configure your clinic (hours, providers, services) in the dashboard.
5. **Go live** — set `SIMULATION_MODE=false`, restart, and click **Go Live**. The app buys a Telnyx number and your receptionist starts answering calls.

Full step-by-step instructions are in **[SETUP.md](SETUP.md)**.

---

## HIPAA disclaimer

Provided as-is. Self-hosters are solely responsible for their own HIPAA compliance, data security, key rotation, and backups. This is **not** a certified HIPAA product.

## Prefer to have it set up for you?

Paid setup assistance is available for **$300** — we'll get you live end to end. Contact: **hello@dentalswarm.com**

## License

MIT — see [LICENSE](LICENSE).

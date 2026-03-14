# tastytrade Options Monitor

Real-time options market monitoring engine with a React dashboard, built on the official tastytrade JS SDK.

Tracks 38 symbols across two strategies:
- **AI Hidden Supply Chain** — 7 layers, 22 symbols covering chip packaging, optical interconnects, signal integrity, rack deployment, thermal/power, copper/rare earth, and nuclear/uranium
- **Midterm Macro Options** — 5 sectors: energy, defense, AI/semis, biotech, and macro hedges

When trigger conditions fire (IV spikes, price moves, IV rank thresholds, or scheduled times), the engine emits structured `OptionsAlert` JSON payloads through an event bus. Consumers include the web dashboard, JSONL log files, and optionally any CLI AI agent.

## Prerequisites

- Node.js 20+
- pnpm (`npm install -g pnpm`)
- A tastytrade account (sandbox works for development)

## Quick Start

```bash
cp .env.example .env
# Fill in TASTYTRADE_REFRESH_TOKEN (see below)

pnpm install
pnpm dev          # Starts monitor + React dashboard
```

Dashboard opens at http://localhost:3000. WebSocket data stream on ws://localhost:3001.

## Getting a Refresh Token

1. Go to https://my.tastytrade.com/app.html#/manage/api-access/oauth-applications
2. Create an OAuth application with scopes: `read`, `trade`, `openid`
3. Set callback URL to `http://localhost:8080/callback`
4. Navigate to your app → Manage → **Create Grant**
5. Copy the refresh token JWT (starts with `eyJ...`)
6. Paste it into `.env` as `TASTYTRADE_REFRESH_TOKEN`

For sandbox, register first at https://developer.tastytrade.com/sandbox/

## Output Modes

```bash
# Default — terminal logs + WebSocket broadcaster + React dashboard
pnpm monitor

# Pipe mode — structured output on stdout for piping to any AI agent
pnpm monitor:pipe

# File mode — writes each alert as a JSON file to packages/monitor/alerts/
pnpm monitor:file
```

### Piping to an AI Agent

The monitor in pipe mode emits `ALERT:{base64-json}` lines on stdout and logs to stderr:

```bash
# Pipe to Claude CLI
pnpm monitor:pipe | claude --system "You are an options desk trader..."

# Pipe to any agent
pnpm monitor:pipe | your-agent-cli
```

## Switching to Production

In `.env`:
```
TASTYTRADE_ENV=production
```

Then use production credentials (client ID/secret from your production OAuth app). Note: `/market-metrics` endpoint (IV rank data) only works in production.

## Adding Tickers

Edit `packages/monitor/src/watchlist.config.ts` — add entries with ticker, layer, strategies, and thesis.

## Project Structure

```
packages/
  shared/       — Zod schemas and TypeScript types (single source of truth)
  monitor/      — Engine: auth, streamer, triggers, alert bus, output modes
  dashboard/    — React SPA: watchlist table, alert feed, positions, agent export
```

## Architecture

```
tastytrade API (REST + DXLink WS)
        │
   Indicator Engine
   • Stream processor
   • Trigger detector
   • Market state
        │
   OptionsAlert (JSON)
        │
     AlertBus
   ┌────┼────────┐
   │    │        │
 Web  JSONL   CLI Pipe
 UI   Logger  (→ Agent)
```

The engine has zero dependency on any AI SDK. Separation of concerns is absolute — the monitor emits structured data, agents consume it externally.

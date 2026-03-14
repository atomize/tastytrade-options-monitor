# Rewrite: Options Indicator Engine in Node/TypeScript

You are building an options market indicator engine and web dashboard using **Node.js/TypeScript** and the **official tastytrade JavaScript SDK** (`@tastytrade/api`). This is a rewrite of a working Python prototype. This document contains everything you need — the verified API behavior, the correct auth flow, all streaming event types, the data architecture, and both strategy definitions.

---

## PROJECT OVERVIEW

Build a real-time options indicator engine that:

1. Connects to the tastytrade brokerage API via OAuth2
2. Streams live market data (Quote, Trade, Summary, Profile) via DXLink WebSocket
3. Monitors 38 symbols across two options strategies
4. Detects trigger conditions (IV spike, price move, IV rank threshold, scheduled, manual)
5. Emits structured `IndicatorAlert` JSON objects through an event bus
6. Displays data in **both** a terminal dashboard (for headless/server use) AND a **web dashboard** (primary UI)
7. Optionally forwards alerts to an AI agent (Claude) for analysis — the agent is a pluggable consumer, NOT tightly coupled

The key architectural principle: **the indicator engine produces structured alerts; consumers (web UI, terminal, AI agent, webhooks) are pluggable handlers on an event bus.**

---

## OFFICIAL SDK

### Install

```bash
npm i @tastytrade/api
```

**Package**: `@tastytrade/api` — https://github.com/tastytrade/tastytrade-api-js

**This is the ONLY official tastytrade SDK.** The Python SDK (`tastyware/tastytrade`) is community-maintained and unofficial. Using the official JS SDK means:
- Guaranteed compatibility with API changes
- Built-in DXLink quote streamer integration
- Automatic access token refresh
- Typed service methods for all API endpoints

### SDK Quick Reference

```typescript
import TastytradeClient from "@tastytrade/api"

// Production
const client = new TastytradeClient({
  ...TastytradeClient.ProdConfig,
  clientSecret: 'your-client-secret',
  refreshToken: 'your-refresh-token',
  oauthScopes: ['read', 'trade']
})

// Sandbox
const client = new TastytradeClient({
  ...TastytradeClient.SandboxConfig,
  clientSecret: 'your-client-secret',
  refreshToken: 'your-refresh-token',
  oauthScopes: ['read', 'trade', 'openid']
})
```

**Static configs in the SDK:**
```typescript
TastytradeClient.ProdConfig = {
  baseUrl: 'https://api.tastyworks.com',
  accountStreamerUrl: 'wss://streamer.tastyworks.com',
}
TastytradeClient.SandboxConfig = {
  baseUrl: 'https://api.cert.tastyworks.com',
  accountStreamerUrl: 'wss://streamer.cert.tastyworks.com',
}
```

---

## AUTHENTICATION — VERIFIED WORKING FLOW

### OAuth2 Token Endpoint

```
POST /oauth/token
Content-Type: application/json

{
  "grant_type": "refresh_token",
  "refresh_token": "<refresh_token_jwt>",
  "client_secret": "<client_secret>",
  "scope": "read trade openid"
}
```

**Response:**
```json
{
  "access_token": "...",
  "expires_in": 900
}
```

### Key Auth Facts (verified by testing)

- **Access tokens expire in 15 minutes (900s).** The SDK auto-refreshes before each request.
- **Refresh tokens NEVER expire.** Generate one once, use it forever.
- The `Authorization` header format is `Bearer <access_token>` — standard OAuth2 bearer.
- **User-Agent header is REQUIRED** on all requests. Format: `<product>/<version>`. The SDK sets `tastytrade-sdk-js` automatically.
- **`Accept-Version` header is NOT accepted in sandbox** — the SDK correctly skips it when `is_test=true`.

### How to Get a Refresh Token

1. Create an OAuth application at https://my.tastytrade.com/app.html#/manage/api-access/oauth-applications
2. Set scopes: `read`, `trade`, `openid`
3. Set callback URL: `http://localhost:8000`
4. Go to: OAuth Applications → Manage → **Create Grant**
5. Copy the refresh token JWT (starts with `eyJ...`)
6. Save it in `.env` as `TASTYTRADE_REFRESH_TOKEN`

For sandbox, register at https://developer.tastytrade.com/sandbox/ first.

### Sandbox Credentials for This Project

```
Client ID: d19b3650-b190-443d-9c59-90dd85a24ae9
Client Secret: 97d05319e7675f39279d34ce5b564a5cd636e613
Scopes: read, trade, openid
```

The refresh token will be stored in `.env` — the user has one already.

---

## STREAMING MARKET DATA — VERIFIED WORKING

This is the core of the engine. The DXLink WebSocket streamer provides real-time data for all symbols, even in sandbox (15-minute delayed).

### Available DXLink Event Types

The API quote token grants access to these event types:

| Event | Key Fields | Use For |
|-------|-----------|---------|
| **Quote** | bidPrice, askPrice, bidSize, askSize | Live bid/ask spread |
| **Trade** | price, size, dayVolume, dayTurnover | Last trade price, volume |
| **Summary** | prevDayClosePrice, dayOpenPrice, dayHighPrice, dayLowPrice, openInterest | OHLC, day change %, OI |
| **Profile** | description, high52WeekPrice, low52WeekPrice, beta, tradingStatus, earningsPerShare | Company metadata, 52wk range |
| **Greeks** | volatility, delta, gamma, theta, rho, vega | Per-option-contract IV and greeks |
| **TimeAndSale** | price, size, time | Tick-level trade data |
| **Candle** | open, high, low, close, volume | Historical OHLC bars (1m to 1d) |

### What We Subscribe To (and why)

For all 38 underlying equity symbols, subscribe to:
- **Quote** — live bid/ask for spread display
- **Trade** — last trade price and volume
- **Summary** — prevDayClosePrice is essential for computing accurate day change %. Also gives OHLC and open interest.
- **Profile** — 52-week high/low, beta, description, trading status. This data arrives once on connect then updates rarely.

For option-specific analysis (future enhancement):
- **Greeks** — subscribe to specific option symbols (e.g., `NVDA 260620C210`) to get IV, delta, gamma, theta per contract.

### DXLink Protocol Flow (for reference)

```
1. SETUP        →  {"type":"SETUP","channel":0,"version":"0.1-DXF-JS/0.3.0",...}
2. AUTH         →  {"type":"AUTH","channel":0,"token":"<api-quote-token>"}
3. CHANNEL_REQ  →  {"type":"CHANNEL_REQUEST","channel":3,"service":"FEED",...}
4. FEED_SETUP   →  {"type":"FEED_SETUP","channel":3,"acceptDataFormat":"COMPACT",...}
5. FEED_SUB     →  {"type":"FEED_SUBSCRIPTION","channel":3,"add":[{"type":"Quote","symbol":"AAPL"},...]]}
6. KEEPALIVE    →  {"type":"KEEPALIVE","channel":0}  (every 30s to maintain connection)
```

The SDK's `quoteStreamer` handles all of this. Usage from the README:

```typescript
client.quoteStreamer.addEventListener((events) => {
  console.log('Received market data:', events)
})
await client.quoteStreamer.connect()
client.quoteStreamer.subscribe(['AAPL', 'TSLA'])
```

### Candle Events for Historical Data

Subscribe to candles with a formatted symbol and `fromTime`:
```typescript
// 5-minute candles for past 24 hours
dxLinkFeed.addSubscriptions({
  type: 'Candle',
  symbol: 'AAPL{=5m}',
  fromTime: Date.now() - 86400000
})
```

Recommended intervals:
| Lookback | Interval | Symbol Format |
|----------|----------|---------------|
| 1 day | 1 min | `AAPL{=1m}` |
| 1 week | 5 min | `AAPL{=5m}` |
| 1 month | 30 min | `AAPL{=30m}` |
| 3 months | 1 hour | `AAPL{=1h}` |
| 1 year+ | 1 day | `AAPL{=1d}` |

---

## REST API ENDPOINTS

**Base URLs:**
- Sandbox: `https://api.cert.tastyworks.com`
- Production: `https://api.tastyworks.com`

### Endpoints We Use

| Endpoint | Method | Purpose | Sandbox? |
|----------|--------|---------|----------|
| `/oauth/token` | POST | Get/refresh access token | Yes |
| `/api-quote-tokens` | GET | Get DXLink streamer token (24hr) | Yes |
| `/customers/me/accounts` | GET | List accounts | Yes |
| `/accounts/{id}/balances` | GET | Net liq, buying power | Yes |
| `/accounts/{id}/positions` | GET | Open positions | Yes |
| `/option-chains/{symbol}/nested` | GET | Full option chain with streamer symbols | Yes |
| `/instruments/equities/{symbol}` | GET | Equity instrument details + streamer-symbol | Yes |
| `/market-metrics?symbols=X,Y,Z` | GET | IV rank, IV percentile, beta, liquidity, earnings | **NO — production only, 404 in sandbox** |

**Important:** The `/market-metrics` REST endpoint does NOT exist in sandbox. In sandbox mode, skip it entirely. IV rank/percentile data is only available through this production-only endpoint. All other market data (price, OHLC, 52wk range, beta) comes from the DXLink streamer.

---

## ARCHITECTURE

### Decoupled Design

```
                   ┌─────────────────────┐
                   │  tastytrade API     │
                   │  (REST + DXLink WS) │
                   └─────────┬───────────┘
                             │
                   ┌─────────▼───────────┐
                   │  Indicator Engine    │
                   │  • Stream processor  │
                   │  • Trigger detector  │
                   │  • State manager     │
                   └─────────┬───────────┘
                             │
                      IndicatorAlert
                         (JSON)
                             │
                   ┌─────────▼───────────┐
                   │      AlertBus       │
                   │   (event emitter)   │
                   └──┬──────┬──────┬────┘
                      │      │      │
              ┌───────▼┐ ┌──▼────┐ ┌▼──────────┐
              │ Web UI │ │ JSONL │ │ AI Agent   │
              │ (React │ │ File  │ │ (Claude)   │
              │  dash) │ │ Log   │ │ [optional] │
              └────────┘ └───────┘ └────────────┘
```

The engine MUST work fully without the AI agent connected. The AI agent is an optional handler registered on the AlertBus.

### IndicatorAlert Schema

This is the primary output of the engine — a self-contained JSON object:

```typescript
interface TickerData {
  symbol: string
  price: number
  bid: number
  ask: number
  dayChangePct: number
  iv?: number
  ivRank?: number
  ivPercentile?: number
  strategies: string[]
  groups: string[]

  // From DXLink Summary
  prevDayClose?: number
  dayOpen?: number
  dayHigh?: number
  dayLow?: number
  openInterest?: number

  // From DXLink Profile
  high52Week?: number
  low52Week?: number
  beta?: number
  description?: string
  tradingStatus?: string
}

interface IndicatorAlert {
  alertId: string          // UUID
  timestamp: string        // ISO 8601 CT
  triggerType: string      // "iv_spike" | "price_move" | "iv_rank_high" | "iv_rank_low" | "scheduled" | "manual"
  symbol: string
  strategies: string[]     // ["supply_chain"] or ["midterm_macro"] or both
  groups: string[]         // ["Chip Packaging & Inspection", ...]
  severity: string         // "high" | "medium" | "low"
  detail: string           // Human-readable description
  skillHint: string        // "ai-hidden-supply-chain-options" | "midterm-options-analysis"
  marketData: TickerData   // Snapshot of the triggered ticker
  watchlistSnapshot: TickerData[]  // All tickers at time of alert
  optionChain?: object[]   // Nearest expirations for the triggered symbol
  account?: object         // Net liq, buying power, positions
}
```

### AlertBus

Simple event emitter pattern. Handlers register on the bus and receive every alert:

```typescript
class AlertBus extends EventEmitter {
  emit(alert: IndicatorAlert): void
  on(handler: (alert: IndicatorAlert) => Promise<void>): void
}
```

Handlers to implement:
1. **JSONL file logger** — always on, appends each alert as a JSON line to `alerts_YYYY-MM-DD.jsonl`
2. **WebSocket broadcast** — pushes alerts to connected web dashboard clients
3. **AI agent** — optional, only active when `ANTHROPIC_API_KEY` is set. Calls Claude with the alert context.

---

## TWO STRATEGIES (38 symbols total)

### Strategy 1: AI Hidden Supply Chain (7 layers, 22 symbols)

| Layer | Symbols | Thesis |
|-------|---------|--------|
| Chip Packaging & Inspection | AMKR, CAMT, ACMR | 2.5D packaging monopoly, HBM inspection |
| Optical Interconnects | FN, CIEN, LITE | 800G→1.6T transceiver upgrade cycle |
| Signal Integrity | ALAB, CRDO, MRVL | PCIe retimers, AI fabric switches |
| Rack Deployment | CLS, EME, CSCO | Physical data center integration |
| Thermal & Power | VRT, MOHN, NVT | Liquid cooling, 50-100kW rack power |
| Raw Materials | FCX, COPX, MP | Copper deficit, rare earth magnets |
| Nuclear & Uranium | CEG, CCJ, UEC, TLN | 24/7 baseload power for hyperscalers |

### Strategy 2: Midterm Macro Options (5 sectors, 16 symbols)

| Sector | Symbols | Thesis |
|--------|---------|--------|
| Energy | XLE, XOM, CVX | Oil geopolitics, energy infrastructure |
| Defense & Aerospace | RTX, LMT, NOC, GD | European rearmament, defense spending |
| AI & Semiconductors | NVDA, AVGO, AMD, MU, SMCI | AI capex cycle, chip demand |
| Biotech & Healthcare | VRTX | FDA catalysts, gene therapy |
| Macro Bear / Hedges | QQQ, SPY, XRT | Portfolio hedges, consumer weakness |

**Total unique symbols: 38** (some overlap between strategies is fine, deduplicate in code).

---

## TRIGGER CONDITIONS

| Trigger | Condition | Severity Logic |
|---------|-----------|---------------|
| `iv_spike` | IV jumps >15% in 5min window | High if >30%, Medium if >20% |
| `price_move` | Price moves >3% in 10min window | High if >6%, Medium if >4% |
| `iv_rank_high` | IV rank crosses above 50 | Based on magnitude above threshold |
| `iv_rank_low` | IV rank drops below 20 | Based on how far below |
| `scheduled` | 9:45am and 3:00pm CT on trading days | Always medium |
| `manual` | User types a ticker in terminal or web UI | Always medium |

Use rolling windows with cooldowns (don't re-fire the same trigger on the same symbol within 5 minutes).

---

## WEB DASHBOARD

Build a modern web dashboard using **React** (or Next.js) served alongside the Node.js backend. Connect to the engine via WebSocket for real-time updates.

### Dashboard Pages/Panels

1. **Watchlist Table** — all 38 symbols with: Symbol, Group, Price, Day Change %, Bid/Ask, Open/High/Low, 52wk High/Low, Beta, IV Rank (when available)
2. **Alerts Feed** — live stream of IndicatorAlerts with severity color coding, filterable by strategy/trigger type
3. **Account Panel** — net liq, buying power, open positions with P&L
4. **Symbol Detail** — click a symbol to see its full profile, option chain, and recent alerts
5. **AI Analysis Panel** — when Claude agent is connected, display formatted analysis results

### Real-time Data Flow

```
Engine → WebSocket Server → Browser clients
```

The backend pushes:
- Ticker state updates (throttled to ~2/sec per symbol)
- IndicatorAlerts as they fire
- Account balance/position updates (every 30s)

### Terminal Dashboard

Also support a terminal mode (for headless servers) using a library like `blessed` or `ink` — showing the same watchlist table, alerts, and log. This is secondary to the web dashboard.

---

## AI AGENT (OPTIONAL HANDLER)

The AI agent is a pluggable AlertBus handler. When `ANTHROPIC_API_KEY` is set in `.env`, it registers on the bus and calls Claude for each alert.

### Two AI Personas Based on `skillHint`

**When `skillHint === "ai-hidden-supply-chain-options"`:**
System prompt focuses on structural choke points in the AI supply chain, picks-and-shovels thesis, moat analysis, and cross-layer correlation.

**When `skillHint === "midterm-options-analysis"`:**
System prompt focuses on sector rotation, geopolitical macro, risk-on/risk-off environment, and cross-sector hedging.

Both prompts should instruct Claude to:
- Analyze why the trigger fired and what it signals
- Give specific option trade recommendation (ticker, strike, expiry, quantity, limit price)
- Explain how it fits the broader thesis
- Identify the key risk / invalidation condition
- Suggest exit criteria

The model to use: `claude-sonnet-4-20250514`

---

## FILE STRUCTURE

```
tastytrade-bot/
├── package.json
├── tsconfig.json
├── .env                        # Credentials (never commit)
├── .env.example                # Template
├── .gitignore
├── README.md
├── src/
│   ├── index.ts                # Entry point — starts engine + servers
│   ├── config.ts               # Env vars, constants
│   ├── auth.ts                 # Token loading, Session creation
│   ├── engine/
│   │   ├── streamer.ts         # DXLink WebSocket subscriptions & event processing
│   │   ├── state.ts            # MarketState — holds all TickerSnapshots
│   │   ├── strategies.ts       # Strategy definitions (supply chain + midterm macro)
│   │   ├── triggers.ts         # Threshold detection, rolling windows, cooldowns
│   │   └── alerts.ts           # IndicatorAlert type, AlertBus, JSONL handler
│   ├── services/
│   │   ├── account.ts          # Account data fetching (balances, positions)
│   │   └── options.ts          # Option chain fetching
│   ├── agent/
│   │   └── claude.ts           # Optional Claude AI handler
│   ├── web/
│   │   ├── server.ts           # Express/Fastify + WebSocket server
│   │   └── routes.ts           # REST API for dashboard (GET /api/state, etc.)
│   └── terminal/
│       └── dashboard.ts        # Terminal UI (blessed/ink)
├── web/                        # React/Next.js frontend
│   ├── package.json
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── WatchlistTable.tsx
│   │   │   ├── AlertsFeed.tsx
│   │   │   ├── AccountPanel.tsx
│   │   │   ├── SymbolDetail.tsx
│   │   │   └── AnalysisPanel.tsx
│   │   ├── hooks/
│   │   │   └── useWebSocket.ts
│   │   └── types/
│   │       └── index.ts        # Shared types (TickerData, IndicatorAlert)
│   └── ...
└── alerts_*.jsonl              # Daily alert logs (gitignored)
```

---

## .env TEMPLATE

```
# tastytrade OAuth (required)
TASTYTRADE_CLIENT_SECRET=97d05319e7675f39279d34ce5b564a5cd636e613
TASTYTRADE_REFRESH_TOKEN=eyJ...  # Your refresh token JWT
TASTYTRADE_ENV=sandbox            # "sandbox" or "production"

# AI Agent (optional — engine runs without it)
ANTHROPIC_API_KEY=

# Web server
PORT=3000
WS_PORT=3001
```

---

## IMPLEMENTATION NOTES

1. **Sandbox first.** All development uses `api.cert.tastyworks.com`. Quotes are 15-minute delayed in sandbox. Everything works except `/market-metrics` (404 in sandbox).

2. **Rate limiting.** Add 100ms minimum delay between REST calls. Batch where possible.

3. **Reconnection.** DXLink WebSocket disconnects are normal. Implement exponential backoff (1s, 2s, 4s, 8s, max 60s). Log all disconnects.

4. **Market hours.** Streaming runs 24/7 (sandbox data is always available). But trigger detection should note market hours (9:30am–4:00pm CT, Mon–Fri) for scheduled triggers and severity weighting.

5. **Never auto-execute trades.** Display recommendations only. Any order submission must require explicit user confirmation.

6. **Node.js WebSocket note.** The SDK's `cometd` dependency references `window`. For Node.js, you need:
```javascript
const WebSocket = require('ws')
global.WebSocket = WebSocket
global.window = { WebSocket, setTimeout, clearTimeout }
```

7. **Greeks require option symbols.** To get IV/delta/theta via streaming, subscribe to specific OCC option symbols (e.g., `NVDA 260620C210`), not the underlying. Fetch the option chain first to get `call-streamer-symbol` / `put-streamer-symbol`.

8. **Token persistence.** Store refresh token in `.env`. The SDK creates access tokens automatically from it. Access tokens are ephemeral (15min) — never store them.

---

## DELIVERABLE

A fully working TypeScript project that:

1. `npm install && npm run dev` starts the engine + web server
2. On startup: authenticates via OAuth2, connects DXLink streamer, subscribes to all events
3. Web dashboard at `http://localhost:3000` shows real-time watchlist, alerts, and account data
4. Terminal output shows basic streamer status and alerts
5. Alerts are written to JSONL files
6. When `ANTHROPIC_API_KEY` is set, Claude analysis fires on trigger events
7. Includes a thorough README with setup instructions

Build this with modern TypeScript, proper error handling, and a clean, beautiful web UI.

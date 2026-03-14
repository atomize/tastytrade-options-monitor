You are an expert TypeScript/Node.js developer building a modular, production-grade 
options market monitoring system. The architecture is deliberately decoupled: a market 
watcher engine that emits structured alert data, and separately, a React SPA dashboard 
plus a CLI output channel that can pipe that data to any external agent.

---

## CORE ARCHITECTURE PRINCIPLE

The market watcher is NOT an agent. It is a structured data emitter.

When trigger conditions are met, it outputs a self-contained JSON alert payload 
to stdout (for CLI agent piping) and broadcasts it via a local WebSocket server 
(for the React dashboard). It has zero knowledge of Claude, Cursor, or any AI system.

The AI analysis layer is entirely external — any agent with a CLI can consume 
the output. Examples:

  # Pipe directly to Claude CLI
  npm run monitor | claude --system "You are an options desk trader..." 

  # Or trigger on alert and pass structured payload
  cat alert.json | claude -p "Analyze this options alert and recommend a trade"

  # Or use with Cursor agent, any MCP-compatible CLI, etc.

This means the monitor can be used with ANY agent now or in the future without 
changing a single line of monitoring code.

---

## TASTYTRADE CREDENTIALS (SANDBOX)

- Developer portal: developer.tastytrade.com
- App name: jdberti Sandbox OAuth2 App
- Client ID: d19b3650-b190-443d-9c59-90dd85a24ae9
- Client Secret: 97d05319e7675f39279d34ce5b564a5cd636e613
- Redirect URI: http://localhost:8080/callback
- Scopes: read, trade, openid
- Sandbox REST base: https://api.cert.tastyworks.com
- Sandbox streamer: wss://streamer.cert.tastyworks.com

Use the official tastytrade JS SDK exclusively:
  npm install @tastytrade/api

Never use any third-party or community tastytrade SDK. The official SDK handles 
OAuth2 token exchange, refresh, DXLink WebSocket streaming, and typed API responses.

---

## TECH STACK

Backend / Monitor Engine:
- Node.js 20+ with TypeScript (strict mode)
- @tastytrade/api — official tastytrade SDK
- ws — WebSocket server for dashboard communication
- zod — runtime schema validation for all alert payloads
- date-fns — market hours and timestamp handling
- dotenv — environment config
- tsx — TypeScript execution for CLI without compile step

Frontend / Dashboard:
- React 18 + TypeScript (Vite)
- Single file components — keep it simple, no heavy UI framework
- Tailwind CSS — utility styling only
- recharts — sparklines and price charts
- Native browser WebSocket — connects to monitor's local WS server
- No Redux, no React Query — simple useState/useEffect is fine

Monorepo structure (pnpm workspaces):
  packages/
    monitor/     — the engine, CLI output, WS broadcaster
    dashboard/   — React SPA

---

## ALERT PAYLOAD SCHEMA

This is the contract between the monitor and any consumer (agent or dashboard).
Define this with Zod in a shared package (packages/shared/src/alert.schema.ts)
so both monitor and dashboard import the same type.

Every alert must conform to:

interface OptionsAlert {
  // Identity
  id: string                    // uuid
  timestamp: string             // ISO8601, Chicago time
  version: "1.0"

  // What fired
  trigger: {
    type: "IV_SPIKE" | "PRICE_MOVE" | "IV_RANK_THRESHOLD" | 
          "SCHEDULED_OPEN" | "SCHEDULED_CLOSE" | "MANUAL"
    ticker: string
    description: string         // human readable: "CAMT IV spiked 18% in 5min"
    threshold: number           // the configured threshold value
    observed: number            // the actual observed value that fired
  }

  // Full watchlist snapshot at time of alert
  marketSnapshot: Array<{
    ticker: string
    price: number
    priceChange1D: number       // absolute
    priceChangePct1D: number    // percentage
    iv: number                  // current IV %
    ivRank: number              // 0-100
    ivPctChange5Min: number     // IV change in last 5 minutes
    bid: number
    ask: number
    volume: number
    lastUpdated: string
  }>

  // Option chain for the triggered ticker (nearest 3 expirations)
  optionChain: Array<{
    expiration: string          // YYYY-MM-DD
    daysToExpiry: number
    strikes: Array<{
      strike: number
      callBid: number
      callAsk: number
      callVolume: number
      callOI: number
      callDelta: number
      callIV: number
      putBid: number
      putAsk: number
      putVolume: number
      putOI: number
      putDelta: number
      putIV: number
    }>
  }>

  // Account context
  account: {
    netLiq: number
    buyingPower: number
    openPositions: Array<{
      ticker: string
      type: "call" | "put" | "stock"
      strike?: number
      expiration?: string
      quantity: number
      costBasis: number
      currentValue: number
      pnl: number
      pnlPct: number
    }>
  }

  // Layer classification for AI context
  supplyChainLayer: string | null   
  // e.g. "Layer 1 — Chip Packaging" or null if not in supply chain watchlist
  
  // Raw prompt-ready summary (pre-formatted for direct agent injection)
  agentContext: string
  // A pre-built markdown string summarizing the above data
  // so agents with limited context windows can use this alone
}

---

## AGENT CONTEXT STRING FORMAT

The agentContext field must be a self-contained markdown string an AI agent 
can act on without reading the rest of the JSON. Format it as:

## OPTIONS ALERT — {trigger.type} on {ticker}
**Time:** {timestamp} Chicago  
**Trigger:** {trigger.description}

### Watchlist Snapshot
| Ticker | Price | Chg% | IV% | IV Rank | Layer |
...

### Option Chain — {ticker} (nearest 3 expirations)
...

### Account
- Net Liq: ${netLiq}
- Buying Power: ${buyingPower}  
- Open Positions: {count} ({list})

---

## CLI OUTPUT BEHAVIOR

The monitor process (packages/monitor) must support two output modes 
controlled by the --mode flag:

### --mode dashboard (default)
- Renders a live terminal UI using console with ANSI escape codes
- Shows a watchlist table that refreshes every 5 seconds
- Shows a scrolling alert log
- Broadcasts alerts via local WebSocket on ws://localhost:3001
- Does NOT print JSON to stdout (dashboard mode is for humans)

### --mode pipe
- Suppresses ALL terminal UI output
- On every alert, prints a single line to stdout:
  ALERT:{base64-encoded JSON of the full OptionsAlert payload}\n
- Prints a keepalive every 30 seconds:
  KEEPALIVE:{timestamp}\n
- All logs go to stderr so they don't pollute the stdout pipe
- This mode is designed for:
    npm run monitor -- --mode pipe | claude --system "..."
    npm run monitor -- --mode pipe | your-agent-cli

### --mode file
- Same as pipe but writes each alert as a JSON file to ./alerts/
- Filename: alert_{timestamp}_{ticker}.json
- Useful for batch processing or testing

---

## TRIGGER CONDITIONS

Configure all thresholds in a config.ts file (not hardcoded):

const config = {
  triggers: {
    ivSpikePct: 15,           // % IV change in 5-minute window
    priceMoveWindowMin: 10,   // minutes to measure price move
    priceMovePct: 3,          // % price change to trigger
    ivRankBuyThreshold: 20,   // IV rank below this = cheap calls
    ivRankSellThreshold: 50,  // IV rank above this = rich premium
  },
  schedule: {
    timezone: "America/Chicago",
    openRunMinutesAfterOpen: 15,   // 9:45am CT
    closeRunMinutesBefore: 60,     // 3:00pm CT
  },
  rateLimit: {
    minMsBetweenRestCalls: 150,
    alertCooldownMs: 300000,  // 5 min cooldown per ticker between alerts
  }
}

---

## WATCHLIST CONFIGURATION

Define watchlist in watchlist.config.ts — structured with layer metadata 
so agentContext can include supply chain layer classification:

const WATCHLIST = [
  { ticker: "AMKR", layer: "Layer 1 — Chip Packaging",      thesis: "2.5D packaging choke point, TSMC alternative" },
  { ticker: "CAMT", layer: "Layer 1 — Chip Inspection",     thesis: "HBM wafer inspection, HBM4 transition catalyst" },
  { ticker: "FN",   layer: "Layer 2 — Optical Interconnects", thesis: "Only manufacturer for 1.6T transceivers at scale" },
  { ticker: "ALAB", layer: "Layer 2 — Signal Connectivity",  thesis: "PCIe retimers, Scorpio AI fabric switch" },
  { ticker: "CRDO", layer: "Layer 3 — Signal Integrity",     thesis: "Competing retimer chips, high volatility leverage" },
  { ticker: "MRVL", layer: "Layer 3 — Custom ASICs",         thesis: "AWS/Microsoft custom AI chips, 3nm volume ramp" },
  { ticker: "CLS",  layer: "Layer 4 — Rack Deployment",      thesis: "AI rack integration, Broadcom manufacturing partner" },
  { ticker: "VRT",  layer: "Layer 5 — Thermal & Power",      thesis: "Liquid cooling, UPS — every DC must retrofit" },
  { ticker: "FCX",  layer: "Layer 6 — Raw Materials",        thesis: "Copper — inelastic AI demand, structural deficit" },
  { ticker: "CCJ",  layer: "Layer 7 — Uranium",              thesis: "Uranium producer, 55% earnings growth 2026" },
  { ticker: "CEG",  layer: "Layer 7 — Nuclear Power",        thesis: "Nuclear baseload PPAs with hyperscalers" },
  { ticker: "NVDA", layer: "Macro — AI Semis",               thesis: "Core AI GPU — visibility on capex cycle" },
  { ticker: "AVGO", layer: "Macro — AI Semis",               thesis: "Custom AI chips, 106% AI revenue YoY" },
  { ticker: "RTX",  layer: "Macro — Defense",                thesis: "Patriot $50B contract, Strait of Hormuz play" },
  { ticker: "NOC",  layer: "Macro — Defense",                thesis: "B-21 ramp, Golden Dome awards" },
  { ticker: "XOM",  layer: "Macro — Energy",                 thesis: "Oil major, Strait of Hormuz beneficiary" },
]

---

## REACT DASHBOARD (packages/dashboard)

Single page, component-based, no router needed. Connects to 
ws://localhost:3001 to receive live OptionsAlert payloads from the monitor.

Components:

<App />
  ├── <ConnectionStatus />      — green/red dot, "Connected to monitor"
  ├── <WatchlistTable />         — live updating table, all tickers
  │     columns: Ticker | Layer | Price | Chg% | IV% | IV Rank | 5m IV Δ | Status
  │     rows color-coded: green = price up, red = down, yellow = alert triggered
  ├── <AlertFeed />              — scrolling list of fired alerts, newest first
  │     each alert shows: time, trigger type, ticker, description
  │     click to expand → shows full agentContext markdown
  ├── <PositionsPanel />         — current tastytrade open positions + P&L
  └── <AgentExportPanel />       — 
        "Copy last alert as agent prompt" button
        "Export all alerts as JSONL" button
        Shows the exact CLI command to pipe monitor output to Claude:
        npm run monitor -- --mode pipe | claude -p "..."

Styling rules:
- Dark theme only (#0f0f0f background, no white backgrounds)
- Monospace font for all numbers and ticker data
- Keep it dense — traders want data density, not whitespace
- No animations except subtle flash on new alert row
- Mobile is not a priority — optimize for a wide desktop terminal

---

## PROJECT FILE STRUCTURE

tastytrade-monitor/
├── packages/
│   ├── shared/
│   │   ├── src/
│   │   │   ├── alert.schema.ts      — Zod schema + TypeScript types
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── monitor/
│   │   ├── src/
│   │   │   ├── main.ts              — entry point, CLI args, mode routing
│   │   │   ├── auth.ts              — OAuth2 flow, token persistence
│   │   │   ├── streamer.ts          — DXLink WebSocket, quote subscriptions
│   │   │   ├── triggers.ts          — threshold detection, cooldown logic
│   │   │   ├── chainFetcher.ts      — option chain REST calls
│   │   │   ├── alertBuilder.ts      — constructs OptionsAlert from raw data
│   │   │   ├── broadcaster.ts       — WS server on :3001 for dashboard
│   │   │   ├── outputModes.ts       — dashboard / pipe / file output logic
│   │   │   ├── marketHours.ts       — Chicago time, open/close detection
│   │   │   ├── config.ts            — all thresholds and settings
│   │   │   └── watchlist.config.ts  — watchlist with layer metadata
│   │   ├── tokens/
│   │   │   └── .gitkeep             — refresh token stored here at runtime
│   │   ├── alerts/
│   │   │   └── .gitkeep             — alert JSON files in --mode file
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── dashboard/
│       ├── src/
│       │   ├── App.tsx
│       │   ├── components/
│       │   │   ├── ConnectionStatus.tsx
│       │   │   ├── WatchlistTable.tsx
│       │   │   ├── AlertFeed.tsx
│       │   │   ├── PositionsPanel.tsx
│       │   │   └── AgentExportPanel.tsx
│       │   ├── hooks/
│       │   │   └── useMonitorSocket.ts   — WS connection, alert state
│       │   └── types.ts                  — imports from @tastytrade-monitor/shared
│       ├── index.html
│       ├── vite.config.ts
│       └── package.json
│
├── .env.example
├── .gitignore                    — must include tokens/, .env, alerts/*.json
├── pnpm-workspace.yaml
├── package.json                  — root scripts
└── README.md

---

## ROOT PACKAGE.JSON SCRIPTS

{
  "scripts": {
    "monitor": "pnpm --filter monitor run start",
    "monitor:pipe": "pnpm --filter monitor run start -- --mode pipe",
    "monitor:file": "pnpm --filter monitor run start -- --mode file",
    "dashboard": "pnpm --filter dashboard run dev",
    "dev": "concurrently \"pnpm monitor\" \"pnpm dashboard\"",
    "build": "pnpm --filter shared build && pnpm --filter monitor build && pnpm --filter dashboard build",
    "typecheck": "pnpm -r typecheck"
  }
}

---

## .env.example

TASTYTRADE_CLIENT_ID=d19b3650-b190-443d-9c59-90dd85a24ae9
TASTYTRADE_CLIENT_SECRET=97d05319e7675f39279d34ce5b564a5cd636e613
TASTYTRADE_REDIRECT_URI=http://localhost:8080/callback
TASTYTRADE_ENV=sandbox
# Switch to 'production' and add production credentials when ready

---

## OAUTH2 IMPLEMENTATION NOTES

The official @tastytrade/api SDK handles the OAuth2 token exchange. Your auth.ts 
must:

1. On first run: open the authorization URL in the system browser 
   (use the 'open' npm package), spin up a temporary Express server on :8080 
   to catch the redirect, extract the code, exchange for tokens via the SDK
2. Persist the refresh_token to packages/monitor/tokens/token.json
3. On subsequent runs: load token.json, use refresh_token to silently get 
   a new access_token via the SDK — never re-open the browser unless 
   the refresh_token itself is expired or revoked
4. Implement a setInterval to proactively refresh the access_token every 
   14 minutes (tokens expire at 15 minutes — refresh before expiry)

---

## IMPORTANT CONSTRAINTS

1. The monitor package has ZERO dependency on any AI SDK (no anthropic package). 
   The separation of concerns is absolute — monitor emits data, agents consume it.

2. Never auto-submit orders. The system is read-only from a trading perspective. 
   The tastytrade 'trade' scope is included in OAuth for future extension only.

3. All tastytrade API calls go to the sandbox (cert.tastyworks.com) until 
   TASTYTRADE_ENV=production is explicitly set in .env.

4. The shared package must be the single source of truth for the OptionsAlert 
   type — no duplicating the interface in monitor or dashboard.

5. The agentContext string inside every alert must be complete enough that an 
   AI agent can make a specific, actionable trade recommendation using it alone, 
   without needing to parse the rest of the JSON.

6. Rate limit all REST calls. The sandbox is strict. Add 150ms minimum delay 
   between calls and use the market-metrics batch endpoint (up to 500 symbols) 
   rather than individual quote calls where possible.

---

## DELIVERABLE

Produce all files in the structure above, fully runnable with:

  cp .env.example .env     # user fills in their own ANTHROPIC_API_KEY if needed
  pnpm install
  pnpm dev                  # starts monitor in dashboard mode + Vite dashboard

First run opens a browser for tastytrade sandbox OAuth login, 
then the terminal dashboard and React SPA both come alive.

Include a README.md covering:
- Prerequisites (Node 20+, pnpm)
- First-run OAuth flow walkthrough
- How to pipe output to Claude CLI
- How to pipe output to Cursor agent
- How to switch to production tastytrade credentials
- How to add tickers to the watchlist
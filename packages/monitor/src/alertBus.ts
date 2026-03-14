import { randomUUID } from 'node:crypto'
import type { OptionsAlert, Severity, TriggerType } from '@tastytrade-monitor/shared'
import { getAllSnapshots, getSnapshot } from './state.js'
import { getEntryByTicker } from './watchlist.config.js'
import { getAccountContext } from './account.js'
import { log } from './logger.js'

export type AlertHandler = (alert: OptionsAlert) => Promise<void> | void

const handlers: AlertHandler[] = []

export function onAlert(handler: AlertHandler): void {
  handlers.push(handler)
}

export interface TriggerInput {
  type: TriggerType
  ticker: string
  description: string
  threshold: number
  observed: number
  severity: Severity
}

export async function emitAlert(input: TriggerInput): Promise<void> {
  const entry = getEntryByTicker(input.ticker)
  const snap = getSnapshot(input.ticker)
  const allSnaps = getAllSnapshots()
  const account = getAccountContext()

  const strategies = entry?.strategies ?? []
  const supplyChainLayer = entry?.layer ?? null

  let skillHint: OptionsAlert['skillHint'] = null
  if (strategies.includes('supply_chain')) {
    skillHint = 'ai-hidden-supply-chain-options'
  } else if (strategies.includes('midterm_macro')) {
    skillHint = 'midterm-options-analysis'
  }

  const alert: OptionsAlert = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    version: '1.0',
    trigger: {
      type: input.type,
      ticker: input.ticker,
      description: input.description,
      threshold: input.threshold,
      observed: input.observed,
    },
    severity: input.severity,
    strategies,
    supplyChainLayer,
    skillHint,
    marketSnapshot: allSnaps,
    optionChain: [],
    account,
    agentContext: buildAgentContext(input, snap, allSnaps, account),
  }

  for (const handler of handlers) {
    try {
      await handler(alert)
    } catch (err) {
      log.error('Alert handler error:', err)
    }
  }
}

function buildAgentContext(
  input: TriggerInput,
  snap: ReturnType<typeof getSnapshot>,
  allSnaps: ReturnType<typeof getAllSnapshots>,
  account: ReturnType<typeof getAccountContext>,
): string {
  const lines: string[] = [
    `## OPTIONS ALERT — ${input.type} on ${input.ticker}`,
    `**Time:** ${new Date().toISOString()} Chicago`,
    `**Trigger:** ${input.description}`,
    `**Severity:** ${input.severity}`,
    '',
    '### Watchlist Snapshot',
    '| Ticker | Price | Chg% | IV Rank | Layer |',
    '|--------|-------|------|---------|-------|',
  ]

  for (const s of allSnaps) {
    if (s.price > 0) {
      lines.push(
        `| ${s.ticker} | $${s.price.toFixed(2)} | ${s.priceChangePct1D.toFixed(1)}% | ${s.ivRank ?? 'N/A'} | ${s.layer ?? '-'} |`
      )
    }
  }

  lines.push('')
  lines.push('### Account')
  lines.push(`- Net Liq: $${account.netLiq.toLocaleString()}`)
  lines.push(`- Buying Power: $${account.buyingPower.toLocaleString()}`)
  lines.push(`- Open Positions: ${account.openPositions.length}`)

  if (snap) {
    lines.push('')
    lines.push(`### Triggered Ticker: ${snap.ticker}`)
    lines.push(`- Price: $${snap.price.toFixed(2)}`)
    lines.push(`- Bid/Ask: $${snap.bid.toFixed(2)} / $${snap.ask.toFixed(2)}`)
    lines.push(`- Day Change: ${snap.priceChangePct1D.toFixed(2)}%`)
    if (snap.high52Week) lines.push(`- 52W Range: $${snap.low52Week?.toFixed(2)} — $${snap.high52Week.toFixed(2)}`)
  }

  return lines.join('\n')
}

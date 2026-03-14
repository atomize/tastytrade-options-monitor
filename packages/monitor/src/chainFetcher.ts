import type { OptionExpiration } from '@tastytrade-monitor/shared'
import { getClient } from './auth.js'
import { getEntryByTicker } from './watchlist.config.js'
import { config } from './config.js'
import { log } from './logger.js'

/**
 * Fetch the nearest N expirations for a symbol's option chain from the tastytrade
 * REST API. Extracts streamer symbols (OCC format) for DXLink Greek subscriptions.
 */
export async function fetchOptionChain(
  symbol: string,
  maxExpirations = 3,
): Promise<OptionExpiration[]> {
  const entry = getEntryByTicker(symbol)
  if (entry?.instrumentType === 'crypto') {
    return []
  }

  try {
    const client = getClient()
    const raw = await client.instrumentsService.getNestedOptionChain(symbol) as Record<string, unknown>

    const expirations = (raw?.items ?? raw) as Record<string, unknown>[]
    if (!Array.isArray(expirations)) {
      log.warn(`No option chain data for ${symbol}`)
      return []
    }

    const today = new Date()
    const results: OptionExpiration[] = []

    const sorted = expirations
      .filter((exp) => {
        const dateStr = String(exp['expiration-date'] ?? exp.expirationDate ?? '')
        return dateStr && new Date(dateStr) > today
      })
      .sort((a, b) => {
        const da = String(a['expiration-date'] ?? a.expirationDate ?? '')
        const db = String(b['expiration-date'] ?? b.expirationDate ?? '')
        return da.localeCompare(db)
      })
      .slice(0, maxExpirations)

    for (const exp of sorted) {
      const expDate = String(exp['expiration-date'] ?? exp.expirationDate ?? '')
      const daysToExpiry = Math.ceil(
        (new Date(expDate).getTime() - today.getTime()) / 86_400_000,
      )

      const strikes = (exp.strikes ?? exp['option-chain-items'] ?? []) as Record<string, unknown>[]
      const parsedStrikes = strikes.map((s: Record<string, unknown>) => ({
        strike: asNumber(s['strike-price'] ?? s.strikePrice),
        callBid: asNumber(s['call-bid'] ?? s.callBid),
        callAsk: asNumber(s['call-ask'] ?? s.callAsk),
        callVolume: asNumber(s['call-volume'] ?? s.callVolume),
        callOI: asNumber(s['call-open-interest'] ?? s.callOpenInterest),
        callDelta: asOptNumber(s['call-delta'] ?? s.callDelta),
        callIV: asOptNumber(s['call-implied-volatility'] ?? s.callImpliedVolatility),
        callStreamerSymbol: (s['call-streamer-symbol'] ?? s.callStreamerSymbol) as string | undefined,
        putBid: asNumber(s['put-bid'] ?? s.putBid),
        putAsk: asNumber(s['put-ask'] ?? s.putAsk),
        putVolume: asNumber(s['put-volume'] ?? s.putVolume),
        putOI: asNumber(s['put-open-interest'] ?? s.putOpenInterest),
        putDelta: asOptNumber(s['put-delta'] ?? s.putDelta),
        putIV: asOptNumber(s['put-implied-volatility'] ?? s.putImpliedVolatility),
        putStreamerSymbol: (s['put-streamer-symbol'] ?? s.putStreamerSymbol) as string | undefined,
      }))

      results.push({
        expiration: expDate,
        daysToExpiry,
        strikes: parsedStrikes,
      })
    }

    log.info(`Fetched option chain for ${symbol}: ${results.length} expirations`)
    return results
  } catch (err) {
    log.error(`Failed to fetch option chain for ${symbol}:`, err)
    return []
  }
}

function asNumber(v: unknown): number {
  if (typeof v === 'number' && isFinite(v)) return v
  if (typeof v === 'string') {
    const n = parseFloat(v)
    return isFinite(n) ? n : 0
  }
  return 0
}

function asOptNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && isFinite(v)) return v
  if (typeof v === 'string') {
    const n = parseFloat(v)
    return isFinite(n) ? n : undefined
  }
  return undefined
}

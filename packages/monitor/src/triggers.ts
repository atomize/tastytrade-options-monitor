import type { Severity, TriggerType } from '@tastytrade-monitor/shared'
import { config } from './config.js'
import { getSnapshot, getPriceHistory } from './state.js'
import { emitAlert } from './alertBus.js'
import { log } from './logger.js'

const cooldowns = new Map<string, number>()

function cooldownKey(ticker: string, type: TriggerType): string {
  return `${ticker}:${type}`
}

function isOnCooldown(ticker: string, type: TriggerType): boolean {
  const key = cooldownKey(ticker, type)
  const last = cooldowns.get(key)
  if (!last) return false
  return Date.now() - last < config.rateLimit.alertCooldownMs
}

function setCooldown(ticker: string, type: TriggerType): void {
  cooldowns.set(cooldownKey(ticker, type), Date.now())
}

export function checkTriggers(ticker: string): void {
  checkPriceMove(ticker)
  checkIvRank(ticker)
}

function checkPriceMove(ticker: string): void {
  if (isOnCooldown(ticker, 'PRICE_MOVE')) return

  const history = getPriceHistory(ticker)
  if (history.length < 2) return

  const now = Date.now()
  const windowMs = config.triggers.priceMoveWindowMin * 60_000
  const recent = history.filter(p => now - p.timestamp < windowMs)
  if (recent.length < 2) return

  const oldest = recent[0]
  const newest = recent[recent.length - 1]
  if (oldest.price === 0) return

  const changePct = Math.abs((newest.price - oldest.price) / oldest.price) * 100

  if (changePct >= config.triggers.priceMovePct) {
    const severity: Severity =
      changePct >= 6 ? 'high' :
      changePct >= 4 ? 'medium' : 'low'

    setCooldown(ticker, 'PRICE_MOVE')
    log.info(`TRIGGER: ${ticker} price moved ${changePct.toFixed(1)}% in ${config.triggers.priceMoveWindowMin}min`)

    emitAlert({
      type: 'PRICE_MOVE',
      ticker,
      description: `${ticker} price moved ${changePct.toFixed(1)}% in ${config.triggers.priceMoveWindowMin} minutes`,
      threshold: config.triggers.priceMovePct,
      observed: changePct,
      severity,
    })
  }
}

function checkIvRank(ticker: string): void {
  const snap = getSnapshot(ticker)
  if (!snap?.ivRank) return

  if (snap.ivRank >= config.triggers.ivRankSellThreshold) {
    if (isOnCooldown(ticker, 'IV_RANK_HIGH')) return
    const severity: Severity =
      snap.ivRank >= 80 ? 'high' :
      snap.ivRank >= 65 ? 'medium' : 'low'

    setCooldown(ticker, 'IV_RANK_HIGH')
    log.info(`TRIGGER: ${ticker} IV rank high at ${snap.ivRank}`)

    emitAlert({
      type: 'IV_RANK_HIGH',
      ticker,
      description: `${ticker} IV rank is ${snap.ivRank} (above sell threshold of ${config.triggers.ivRankSellThreshold})`,
      threshold: config.triggers.ivRankSellThreshold,
      observed: snap.ivRank,
      severity,
    })
  }

  if (snap.ivRank <= config.triggers.ivRankBuyThreshold) {
    if (isOnCooldown(ticker, 'IV_RANK_LOW')) return
    const severity: Severity =
      snap.ivRank <= 5 ? 'high' :
      snap.ivRank <= 10 ? 'medium' : 'low'

    setCooldown(ticker, 'IV_RANK_LOW')
    log.info(`TRIGGER: ${ticker} IV rank low at ${snap.ivRank}`)

    emitAlert({
      type: 'IV_RANK_LOW',
      ticker,
      description: `${ticker} IV rank is ${snap.ivRank} (below buy threshold of ${config.triggers.ivRankBuyThreshold})`,
      threshold: config.triggers.ivRankBuyThreshold,
      observed: snap.ivRank,
      severity,
    })
  }
}

export function triggerManual(ticker: string): void {
  log.info(`TRIGGER: Manual analysis requested for ${ticker}`)
  emitAlert({
    type: 'MANUAL',
    ticker,
    description: `Manual analysis requested for ${ticker}`,
    threshold: 0,
    observed: 0,
    severity: 'medium',
  })
}

export function triggerScheduled(type: 'SCHEDULED_OPEN' | 'SCHEDULED_CLOSE'): void {
  const label = type === 'SCHEDULED_OPEN' ? '9:45am CT open' : '3:00pm CT close'
  log.info(`TRIGGER: Scheduled ${label} analysis`)
  emitAlert({
    type,
    ticker: '*',
    description: `Scheduled ${label} watchlist analysis`,
    threshold: 0,
    observed: 0,
    severity: 'medium',
  })
}

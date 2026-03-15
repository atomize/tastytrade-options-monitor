#!/usr/bin/env node

/**
 * Persistent alert listener that invokes `pi --print` on-demand per alert.
 *
 * Stays alive as the main container process, connects to the monitor WS,
 * and spawns a one-shot `pi --print --no-session` for each incoming alert.
 * The pi extension (alert-receiver.ts) is still loaded for interactive use;
 * this runner handles the headless/container case.
 */

import { WebSocket } from 'ws'
import { execFile } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const WS_URL = process.env.MONITOR_WS_URL || 'ws://localhost:3001'
const PI_MODEL = process.env.PI_MODEL || 'claude-sonnet-4-20250514'
const MAX_QUEUE = 5
const COOLDOWN_MS = 300_000
const RECONNECT_MS = 5_000
const PI_TIMEOUT_MS = 120_000

const alertQueue = []
const cooldowns = new Map()
let isProcessing = false
let ws = null

function log(msg) {
  console.error(`[runner] ${msg}`)
}

function loadSkillContent(name) {
  const path = resolve(__dirname, 'skills', name, 'SKILL.md')
  if (!existsSync(path)) return ''
  const raw = readFileSync(path, 'utf-8')
  const bodyStart = raw.indexOf('---', raw.indexOf('---') + 3)
  return bodyStart > 0 ? raw.slice(bodyStart + 3).trim() : raw
}

function loadAgentsContext() {
  const path = resolve(__dirname, 'AGENTS.md')
  return existsSync(path) ? readFileSync(path, 'utf-8').trim() : ''
}

function loadSystemPrompt() {
  const path = resolve(__dirname, 'SYSTEM.md')
  return existsSync(path) ? readFileSync(path, 'utf-8').trim() : ''
}

function selectSkills(alert) {
  const skills = ['options-trader']
  const strategies = alert.strategies || []
  const layer = alert.supplyChainLayer || ''

  if (strategies.includes('supply_chain') || layer.startsWith('Layer')) {
    skills.push('ai-supply-chain')
  }
  if (strategies.includes('midterm_macro') || layer.startsWith('Macro')) {
    skills.push('midterm-macro')
  }
  return skills
}

function buildPrompt(alert) {
  const skills = selectSkills(alert)
  const skillContent = skills.map(loadSkillContent).filter(Boolean).join('\n\n---\n\n')
  const agentsContext = loadAgentsContext()

  const isDelayed = (alert.agentContext || '').includes('15-min delayed')
  const isCrypto = (alert.strategies || []).includes('crypto')

  let prompt = ''
  if (agentsContext) prompt += agentsContext + '\n\n'
  if (skillContent) prompt += skillContent + '\n\n'

  if (isDelayed) prompt += 'NOTE: This alert is based on 15-minute delayed sandbox data.\n\n'
  if (isCrypto) prompt += 'NOTE: This is a crypto spot instrument — no options chain is available on tastytrade.\n\n'

  prompt += 'New alert received. Analyze and recommend:\n\n'
  prompt += alert.agentContext || JSON.stringify(alert, null, 2)

  return prompt
}

function invokePi(prompt) {
  return new Promise((resolve, reject) => {
    const child = execFile('pi', ['--print', '--no-session', '-p', prompt], {
      timeout: PI_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, FORCE_COLOR: '0' },
    }, (err, stdout, stderr) => {
      if (stderr) log(`pi stderr: ${stderr.slice(0, 500)}`)
      if (err) return reject(err)
      resolve(stdout.trim())
    })
  })
}

function sendAnalysis(alert, analysis) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return

  ws.send(JSON.stringify({
    type: 'agent_analysis',
    data: {
      alertId: alert.id,
      timestamp: new Date().toISOString(),
      model: PI_MODEL,
      analysis,
      ticker: alert.trigger?.ticker || 'unknown',
      triggerType: alert.trigger?.type || 'unknown',
    },
  }))

  log(`Analysis posted for ${alert.trigger?.ticker}`)
}

async function processAlert(alert) {
  isProcessing = true
  const ticker = alert.trigger?.ticker || '?'
  log(`Processing alert: ${ticker} ${alert.trigger?.type}`)

  try {
    const prompt = buildPrompt(alert)
    const analysis = await invokePi(prompt)

    if (analysis) {
      sendAnalysis(alert, analysis)
    } else {
      log(`Empty response from pi for ${ticker}`)
    }
  } catch (err) {
    log(`pi invocation failed for ${ticker}: ${err.message}`)
  }

  isProcessing = false

  if (alertQueue.length > 0) {
    const next = alertQueue.shift()
    setTimeout(() => processAlert(next), 1000)
  }
}

function handleAlert(data) {
  if (!data || !data.id || !data.trigger) return

  const cooldownKey = `${data.trigger.ticker}:${data.trigger.type}`
  const last = cooldowns.get(cooldownKey)
  if (last && Date.now() - last < COOLDOWN_MS) {
    log(`Cooldown active for ${cooldownKey}, skipping`)
    return
  }
  cooldowns.set(cooldownKey, Date.now())

  if (isProcessing) {
    if (alertQueue.length >= MAX_QUEUE) alertQueue.shift()
    alertQueue.push(data)
    log(`Queued alert for ${data.trigger.ticker} (queue: ${alertQueue.length})`)
    return
  }

  processAlert(data)
}

function connect() {
  log(`Connecting to ${WS_URL}`)

  try {
    ws = new WebSocket(WS_URL)
  } catch (err) {
    log(`Connection failed: ${err.message}`)
    setTimeout(connect, RECONNECT_MS)
    return
  }

  ws.on('open', () => {
    log('Connected to monitor WS')
  })

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(String(raw))
      if (msg.type === 'alert' && msg.data) {
        handleAlert(msg.data)
      }
    } catch { /* ignore */ }
  })

  ws.on('close', () => {
    log('Disconnected from monitor WS, reconnecting...')
    ws = null
    setTimeout(connect, RECONNECT_MS)
  })

  ws.on('error', (err) => {
    log(`WS error: ${err.message}`)
    ws?.close()
  })
}

log(`Starting persistent alert runner`)
log(`Monitor WS: ${WS_URL}`)
log(`Model: ${PI_MODEL}`)

const systemPrompt = loadSystemPrompt()
if (systemPrompt) log(`System prompt loaded (${systemPrompt.length} chars)`)

connect()

process.on('SIGTERM', () => {
  log('SIGTERM received, shutting down')
  ws?.close()
  process.exit(0)
})

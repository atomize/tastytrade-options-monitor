import { WebSocketServer, WebSocket } from 'ws'
import type { OptionsAlert, WsMessage } from '@tastytrade-monitor/shared'
import { getAllSnapshots } from './state.js'
import { getAccountContext } from './account.js'
import { onAlert } from './alertBus.js'
import { config } from './config.js'
import { log } from './logger.js'

let wss: WebSocketServer | null = null
const startTime = Date.now()

export function startBroadcaster(): void {
  wss = new WebSocketServer({ port: config.server.wsPort })
  log.info(`WebSocket broadcaster listening on ws://localhost:${config.server.wsPort}`)

  wss.on('connection', (ws) => {
    log.info(`Dashboard client connected (total: ${wss!.clients.size})`)

    send(ws, {
      type: 'snapshot',
      data: getAllSnapshots(),
    })
    send(ws, {
      type: 'account',
      data: getAccountContext(),
    })
    send(ws, {
      type: 'status',
      data: buildStatus(),
    })

    ws.on('close', () => {
      log.info(`Dashboard client disconnected (total: ${wss!.clients.size})`)
    })
  })

  onAlert((alert: OptionsAlert) => {
    broadcast({ type: 'alert', data: alert })
  })

  setInterval(() => {
    broadcast({
      type: 'snapshot',
      data: getAllSnapshots(),
    })
  }, 2000)

  setInterval(() => {
    broadcast({
      type: 'account',
      data: getAccountContext(),
    })
    broadcast({
      type: 'status',
      data: buildStatus(),
    })
  }, 30_000)
}

function buildStatus() {
  return {
    connected: true,
    symbolCount: getAllSnapshots().length,
    uptime: Date.now() - startTime,
    env: config.tastytrade.env,
    isDelayed: config.tastytrade.env === 'sandbox',
  }
}

function broadcast(msg: WsMessage): void {
  if (!wss) return
  const payload = JSON.stringify(msg)
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload)
    }
  }
}

function send(ws: WebSocket, msg: WsMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg))
  }
}

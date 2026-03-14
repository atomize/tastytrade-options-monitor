import { useState, useEffect, useRef, useCallback } from 'react'
import type { TickerSnapshot, OptionsAlert, AccountContext } from '@tastytrade-monitor/shared'

interface MonitorState {
  connected: boolean
  snapshots: TickerSnapshot[]
  alerts: OptionsAlert[]
  account: AccountContext
  uptime: number
}

const WS_URL = 'ws://localhost:3001'
const MAX_ALERTS = 200

export function useMonitorSocket(): MonitorState {
  const [connected, setConnected] = useState(false)
  const [snapshots, setSnapshots] = useState<TickerSnapshot[]>([])
  const [alerts, setAlerts] = useState<OptionsAlert[]>([])
  const [account, setAccount] = useState<AccountContext>({
    netLiq: 0,
    buyingPower: 0,
    openPositions: [],
  })
  const [uptime, setUptime] = useState(0)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    const ws = new WebSocket(WS_URL)
    wsRef.current = ws

    ws.onopen = () => {
      setConnected(true)
    }

    ws.onclose = () => {
      setConnected(false)
      reconnectTimer.current = setTimeout(connect, 3000)
    }

    ws.onerror = () => {
      ws.close()
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        switch (msg.type) {
          case 'snapshot':
            setSnapshots(msg.data)
            break
          case 'alert':
            setAlerts(prev => [msg.data, ...prev].slice(0, MAX_ALERTS))
            break
          case 'account':
            setAccount(msg.data)
            break
          case 'status':
            setUptime(msg.data.uptime)
            break
        }
      } catch {
        // ignore malformed messages
      }
    }
  }, [])

  useEffect(() => {
    connect()
    return () => {
      clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
  }, [connect])

  return { connected, snapshots, alerts, account, uptime }
}

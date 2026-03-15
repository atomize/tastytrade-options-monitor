import { useState, useEffect, useRef, useCallback } from 'react'
import type { TickerSnapshot, OptionsAlert, AccountContext, OptionChainResponse, AgentAnalysis } from '@tastytrade-monitor/shared'

export interface MonitorState {
  connected: boolean
  snapshots: TickerSnapshot[]
  alerts: OptionsAlert[]
  analyses: AgentAnalysis[]
  account: AccountContext
  uptime: number
  env: 'sandbox' | 'production'
  isDelayed: boolean
  optionChain: OptionChainResponse | null
  requestChain: (ticker: string) => void
  sendRaw: (msg: unknown) => void
}

function getWsUrl(): string {
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return `${proto}//${window.location.hostname}:3001`
  }
  return `${proto}//${window.location.host}`
}

const WS_URL = getWsUrl()
const MAX_ALERTS = 200
const MAX_ANALYSES = 50

export function useMonitorSocket(): MonitorState {
  const [connected, setConnected] = useState(false)
  const [snapshots, setSnapshots] = useState<TickerSnapshot[]>([])
  const [alerts, setAlerts] = useState<OptionsAlert[]>([])
  const [analyses, setAnalyses] = useState<AgentAnalysis[]>([])
  const [account, setAccount] = useState<AccountContext>({
    netLiq: 0,
    buyingPower: 0,
    openPositions: [],
  })
  const [uptime, setUptime] = useState(0)
  const [env, setEnv] = useState<'sandbox' | 'production'>('sandbox')
  const [isDelayed, setIsDelayed] = useState(true)
  const [optionChain, setOptionChain] = useState<OptionChainResponse | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const requestChain = useCallback((ticker: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'requestChain', ticker }))
    }
  }, [])

  const sendRaw = useCallback((msg: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg))
    }
  }, [])

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
        const msg = JSON.parse(event.data as string)
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
            if (msg.data.env) setEnv(msg.data.env)
            if (msg.data.isDelayed != null) setIsDelayed(msg.data.isDelayed)
            break
          case 'optionChain':
            setOptionChain(msg.data)
            break
          case 'agent_analysis':
            setAnalyses(prev => [msg.data, ...prev].slice(0, MAX_ANALYSES))
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

  return { connected, snapshots, alerts, analyses, account, uptime, env, isDelayed, optionChain, requestChain, sendRaw }
}

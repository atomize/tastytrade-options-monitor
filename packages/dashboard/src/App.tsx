import { useState } from 'react'
import { useMonitorSocket } from './hooks/useMonitorSocket.js'
import { ConnectionStatus } from './components/ConnectionStatus.js'
import { WatchlistTable } from './components/WatchlistTable.js'
import { AlertFeed } from './components/AlertFeed.js'
import { PositionsPanel } from './components/PositionsPanel.js'
import { AgentExportPanel } from './components/AgentExportPanel.js'

type Tab = 'watchlist' | 'alerts' | 'positions' | 'agent'

export function App() {
  const { connected, snapshots, alerts, account, uptime, env, isDelayed } = useMonitorSocket()
  const [activeTab, setActiveTab] = useState<Tab>('watchlist')

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'watchlist', label: 'Watchlist', count: snapshots.length },
    { id: 'alerts', label: 'Alerts', count: alerts.length },
    { id: 'positions', label: 'Positions', count: account.openPositions.length },
    { id: 'agent', label: 'Agent Export' },
  ]

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-800 px-4 py-2 flex items-center justify-between bg-[#0f0f0f]">
        <div className="flex items-center gap-4">
          <h1 className="text-sm font-bold tracking-wider uppercase text-gray-300">
            tastytrade Monitor
          </h1>
          <ConnectionStatus connected={connected} uptime={uptime} env={env} isDelayed={isDelayed} />
        </div>
        <div className="flex items-center gap-4 font-mono text-xs">
          <span className="text-gray-500">Net Liq</span>
          <span className="text-green-400 font-semibold">
            ${account.netLiq.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </span>
          <span className="text-gray-600">|</span>
          <span className="text-gray-500">BP</span>
          <span className="text-blue-400">
            ${account.buyingPower.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </span>
        </div>
      </header>

      {/* Delayed data warning banner */}
      {isDelayed && (
        <div className="bg-amber-900/30 border-b border-amber-800/50 px-4 py-1.5 text-center text-[11px] text-amber-400 font-mono">
          SANDBOX — All market data is 15-minute delayed. Positions reset at midnight.
        </div>
      )}

      {/* Tab bar */}
      <nav className="border-b border-gray-800 px-4 flex gap-0 bg-[#0f0f0f]">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-xs font-medium uppercase tracking-wide border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-amber-500 text-amber-400'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            {tab.label}
            {tab.count != null && (
              <span className="ml-1.5 text-[10px] bg-gray-800 px-1.5 py-0.5 rounded">
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </nav>

      {/* Content */}
      <main className="flex-1 overflow-auto p-4">
        {activeTab === 'watchlist' && <WatchlistTable snapshots={snapshots} alerts={alerts} />}
        {activeTab === 'alerts' && <AlertFeed alerts={alerts} />}
        {activeTab === 'positions' && <PositionsPanel account={account} env={env} />}
        {activeTab === 'agent' && <AgentExportPanel alerts={alerts} />}
      </main>
    </div>
  )
}

import { useState } from 'react'
import type { AgentAnalysis } from '@tastytrade-monitor/shared'

interface Props {
  analyses: AgentAnalysis[]
}

export function AnalysisPanel({ analyses }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  if (analyses.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="inline-block bg-gray-900/50 border border-gray-800 rounded-lg px-8 py-6">
          <p className="text-gray-400 text-sm font-medium mb-2">
            No agent analyses yet
          </p>
          <p className="text-gray-600 text-xs max-w-sm">
            Start the pi agent to receive AI-powered trade analyses for each alert.
          </p>
          <pre className="mt-4 bg-black/50 rounded p-3 text-[11px] text-green-400 font-mono text-left">
            cd packages/pi-agent && pi
          </pre>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2 max-w-4xl">
      {analyses.map(a => {
        const isExpanded = expandedId === a.alertId + a.timestamp
        const key = a.alertId + a.timestamp

        return (
          <div
            key={key}
            className="border border-gray-800 rounded-lg overflow-hidden transition-colors hover:border-gray-700"
          >
            <button
              onClick={() => setExpandedId(isExpanded ? null : key)}
              className="w-full text-left px-4 py-3 flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <span className="font-mono font-semibold text-amber-400 text-sm">
                  {a.ticker}
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-900/40 text-purple-400 uppercase font-medium border border-purple-800/50">
                  {a.triggerType.replace(/_/g, ' ')}
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-500 font-mono">
                  {a.model}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-mono text-[10px] text-gray-600">
                  {new Date(a.timestamp).toLocaleTimeString()}
                </span>
                <span className="text-gray-600 text-xs">
                  {isExpanded ? '\u25B2' : '\u25BC'}
                </span>
              </div>
            </button>

            {isExpanded && (
              <div className="border-t border-gray-800 px-4 py-4 bg-[#0a0a0a]">
                <pre className="text-[11px] text-gray-300 whitespace-pre-wrap font-mono leading-relaxed max-h-[60vh] overflow-y-auto">
                  {a.analysis}
                </pre>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

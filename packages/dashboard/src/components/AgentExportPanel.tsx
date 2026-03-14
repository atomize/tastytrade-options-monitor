import { useState } from 'react'
import type { OptionsAlert } from '@tastytrade-monitor/shared'

interface Props {
  alerts: OptionsAlert[]
}

export function AgentExportPanel({ alerts }: Props) {
  const [copied, setCopied] = useState<string | null>(null)

  const lastAlert = alerts[0]

  async function copyText(text: string, label: string) {
    await navigator.clipboard.writeText(text)
    setCopied(label)
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <div className="max-w-3xl space-y-6">
      <section>
        <h2 className="text-sm font-semibold text-gray-300 mb-3 uppercase tracking-wider">
          Pipe to AI Agent
        </h2>
        <div className="bg-[#111] border border-gray-800 rounded-lg p-4 space-y-3">
          <p className="text-xs text-gray-500">
            Run the monitor in pipe mode and feed output to any CLI agent:
          </p>
          <CodeBlock>
            {`# Pipe to Claude CLI\nnpm run monitor:pipe | claude --system "You are an options desk trader..."\n\n# Pipe to any agent\nnpm run monitor:pipe | your-agent-cli`}
          </CodeBlock>
        </div>
      </section>

      {lastAlert && (
        <section>
          <h2 className="text-sm font-semibold text-gray-300 mb-3 uppercase tracking-wider">
            Last Alert — Agent Context
          </h2>
          <div className="bg-[#111] border border-gray-800 rounded-lg p-4">
            <div className="flex justify-between items-center mb-3">
              <span className="text-xs text-gray-500">
                {lastAlert.trigger.ticker} — {lastAlert.trigger.type} — {new Date(lastAlert.timestamp).toLocaleString()}
              </span>
              <button
                onClick={() => copyText(lastAlert.agentContext, 'context')}
                className="px-2 py-1 text-[10px] bg-amber-600 text-black rounded font-medium hover:bg-amber-500"
              >
                {copied === 'context' ? 'Copied!' : 'Copy Agent Context'}
              </button>
            </div>
            <pre className="text-[11px] text-gray-400 whitespace-pre-wrap font-mono leading-relaxed max-h-80 overflow-y-auto">
              {lastAlert.agentContext}
            </pre>
          </div>
        </section>
      )}

      <section>
        <h2 className="text-sm font-semibold text-gray-300 mb-3 uppercase tracking-wider">
          Export All Alerts
        </h2>
        <div className="flex gap-2">
          <button
            onClick={() => {
              const jsonl = alerts.map(a => JSON.stringify(a)).join('\n')
              copyText(jsonl, 'jsonl')
            }}
            disabled={alerts.length === 0}
            className="px-3 py-1.5 text-xs bg-gray-800 text-gray-300 rounded hover:bg-gray-700 disabled:opacity-40"
          >
            {copied === 'jsonl' ? 'Copied!' : `Copy as JSONL (${alerts.length} alerts)`}
          </button>
          <button
            onClick={() => {
              const blob = new Blob(
                [alerts.map(a => JSON.stringify(a)).join('\n')],
                { type: 'application/jsonl' }
              )
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = `alerts_${new Date().toISOString().split('T')[0]}.jsonl`
              a.click()
              URL.revokeObjectURL(url)
            }}
            disabled={alerts.length === 0}
            className="px-3 py-1.5 text-xs bg-gray-800 text-gray-300 rounded hover:bg-gray-700 disabled:opacity-40"
          >
            Download JSONL
          </button>
        </div>
      </section>
    </div>
  )
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="bg-black/50 rounded p-3 text-[11px] text-green-400 font-mono overflow-x-auto">
      {children}
    </pre>
  )
}

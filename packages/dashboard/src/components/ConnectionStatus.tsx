interface Props {
  connected: boolean
  uptime: number
}

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

export function ConnectionStatus({ connected, uptime }: Props) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span
        className={`w-2 h-2 rounded-full ${
          connected ? 'bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.5)]' : 'bg-red-500'
        }`}
      />
      <span className={connected ? 'text-green-400' : 'text-red-400'}>
        {connected ? 'Connected' : 'Disconnected'}
      </span>
      {connected && uptime > 0 && (
        <span className="text-gray-600 font-mono">{formatUptime(uptime)}</span>
      )}
    </div>
  )
}

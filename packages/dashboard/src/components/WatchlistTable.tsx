import { useState } from 'react'
import type { TickerSnapshot } from '@tastytrade-monitor/shared'

interface Props {
  snapshots: TickerSnapshot[]
}

type SortKey = 'ticker' | 'price' | 'priceChangePct1D' | 'ivRank' | 'layer' | 'volume'

export function WatchlistTable({ snapshots }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('layer')
  const [sortAsc, setSortAsc] = useState(true)
  const [filter, setFilter] = useState('')

  const filtered = snapshots.filter(s =>
    !filter || s.ticker.toLowerCase().includes(filter.toLowerCase()) ||
    (s.layer?.toLowerCase().includes(filter.toLowerCase()) ?? false)
  )

  const sorted = [...filtered].sort((a, b) => {
    let av: string | number, bv: string | number
    switch (sortKey) {
      case 'ticker': av = a.ticker; bv = b.ticker; break
      case 'price': av = a.price; bv = b.price; break
      case 'priceChangePct1D': av = a.priceChangePct1D; bv = b.priceChangePct1D; break
      case 'ivRank': av = a.ivRank ?? -1; bv = b.ivRank ?? -1; break
      case 'volume': av = a.volume; bv = b.volume; break
      case 'layer': av = a.layer ?? 'zzz'; bv = b.layer ?? 'zzz'; break
      default: av = 0; bv = 0
    }
    const cmp = av < bv ? -1 : av > bv ? 1 : 0
    return sortAsc ? cmp : -cmp
  })

  function handleSort(key: SortKey) {
    if (key === sortKey) setSortAsc(!sortAsc)
    else { setSortKey(key); setSortAsc(true) }
  }

  const SortHeader = ({ k, label }: { k: SortKey; label: string }) => (
    <th
      className="cursor-pointer hover:text-gray-300 select-none text-left"
      onClick={() => handleSort(k)}
    >
      {label} {sortKey === k ? (sortAsc ? '▲' : '▼') : ''}
    </th>
  )

  return (
    <div>
      <div className="mb-3">
        <input
          type="text"
          placeholder="Filter by ticker or layer..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="bg-[#111] border border-gray-800 rounded px-3 py-1.5 text-xs text-gray-300 w-64 focus:outline-none focus:border-amber-600"
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full font-mono">
          <thead>
            <tr>
              <SortHeader k="ticker" label="Ticker" />
              <SortHeader k="layer" label="Layer" />
              <SortHeader k="price" label="Price" />
              <th className="text-left">Bid</th>
              <th className="text-left">Ask</th>
              <SortHeader k="priceChangePct1D" label="Chg%" />
              <th className="text-left">Open</th>
              <th className="text-left">High</th>
              <th className="text-left">Low</th>
              <th className="text-left">52W Hi</th>
              <th className="text-left">52W Lo</th>
              <SortHeader k="ivRank" label="IV Rank" />
              <SortHeader k="volume" label="Volume" />
            </tr>
          </thead>
          <tbody>
            {sorted.map(s => (
              <tr
                key={s.ticker}
                className="hover:bg-gray-900/50 transition-colors"
              >
                <td className="font-semibold text-amber-400">{s.ticker}</td>
                <td className="text-gray-500 text-[11px] max-w-[160px] truncate">{s.layer ?? '-'}</td>
                <td>{fmtPrice(s.price)}</td>
                <td className="text-gray-500">{fmtPrice(s.bid)}</td>
                <td className="text-gray-500">{fmtPrice(s.ask)}</td>
                <td className={s.priceChangePct1D >= 0 ? 'text-green-400' : 'text-red-400'}>
                  {s.priceChangePct1D >= 0 ? '+' : ''}{s.priceChangePct1D.toFixed(2)}%
                </td>
                <td className="text-gray-500">{fmtPrice(s.dayOpen)}</td>
                <td className="text-gray-500">{fmtPrice(s.dayHigh)}</td>
                <td className="text-gray-500">{fmtPrice(s.dayLow)}</td>
                <td className="text-gray-500">{fmtPrice(s.high52Week)}</td>
                <td className="text-gray-500">{fmtPrice(s.low52Week)}</td>
                <td>{s.ivRank != null ? s.ivRank.toFixed(0) : <span className="text-gray-700">-</span>}</td>
                <td className="text-gray-500">{s.volume > 0 ? fmtVol(s.volume) : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {sorted.length === 0 && (
        <div className="text-center py-12 text-gray-600 text-sm">
          {snapshots.length === 0
            ? 'Waiting for market data...'
            : 'No tickers match your filter.'
          }
        </div>
      )}
    </div>
  )
}

function fmtPrice(v: number | undefined): string {
  if (v == null || v === 0) return '-'
  return `$${v.toFixed(2)}`
}

function fmtVol(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`
  return v.toString()
}

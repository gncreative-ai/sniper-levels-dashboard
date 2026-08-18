import type { SpotCandleDaily } from '../lib/types'
import {
  formatPrice,
  formatSessionDate,
  formatSessionWeekday,
  formatSignedPercent,
  formatVolume,
} from '../lib/format'

/**
 * Plain table of daily spot OHLC. Phase 1 is about proving the data is real and
 * correctly typed — charts arrive in phase 3.
 */
export function DailyCandleTable({ candles }: { candles: SpotCandleDaily[] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-zinc-800">
      <table className="w-full border-collapse text-right font-mono text-sm">
        <thead>
          <tr className="border-b border-zinc-800 bg-zinc-900/60 text-xs uppercase tracking-wider text-zinc-500">
            <th scope="col" className="px-3 py-2 text-left font-medium">Session</th>
            <th scope="col" className="px-3 py-2 text-left font-medium">Day</th>
            <th scope="col" className="px-3 py-2 font-medium">Open</th>
            <th scope="col" className="px-3 py-2 font-medium">High</th>
            <th scope="col" className="px-3 py-2 font-medium">Low</th>
            <th scope="col" className="px-3 py-2 font-medium">Close</th>
            <th scope="col" className="px-3 py-2 font-medium">Chg %</th>
            <th scope="col" className="px-3 py-2 font-medium">Volume</th>
          </tr>
        </thead>
        <tbody>
          {candles.map((candle) => {
            const changePct = candle.open === 0 ? 0 : ((candle.close - candle.open) / candle.open) * 100
            const up = candle.close >= candle.open

            return (
              <tr
                key={candle.candleDate}
                className="border-b border-zinc-900 last:border-b-0 hover:bg-zinc-900/50"
              >
                <td className="px-3 py-1.5 text-left text-zinc-300">
                  {formatSessionDate(candle.candleDate)}
                </td>
                <td className="px-3 py-1.5 text-left text-zinc-600">
                  {formatSessionWeekday(candle.candleDate)}
                </td>
                <td className="px-3 py-1.5 text-zinc-400">{formatPrice(candle.open)}</td>
                <td className="px-3 py-1.5 text-zinc-400">{formatPrice(candle.high)}</td>
                <td className="px-3 py-1.5 text-zinc-400">{formatPrice(candle.low)}</td>
                <td className={`px-3 py-1.5 font-medium ${up ? 'text-emerald-400' : 'text-red-400'}`}>
                  {formatPrice(candle.close)}
                </td>
                <td className={`px-3 py-1.5 ${up ? 'text-emerald-500/80' : 'text-red-500/80'}`}>
                  {formatSignedPercent(changePct)}
                </td>
                <td className="px-3 py-1.5 text-zinc-600">{formatVolume(candle.volume)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

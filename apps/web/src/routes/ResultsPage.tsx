import * as React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import type { ResultRow } from '@puzzle-arena/shared';
import { PixelButton, PixelPanel } from '../ui/primitives.js';
import { SeatAvatar } from '../ui/game-bits.js';
import { PODIUM_STEP_MS, RESULT_ROW_MS, stepTransition, useReducedMotion } from '../ui/motion.js';
import { seatColor } from '../ui/seat.js';
import { api } from '../net/socket.js';

export default function ResultsPage(): React.ReactElement {
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const [results, setResults] = React.useState<ResultRow[] | null>(null);
  const [notFound, setNotFound] = React.useState(false);

  React.useEffect(() => {
    void (async () => {
      const lookup = await api<{ id: string }>(`/api/rooms/${code.toUpperCase()}`);
      if (lookup.status !== 200) {
        setNotFound(true);
        return;
      }
      const res = await api<{ results: ResultRow[] }>(`/api/rooms/${lookup.body.id}/results`);
      if (res.status !== 200) {
        setNotFound(true);
        return;
      }
      setResults(res.body.results ?? []);
    })();
  }, [code]);

  return (
    <main className="min-h-screen p-4 md:p-8 max-w-4xl mx-auto flex flex-col gap-6">
      <h1 className="font-display text-pa-cyan" style={{ fontSize: 'clamp(20px, 6vw, 32px)' }}>
        RESULTS
      </h1>
      <PixelPanel title={`Room ${code.toUpperCase()}`}>
        {notFound ? (
          <div className="flex flex-col gap-3 items-start">
            <p className="text-pa-ink-dim">Room not found or results have expired.</p>
            <PixelButton onClick={() => navigate('/')}>Back to home</PixelButton>
          </div>
        ) : results ? (
          <ResultsTable results={results} />
        ) : (
          <p className="text-pa-ink-dim">Loading…</p>
        )}
      </PixelPanel>
      <PixelButton className="self-start" onClick={() => navigate('/')}>
        Back to home
      </PixelButton>
    </main>
  );
}

/** Podium rises 3rd, then 2nd, then 1st; the table reveals row by row. */
export function ResultsTable({ results }: { results: ResultRow[] }): React.ReactElement {
  const reduced = useReducedMotion();
  const podium = [...results].slice(0, 3);
  const order = [2, 1, 0]; // 3rd, 2nd, 1st

  const heights = ['h-32', 'h-24', 'h-16'];

  return (
    <div className="flex flex-col gap-8">
      {podium.length > 0 && (
        <div className="flex items-end justify-center gap-3">
          {[1, 0, 2].map((slot) => {
            const row = podium[slot];
            if (!row) return null;
            const delayIndex = order.indexOf(slot);
            return (
              <motion.div
                key={row.playerId}
                initial={reduced ? {} : { y: 40, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{
                  ...stepTransition(reduced ? 0 : PODIUM_STEP_MS),
                  delay: reduced ? 0 : (delayIndex * PODIUM_STEP_MS) / 1000,
                }}
                className="flex flex-col items-center gap-2"
              >
                <SeatAvatar
                  seat={row.seat}
                  displayName={row.displayName}
                  avatar={row.avatar}
                  isBot={row.isBot}
                  size={40}
                />
                <span className="font-display text-[10px] truncate max-w-[6rem]">
                  {row.displayName}
                </span>
                <div
                  className={`w-20 md:w-24 border-2 flex items-start justify-center pt-2 ${heights[slot]}`}
                  style={{
                    borderColor: seatColor(row.seat),
                    backgroundColor: 'var(--color-pa-surface)',
                  }}
                >
                  <span className="font-display text-[16px] tabular">{row.rank}</span>
                </div>
                <span className="font-display text-[12px] tabular text-pa-cyan">{row.score}</span>
              </motion.div>
            );
          })}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-[13px] tabular">
          <thead>
            <tr className="border-b-2 border-pa-border text-pa-ink-dim">
              <th className="text-left py-2 font-normal">#</th>
              <th className="text-left py-2 font-normal">Player</th>
              <th className="text-right py-2 font-normal">Score</th>
              <th className="text-right py-2 font-normal">Progress</th>
              <th className="text-right py-2 font-normal">Accuracy</th>
              <th className="text-right py-2 font-normal">Speed</th>
              <th className="text-right py-2 font-normal">Pen.</th>
              <th className="text-right py-2 font-normal">Finish</th>
            </tr>
          </thead>
          <tbody>
            {results.map((row, i) => (
              <motion.tr
                key={row.playerId}
                initial={reduced ? {} : { opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{
                  ...stepTransition(reduced ? 0 : RESULT_ROW_MS),
                  delay: reduced ? 0 : (i * RESULT_ROW_MS) / 1000,
                }}
                className="border-b border-pa-border"
              >
                <td className="py-2">{row.rank}</td>
                <td className="py-2">
                  <span className="flex items-center gap-2">
                    <SeatAvatar
                      seat={row.seat}
                      displayName={row.displayName}
                      avatar={row.avatar}
                      isBot={row.isBot}
                      size={20}
                    />
                    <span className="truncate max-w-[12rem]">{row.displayName}</span>
                  </span>
                </td>
                <td className="py-2 text-right font-display text-[10px]">{row.score}</td>
                <td className="py-2 text-right">{Math.round(row.progress * 100)}%</td>
                <td className="py-2 text-right">{Math.round(row.accuracy * 100)}%</td>
                <td className="py-2 text-right">{Math.round(row.speed * 100)}%</td>
                <td className="py-2 text-right">{row.penalties}</td>
                <td className="py-2 text-right">
                  {row.completedAtMs === null
                    ? '—'
                    : `${Math.floor(row.completedAtMs / 60000)}:${String(
                        Math.floor((row.completedAtMs % 60000) / 1000),
                      ).padStart(2, '0')}`}
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

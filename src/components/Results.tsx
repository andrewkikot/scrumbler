'use client';

import type { RoundStats } from '@/lib/types';

const format = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

type ResultsProps = {
  stats: RoundStats;
  showAverage: boolean;
};

export function Results({ stats, showAverage }: ResultsProps) {
  const peak = Math.max(1, ...stats.distribution.map((d) => d.count));

  return (
    <section className="px-panel p-5" aria-labelledby="results-heading">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 id="results-heading" className="text-[18px]">
          Results
        </h2>
        {stats.consensus && (
          <span
            className="px-chip px-pop"
            style={{ background: 'var(--color-lime)', color: 'var(--color-void-deep)' }}
          >
            Everyone agreed
          </span>
        )}
      </div>

      {showAverage && (
        <dl className="mb-5 flex flex-wrap gap-3">
          <div className="px-panel-sunken min-w-[104px] flex-1 p-3">
            <dt className="font-display text-[12px] text-[color:var(--color-ink-dim)]">Average</dt>
            <dd className="px-numeral text-[30px] text-[color:var(--color-gold)]">
              {stats.average === null ? '—' : format(stats.average)}
            </dd>
          </div>
          <div className="px-panel-sunken min-w-[104px] flex-1 p-3">
            <dt className="font-display text-[12px] text-[color:var(--color-ink-dim)]">Median</dt>
            <dd className="px-numeral text-[30px] text-[color:var(--color-teal)]">
              {stats.median === null ? '—' : format(stats.median)}
            </dd>
          </div>
          <div className="px-panel-sunken min-w-[104px] flex-1 p-3">
            <dt className="font-display text-[12px] text-[color:var(--color-ink-dim)]">Cards in</dt>
            <dd className="px-numeral text-[30px]">
              {stats.voted}
              <span className="text-[18px] text-[color:var(--color-ink-dim)]">/{stats.eligible}</span>
            </dd>
          </div>
        </dl>
      )}

      <ul className="flex flex-col gap-2">
        {stats.distribution.map((entry) => (
          <li key={entry.value} className="flex items-center gap-3">
            <span className="px-numeral w-10 shrink-0 text-right text-[17px]">{entry.value}</span>
            {/* Count bars are stepped in 4px blocks to stay on the pixel grid. */}
            <span className="px-panel-sunken h-5 flex-1 overflow-hidden">
              <span
                className="block h-full"
                style={{
                  width: `${(entry.count / peak) * 100}%`,
                  background:
                    entry.count === peak ? 'var(--color-gold)' : 'var(--color-edge-light)',
                }}
              />
            </span>
            <span className="px-numeral w-8 shrink-0 text-right text-[14px] text-[color:var(--color-ink-dim)]">
              {entry.count}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

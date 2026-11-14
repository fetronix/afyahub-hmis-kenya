import React from 'react';
import type { EquityModel } from '../../../partner-equity/model.ts';
import type { EquityResult } from '../../../partner-equity/calculations.ts';
const amount = (v: string | null) =>
  v === null
    ? 'Undefined'
    : Number(v).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Accessible SVG charts consume the very same calculated cells as the statement/export. */
export function PartnerEquityCharts({
  model,
  result,
}: {
  model: EquityModel;
  result: EquityResult;
}) {
  const partners = [...model.partners].sort(
    (a, b) => a.order - b.order || a.id.localeCompare(b.id),
  );
  const chart = (
    title: string,
    values: { label: string; value: string | null; secondary?: string | null }[],
    pct = false,
    waterfall = false,
  ) => {
    let cumulative = 0;
    const extents = waterfall
      ? values.map((v) => {
          cumulative =
            v.label === 'Closing equity (total)'
              ? Number(v.value ?? 0)
              : cumulative + Number(v.value ?? 0);
          return Math.abs(cumulative);
        })
      : [];
    const max = Math.max(
      ...extents,
      1,
      ...values.flatMap((v) => [
        Math.abs(Number(v.value ?? 0)),
        Math.abs(Number(v.secondary ?? 0)),
      ]),
    );
    let running = 0;
    return (
      <figure className="rounded-xl border bg-white p-4" key={title}>
        <figcaption className="mb-3 font-semibold">{title}</figcaption>
        <svg
          role="img"
          aria-label={title}
          viewBox={`0 0 640 ${values.length * 52 + 20}`}
          className="w-full"
        >
          <line x1="350" x2="350" y1="0" y2={values.length * 52} stroke="#94a3b8" />
          {values.map((v, i) => {
            const n = Number(v.value ?? 0),
              w = (Math.abs(n) / max) * 240,
              start = waterfall && v.label !== 'Closing equity (total)' ? running : 0;
            if (waterfall) running = start + n;
            return (
              <g
                key={v.label}
                tabIndex={0}
                aria-label={`${v.label}: ${amount(v.value)}${pct ? '%' : ' KES'}${v.secondary !== undefined ? ' / ' + amount(v.secondary) + ' KES' : ''}`}
              >
                <title>
                  {v.label}: {amount(v.value)}
                  {pct ? '%' : ' KES'}
                  {waterfall ? `; cumulative ${running.toFixed(2)} KES` : ''}
                </title>
                <text x="0" y={i * 52 + 18} fontSize="12">
                  {v.label.slice(0, 30)}
                </text>
                <rect
                  x={
                    waterfall
                      ? 350 + (Math.min(start, start + n) / max) * 240
                      : n < 0
                        ? 350 - w
                        : 350
                  }
                  y={i * 52 + 5}
                  width={w}
                  height="14"
                  fill={n < 0 ? '#dc2626' : '#047857'}
                />
                {v.secondary !== undefined && (
                  <rect
                    x={
                      Number(v.secondary) < 0
                        ? 350 - (Math.abs(Number(v.secondary)) / max) * 240
                        : 350
                    }
                    y={i * 52 + 23}
                    width={(Math.abs(Number(v.secondary ?? 0)) / max) * 240}
                    height="12"
                    fill="#2563eb"
                  />
                )}
                <text x="190" y={i * 52 + 46} fontSize="10">
                  {amount(v.value)}
                  {pct ? '%' : ''}
                  {v.secondary !== undefined ? ' → ' + amount(v.secondary) : ''}
                  {waterfall ? ` | cumulative ${(start + n).toFixed(2)}` : ''}
                </text>
              </g>
            );
          })}
        </svg>
        <details className="text-xs">
          <summary>Show chart values</summary>
          <ul>
            {values.map((v) => (
              <li key={v.label}>
                {v.label}: {amount(v.value)}
                {pct ? '%' : ' KES'}
                {v.secondary !== undefined ? ' → ' + amount(v.secondary) + ' KES' : ''}
              </li>
            ))}
          </ul>
        </details>
      </figure>
    );
  };
  const movement = [
    { label: 'Opening equity', value: result.totals.opening },
    { label: 'Additional capital', value: result.totals.capital },
    { label: 'Interest on capital', value: result.totals.interest },
    { label: 'Partner salaries', value: result.totals.salary },
    { label: 'Allocated profit/loss', value: result.totals.allocation },
    { label: 'Drawings', value: result.totals.drawings },
    { label: 'Tax', value: result.totals.tax },
    { label: 'Revaluation', value: result.totals.revaluation },
    { label: 'Other adjustments', value: result.totals.adjustments },
    { label: 'Closing equity (total)', value: result.totals.closing },
  ];
  return (
    <div aria-label="Partner equity executive charts" className="grid gap-4 xl:grid-cols-2">
      {chart(
        'Partner equity — opening versus closing',
        partners.map((p) => ({
          label: p.name,
          value: result.cells.opening[p.id],
          secondary: result.cells.closing[p.id],
        })),
      )}
      {chart(
        'Partner profit/loss allocation',
        partners.map((p) => ({ label: p.name, value: result.cells.allocation[p.id] })),
      )}
      {chart(
        'Partner ownership distribution — provisional calculation',
        partners.map((p) => ({ label: p.name, value: result.cells.ownership[p.id] })),
        true,
      )}
      {chart('Equity movement waterfall', movement, false, true)}
      {chart(
        'Partner closing equity comparison',
        partners.map((p) => ({ label: p.name, value: result.cells.closing[p.id] })),
      )}
    </div>
  );
}

/**
 * JaliCare HMIS
 * Partograph plot
 *
 * An inline SVG chart, drawn from the geometry the server computed.
 *
 * Why SVG and not a charting library: the deployed screen must render on
 * a facility laptop with no internet access. A canvas library adds a
 * hundred kilobytes and a CDN dependency to draw eleven points and two
 * straight lines.
 *
 * The chart plots what was recorded. It does not extrapolate past the
 * last reading, and it does not draw a line through points that were
 * never measured — an empty stretch means nobody examined her, not that
 * labour stood still.
 */

import React from 'react';

import type { PartographPlot } from '../../api/client.ts';

const WIDTH = 760;
const HEIGHT = 360;
const PAD = { top: 18, right: 18, bottom: 40, left: 46 };

const PLOT_W = WIDTH - PAD.left - PAD.right;
const PLOT_H = HEIGHT - PAD.top - PAD.bottom;

const MAX_CM = 10;

export const PartographChart: React.FC<{ plot: PartographPlot }> = ({ plot }) => {
  const maxHour = Math.max(1, plot.maxHour);

  const x = (hour: number) => PAD.left + (Math.max(0, Math.min(hour, maxHour)) / maxHour) * PLOT_W;

  const y = (cm: number) =>
    PAD.top + PLOT_H - (Math.max(0, Math.min(cm, MAX_CM)) / MAX_CM) * PLOT_H;

  const plotted = plot.readings.filter(
    (reading): reading is typeof reading & { dilatationCm: number } =>
      typeof reading.dilatationCm === 'number',
  );

  const points = plotted.map((reading) => ({
    ...reading,
    cx: x(reading.hoursSinceAdmission),
    cy: y(reading.dilatationCm),
  }));

  const polyline = points.map((point) => `${point.cx},${point.cy}`).join(' ');

  /* A tick every hour, labelled every two unless the axis gets long. */
  const hourStep = maxHour <= 16 ? 1 : maxHour <= 30 ? 2 : 4;
  const labelStep = hourStep * 2;

  const hourTicks: number[] = [];

  for (let hour = 0; hour <= maxHour; hour += hourStep) hourTicks.push(hour);

  const cmTicks = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  const description =
    plotted.length === 0
      ? 'Partograph chart. No cervical dilatation has been plotted yet.'
      : `Partograph chart. ${plotted.length} plotted ${plotted.length === 1 ? 'reading' : 'readings'}; latest ${plotted.at(-1)?.dilatationCm} cm at ${plotted.at(-1)?.hoursSinceAdmission} h after admission. ${plot.zone}.`;

  return (
    <figure className="rounded-xl border border-slate-200 bg-white p-3">
      <figcaption className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold text-slate-800">Cervical dilatation against time</h3>

        <div className="flex flex-wrap items-center gap-3 text-2xs text-slate-600">
          <span className="inline-flex items-center gap-1.5">
            <svg width="18" height="8" aria-hidden="true">
              <line x1="0" y1="4" x2="18" y2="4" stroke="#0f766e" strokeWidth="2.5" />
            </svg>
            Readings
          </span>
          <span className="inline-flex items-center gap-1.5">
            <svg width="18" height="8" aria-hidden="true">
              <line
                x1="0"
                y1="4"
                x2="18"
                y2="4"
                stroke="#b45309"
                strokeWidth="2"
                strokeDasharray="5 3"
              />
            </svg>
            Alert line
          </span>
          <span className="inline-flex items-center gap-1.5">
            <svg width="18" height="8" aria-hidden="true">
              <line
                x1="0"
                y1="4"
                x2="18"
                y2="4"
                stroke="#be123c"
                strokeWidth="2"
                strokeDasharray="2 3"
              />
            </svg>
            Action line
          </span>
        </div>
      </figcaption>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full"
        role="img"
        aria-label={description}
      >
        <title>Partograph: cervical dilatation in centimetres by hours since admission</title>

        {/* Plot frame */}
        <rect
          x={PAD.left}
          y={PAD.top}
          width={PLOT_W}
          height={PLOT_H}
          fill="#f8fafc"
          stroke="#cbd5e1"
        />

        {/* Horizontal grid, one centimetre apart */}
        {cmTicks.map((cm) => (
          <g key={`cm-${cm}`}>
            <line
              x1={PAD.left}
              y1={y(cm)}
              x2={PAD.left + PLOT_W}
              y2={y(cm)}
              stroke={cm === 4 ? '#94a3b8' : '#e2e8f0'}
              strokeWidth={cm === 4 ? 1.2 : 1}
            />
            <text x={PAD.left - 8} y={y(cm) + 3} textAnchor="end" fontSize="10" fill="#475569">
              {cm}
            </text>
          </g>
        ))}

        {/* Vertical grid, one hour apart */}
        {hourTicks.map((hour) => (
          <g key={`h-${hour}`}>
            <line
              x1={x(hour)}
              y1={PAD.top}
              x2={x(hour)}
              y2={PAD.top + PLOT_H}
              stroke="#e2e8f0"
              strokeWidth="1"
            />
            {hour % labelStep === 0 && (
              <text
                x={x(hour)}
                y={PAD.top + PLOT_H + 16}
                textAnchor="middle"
                fontSize="10"
                fill="#475569"
              >
                {hour}
              </text>
            )}
          </g>
        ))}

        {/* Axis labels */}
        <text
          x={PAD.left + PLOT_W / 2}
          y={HEIGHT - 6}
          textAnchor="middle"
          fontSize="10.5"
          fill="#334155"
        >
          Hours since admission
        </text>
        <text
          x={12}
          y={PAD.top + PLOT_H / 2}
          textAnchor="middle"
          fontSize="10.5"
          fill="#334155"
          transform={`rotate(-90 12 ${PAD.top + PLOT_H / 2})`}
        >
          Dilatation (cm)
        </text>

        {/* Alert line */}
        {plot.alertLine && (
          <line
            x1={x(plot.alertLine.startHour)}
            y1={y(plot.alertLine.startCm)}
            x2={x(plot.alertLine.endHour)}
            y2={y(plot.alertLine.endCm)}
            stroke="#b45309"
            strokeWidth="2"
            strokeDasharray="6 3"
          />
        )}

        {/* Action line */}
        {plot.actionLine && (
          <line
            x1={x(plot.actionLine.startHour)}
            y1={y(plot.actionLine.startCm)}
            x2={x(plot.actionLine.endHour)}
            y2={y(plot.actionLine.endCm)}
            stroke="#be123c"
            strokeWidth="2"
            strokeDasharray="2 3"
          />
        )}

        {/* The readings */}
        {points.length > 1 && (
          <polyline
            points={polyline}
            fill="none"
            stroke="#0f766e"
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}

        {points.map((point, index) => (
          <g key={`${point.recordedAt}-${index}`}>
            <circle cx={point.cx} cy={point.cy} r="4.5" fill="#0f766e" />
            <circle cx={point.cx} cy={point.cy} r="2" fill="#ffffff" />
            <title>
              {`${point.dilatationCm} cm at ${point.hoursSinceAdmission} h (${point.recordedAt.replace('T', ' ').slice(0, 16)})`}
            </title>
          </g>
        ))}

        {points.length === 0 && (
          <text
            x={PAD.left + PLOT_W / 2}
            y={PAD.top + PLOT_H / 2}
            textAnchor="middle"
            fontSize="12"
            fill="#64748b"
          >
            No cervical dilatation recorded yet
          </text>
        )}
      </svg>

      <p className="mt-2 text-2xs leading-relaxed text-slate-500">{plot.note}</p>
    </figure>
  );
};

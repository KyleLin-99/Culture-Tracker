import { useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';

import type { TrendPoint } from '@/domain/trend';

import { colors } from './theme';

const H = 200;
const PAD = { left: 36, right: 12, top: 22, bottom: 40 };

/** Where a date falls along the chart, between bucket starts (0 = first bucket). */
function position(points: TrendPoint[], date: string): number | null {
  if (!points.length || date < points[0].start) return null;
  for (let i = 0; i < points.length; i += 1) {
    const end = points[i + 1]?.start;
    if (!end || date < end) {
      const start = new Date(points[i].start).getTime();
      const span = end ? new Date(end).getTime() - start : 7 * 86400000;
      return i + Math.min(1, (new Date(date).getTime() - start) / span);
    }
  }
  return null;
}

/**
 * Contamination % per week or month as a line, plates made under each point,
 * and numbered dashed lines where technique changes happened.
 */
export function TrendChart({ points, markers }: { points: TrendPoint[]; markers: { n: number; date: string }[] }) {
  const [width, setWidth] = useState(0);
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = H - PAD.top - PAD.bottom;
  const step = points.length > 1 ? plotW / (points.length - 1) : 0;
  const x = (i: number) => PAD.left + (points.length > 1 ? i * step : plotW / 2);
  const max = Math.max(0.1, ...points.map((p) => p.rate ?? 0));
  const top = Math.min(1, Math.ceil(max * 10) / 10);
  const y = (rate: number) => PAD.top + plotH - (rate / top) * plotH;
  const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(1, Math.floor(plotW / 44))));

  // Gaps (no plates) break the line.
  let d = '';
  let pen = false;
  points.forEach((p, i) => {
    if (p.rate === null) {
      pen = false;
      return;
    }
    d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.rate).toFixed(1)} `;
    pen = true;
  });

  const summary = points
    .filter((p) => p.total)
    .map((p) => `${p.label}: ${Math.round((p.rate ?? 0) * 100)}% of ${p.total}`)
    .join('; ');

  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      testID="trend-chart"
      accessibilityLabel={`Contamination over time. ${summary || 'No plates yet.'}`}
      style={{ backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border }}
    >
      {width > 0 && (
        <Svg width={width} height={H}>
          {[0, top / 2, top].map((t) => (
            <Line key={t} x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke={colors.border} strokeWidth={1} />
          ))}
          {[0, top / 2, top].map((t) => (
            <SvgText key={`l${t}`} x={PAD.left - 6} y={y(t) + 4} fontSize={11} fill={colors.muted} textAnchor="end">
              {`${Math.round(t * 100)}%`}
            </SvgText>
          ))}

          {markers.map((m) => {
            const pos = position(points, m.date);
            if (pos === null) return null;
            const mx = points.length > 1 ? PAD.left + pos * step : PAD.left + plotW / 2;
            return (
              <SvgText key={`m${m.n}`} x={mx} y={PAD.top - 8} fontSize={12} fontWeight="bold" fill={colors.warn} textAnchor="middle">
                {String(m.n)}
              </SvgText>
            );
          })}
          {markers.map((m) => {
            const pos = position(points, m.date);
            if (pos === null) return null;
            const mx = points.length > 1 ? PAD.left + pos * step : PAD.left + plotW / 2;
            return (
              <Line
                key={`ml${m.n}`}
                x1={mx}
                x2={mx}
                y1={PAD.top - 4}
                y2={PAD.top + plotH}
                stroke={colors.warn}
                strokeWidth={1.5}
                strokeDasharray="4,3"
              />
            );
          })}

          <Path d={d} stroke={colors.danger} strokeWidth={2.5} fill="none" />
          {points.map((p, i) =>
            p.rate === null ? null : <Circle key={p.start} cx={x(i)} cy={y(p.rate)} r={3.5} fill={colors.danger} />,
          )}

          {points.map((p, i) =>
            i % labelEvery === 0 ? (
              <SvgText key={`x${p.start}`} x={x(i)} y={H - PAD.bottom + 16} fontSize={11} fill={colors.text} textAnchor="middle">
                {p.label}
              </SvgText>
            ) : null,
          )}
          {points.map((p, i) =>
            i % labelEvery === 0 ? (
              <SvgText key={`n${p.start}`} x={x(i)} y={H - PAD.bottom + 30} fontSize={10} fill={colors.muted} textAnchor="middle">
                {p.total ? `n=${p.total}` : '–'}
              </SvgText>
            ) : null,
          )}
        </Svg>
      )}
    </View>
  );
}

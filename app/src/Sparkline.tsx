import React from 'react';
import { View } from 'react-native';
import Svg, { Polyline, Line } from 'react-native-svg';
import { theme } from './theme';

/**
 * Lightweight price graph for a holding. Renders a closing-price line over the
 * provided history, colored green/red by net direction, with a faint baseline.
 */
export function Sparkline({
  data,
  width = 300,
  height = 64,
  color,
}: {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
}) {
  if (!data || data.length < 2) {
    return <View style={{ width, height }} />;
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pad = 3;
  const x = (i: number) => (i / (data.length - 1)) * (width - pad * 2) + pad;
  const y = (v: number) => height - pad - ((v - min) / span) * (height - pad * 2);
  const points = data.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  const up = data[data.length - 1]! >= data[0]!;
  const stroke = color ?? (up ? theme.green : theme.red);
  const baseY = y(data[0]!);

  return (
    <Svg width={width} height={height}>
      <Line x1={pad} y1={baseY} x2={width - pad} y2={baseY} stroke={theme.border} strokeWidth={1} strokeDasharray="3 3" />
      <Polyline points={points} fill="none" stroke={stroke} strokeWidth={2} />
    </Svg>
  );
}

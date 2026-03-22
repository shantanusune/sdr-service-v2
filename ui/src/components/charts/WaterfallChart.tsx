import React, { useCallback, useEffect, useRef } from 'react';
import type { SpectrumFrame } from '@/types/sdr';

interface WaterfallChartProps {
  frame: SpectrumFrame | null;
  title?: string;
  width?: number;
  height?: number;
  maxRows?: number;
  className?: string;
}

interface WaterfallRow {
  ts: number;
  bins: Float32Array;
  signature: string;
}

const WATERFALL_STOPS = [
  { pos: 0.0, rgb: [4, 10, 26] },
  { pos: 0.15, rgb: [15, 37, 88] },
  { pos: 0.35, rgb: [29, 97, 170] },
  { pos: 0.55, rgb: [34, 169, 170] },
  { pos: 0.72, rgb: [84, 196, 86] },
  { pos: 0.86, rgb: [234, 202, 74] },
  { pos: 0.94, rgb: [240, 120, 56] },
  { pos: 1.0, rgb: [245, 245, 245] },
] as const;

const WATERFALL_PALETTE: Array<[number, number, number]> = buildPalette();
const GRID_COLOR = 'rgba(200, 210, 230, 0.22)';
const AXIS_COLOR = 'rgba(215, 225, 240, 0.9)';
const LABEL_COLOR = 'rgba(190, 205, 225, 0.9)';

function buildPalette(size = 256): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];

  for (let i = 0; i < size; i++) {
    const t = i / (size - 1);
    let left = WATERFALL_STOPS[0];
    let right = WATERFALL_STOPS[WATERFALL_STOPS.length - 1];

    for (let s = 0; s < WATERFALL_STOPS.length; s++) {
      if (WATERFALL_STOPS[s].pos <= t) {
        left = WATERFALL_STOPS[s];
      }
      if (WATERFALL_STOPS[s].pos >= t) {
        right = WATERFALL_STOPS[s];
        break;
      }
    }

    if (left.pos === right.pos) {
      out.push([left.rgb[0], left.rgb[1], left.rgb[2]]);
      continue;
    }

    const localT = (t - left.pos) / (right.pos - left.pos);
    const r = Math.round(left.rgb[0] + (right.rgb[0] - left.rgb[0]) * localT);
    const g = Math.round(left.rgb[1] + (right.rgb[1] - left.rgb[1]) * localT);
    const b = Math.round(left.rgb[2] + (right.rgb[2] - left.rgb[2]) * localT);
    out.push([r, g, b]);
  }

  return out;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function computeDbRange(rows: WaterfallRow[]): { minDb: number; maxDb: number; dbRange: number } {
  const values: number[] = [];

  for (const row of rows) {
    const bins = row.bins;
    for (let i = 0; i < bins.length; i++) {
      const value = bins[i];
      if (!Number.isFinite(value) || value < -220 || value > 120) {
        continue;
      }
      values.push(value);
    }
  }

  if (values.length === 0) {
    return { minDb: -120, maxDb: 10, dbRange: 130 };
  }

  values.sort((a, b) => a - b);
  const p10 = values[Math.floor(values.length * 0.1)];
  const p98 = values[Math.floor(values.length * 0.98)];

  let minDb = Number.isFinite(p10) ? p10 : values[0];
  let maxDb = Number.isFinite(p98) ? p98 : values[values.length - 1];

  // Keep sane waterfall range for visual contrast.
  minDb = Math.max(-180, minDb - 4);
  maxDb = Math.min(40, maxDb + 2);

  minDb = Math.floor(minDb / 5) * 5;
  maxDb = Math.ceil(maxDb / 5) * 5;

  if (maxDb - minDb < 20) {
    maxDb = minDb + 20;
  }

  return {
    minDb,
    maxDb,
    dbRange: maxDb - minDb,
  };
}

function frameSignature(frame: SpectrumFrame): string {
  const bins = frame.binsDbm;
  const n = bins.length;
  const a = n > 0 ? Number(bins[0]) : 0;
  const b = n > 1 ? Number(bins[Math.floor(n / 2)]) : 0;
  const c = n > 0 ? Number(bins[n - 1]) : 0;
  return `${frame.ts}:${frame.frameId ?? ''}:${frame.centerHz}:${frame.spanHz}:${n}:${a.toFixed(2)}:${b.toFixed(2)}:${c.toFixed(2)}`;
}

export const WaterfallChart: React.FC<WaterfallChartProps> = ({
  frame,
  title,
  width = 900,
  height = 360,
  maxRows = 512,
  className,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rowsRef = useRef<WaterfallRow[]>([]);
  const lastSignatureRef = useRef<string>('');

  const drawChart = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);

    const padding = { top: 28, right: 58, bottom: 48, left: 34 };
    const colorBarWidth = 12;
    const colorBarGap = 10;
    const chartWidth = Math.max(1, Math.floor(width - padding.left - padding.right));
    const chartHeight = Math.max(1, Math.floor(height - padding.top - padding.bottom));

    const rows = rowsRef.current;
    if (rows.length === 0) {
      ctx.fillStyle = LABEL_COLOR;
      ctx.font = '12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Waiting for raw IQ frames...', width / 2, height / 2);
      return;
    }

    const { minDb, maxDb, dbRange } = computeDbRange(rows);

    const image = ctx.createImageData(chartWidth, chartHeight);
    const pixels = image.data;

    const visibleRows = Math.min(chartHeight, rows.length);
    const startIndex = Math.max(0, rows.length - visibleRows);
    for (let dy = 0; dy < visibleRows; dy++) {
      const rowIndex = startIndex + dy;
      const row = rows[rowIndex];
      const bins = row.bins;
      const binsLen = bins.length;
      const y = dy; // oldest at top, newest at bottom

      for (let x = 0; x < chartWidth; x++) {
        const binIndex = Math.min(binsLen - 1, Math.floor((x / chartWidth) * binsLen));
        const db = bins[binIndex];
        const normalized = Number.isFinite(db) ? (db - minDb) / dbRange : 0;
        const paletteIndex = clamp(Math.round(normalized * 255), 0, 255);
        const [r, g, b] = WATERFALL_PALETTE[paletteIndex];

        const px = (y * chartWidth + x) * 4;
        pixels[px] = r;
        pixels[px + 1] = g;
        pixels[px + 2] = b;
        pixels[px + 3] = 255;
      }
    }

    ctx.putImageData(image, Math.round(padding.left), Math.round(padding.top));

    // Grid overlay
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 1;
    for (let i = 0; i <= 10; i++) {
      const x = padding.left + (chartWidth * i) / 10;
      ctx.beginPath();
      ctx.moveTo(x, padding.top);
      ctx.lineTo(x, padding.top + chartHeight);
      ctx.stroke();
    }
    for (let i = 0; i <= 10; i++) {
      const y = padding.top + (chartHeight * i) / 10;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(padding.left + chartWidth, y);
      ctx.stroke();
    }

    const latest = rows[rows.length - 1];
    const oldest = rows[0];

    // Border
    ctx.strokeStyle = AXIS_COLOR;
    ctx.lineWidth = 1;
    ctx.strokeRect(padding.left, padding.top, chartWidth, chartHeight);

    // Color bar
    const cbX = padding.left + chartWidth + colorBarGap;
    const cbY = padding.top;
    const gradient = ctx.createLinearGradient(0, cbY, 0, cbY + chartHeight);
    gradient.addColorStop(0.0, 'rgb(245,245,245)');
    gradient.addColorStop(0.1, 'rgb(240,120,56)');
    gradient.addColorStop(0.25, 'rgb(234,202,74)');
    gradient.addColorStop(0.45, 'rgb(84,196,86)');
    gradient.addColorStop(0.65, 'rgb(34,169,170)');
    gradient.addColorStop(0.82, 'rgb(29,97,170)');
    gradient.addColorStop(1.0, 'rgb(4,10,26)');
    ctx.fillStyle = gradient;
    ctx.fillRect(cbX, cbY, colorBarWidth, chartHeight);
    ctx.strokeStyle = AXIS_COLOR;
    ctx.strokeRect(cbX, cbY, colorBarWidth, chartHeight);

    // Title
    ctx.fillStyle = AXIS_COLOR;
    ctx.font = '24px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(title || 'Waterfall History', width / 2, 22);

    // Axes labels and ticks
    ctx.fillStyle = LABEL_COLOR;
    ctx.font = '11px monospace';
    const yTicks = 10;
    ctx.textAlign = 'right';
    for (let i = 0; i <= yTicks; i++) {
      const ratio = i / yTicks;
      const y = padding.top + chartHeight * ratio;
      const sweep = -Math.round(visibleRows - (visibleRows - 1) * ratio);
      ctx.fillText(`${sweep}`, padding.left - 6, y + 4);
    }

    ctx.save();
    ctx.translate(12, padding.top + chartHeight / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText('Sweep', 0, 0);
    ctx.restore();

    if (frame && Number.isFinite(frame.centerHz) && Number.isFinite(frame.spanHz) && frame.spanHz > 0) {
      const startMHz = (frame.centerHz - frame.spanHz / 2) / 1e6;
      const endMHz = (frame.centerHz + frame.spanHz / 2) / 1e6;

      ctx.textAlign = 'center';
      for (let i = 0; i <= 10; i++) {
        const x = padding.left + (chartWidth * i) / 10;
        const freq = startMHz + ((endMHz - startMHz) * i) / 10;
        ctx.fillText(`${freq.toFixed(2)} MHz`, x, height - 10);
      }

      ctx.textAlign = 'center';
      ctx.fillText('Frequency', padding.left + chartWidth / 2, height - 24);

      ctx.textAlign = 'left';
      ctx.fillText(`Start: ${startMHz.toFixed(0)} MHz`, 4, height - 2);

      ctx.textAlign = 'right';
      ctx.fillText(`Stop: ${endMHz.toFixed(0)} MHz`, width - 4, height - 2);
    }

    // Color bar dB labels
    ctx.textAlign = 'left';
    ctx.fillText(`${maxDb.toFixed(0)} dB`, cbX + colorBarWidth + 4, cbY + 10);
    ctx.fillText(`${((maxDb + minDb) / 2).toFixed(0)} dB`, cbX + colorBarWidth + 4, cbY + chartHeight / 2 + 4);
    ctx.fillText(`${minDb.toFixed(0)} dB`, cbX + colorBarWidth + 4, cbY + chartHeight - 2);

    const spanSec = Math.max(0, (latest.ts - oldest.ts) / 1000);
    ctx.textAlign = 'left';
    ctx.fillText(`History ${spanSec.toFixed(1)}s`, padding.left, padding.top - 8);
  }, [frame, width, height, title]);

  useEffect(() => {
    if (!frame || !frame.binsDbm || frame.binsDbm.length === 0) {
      drawChart();
      return;
    }

    const signature = frameSignature(frame);
    if (signature === lastSignatureRef.current) {
      return;
    }
    lastSignatureRef.current = signature;

    rowsRef.current.push({
      ts: Number.isFinite(frame.ts) ? frame.ts : Date.now(),
      bins: Float32Array.from(frame.binsDbm),
      signature,
    });

    if (rowsRef.current.length > maxRows) {
      rowsRef.current = rowsRef.current.slice(rowsRef.current.length - maxRows);
    }

    drawChart();
  }, [frame, maxRows, drawChart]);

  useEffect(() => {
    drawChart();
  }, [drawChart]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width, height }}
      className={className || 'rounded-lg border border-border/40'}
    />
  );
};

export default WaterfallChart;

import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import type { SpectrumFrame } from '@/types/sdr';

interface WaterfallChartProps {
  frame: SpectrumFrame | null;
  title?: string;
  width?: number | string;
  height?: number | string;
  maxRows?: number;
  className?: string;
}

interface WaterfallRow {
  ts: number;
  bins: Float32Array;
}

const APPEND_INTERVAL_MS = 80;
const MAX_VISIBLE_POINTS = 90000;
const MAX_TARGET_BINS = 640;
const MIN_TARGET_BINS = 192;
const MAX_SAMPLED_VALUES = 24000;
const GRID_COLOR = 'rgba(180, 195, 220, 0.20)';
const COLOR_SCALE = [
  '#05245f',
  '#0b3f8f',
  '#1165c5',
  '#11a1d7',
  '#20c88e',
  '#8fda4a',
  '#f1d13f',
  '#f49532',
  '#f25224',
  '#fff2e8',
];

function resolveTargetBins(sourceBins: number): number {
  if (sourceBins <= MIN_TARGET_BINS) {
    return sourceBins;
  }
  const bounded = Math.min(MAX_TARGET_BINS, sourceBins);
  return Math.max(MIN_TARGET_BINS, Math.floor(bounded / 8) * 8);
}

function resolveRowLimit(maxRows: number, binsCount: number): number {
  const budgetRows = Math.max(80, Math.floor(MAX_VISIBLE_POINTS / Math.max(1, binsCount)));
  return Math.max(80, Math.min(maxRows, 260, budgetRows));
}

function downsampleBins(source: number[] | Float32Array, targetBins: number): Float32Array {
  const sourceBins = source.length;
  if (sourceBins === 0 || targetBins <= 0) {
    return new Float32Array(0);
  }

  if (sourceBins === targetBins) {
    return Float32Array.from(source);
  }

  const out = new Float32Array(targetBins);

  if (sourceBins < targetBins) {
    const ratio = sourceBins / targetBins;
    for (let i = 0; i < targetBins; i++) {
      const srcIndex = Math.min(sourceBins - 1, Math.floor(i * ratio));
      const value = Number(source[srcIndex]);
      out[i] = Number.isFinite(value) ? value : -140;
    }
    return out;
  }

  const ratio = sourceBins / targetBins;
  for (let i = 0; i < targetBins; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.max(start + 1, Math.min(sourceBins, Math.floor((i + 1) * ratio)));
    let sum = 0;
    let count = 0;
    let max = -Infinity;
    for (let j = start; j < end; j++) {
      const value = Number(source[j]);
      if (!Number.isFinite(value)) {
        continue;
      }
      sum += value;
      count++;
      if (value > max) {
        max = value;
      }
    }

    if (count === 0) {
      out[i] = -140;
      continue;
    }

    const avg = sum / count;
    out[i] = avg * 0.65 + max * 0.35;
  }

  return out;
}

function frameSignature(frame: SpectrumFrame): string {
  const bins = frame.binsDbm;
  const n = bins.length;
  const first = n > 0 ? Number(bins[0]) : 0;
  const mid = n > 1 ? Number(bins[Math.floor(n / 2)]) : 0;
  const last = n > 0 ? Number(bins[n - 1]) : 0;
  return `${frame.ts}:${frame.centerHz}:${frame.spanHz}:${n}:${first.toFixed(2)}:${mid.toFixed(2)}:${last.toFixed(2)}`;
}

function computeDbRange(rows: WaterfallRow[]): { minDb: number; maxDb: number } {
  const values: number[] = [];

  const totalBins = rows.reduce((sum, row) => sum + row.bins.length, 0);
  const stepHint = Math.max(1, Math.floor(totalBins / MAX_SAMPLED_VALUES));

  for (const row of rows) {
    const bins = row.bins;
    const step = Math.max(
      stepHint,
      bins.length > 4096 ? 16 : bins.length > 2048 ? 8 : bins.length > 1024 ? 4 : bins.length > 512 ? 2 : 1
    );
    for (let i = 0; i < bins.length; i += step) {
      const value = bins[i];
      if (!Number.isFinite(value) || value < -220 || value > 120) {
        continue;
      }
      values.push(value);
    }
  }

  if (values.length === 0) {
    return { minDb: -120, maxDb: 10 };
  }

  values.sort((a, b) => a - b);

  const p05 = values[Math.max(0, Math.floor(values.length * 0.05))];
  const p995 = values[Math.max(0, Math.floor(values.length * 0.995) - 1)];

  let minDb = Number.isFinite(p05) ? p05 - 3 : values[0];
  let maxDb = Number.isFinite(p995) ? p995 + 2 : values[values.length - 1];

  minDb = Math.max(-180, Math.floor(minDb / 5) * 5);
  maxDb = Math.min(40, Math.ceil(maxDb / 5) * 5);

  if (maxDb - minDb < 20) {
    maxDb = minDb + 20;
  }

  return { minDb, maxDb };
}

export const WaterfallChart: React.FC<WaterfallChartProps> = ({
  frame,
  title,
  width = '100%',
  height = 360,
  maxRows = 220,
  className,
}) => {
  const [rows, setRows] = useState<WaterfallRow[]>([]);
  const lastSigRef = useRef('');
  const lastAppendRef = useRef(0);
  const metaRef = useRef<{ sourceBins: number; targetBins: number; centerHz: number; spanHz: number } | null>(null);

  useEffect(() => {
    if (!frame || !frame.binsDbm || frame.binsDbm.length === 0) {
      return;
    }

    const now = Date.now();
    if (now - lastAppendRef.current < APPEND_INTERVAL_MS) {
      return;
    }

    const signature = frameSignature(frame);
    if (signature === lastSigRef.current) {
      return;
    }

    const sourceBins = frame.binsDbm.length;
    const targetBins = resolveTargetBins(sourceBins);
    const currentMeta = metaRef.current;
    const freqChanged =
      currentMeta !== null &&
      (currentMeta.sourceBins !== sourceBins ||
        currentMeta.targetBins !== targetBins ||
        Math.abs(currentMeta.centerHz - frame.centerHz) > Math.max(1, frame.binHz) ||
        Math.abs(currentMeta.spanHz - frame.spanHz) > Math.max(1, frame.binHz));

    metaRef.current = {
      sourceBins,
      targetBins,
      centerHz: frame.centerHz,
      spanHz: frame.spanHz,
    };

    lastSigRef.current = signature;
    lastAppendRef.current = now;

    const downsampledBins = downsampleBins(frame.binsDbm, targetBins);
    const rowLimit = resolveRowLimit(maxRows, downsampledBins.length);

    setRows((prev) => {
      const nextBase = freqChanged ? [] : prev;
      const next = [...nextBase, { ts: Number.isFinite(frame.ts) ? frame.ts : now, bins: downsampledBins }];
      return next.length > rowLimit ? next.slice(next.length - rowLimit) : next;
    });
  }, [frame, maxRows]);

  const option: EChartsOption = useMemo(() => {
    if (!frame || rows.length === 0) {
      return {
        backgroundColor: '#000000',
        title: {
          text: title || 'Waterfall History',
          left: 'center',
          top: 6,
          textStyle: { color: '#b8c2d6', fontSize: 16, fontWeight: 500 },
        },
      };
    }

    const binsCount = Math.max(1, rows[rows.length - 1]?.bins.length ?? frame.binsDbm.length);
    const rowCount = rows.length;
    const { minDb, maxDb } = computeDbRange(rows);
    const startHz = frame.centerHz - frame.spanHz / 2;
    const endHz = frame.centerHz + frame.spanHz / 2;
    const startMHz = startHz / 1e6;
    const endMHz = endHz / 1e6;

    const totalPoints = rowCount * binsCount;
    const heatmapData: number[][] = new Array(totalPoints);
    let cursor = 0;
    for (let r = 0; r < rowCount; r++) {
      const bins = rows[r].bins;
      for (let x = 0; x < binsCount; x++) {
        const v = Number(bins[x]);
        heatmapData[cursor++] = [x, r, Number.isFinite(v) ? v : minDb];
      }
    }
    if (cursor < heatmapData.length) {
      heatmapData.length = cursor;
    }

    return {
      backgroundColor: '#000000',
      animation: false,
      title: {
        text: title || 'Waterfall History',
        left: 'center',
        top: 4,
        textStyle: { color: '#b8c2d6', fontSize: 16, fontWeight: 500 },
      },
      grid: {
        left: 64,
        right: 108,
        top: 34,
        bottom: 64,
      },
      tooltip: {
        trigger: 'item',
        backgroundColor: '#0a101f',
        borderColor: '#2a3a5a',
        textStyle: { color: '#dbe5ff' },
        formatter: (params: any) => {
          const x = Number(params.value?.[0] ?? 0);
          const y = Number(params.value?.[1] ?? 0);
          const db = Number(params.value?.[2] ?? 0);
          const hz = startHz + ((endHz - startHz) * x) / Math.max(1, binsCount - 1);
          return `Freq: ${(hz / 1e6).toFixed(3)} MHz<br/>Sweep: -${rowCount - y}<br/>Power: ${db.toFixed(1)} dB`;
        },
      },
      xAxis: {
        type: 'value',
        min: 0,
        max: binsCount - 1,
        splitNumber: 10,
        axisLine: { lineStyle: { color: '#8ea2c6' } },
        axisTick: { show: true },
        axisLabel: {
          color: '#9fb2d6',
          formatter: (value: number) => {
            const hz = startHz + ((endHz - startHz) * value) / Math.max(1, binsCount - 1);
            return `${(hz / 1e6).toFixed(2)} MHz`;
          },
        },
        splitLine: { show: true, lineStyle: { color: GRID_COLOR } },
        name: 'Frequency',
        nameLocation: 'middle',
        nameGap: 42,
        nameTextStyle: { color: '#a9bbdc' },
      },
      yAxis: {
        type: 'value',
        min: 0,
        max: Math.max(1, rowCount - 1),
        splitNumber: 8,
        axisLine: { lineStyle: { color: '#8ea2c6' } },
        axisLabel: {
          color: '#9fb2d6',
          formatter: (value: number) => `-${Math.round(value + 1)}`,
        },
        splitLine: { show: true, lineStyle: { color: GRID_COLOR } },
        name: 'Sweep',
        nameLocation: 'middle',
        nameGap: 48,
        nameTextStyle: { color: '#a9bbdc' },
      },
      visualMap: {
        min: minDb,
        max: maxDb,
        calculable: false,
        orient: 'vertical',
        right: 18,
        top: 'middle',
        textStyle: { color: '#9fb2d6' },
        inRange: { color: COLOR_SCALE },
      },
      series: [
        {
          type: 'heatmap',
          data: heatmapData,
          silent: true,
          progressive: Math.max(10000, Math.floor(heatmapData.length / 2)),
          progressiveThreshold: 3000,
          animation: false,
          emphasis: { disabled: true },
        },
      ],
      graphic: [
        {
          type: 'text',
          left: 8,
          bottom: 8,
          style: {
            text: `Start: ${Math.round(startMHz)} MHz`,
            fill: '#9fb2d6',
            font: '12px monospace',
          },
        },
        {
          type: 'text',
          right: 8,
          bottom: 8,
          style: {
            text: `Stop: ${Math.round(endMHz)} MHz`,
            fill: '#9fb2d6',
            font: '12px monospace',
            textAlign: 'right',
          },
        },
      ],
    };
  }, [frame, rows, title]);

  const chartOpts = useMemo(
    () => ({
      renderer: 'canvas' as const,
      devicePixelRatio:
        typeof window === 'undefined'
          ? 2
          : Math.max(2, Math.floor(window.devicePixelRatio || 1)),
    }),
    []
  );

  return (
    <div className={className || 'rounded-lg border border-border/40 overflow-hidden'} style={{ width, height }}>
      <ReactECharts
        option={option}
        notMerge
        lazyUpdate
        opts={chartOpts}
        autoResize
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  );
};

export default WaterfallChart;

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

const APPEND_INTERVAL_MS = 33;
const MAX_SAMPLED_VALUES = 24000;
const GRID_COLOR = 'rgba(180, 195, 220, 0.20)';
const COLOR_SCALE = [
  '#040b17',
  '#0d2f5f',
  '#1456a2',
  '#1d96c4',
  '#34c18f',
  '#8fd84f',
  '#f0ca3a',
  '#f08a31',
  '#f24e1e',
  '#fff2e8',
];

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
  maxRows = 360,
  className,
}) => {
  const [rows, setRows] = useState<WaterfallRow[]>([]);
  const lastSigRef = useRef('');
  const lastAppendRef = useRef(0);
  const metaRef = useRef<{ bins: number; centerHz: number; spanHz: number } | null>(null);

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

    const binsCount = frame.binsDbm.length;
    const currentMeta = metaRef.current;
    const freqChanged =
      currentMeta !== null &&
      (currentMeta.bins !== binsCount ||
        Math.abs(currentMeta.centerHz - frame.centerHz) > Math.max(1, frame.binHz) ||
        Math.abs(currentMeta.spanHz - frame.spanHz) > Math.max(1, frame.binHz));

    metaRef.current = {
      bins: binsCount,
      centerHz: frame.centerHz,
      spanHz: frame.spanHz,
    };

    lastSigRef.current = signature;
    lastAppendRef.current = now;

    setRows((prev) => {
      const nextBase = freqChanged ? [] : prev;
      const next = [...nextBase, { ts: Number.isFinite(frame.ts) ? frame.ts : now, bins: Float32Array.from(frame.binsDbm) }];
      return next.length > maxRows ? next.slice(next.length - maxRows) : next;
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

    const heatmapData: number[][] = [];
    for (let r = 0; r < rowCount; r++) {
      const row = rows[r];
      const bins = row.bins;
      const srcCount = bins.length;
      if (srcCount === 0) {
        continue;
      }

      if (srcCount === binsCount) {
        for (let x = 0; x < binsCount; x++) {
          const v = Number(bins[x]);
          heatmapData.push([x, r, Number.isFinite(v) ? v : minDb]);
        }
        continue;
      }

      const ratio = srcCount / binsCount;
      for (let x = 0; x < binsCount; x++) {
        const srcX = Math.min(srcCount - 1, Math.floor(x * ratio));
        const v = Number(bins[srcX]);
        heatmapData.push([x, r, Number.isFinite(v) ? v : minDb]);
      }
    }

    const xCategories = Array.from({ length: binsCount }, (_, i) => i);
    const yCategories = Array.from({ length: rowCount }, (_, i) => i);
    const xLabelInterval = Math.max(1, Math.floor(binsCount / 10));
    const yLabelInterval = Math.max(1, Math.floor(rowCount / 8));

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
        type: 'category',
        data: xCategories,
        boundaryGap: false,
        axisLine: { lineStyle: { color: '#8ea2c6' } },
        axisTick: { show: true },
        axisLabel: {
          color: '#9fb2d6',
          interval: xLabelInterval,
          formatter: (_value: number, index: number) => {
            const hz = startHz + ((endHz - startHz) * index) / Math.max(1, binsCount - 1);
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
        type: 'category',
        data: yCategories,
        inverse: true,
        axisLine: { lineStyle: { color: '#8ea2c6' } },
        axisLabel: {
          color: '#9fb2d6',
          interval: yLabelInterval,
          formatter: (_value: number, index: number) => `-${rowCount - index}`,
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
          progressive: 75000,
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

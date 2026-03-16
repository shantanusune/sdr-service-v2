import React, { useEffect, useRef, useCallback } from 'react';
import type { SpectrumData, SpectrumMarker } from '@/models/types';
import type { SpectrumFrame } from '@/types/sdr';

// Support both legacy SpectrumData and new SpectrumFrame types
type ChartDataItem = SpectrumData | SpectrumFrame;

interface SpectrumChartProps {
  data: ChartDataItem[];
  markers?: SpectrumMarker[];
  onMarkerAdd?: (frequencyHz: number) => void;
  width?: number;
  height?: number;
  showGrid?: boolean;
  showPeaks?: boolean;
  colors?: string[];
  opacities?: number[];
  offsets?: number[];
}

const DEFAULT_COLORS = [
  'hsl(217, 91%, 60%)',  // Primary blue
  'hsl(187, 96%, 42%)',  // Cyan
  'hsl(160, 84%, 39%)',  // Green
  'hsl(38, 92%, 50%)',   // Yellow
  'hsl(280, 70%, 60%)',  // Purple
  'hsl(0, 84%, 60%)',    // Red
];

/**
 * Type guard to check if item is legacy SpectrumData
 */
function isSpectrumData(item: ChartDataItem): item is SpectrumData {
  return 'meta' in item && 'bins' in item;
}

/**
 * Type guard to check if item is new SpectrumFrame
 */
function isSpectrumFrame(item: ChartDataItem): item is SpectrumFrame {
  return 'binsDbm' in item && 'centerHz' in item;
}

/**
 * Normalize data item to common format for rendering
 */
function normalizeData(item: ChartDataItem): {
  bins: number[] | Float32Array;
  centerHz: number;
  spanHz: number;
  binHz: number;
  deviceId?: string;
  peakHz?: number;
  peakDb?: number;
} | null {
  if (isSpectrumData(item)) {
    return {
      bins: item.bins,
      centerHz: item.meta?.cf ?? 0,
      spanHz: item.meta?.sr ?? 0,
      binHz: item.meta?.binHz ?? 0,
      deviceId: item.meta?.deviceId,
      peakHz: item.meta?.peakHz,
      peakDb: item.meta?.peakDb,
    };
  }

  if (isSpectrumFrame(item)) {
    // Validate frequency data - use defaults if invalid
    const centerHz = item.centerHz > 1e3 && item.centerHz < 1e12 ? item.centerHz : 100e6;
    const spanHz = item.spanHz > 0 && item.spanHz < 1e11 ? item.spanHz : 20e6;
    const bins = item.binsDbm;
    const binHz = bins.length > 0 ? spanHz / bins.length : 0;

    // Find peak in bins (skip invalid values)
    let peakDb = -120;
    let peakBin = 0;
    for (let i = 0; i < bins.length; i++) {
      const val = bins[i];
      if (isFinite(val) && val >= -200 && val <= 50 && val > peakDb) {
        peakDb = val;
        peakBin = i;
      }
    }
    const startHz = centerHz - spanHz / 2;
    const peakHz = startHz + peakBin * binHz;

    return {
      bins,
      centerHz,
      spanHz,
      binHz,
      peakHz,
      peakDb,
    };
  }

  return null;
}

export const SpectrumChart: React.FC<SpectrumChartProps> = ({
  data,
  markers = [],
  onMarkerAdd,
  width = 800,
  height = 300,
  showGrid = true,
  showPeaks = true,
  colors = DEFAULT_COLORS,
  opacities = [],
  offsets = [],
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const drawChart = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // Clear
    ctx.fillStyle = 'hsl(222, 47%, 11%)';
    ctx.fillRect(0, 0, width, height);

    const padding = { top: 20, right: 20, bottom: 40, left: 60 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    // Normalize data
    const normalizedData = data.map(normalizeData).filter((d): d is NonNullable<typeof d> => d !== null);

    // Draw grid
    if (showGrid) {
      ctx.strokeStyle = 'hsl(217, 33%, 20%)';
      ctx.lineWidth = 1;

      // Horizontal grid lines (dB)
      for (let i = 0; i <= 8; i++) {
        const y = padding.top + (chartHeight * i) / 8;
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(width - padding.right, y);
        ctx.stroke();
      }

      // Vertical grid lines (frequency)
      for (let i = 0; i <= 10; i++) {
        const x = padding.left + (chartWidth * i) / 10;
        ctx.beginPath();
        ctx.moveTo(x, padding.top);
        ctx.lineTo(x, height - padding.bottom);
        ctx.stroke();
      }
    }

    // Draw each spectrum layer
    normalizedData.forEach((spectrum, layerIdx) => {
      const { bins } = spectrum;
      if (!bins || bins.length === 0) return;

      const color = colors[layerIdx % colors.length];
      const opacity = opacities[layerIdx] ?? 0.8;
      const offset = offsets[layerIdx] ?? 0;

      // Determine dB range
      const minDb = -100;
      const maxDb = 0;
      const dbRange = maxDb - minDb;

      // Draw spectrum line
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = opacity;

      for (let i = 0; i < bins.length; i++) {
        const x = padding.left + (i / bins.length) * chartWidth;
        const dbValue = bins[i] + offset;
        const normalizedDb = Math.max(0, Math.min(1, (dbValue - minDb) / dbRange));
        const y = padding.top + chartHeight * (1 - normalizedDb);

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();

      // Fill under curve
      ctx.lineTo(padding.left + chartWidth, height - padding.bottom);
      ctx.lineTo(padding.left, height - padding.bottom);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.globalAlpha = opacity * 0.15;
      ctx.fill();

      ctx.globalAlpha = 1;

      // Draw peak marker
      if (showPeaks && spectrum.peakHz !== undefined && spectrum.peakDb !== undefined) {
        const startHz = spectrum.centerHz - spectrum.spanHz / 2;
        const peakBin = Math.round((spectrum.peakHz - startHz) / spectrum.binHz);
        
        if (peakBin >= 0 && peakBin < bins.length) {
          const peakX = padding.left + (peakBin / bins.length) * chartWidth;
          const peakDbValue = spectrum.peakDb + offset;
          const normalizedPeakDb = Math.max(0, Math.min(1, (peakDbValue - minDb) / dbRange));
          const peakY = padding.top + chartHeight * (1 - normalizedPeakDb);

          // Peak dot
          ctx.beginPath();
          ctx.arc(peakX, peakY, 4, 0, Math.PI * 2);
          ctx.fillStyle = 'hsl(0, 84%, 60%)';
          ctx.fill();

          // Peak label
          ctx.font = '10px monospace';
          ctx.fillStyle = 'hsl(0, 84%, 60%)';
          ctx.textAlign = 'center';
          ctx.fillText(`${spectrum.peakDb.toFixed(1)} dB`, peakX, peakY - 8);
        }
      }
    });

    // Draw markers
    if (normalizedData.length > 0) {
      const firstSpectrum = normalizedData[0];
      
      markers.forEach(marker => {
        const startHz = firstSpectrum.centerHz - firstSpectrum.spanHz / 2;
        const endHz = firstSpectrum.centerHz + firstSpectrum.spanHz / 2;
        const markerPos = (marker.frequencyHz - startHz) / (endHz - startHz);
        
        if (markerPos >= 0 && markerPos <= 1) {
          const x = padding.left + markerPos * chartWidth;
          
          ctx.strokeStyle = marker.color || 'hsl(38, 92%, 50%)';
          ctx.lineWidth = 2;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(x, padding.top);
          ctx.lineTo(x, height - padding.bottom);
          ctx.stroke();
          ctx.setLineDash([]);

          // Marker label
          ctx.font = '10px monospace';
          ctx.fillStyle = marker.color || 'hsl(38, 92%, 50%)';
          ctx.textAlign = 'center';
          ctx.fillText(
            marker.label || `${(marker.frequencyHz / 1e6).toFixed(3)} MHz`,
            x,
            padding.top - 5
          );
        }
      });
    }

    // Draw axes labels
    ctx.font = '11px monospace';
    ctx.fillStyle = 'hsl(215, 20%, 65%)';

    // Y-axis labels (dB)
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const db = -100 + (100 * i) / 4;
      const y = padding.top + chartHeight * (1 - i / 4);
      ctx.fillText(`${db} dB`, padding.left - 8, y + 4);
    }

    // X-axis labels (frequency)
    if (normalizedData.length > 0) {
      const firstSpectrum = normalizedData[0];
      const startMHz = (firstSpectrum.centerHz - firstSpectrum.spanHz / 2) / 1e6;
      const endMHz = (firstSpectrum.centerHz + firstSpectrum.spanHz / 2) / 1e6;
      
      ctx.textAlign = 'center';
      for (let i = 0; i <= 5; i++) {
        const freq = startMHz + ((endMHz - startMHz) * i) / 5;
        const x = padding.left + (chartWidth * i) / 5;
        ctx.fillText(`${freq.toFixed(2)} MHz`, x, height - 10);
      }
    }

    // Chart title area
    if (normalizedData.length > 0) {
      ctx.font = '10px monospace';
      ctx.fillStyle = 'hsl(215, 20%, 65%)';
      ctx.textAlign = 'left';
      
      normalizedData.forEach((spectrum, idx) => {
        const y = 12;
        const x = padding.left + idx * 150;
        ctx.fillStyle = colors[idx % colors.length];
        ctx.fillRect(x, y - 6, 8, 8);
        ctx.fillStyle = 'hsl(215, 20%, 65%)';
        ctx.fillText(spectrum.deviceId || `Layer ${idx + 1}`, x + 12, y + 2);
      });
    }
  }, [data, markers, width, height, showGrid, showPeaks, colors, opacities, offsets]);

  useEffect(() => {
    drawChart();
  }, [drawChart]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onMarkerAdd) return;
    
    const normalizedData = data.map(normalizeData).filter((d): d is NonNullable<typeof d> => d !== null);
    if (normalizedData.length === 0) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;

    const padding = { left: 60, right: 20 };
    const chartWidth = width - padding.left - padding.right;

    const relX = (x - padding.left) / chartWidth;
    if (relX >= 0 && relX <= 1) {
      const firstSpectrum = normalizedData[0];
      const startHz = firstSpectrum.centerHz - firstSpectrum.spanHz / 2;
      const endHz = firstSpectrum.centerHz + firstSpectrum.spanHz / 2;
      const frequencyHz = startHz + relX * (endHz - startHz);
      onMarkerAdd(frequencyHz);
    }
  };

  return (
    <canvas
      ref={canvasRef}
      style={{ width, height }}
      className="rounded-lg cursor-crosshair"
      onClick={handleClick}
    />
  );
};

export default SpectrumChart;

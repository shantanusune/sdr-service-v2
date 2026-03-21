import React, { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type FrequencyUnit = "Hz" | "kHz" | "MHz" | "GHz";

interface FrequencyInputProps {
  value: number; // Always in Hz
  onChange: (hz: number) => void;
  label?: string;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

const UNIT_MULTIPLIERS: Record<FrequencyUnit, number> = {
  Hz: 1,
  kHz: 1_000,
  MHz: 1_000_000,
  GHz: 1_000_000_000,
};

function detectBestUnit(hz: number): FrequencyUnit {
  if (hz >= 1_000_000_000) return "GHz";
  if (hz >= 1_000_000) return "MHz";
  if (hz >= 1_000) return "kHz";
  return "Hz";
}

export function formatHz(hz: number): string {
  if (hz >= 1e9) return `${(hz / 1e9).toFixed(3)} GHz`;
  if (hz >= 1e6) return `${(hz / 1e6).toFixed(3)} MHz`;
  if (hz >= 1e3) return `${(hz / 1e3).toFixed(3)} kHz`;
  return `${hz} Hz`;
}

export const FrequencyInput: React.FC<FrequencyInputProps> = ({
  value,
  onChange,
  label,
  placeholder,
  className,
  disabled,
}) => {
  const [unit, setUnit] = useState<FrequencyUnit>(() => detectBestUnit(value));
  const [displayValue, setDisplayValue] = useState<string>(() =>
    (value / UNIT_MULTIPLIERS[unit]).toString()
  );

  // Sync display when value changes externally
  useEffect(() => {
    const newUnit = detectBestUnit(value);
    setUnit(newUnit);
    setDisplayValue((value / UNIT_MULTIPLIERS[newUnit]).toString());
  }, [value]);

  const handleValueChange = (newValue: string) => {
    setDisplayValue(newValue);
    const num = parseFloat(newValue);
    if (!isNaN(num)) {
      onChange(num * UNIT_MULTIPLIERS[unit]);
    }
  };

  const handleUnitChange = (newUnit: FrequencyUnit) => {
    const currentHz = parseFloat(displayValue) * UNIT_MULTIPLIERS[unit];
    setUnit(newUnit);
    setDisplayValue((currentHz / UNIT_MULTIPLIERS[newUnit]).toString());
  };

  return (
    <div className={className}>
      {label && <Label className="mb-2 block text-sm">{label}</Label>}
      <div className="flex gap-2">
        <Input
          type="number"
          value={displayValue}
          onChange={(e) => handleValueChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1"
          disabled={disabled}
        />
        <Select value={unit} onValueChange={(v) => handleUnitChange(v as FrequencyUnit)}>
          <SelectTrigger className="w-20" disabled={disabled}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Hz">Hz</SelectItem>
            <SelectItem value="kHz">kHz</SelectItem>
            <SelectItem value="MHz">MHz</SelectItem>
            <SelectItem value="GHz">GHz</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <p className="text-xs text-muted-foreground mt-1">{formatHz(value)}</p>
    </div>
  );
};

export default FrequencyInput;

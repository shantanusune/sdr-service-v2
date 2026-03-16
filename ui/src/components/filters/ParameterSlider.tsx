import React from "react";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { RotateCcw } from "lucide-react";

interface ParameterSliderProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  defaultValue?: number;
  showReset?: boolean;
  className?: string;
  disabled?: boolean;
  description?: string;
}

export const ParameterSlider: React.FC<ParameterSliderProps> = ({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit = "",
  defaultValue,
  showReset = false,
  className,
  disabled,
  description,
}) => {
  const handleReset = () => {
    if (defaultValue !== undefined) {
      onChange(defaultValue);
    }
  };

  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-2">
        <Label className="text-sm">{label}</Label>
        <div className="flex items-center gap-2">
          <span className="text-sm font-mono text-primary">
            {value.toFixed(step < 1 ? 1 : 0)} {unit}
          </span>
          {showReset && defaultValue !== undefined && value !== defaultValue && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={handleReset}
              disabled={disabled}
            >
              <RotateCcw className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>
      <Slider
        value={[value]}
        onValueChange={([v]) => onChange(v)}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        className="w-full"
      />
      {description && (
        <p className="text-xs text-muted-foreground mt-1">{description}</p>
      )}
      <div className="flex justify-between text-xs text-muted-foreground mt-1">
        <span>{min} {unit}</span>
        <span>{max} {unit}</span>
      </div>
    </div>
  );
};

export default ParameterSlider;

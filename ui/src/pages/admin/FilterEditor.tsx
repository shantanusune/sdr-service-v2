import React, { useState, useEffect, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  Plus,
  Trash2,
  Save,
  Play,
  RotateCcw,
  Code,
  Sliders,
  AlertCircle,
} from "lucide-react";
import {
  loadFilters,
  saveFilters,
  getFilter,
  generateFilterId,
} from "@/services/filterStore";
import { getTemplateById } from "@/config/filterTemplates";
import { FrequencyInput, formatHz } from "@/components/filters/FrequencyInput";
import { FilterParamsEditor } from "@/components/filters/FilterParamsEditor";
import type {
  FilterConfig,
  FilterType,
  FilterSeverity,
  FilterScope,
  FilterBand,
  InferenceCategory,
} from "@/types/sdr";
import { FILTER_TYPE_INFO, INFERENCE_CATEGORIES } from "@/types/sdr";
import { toast } from "@/hooks/use-toast";

const SEVERITIES: { value: FilterSeverity; label: string; color: string }[] = [
  { value: "info", label: "Info", color: "bg-blue-500" },
  { value: "warn", label: "Warning", color: "bg-yellow-500" },
  { value: "critical", label: "Critical", color: "bg-red-500" },
];

const SCOPES: { value: FilterScope; label: string }[] = [
  { value: "live", label: "Live (affects spectrum)" },
  { value: "test", label: "Test Only" },
  { value: "disabled", label: "Disabled" },
];

// Group filter types by category for UI
const FILTER_TYPES_BY_CATEGORY = Object.entries(FILTER_TYPE_INFO).reduce(
  (acc, [type, info]) => {
    if (!acc[info.category]) acc[info.category] = [];
    acc[info.category].push({ value: type as FilterType, ...info });
    return acc;
  },
  {} as Record<InferenceCategory, { value: FilterType; label: string; description: string }[]>
);

const FilterEditor: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isNew = id === "new";

  const [filter, setFilter] = useState<FilterConfig>({
    id: generateFilterId(),
    name: "",
    type: "peak_in_band",
    category: "carrier_energy",
    enabled: true,
    scope: "live",
    severity: "warn",
    cooldownMs: 1000,
    bands: [{ startHz: 144_000_000, endHz: 146_000_000 }],
    params: { peakThresholdDbm: -50 },
    createdAt: Date.now(),
  });

  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [jsonEditMode, setJsonEditMode] = useState(false);

  // Load existing filter
  useEffect(() => {
    if (!isNew && id) {
      const existing = getFilter(id);
      if (existing) {
        setFilter(existing);
        setJsonText(JSON.stringify(existing, null, 2));
      } else {
        toast({ title: "Filter not found", variant: "destructive" });
        navigate("/admin/filters");
      }
    } else {
      setJsonText(JSON.stringify(filter, null, 2));
    }
  }, [id, isNew, navigate]);

  // Sync JSON preview when filter changes (if not in edit mode)
  useEffect(() => {
    if (!jsonEditMode) {
      setJsonText(JSON.stringify(filter, null, 2));
      setJsonError(null);
    }
  }, [filter, jsonEditMode]);

  const templateInfo = useMemo(() => {
    if (filter.templateId) {
      return getTemplateById(filter.templateId);
    }
    return null;
  }, [filter.templateId]);

  const handleSave = () => {
    if (!filter.name.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }

    const filters = loadFilters();
    const updatedFilter = { ...filter, updatedAt: Date.now() };

    if (isNew) {
      filters.push(updatedFilter);
    } else {
      const index = filters.findIndex((f) => f.id === filter.id);
      if (index !== -1) {
        filters[index] = updatedFilter;
      }
    }
    saveFilters(filters);
    toast({ title: isNew ? "Filter created" : "Filter updated" });
    navigate("/admin/filters");
  };

  const handleSaveAndTest = () => {
    if (!filter.name.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }

    const filters = loadFilters();
    const updatedFilter = { ...filter, updatedAt: Date.now() };

    if (isNew) {
      filters.push(updatedFilter);
    } else {
      const index = filters.findIndex((f) => f.id === filter.id);
      if (index !== -1) {
        filters[index] = updatedFilter;
      }
    }
    saveFilters(filters);
    toast({ title: "Filter saved" });
    navigate(`/admin/filters/${updatedFilter.id}/test`);
  };

  const handleAddBand = () => {
    setFilter((prev) => ({
      ...prev,
      bands: [...prev.bands, { startHz: 100_000_000, endHz: 110_000_000 }],
    }));
  };

  const handleRemoveBand = (index: number) => {
    setFilter((prev) => ({
      ...prev,
      bands: prev.bands.filter((_, i) => i !== index),
    }));
  };

  const handleBandChange = (index: number, field: keyof FilterBand, value: number) => {
    setFilter((prev) => ({
      ...prev,
      bands: prev.bands.map((b, i) => (i === index ? { ...b, [field]: value } : b)),
    }));
  };

  const handleTypeChange = (type: FilterType) => {
    const typeInfo = FILTER_TYPE_INFO[type];
    setFilter((prev) => ({
      ...prev,
      type,
      category: typeInfo.category,
      params: {}, // Reset params when type changes
    }));
  };

  const handleJsonChange = (text: string) => {
    setJsonText(text);
    try {
      const parsed = JSON.parse(text);
      if (parsed.id && parsed.name && parsed.type) {
        setFilter(parsed);
        setJsonError(null);
      } else {
        setJsonError("Missing required fields: id, name, type");
      }
    } catch (e) {
      setJsonError(`Invalid JSON: ${e instanceof Error ? e.message : "Parse error"}`);
    }
  };

  const handleResetToTemplate = () => {
    if (templateInfo) {
      const newFilter = templateInfo.createFilter();
      // Keep the current ID and name
      setFilter({
        ...newFilter,
        id: filter.id,
        name: filter.name || newFilter.name,
      });
      toast({ title: "Reset to template defaults" });
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/admin/filters")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">
              {isNew ? "New Filter" : "Edit Filter"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {isNew ? "Create a new detection filter" : `Editing: ${filter.name}`}
            </p>
          </div>
        </div>
        {templateInfo && (
          <Badge variant="outline" className="gap-1">
            <span>{templateInfo.icon}</span>
            From: {templateInfo.name}
          </Badge>
        )}
      </div>

      {/* Main Split Layout */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-5 gap-4 min-h-0">
        {/* Left: Guided Builder (60%) */}
        <div className="lg:col-span-3 flex flex-col min-h-0">
          <Card className="flex-1 flex flex-col min-h-0">
            <CardHeader className="pb-2 flex-shrink-0">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Sliders className="h-4 w-4" />
                Guided Builder
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 min-h-0 overflow-hidden">
              <ScrollArea className="h-full pr-4">
                <Tabs defaultValue="basic" className="w-full">
                  <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="basic">Basic</TabsTrigger>
                    <TabsTrigger value="params">Parameters</TabsTrigger>
                    <TabsTrigger value="bands">Bands</TabsTrigger>
                  </TabsList>

                  {/* Basic Settings Tab */}
                  <TabsContent value="basic" className="mt-4 space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="name">Filter Name</Label>
                      <Input
                        id="name"
                        value={filter.name}
                        onChange={(e) => setFilter((prev) => ({ ...prev, name: e.target.value }))}
                        placeholder="My Filter"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Category</Label>
                      <Select
                        value={filter.category || "carrier_energy"}
                        onValueChange={(v) => setFilter((prev) => ({ ...prev, category: v as InferenceCategory }))}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(INFERENCE_CATEGORIES).map(([key, info]) => (
                            <SelectItem key={key} value={key}>
                              {info.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Filter Type</Label>
                      <Select value={filter.type} onValueChange={handleTypeChange}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="max-h-[300px]">
                          {Object.entries(FILTER_TYPES_BY_CATEGORY).map(([category, types]) => (
                            <div key={category}>
                              <div className="px-2 py-1 text-xs font-semibold text-muted-foreground">
                                {INFERENCE_CATEGORIES[category as InferenceCategory]?.label}
                              </div>
                              {types.map((t) => (
                                <SelectItem key={t.value} value={t.value}>
                                  <div>
                                    <span>{t.label}</span>
                                  </div>
                                </SelectItem>
                              ))}
                            </div>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        {FILTER_TYPE_INFO[filter.type]?.description}
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Severity</Label>
                        <Select
                          value={filter.severity}
                          onValueChange={(v) =>
                            setFilter((prev) => ({ ...prev, severity: v as FilterSeverity }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {SEVERITIES.map((s) => (
                              <SelectItem key={s.value} value={s.value}>
                                <div className="flex items-center gap-2">
                                  <span className={`w-2 h-2 rounded-full ${s.color}`} />
                                  {s.label}
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label>Scope</Label>
                        <Select
                          value={filter.scope || "live"}
                          onValueChange={(v) =>
                            setFilter((prev) => ({ ...prev, scope: v as FilterScope }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {SCOPES.map((s) => (
                              <SelectItem key={s.value} value={s.value}>
                                {s.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="cooldown">Cooldown (ms)</Label>
                      <Input
                        id="cooldown"
                        type="number"
                        value={filter.cooldownMs}
                        onChange={(e) =>
                          setFilter((prev) => ({
                            ...prev,
                            cooldownMs: parseInt(e.target.value) || 0,
                          }))
                        }
                      />
                      <p className="text-xs text-muted-foreground">
                        Minimum time between matches
                      </p>
                    </div>

                    <div className="flex items-center gap-2 pt-2">
                      <Switch
                        id="enabled"
                        checked={filter.enabled}
                        onCheckedChange={(enabled) => setFilter((prev) => ({ ...prev, enabled }))}
                      />
                      <Label htmlFor="enabled">Enabled</Label>
                    </div>
                  </TabsContent>

                  {/* Parameters Tab */}
                  <TabsContent value="params" className="mt-4">
                    <FilterParamsEditor
                      filterType={filter.type}
                      params={filter.params}
                      onChange={(params) => setFilter((prev) => ({ ...prev, params }))}
                    />
                  </TabsContent>

                  {/* Bands Tab */}
                  <TabsContent value="bands" className="mt-4 space-y-4">
                    <div className="flex justify-between items-center">
                      <p className="text-sm text-muted-foreground">
                        Define frequency bands for this filter
                      </p>
                      <Button variant="outline" size="sm" onClick={handleAddBand} className="gap-1">
                        <Plus className="h-4 w-4" />
                        Add Band
                      </Button>
                    </div>

                    {filter.bands.length === 0 ? (
                      <Alert>
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>
                          No bands configured. Add at least one frequency band.
                        </AlertDescription>
                      </Alert>
                    ) : (
                      <div className="space-y-4">
                        {filter.bands.map((band, index) => (
                          <Card key={index} className="bg-muted/30">
                            <CardContent className="pt-4">
                              <div className="flex items-center justify-between mb-3">
                                <span className="text-sm font-medium">Band {index + 1}</span>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => handleRemoveBand(index)}
                                  disabled={filter.bands.length === 1}
                                >
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </div>
                              <div className="grid grid-cols-2 gap-4">
                                <FrequencyInput
                                  label="Start Frequency"
                                  value={band.startHz}
                                  onChange={(v) => handleBandChange(index, "startHz", v)}
                                />
                                <FrequencyInput
                                  label="End Frequency"
                                  value={band.endHz}
                                  onChange={(v) => handleBandChange(index, "endHz", v)}
                                />
                              </div>
                              <p className="text-xs text-muted-foreground mt-2">
                                Span: {formatHz(band.endHz - band.startHz)}
                              </p>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    )}
                  </TabsContent>
                </Tabs>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        {/* Right: JSON Editor (40%) */}
        <div className="lg:col-span-2 flex flex-col min-h-0">
          <Card className="flex-1 flex flex-col min-h-0">
            <CardHeader className="pb-2 flex-shrink-0">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Code className="h-4 w-4" />
                  JSON {jsonEditMode ? "(Editing)" : "(Preview)"}
                </CardTitle>
                <div className="flex items-center gap-2">
                  {templateInfo && (
                    <Button variant="ghost" size="sm" onClick={handleResetToTemplate} className="gap-1">
                      <RotateCcw className="h-3 w-3" />
                      Reset
                    </Button>
                  )}
                  <div className="flex items-center gap-2">
                    <Label htmlFor="json-edit" className="text-xs">Edit</Label>
                    <Switch
                      id="json-edit"
                      checked={jsonEditMode}
                      onCheckedChange={setJsonEditMode}
                    />
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex-1 min-h-0 flex flex-col">
              {jsonError && (
                <Alert variant="destructive" className="mb-2 flex-shrink-0">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="text-xs">{jsonError}</AlertDescription>
                </Alert>
              )}
              <Textarea
                value={jsonText}
                onChange={(e) => handleJsonChange(e.target.value)}
                readOnly={!jsonEditMode}
                className={`flex-1 font-mono text-xs resize-none ${
                  !jsonEditMode ? "bg-muted/50" : ""
                }`}
                placeholder="Filter JSON..."
              />
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Actions Bar */}
      <div className="flex justify-between items-center mt-4 pt-4 border-t">
        <Button variant="outline" onClick={() => navigate("/admin/filters")}>
          Cancel
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleSaveAndTest} className="gap-2">
            <Play className="h-4 w-4" />
            Save & Test
          </Button>
          <Button onClick={handleSave} className="gap-2">
            <Save className="h-4 w-4" />
            {isNew ? "Create Filter" : "Save Changes"}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default FilterEditor;

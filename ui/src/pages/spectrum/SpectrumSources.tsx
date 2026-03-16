import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Radio, Wifi, WifiOff, ArrowRight, RefreshCw, AlertCircle, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { loadSelectedRadios, saveSelectedRadios, groupDataSourcesByHost } from "@/config/dataSources";
import { useStreamableDatasources, useHosts } from "@/hooks/useDatasources";
import type { SelectedRadio } from "@/types/sources";
import { isDisabledState, type LiveState } from "@/types/api";
const SpectrumSources: React.FC = () => {
  const navigate = useNavigate();
  const [selectedRadios, setSelectedRadios] = useState<SelectedRadio[]>([]);

  // Fetch datasources and hosts from API
  const { data: rawDatasources, isLoading, error, refetch, isRefetching } = useStreamableDatasources();
  const { data: hosts } = useHosts();

  // Transform backend DTOs to frontend format (pass hosts for host-level state checking)
  const dataSources = useMemo(() => {
    if (!rawDatasources) return [];
    return groupDataSourcesByHost(rawDatasources, hosts);
  }, [rawDatasources, hosts]);

  // Helper to get state badge variant and label
  const getStateBadge = (state: string | undefined): { variant: "default" | "secondary" | "destructive" | "outline"; label: string; icon: React.ReactNode } => {
    const s = (state || 'UNKNOWN').toUpperCase() as LiveState;
    switch (s) {
      case 'ONLINE':
        return { variant: 'default', label: 'Online', icon: <CheckCircle2 className="h-3 w-3" /> };
      case 'READY':
        return { variant: 'outline', label: 'Ready', icon: <CheckCircle2 className="h-3 w-3" /> };
      case 'CAPTURING':
        return { variant: 'default', label: 'Capturing', icon: <Loader2 className="h-3 w-3 animate-spin" /> };
      case 'OFFLINE':
        return { variant: 'secondary', label: 'Offline', icon: <WifiOff className="h-3 w-3" /> };
      case 'ERROR':
        return { variant: 'destructive', label: 'Error', icon: <XCircle className="h-3 w-3" /> };
      case 'UNKNOWN':
      default:
        return { variant: 'secondary', label: 'Unknown', icon: <AlertCircle className="h-3 w-3" /> };
    }
  };

  useEffect(() => {
    setSelectedRadios(loadSelectedRadios());
  }, []);

  const handleToggleRadio = (sourceId: string, radioId: string) => {
    setSelectedRadios((prev) => {
      const exists = prev.some((r) => r.sourceId === sourceId && r.radioId === radioId);
      let updated: SelectedRadio[];
      if (exists) {
        updated = prev.filter((r) => !(r.sourceId === sourceId && r.radioId === radioId));
      } else {
        updated = [...prev, { sourceId, radioId }];
      }
      saveSelectedRadios(updated);
      return updated;
    });
  };

  const isSelected = (sourceId: string, radioId: string) => {
    return selectedRadios.some((r) => r.sourceId === sourceId && r.radioId === radioId);
  };

  const handleOpenLiveView = () => {
    navigate("/spectrum/view");
  };

  // Loading skeleton
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="h-9 w-64 mb-2" />
            <Skeleton className="h-4 w-96" />
          </div>
          <Skeleton className="h-10 w-40" />
        </div>
        <div className="grid gap-6">
          {[1, 2].map((i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-6 w-48 mb-2" />
                <Skeleton className="h-4 w-64" />
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {[1, 2, 3].map((j) => (
                    <Skeleton key={j} className="h-16 rounded-lg" />
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Data Sources & Radios</h1>
          <p className="text-muted-foreground mt-1">
            Select radios to monitor in the live spectrum viewer
          </p>
        </div>
        <Card className="border-destructive/50 bg-destructive/10">
          <CardContent className="py-8 text-center">
            <AlertCircle className="h-12 w-12 mx-auto mb-4 text-destructive" />
            <h3 className="font-medium mb-2">Failed to Load Data Sources</h3>
            <p className="text-sm text-muted-foreground mb-4">
              {error instanceof Error ? error.message : "Unable to connect to the backend API"}
            </p>
            <Button onClick={() => refetch()} variant="outline" className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Data Sources & Radios</h1>
          <p className="text-muted-foreground mt-1">
            Select radios to monitor in the live spectrum viewer
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isRefetching}
            className="gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${isRefetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button
            onClick={handleOpenLiveView}
            disabled={selectedRadios.length === 0}
            className="gap-2"
          >
            Open Live Spectrum <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {dataSources.length === 0 ? (
        <Card className="bg-muted/50">
          <CardContent className="py-8 text-center">
            <Radio className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <h3 className="font-medium mb-2">No Data Sources Found</h3>
            <p className="text-sm text-muted-foreground mb-4">
              No streamable datasources are currently available from the backend.
            </p>
            <Button onClick={() => refetch()} variant="outline" className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6">
          {dataSources.map((source) => (
            <Card key={source.id} className={!source.enabled ? "opacity-60" : ""}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {source.enabled ? (
                      <Wifi className="h-5 w-5 text-green-500" />
                    ) : (
                      <WifiOff className="h-5 w-5 text-muted-foreground" />
                    )}
                    <div>
                      <CardTitle className="text-lg">{source.name}</CardTitle>
                      <CardDescription>{source.description}</CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={source.enabled ? "default" : "secondary"}>
                      {source.enabled ? "Online" : "Offline"}
                    </Badge>
                    <Badge variant="outline" className="font-mono text-xs">
                      {source.endpoint}
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {source.radios.map((radio) => {
                    const selected = isSelected(source.id, radio.id);
                    const radioState = String(radio.meta?.state || 'UNKNOWN');
                    const isRadioDisabled = radio.meta?.disabled === true || isDisabledState(radioState);
                    const stateBadge = getStateBadge(radioState);
                    const lastSeen = radio.meta?.lastSeenAt
                      ? new Date(String(radio.meta.lastSeenAt)).toLocaleTimeString()
                      : null;

                    return (
                      <div
                        key={radio.id}
                        className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                          isRadioDisabled
                            ? "opacity-50 cursor-not-allowed bg-muted/30"
                            : selected
                            ? "bg-primary/10 border-primary cursor-pointer"
                            : "bg-card hover:bg-accent/50 cursor-pointer"
                        }`}
                        onClick={() => !isRadioDisabled && handleToggleRadio(source.id, radio.id)}
                      >
                        <Checkbox
                          checked={selected}
                          disabled={isRadioDisabled}
                          onCheckedChange={() => !isRadioDisabled && handleToggleRadio(source.id, radio.id)}
                        />
                        <Radio className={`h-4 w-4 ${isRadioDisabled ? "text-muted-foreground/50" : "text-muted-foreground"}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-sm truncate">{radio.name}</p>
                            <Badge variant={stateBadge.variant} className="text-[10px] px-1.5 py-0 h-4 gap-1">
                              {stateBadge.icon}
                              {stateBadge.label}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            {radio.meta?.type && <span>{String(radio.meta.type)}</span>}
                            {lastSeen && (
                              <span className="text-muted-foreground/60">• {lastSeen}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {selectedRadios.length > 0 && (
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">
                  {selectedRadios.length} radio{selectedRadios.length !== 1 ? "s" : ""} selected
                </p>
                <p className="text-sm text-muted-foreground">
                  Ready to stream spectrum data
                </p>
              </div>
              <Button onClick={handleOpenLiveView} className="gap-2">
                Open Live Spectrum <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default SpectrumSources;

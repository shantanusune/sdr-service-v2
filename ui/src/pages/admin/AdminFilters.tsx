import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Plus,
  Pencil,
  Trash2,
  Download,
  Upload,
  Filter,
  Copy,
  Search,
  Sparkles,
} from "lucide-react";
import {
  loadFilters,
  saveFilters,
  deleteFilter,
  exportFilters,
  importFilters,
  generateFilterId,
} from "@/services/filterStore";
import {
  FILTER_TEMPLATES,
  getTemplatesByCategory,
  type FilterTemplate,
} from "@/config/filterTemplates";
import type { FilterConfig } from "@/types/sdr";
import { toast } from "@/hooks/use-toast";

const AdminFilters: React.FC = () => {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<FilterConfig[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);

  useEffect(() => {
    setFilters(loadFilters());
  }, []);

  const handleToggleEnabled = (id: string, enabled: boolean) => {
    const updated = filters.map((f) =>
      f.id === id ? { ...f, enabled } : f
    );
    saveFilters(updated);
    setFilters(updated);
  };

  const handleDelete = (id: string) => {
    deleteFilter(id);
    setFilters(loadFilters());
    toast({ title: "Filter deleted" });
  };

  const handleClone = (filter: FilterConfig) => {
    const cloned: FilterConfig = {
      ...filter,
      id: generateFilterId(),
      name: `${filter.name} (Copy)`,
      bands: filter.bands.map((b) => ({ ...b })),
      params: { ...filter.params },
    };
    const updated = [...filters, cloned];
    saveFilters(updated);
    setFilters(updated);
    toast({ title: "Filter cloned" });
  };

  const handleExport = () => {
    const json = exportFilters();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `filters-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const text = await file.text();
      const result = importFilters(text);

      if (result.success) {
        setFilters(loadFilters());
        toast({ title: "Filters imported successfully" });
      } else {
        toast({ title: "Import failed", description: result.error, variant: "destructive" });
      }
    };
    input.click();
  };

  const handleCreateFromTemplate = (template: FilterTemplate) => {
    const newFilter = template.createFilter();
    const updated = [...filters, newFilter];
    saveFilters(updated);
    setFilters(updated);
    setTemplateDialogOpen(false);
    toast({ title: `Created filter from "${template.name}" template` });
    navigate(`/admin/filters/${newFilter.id}`);
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case "critical":
        return "destructive";
      case "warn":
        return "secondary";
      default:
        return "outline";
    }
  };

  const filteredFilters = filters.filter((f) =>
    f.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    f.type.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const templatesByCategory = getTemplatesByCategory();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Filters</h1>
          <p className="text-muted-foreground mt-1">
            Manage spectrum detection filters
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExport} className="gap-2">
            <Download className="h-4 w-4" />
            Export
          </Button>
          <Button variant="outline" onClick={handleImport} className="gap-2">
            <Upload className="h-4 w-4" />
            Import
          </Button>
          <Button
            variant="outline"
            onClick={() => setTemplateDialogOpen(true)}
            className="gap-2"
          >
            <Sparkles className="h-4 w-4" />
            From Template
          </Button>
          <Button onClick={() => navigate("/admin/filters/new")} className="gap-2">
            <Plus className="h-4 w-4" />
            New Filter
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search filters..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="h-5 w-5" />
            Filter List
          </CardTitle>
        </CardHeader>
        <CardContent>
          {filteredFilters.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Filter className="h-12 w-12 mx-auto mb-4 opacity-30" />
              <p>{searchQuery ? "No filters match your search" : "No filters configured"}</p>
              <div className="flex gap-2 justify-center mt-4">
                <Button
                  variant="outline"
                  onClick={() => setTemplateDialogOpen(true)}
                >
                  <Sparkles className="h-4 w-4 mr-2" />
                  Create from Template
                </Button>
                <Button
                  variant="outline"
                  onClick={() => navigate("/admin/filters/new")}
                >
                  Create from Scratch
                </Button>
              </div>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Enabled</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Bands</TableHead>
                  <TableHead>Cooldown</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredFilters.map((filter) => (
                  <TableRow key={filter.id}>
                    <TableCell>
                      <Switch
                        checked={filter.enabled}
                        onCheckedChange={(checked) =>
                          handleToggleEnabled(filter.id, checked)
                        }
                      />
                    </TableCell>
                    <TableCell className="font-medium">{filter.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-xs">
                        {filter.type}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={getSeverityColor(filter.severity) as "destructive" | "secondary" | "outline"}>
                        {filter.severity}
                      </Badge>
                    </TableCell>
                    <TableCell>{filter.bands.length} band(s)</TableCell>
                    <TableCell>{filter.cooldownMs}ms</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleClone(filter)}
                          title="Clone filter"
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => navigate(`/admin/filters/${filter.id}`)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Filter</AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you sure you want to delete "{filter.name}"? This action
                                cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleDelete(filter.id)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Template Dialog */}
      <Dialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              Create from Template
            </DialogTitle>
            <DialogDescription>
              Choose a pre-configured filter template to get started quickly
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <div className="space-y-6 pr-4">
              {Object.entries(templatesByCategory).map(([category, templates]) => (
                <div key={category}>
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                    {category}
                  </h3>
                  <div className="grid gap-3">
                    {templates.map((template) => (
                      <Card
                        key={template.id}
                        className="cursor-pointer hover:bg-muted/50 transition-colors"
                        onClick={() => handleCreateFromTemplate(template)}
                      >
                        <CardContent className="py-3">
                          <div className="flex items-start gap-3">
                            <span className="text-2xl">{template.icon}</span>
                            <div className="flex-1">
                              <h4 className="font-medium">{template.name}</h4>
                              <p className="text-sm text-muted-foreground">
                                {template.description}
                              </p>
                            </div>
                            <Button variant="ghost" size="sm">
                              Use
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminFilters;

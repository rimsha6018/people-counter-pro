import { useEffect, useState } from "react";
import { Download, Loader2, ScrollText } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";

export default function LogsPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = "Logs · SentinelCount";
    (async () => {
      const [l, e, a] = await Promise.all([
        supabase.from("detection_logs").select("*").order("created_at", { ascending: false }).limit(500),
        supabase
          .from("entry_exit_events")
          .select("*, employees(name)")
          .order("created_at", { ascending: false })
          .limit(500),
        supabase.from("alerts").select("*").order("created_at", { ascending: false }).limit(500),
      ]);
      setLogs(l.data ?? []);
      setEvents(e.data ?? []);
      setAlerts(a.data ?? []);
      setLoading(false);
    })();
  }, []);

  const exportCsv = (rows: any[], name: string) => {
    if (!rows.length) return;
    const keys = Object.keys(rows[0]);
    const header = keys.join(",");
    const body = rows
      .map((r) =>
        keys
          .map((k) => {
            const v = r[k];
            const s = typeof v === "object" ? JSON.stringify(v) : String(v ?? "");
            return `"${s.replace(/"/g, '""')}"`;
          })
          .join(","),
      )
      .join("\n");
    const blob = new Blob([header + "\n" + body], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name}-${new Date().toISOString().slice(0, 19)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="container space-y-6 py-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">History & Logs</h1>
        <p className="text-sm text-muted-foreground">All detections, entry/exit events, and alerts</p>
      </div>

      <Tabs defaultValue="events">
        <TabsList>
          <TabsTrigger value="events">Entry/Exit ({events.length})</TabsTrigger>
          <TabsTrigger value="logs">Detections ({logs.length})</TabsTrigger>
          <TabsTrigger value="alerts">Alerts ({alerts.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="events">
          <Card className="border-border/60 bg-card shadow-card-soft">
            <div className="flex items-center justify-between border-b border-border/60 px-5 py-3">
              <h2 className="text-sm font-semibold">Entry / Exit Events</h2>
              <Button size="sm" variant="ghost" onClick={() => exportCsv(events, "events")} className="gap-1.5">
                <Download className="h-3.5 w-3.5" /> CSV
              </Button>
            </div>
            <ScrollArea className="h-[60vh]">
              {events.length === 0 ? (
                <Empty />
              ) : (
                <ul className="divide-y divide-border/60">
                  {events.map((ev) => (
                    <li key={ev.id} className="flex items-center justify-between px-5 py-3 text-sm">
                      <div className="flex items-center gap-3">
                        <Badge variant={ev.direction === "in" ? "default" : "destructive"}>
                          {ev.direction.toUpperCase()}
                        </Badge>
                        <span>
                          {ev.employees?.name ?? "Unknown person"}{" "}
                          <span className="text-xs text-muted-foreground">
                            (track #{ev.track_id ?? "?"})
                          </span>
                        </span>
                      </div>
                      <span className="font-mono text-xs text-muted-foreground">
                        {new Date(ev.created_at).toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </ScrollArea>
          </Card>
        </TabsContent>

        <TabsContent value="logs">
          <Card className="border-border/60 bg-card shadow-card-soft">
            <div className="flex items-center justify-between border-b border-border/60 px-5 py-3">
              <h2 className="text-sm font-semibold">Detection Logs</h2>
              <Button size="sm" variant="ghost" onClick={() => exportCsv(logs, "logs")} className="gap-1.5">
                <Download className="h-3.5 w-3.5" /> CSV
              </Button>
            </div>
            <ScrollArea className="h-[60vh]">
              {logs.length === 0 ? (
                <Empty />
              ) : (
                <ul className="divide-y divide-border/60">
                  {logs.map((l) => (
                    <li key={l.id} className="flex items-center justify-between px-5 py-3 text-sm">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="font-mono">
                          {l.count}
                        </Badge>
                        <span className="text-xs uppercase text-muted-foreground">{l.source}</span>
                        {Array.isArray(l.recognized_employee_ids) && l.recognized_employee_ids.length > 0 && (
                          <Badge variant="secondary" className="text-[10px]">
                            {l.recognized_employee_ids.length} recognized
                          </Badge>
                        )}
                      </div>
                      <span className="font-mono text-xs text-muted-foreground">
                        {new Date(l.created_at).toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </ScrollArea>
          </Card>
        </TabsContent>

        <TabsContent value="alerts">
          <Card className="border-border/60 bg-card shadow-card-soft">
            <div className="flex items-center justify-between border-b border-border/60 px-5 py-3">
              <h2 className="text-sm font-semibold">Alerts</h2>
              <Button size="sm" variant="ghost" onClick={() => exportCsv(alerts, "alerts")} className="gap-1.5">
                <Download className="h-3.5 w-3.5" /> CSV
              </Button>
            </div>
            <ScrollArea className="h-[60vh]">
              {alerts.length === 0 ? (
                <Empty />
              ) : (
                <ul className="divide-y divide-border/60">
                  {alerts.map((a) => (
                    <li key={a.id} className="flex items-center justify-between px-5 py-3 text-sm">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={
                            a.severity === "critical"
                              ? "destructive"
                              : a.severity === "warning"
                                ? "default"
                                : "secondary"
                          }
                        >
                          {a.severity}
                        </Badge>
                        <span>{a.message}</span>
                      </div>
                      <span className="font-mono text-xs text-muted-foreground">
                        {new Date(a.created_at).toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </ScrollArea>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Empty() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
      <ScrollText className="h-8 w-8 opacity-50" />
      <p className="text-sm">Nothing to show yet</p>
    </div>
  );
}

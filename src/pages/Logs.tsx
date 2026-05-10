import { useEffect, useMemo, useState } from "react";
import { Download, FileJson, FileText, Loader2, ScrollText } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { exportCsv, exportJson, exportPdfReport } from "@/lib/reportExport";
import { logActivity } from "@/lib/activityLogger";
import { toast } from "sonner";

const DEFAULT_RANGE_DAYS = 7;

export default function LogsPage() {
  const { user, caps } = useAuth();
  const [logs, setLogs] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [activity, setActivity] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const initialFrom = new Date(Date.now() - DEFAULT_RANGE_DAYS * 86400000).toISOString().slice(0, 10);
  const initialTo = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);

  useEffect(() => {
    document.title = "Logs · SentinelCount";
  }, []);

  useEffect(() => {
    const fromIso = new Date(`${from}T00:00:00`).toISOString();
    const toIso = new Date(`${to}T23:59:59`).toISOString();
    (async () => {
      setLoading(true);
      const [l, e, a, ua] = await Promise.all([
        supabase
          .from("detection_logs")
          .select("*")
          .gte("created_at", fromIso)
          .lte("created_at", toIso)
          .order("created_at", { ascending: false })
          .limit(2000),
        supabase
          .from("entry_exit_events")
          .select("*, employees(name)")
          .gte("created_at", fromIso)
          .lte("created_at", toIso)
          .order("created_at", { ascending: false })
          .limit(2000),
        supabase
          .from("alerts")
          .select("*")
          .gte("created_at", fromIso)
          .lte("created_at", toIso)
          .order("created_at", { ascending: false })
          .limit(2000),
        supabase
          .from("user_activity_logs")
          .select("*")
          .gte("created_at", fromIso)
          .lte("created_at", toIso)
          .order("created_at", { ascending: false })
          .limit(2000),
      ]);
      setLogs(l.data ?? []);
      setEvents(e.data ?? []);
      setAlerts(a.data ?? []);
      setActivity(ua.data ?? []);
      setLoading(false);
    })();
  }, [from, to]);

  const summary = useMemo(() => {
    const ins = events.filter((e) => e.direction === "in").length;
    const outs = events.filter((e) => e.direction === "out").length;
    const peak = logs.reduce((m, l) => Math.max(m, l.count ?? 0), 0);
    const avg = logs.length
      ? Math.round((logs.reduce((s, l) => s + (l.count ?? 0), 0) / logs.length) * 10) / 10
      : 0;
    return { ins, outs, peak, avg };
  }, [logs, events]);

  const handleExport = (kind: "csv" | "json" | "pdf") => {
    if (!caps.canExportReports) {
      toast.error("You do not have permission to export");
      return;
    }
    const stamp = `${from}_to_${to}`;
    if (kind === "csv") {
      exportCsv(events, `events-${stamp}`);
      exportCsv(logs, `detections-${stamp}`);
      exportCsv(alerts, `alerts-${stamp}`);
    } else if (kind === "json") {
      exportJson({ from, to, summary, events, logs, alerts } as any, `report-${stamp}`);
    } else {
      exportPdfReport({
        title: `SentinelCount Report (${from} → ${to})`,
        summary: [
          { label: "Entries", value: summary.ins },
          { label: "Exits", value: summary.outs },
          { label: "Peak", value: summary.peak },
          { label: "Average", value: summary.avg },
          { label: "Alerts", value: alerts.length },
        ],
        sections: [
          {
            heading: "Entry / Exit Events",
            rows: events.map((e) => ({
              time: new Date(e.created_at).toLocaleString(),
              direction: e.direction,
              employee: e.employees?.name ?? "Unknown",
              track: e.track_id ?? "",
            })),
          },
          {
            heading: "Alerts",
            rows: alerts.map((a) => ({
              time: new Date(a.created_at).toLocaleString(),
              severity: a.severity,
              type: a.type,
              message: a.message,
            })),
          },
          {
            heading: "Detection Samples",
            rows: logs.slice(0, 200).map((l) => ({
              time: new Date(l.created_at).toLocaleString(),
              count: l.count,
              source: l.source,
            })),
          },
        ],
      });
    }
    if (user) logActivity(user.id, "export_report", { kind, from, to });
    toast.success(`Exported ${kind.toUpperCase()}`);
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
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">History &amp; Logs</h1>
          <p className="text-sm text-muted-foreground">
            All detections, entry/exit events, alerts and activity
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">From</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 w-[140px]" />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">To</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 w-[140px]" />
          </div>
          <Button size="sm" variant="outline" onClick={() => handleExport("csv")} className="gap-1.5">
            <Download className="h-3.5 w-3.5" /> CSV
          </Button>
          <Button size="sm" variant="outline" onClick={() => handleExport("json")} className="gap-1.5">
            <FileJson className="h-3.5 w-3.5" /> JSON
          </Button>
          <Button size="sm" onClick={() => handleExport("pdf")} className="gap-1.5">
            <FileText className="h-3.5 w-3.5" /> PDF Report
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Entries" value={summary.ins} />
        <Stat label="Exits" value={summary.outs} />
        <Stat label="Peak" value={summary.peak} />
        <Stat label="Average" value={summary.avg} />
        <Stat label="Alerts" value={alerts.length} />
      </div>

      <Tabs defaultValue="events">
        <TabsList>
          <TabsTrigger value="events">Entry/Exit ({events.length})</TabsTrigger>
          <TabsTrigger value="logs">Detections ({logs.length})</TabsTrigger>
          <TabsTrigger value="alerts">Alerts ({alerts.length})</TabsTrigger>
          <TabsTrigger value="activity">Activity ({activity.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="events">
          <ListCard
            title="Entry / Exit Events"
            empty={events.length === 0}
            onExport={() => exportCsv(events, "events")}
          >
            <ul className="divide-y divide-border/60">
              {events.map((ev) => (
                <li key={ev.id} className="flex items-center justify-between px-5 py-3 text-sm">
                  <div className="flex items-center gap-3">
                    <Badge variant={ev.direction === "in" ? "default" : "destructive"}>
                      {ev.direction.toUpperCase()}
                    </Badge>
                    <span>
                      {ev.employees?.name ?? "Unknown person"}{" "}
                      <span className="text-xs text-muted-foreground">(track #{ev.track_id ?? "?"})</span>
                    </span>
                  </div>
                  <span className="font-mono text-xs text-muted-foreground">
                    {new Date(ev.created_at).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          </ListCard>
        </TabsContent>

        <TabsContent value="logs">
          <ListCard title="Detection Logs" empty={logs.length === 0} onExport={() => exportCsv(logs, "logs")}>
            <ul className="divide-y divide-border/60">
              {logs.map((l) => (
                <li key={l.id} className="flex items-center justify-between px-5 py-3 text-sm">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="font-mono">
                      {l.count}
                    </Badge>
                    <span className="text-xs uppercase text-muted-foreground">{l.source}</span>
                  </div>
                  <span className="font-mono text-xs text-muted-foreground">
                    {new Date(l.created_at).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          </ListCard>
        </TabsContent>

        <TabsContent value="alerts">
          <ListCard title="Alerts" empty={alerts.length === 0} onExport={() => exportCsv(alerts, "alerts")}>
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
          </ListCard>
        </TabsContent>

        <TabsContent value="activity">
          <ListCard title="Activity" empty={activity.length === 0} onExport={() => exportCsv(activity, "activity")}>
            <ul className="divide-y divide-border/60">
              {activity.map((a) => (
                <li key={a.id} className="flex items-center justify-between px-5 py-3 text-sm">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="font-mono text-[10px]">
                      {a.action}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {a.details && Object.keys(a.details).length > 0 ? JSON.stringify(a.details) : ""}
                    </span>
                  </div>
                  <span className="font-mono text-xs text-muted-foreground">
                    {new Date(a.created_at).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          </ListCard>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ListCard({
  title,
  empty,
  onExport,
  children,
}: {
  title: string;
  empty: boolean;
  onExport: () => void;
  children: React.ReactNode;
}) {
  return (
    <Card className="border-border/60 bg-card shadow-card-soft">
      <div className="flex items-center justify-between border-b border-border/60 px-5 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <Button size="sm" variant="ghost" onClick={onExport} className="gap-1.5">
          <Download className="h-3.5 w-3.5" /> CSV
        </Button>
      </div>
      <ScrollArea className="h-[60vh]">
        {empty ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
            <ScrollText className="h-8 w-8 opacity-50" />
            <p className="text-sm">Nothing to show yet</p>
          </div>
        ) : (
          children
        )}
      </ScrollArea>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card className="border-border/60 bg-card p-4 shadow-card-soft">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-2xl font-bold text-gradient">{value}</p>
    </Card>
  );
}

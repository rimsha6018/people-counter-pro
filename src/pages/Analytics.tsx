import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export default function AnalyticsPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = "Analytics · SentinelCount";
    (async () => {
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const [l, e] = await Promise.all([
        supabase
          .from("detection_logs")
          .select("count, created_at")
          .gte("created_at", since)
          .order("created_at"),
        supabase
          .from("entry_exit_events")
          .select("direction, created_at")
          .gte("created_at", since),
      ]);
      setLogs(l.data ?? []);
      setEvents(e.data ?? []);
      setLoading(false);
    })();
  }, []);

  const dailyData = useMemo(() => {
    const days: Record<string, { day: string; in: number; out: number; avg: number; samples: number }> = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      const key = d.toISOString().slice(0, 10);
      days[key] = { day: key.slice(5), in: 0, out: 0, avg: 0, samples: 0 };
    }
    for (const l of logs) {
      const k = (l.created_at as string).slice(0, 10);
      if (days[k]) {
        days[k].avg += l.count;
        days[k].samples += 1;
      }
    }
    Object.values(days).forEach((d) => {
      if (d.samples) d.avg = Math.round((d.avg / d.samples) * 10) / 10;
    });
    for (const e of events) {
      const k = (e.created_at as string).slice(0, 10);
      if (!days[k]) continue;
      if (e.direction === "in") days[k].in += 1;
      else days[k].out += 1;
    }
    return Object.values(days);
  }, [logs, events]);

  const totals = useMemo(() => {
    const totalIn = events.filter((e) => e.direction === "in").length;
    const totalOut = events.filter((e) => e.direction === "out").length;
    const peak = logs.reduce((m, l) => Math.max(m, l.count), 0);
    return { totalIn, totalOut, peak };
  }, [logs, events]);

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
        <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
        <p className="text-sm text-muted-foreground">Last 7 days overview</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Entries (7d)" value={totals.totalIn} />
        <Stat label="Exits (7d)" value={totals.totalOut} />
        <Stat label="Peak count" value={totals.peak} />
      </div>

      <Card className="border-border/60 bg-card p-5 shadow-card-soft">
        <h2 className="mb-4 text-sm font-semibold">Average occupancy per day</h2>
        <div className="h-72 w-full">
          <ResponsiveContainer>
            <AreaChart data={dailyData}>
              <defs>
                <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.5} />
                  <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" fontSize={11} />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} allowDecimals={false} />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 8,
                }}
              />
              <Area type="monotone" dataKey="avg" stroke="hsl(var(--primary))" fill="url(#g1)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card className="border-border/60 bg-card p-5 shadow-card-soft">
        <h2 className="mb-4 text-sm font-semibold">Entries vs exits per day</h2>
        <div className="h-72 w-full">
          <ResponsiveContainer>
            <BarChart data={dailyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" fontSize={11} />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} allowDecimals={false} />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 8,
                }}
              />
              <Bar dataKey="in" fill="hsl(var(--success))" radius={[4, 4, 0, 0]} />
              <Bar dataKey="out" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card className="border-border/60 bg-card p-5 shadow-card-soft">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-3xl font-bold text-gradient">{value}</p>
    </Card>
  );
}

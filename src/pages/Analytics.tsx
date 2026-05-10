import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Loader2, TrendingUp, Users, Activity, AlertOctagon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export default function AnalyticsPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = "Analytics · SentinelCount";
    (async () => {
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const [l, e, a] = await Promise.all([
        supabase
          .from("detection_logs")
          .select("count, created_at")
          .gte("created_at", since)
          .order("created_at"),
        supabase
          .from("entry_exit_events")
          .select("direction, created_at")
          .gte("created_at", since),
        supabase
          .from("alerts")
          .select("severity, created_at")
          .gte("created_at", since),
      ]);
      setLogs(l.data ?? []);
      setEvents(e.data ?? []);
      setAlerts(a.data ?? []);
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

  const hourlyData = useMemo(() => {
    const hours: Record<number, { hour: string; count: number }> = {};
    for (let h = 0; h < 24; h++) hours[h] = { hour: String(h).padStart(2, "0"), count: 0 };
    let counts: Record<number, number[]> = {};
    for (let h = 0; h < 24; h++) counts[h] = [];
    for (const l of logs) {
      const h = new Date(l.created_at).getHours();
      counts[h].push(l.count);
    }
    for (let h = 0; h < 24; h++) {
      if (counts[h].length) {
        hours[h].count = Math.round((counts[h].reduce((a, b) => a + b, 0) / counts[h].length) * 10) / 10;
      }
    }
    return Object.values(hours);
  }, [logs]);

  const liveTrend = useMemo(() => {
    return logs.slice(-60).map((l) => ({
      t: new Date(l.created_at).toLocaleTimeString().slice(0, 5),
      count: l.count,
    }));
  }, [logs]);

  const totals = useMemo(() => {
    const totalIn = events.filter((e) => e.direction === "in").length;
    const totalOut = events.filter((e) => e.direction === "out").length;
    const peak = logs.reduce((m, l) => Math.max(m, l.count), 0);
    const avg = logs.length
      ? Math.round((logs.reduce((s, l) => s + l.count, 0) / logs.length) * 10) / 10
      : 0;
    return { totalIn, totalOut, peak, avg };
  }, [logs, events]);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const tooltipStyle = {
    background: "hsl(var(--card))",
    border: "1px solid hsl(var(--border))",
    borderRadius: 8,
  };

  return (
    <div className="container space-y-6 py-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
        <p className="text-sm text-muted-foreground">Last 7 days overview</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Entries" value={totals.totalIn} icon={<TrendingUp className="h-4 w-4" />} />
        <Stat label="Exits" value={totals.totalOut} icon={<TrendingUp className="h-4 w-4 rotate-180" />} />
        <Stat label="Peak count" value={totals.peak} icon={<Users className="h-4 w-4" />} highlight />
        <Stat label="Avg occupancy" value={totals.avg} icon={<Activity className="h-4 w-4" />} />
        <Stat label="Alerts" value={alerts.length} icon={<AlertOctagon className="h-4 w-4" />} />
      </div>

      <Card className="border-border/60 bg-card p-5 shadow-card-soft">
        <h2 className="mb-4 text-sm font-semibold">Live count trend (recent samples)</h2>
        <div className="h-56 w-full">
          <ResponsiveContainer>
            <LineChart data={liveTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="t" stroke="hsl(var(--muted-foreground))" fontSize={11} />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle} />
              <Line
                type="monotone"
                dataKey="count"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                dot={false}
                isAnimationActive
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
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
                <Tooltip contentStyle={tooltipStyle} />
                <Area type="monotone" dataKey="avg" stroke="hsl(var(--primary))" fill="url(#g1)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="border-border/60 bg-card p-5 shadow-card-soft">
          <h2 className="mb-4 text-sm font-semibold">Hourly average occupancy</h2>
          <div className="h-72 w-full">
            <ResponsiveContainer>
              <BarChart data={hourlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="hour" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="count" fill="hsl(var(--accent))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card className="border-border/60 bg-card p-5 shadow-card-soft">
        <h2 className="mb-4 text-sm font-semibold">Entries vs exits per day</h2>
        <div className="h-72 w-full">
          <ResponsiveContainer>
            <BarChart data={dailyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" fontSize={11} />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="in" fill="hsl(var(--success))" radius={[4, 4, 0, 0]} />
              <Bar dataKey="out" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}

function Stat({
  label,
  value,
  icon,
  highlight,
}: {
  label: string;
  value: number;
  icon?: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <Card
      className={`relative overflow-hidden border-border/60 bg-card p-5 shadow-card-soft ${
        highlight ? "ring-1 ring-primary/40" : ""
      }`}
    >
      {highlight && <div className="absolute inset-0 gradient-primary opacity-[0.06]" aria-hidden />}
      <div className="relative flex items-center justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
          <p className={`mt-1 font-mono text-3xl font-bold ${highlight ? "text-gradient" : ""}`}>{value}</p>
        </div>
        {icon && (
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary text-primary">{icon}</div>
        )}
      </div>
    </Card>
  );
}

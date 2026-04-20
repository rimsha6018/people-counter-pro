export interface LogEntry {
  id: string;
  timestamp: number;
  count: number;
  source: "webcam" | "video";
}

export function exportLogsToCsv(logs: LogEntry[]) {
  const header = "timestamp,iso_time,count,source\n";
  const rows = logs
    .map((l) => `${l.timestamp},${new Date(l.timestamp).toISOString()},${l.count},${l.source}`)
    .join("\n");
  const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `employee-detection-log-${new Date().toISOString().slice(0, 19)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

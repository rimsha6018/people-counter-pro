// Browser-safe export helpers: CSV, JSON, and printable HTML report (Save as PDF).

function download(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function toCsv(rows: any[]): string {
  if (!rows.length) return "";
  const keys = Array.from(
    rows.reduce<Set<string>>((set, r) => {
      Object.keys(r).forEach((k) => set.add(k));
      return set;
    }, new Set<string>()),
  );
  const escape = (v: unknown) => {
    const s = typeof v === "object" && v !== null ? JSON.stringify(v) : String(v ?? "");
    return `"${s.replace(/"/g, '""')}"`;
  };
  return [keys.join(","), ...rows.map((r) => keys.map((k) => escape((r as any)[k])).join(","))].join("\n");
}

export function exportCsv(rows: any[], name: string) {
  const csv = toCsv(rows);
  download(`${name}-${new Date().toISOString().slice(0, 19)}.csv`, new Blob([csv], { type: "text/csv;charset=utf-8" }));
}

export function exportJson(rows: any[], name: string) {
  download(
    `${name}-${new Date().toISOString().slice(0, 19)}.json`,
    new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" }),
  );
}

interface PdfReportInput {
  title: string;
  generatedAt?: Date;
  summary?: { label: string; value: string | number }[];
  sections: { heading: string; rows: any[] }[];
}

/** Opens a print-ready HTML report; user can choose "Save as PDF" in the print dialog. */
export function exportPdfReport(input: PdfReportInput) {
  const win = window.open("", "_blank", "width=900,height=900");
  if (!win) return;
  const date = input.generatedAt ?? new Date();
  const summaryHtml = (input.summary ?? [])
    .map(
      (s) => `
    <div class="card">
      <div class="card-label">${s.label}</div>
      <div class="card-value">${s.value}</div>
    </div>`,
    )
    .join("");

  const sectionsHtml = input.sections
    .map((sec) => {
      if (!sec.rows.length) {
        return `<h2>${sec.heading}</h2><p class="muted">No records.</p>`;
      }
      const keys = Object.keys(sec.rows[0]);
      const head = keys.map((k) => `<th>${k}</th>`).join("");
      const body = sec.rows
        .slice(0, 500)
        .map(
          (r) =>
            `<tr>${keys
              .map((k) => `<td>${escapeHtml(formatCell((r as any)[k]))}</td>`)
              .join("")}</tr>`,
        )
        .join("");
      return `
        <h2>${sec.heading} <span class="muted">(${sec.rows.length} records)</span></h2>
        <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
    })
    .join("");

  win.document.write(`
<!doctype html><html><head><meta charset="utf-8"><title>${input.title}</title>
<style>
  body { font-family: Inter, system-ui, sans-serif; color:#111; padding: 32px; }
  h1 { margin: 0 0 4px; font-size: 22px; }
  h2 { margin-top: 28px; font-size: 15px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
  .muted { color: #777; font-weight: normal; font-size: 12px; }
  .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-top: 20px; }
  .card { border: 1px solid #ddd; border-radius: 8px; padding: 12px; }
  .card-label { font-size: 11px; color:#666; text-transform: uppercase; letter-spacing: 0.05em; }
  .card-value { font-size: 22px; font-weight: 700; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 8px; }
  th, td { border: 1px solid #e5e5e5; padding: 4px 6px; text-align: left; vertical-align: top; }
  th { background: #f5f5f5; }
  @media print { body { padding: 18px; } }
</style></head><body>
<h1>${input.title}</h1>
<p class="muted">Generated ${date.toLocaleString()}</p>
<div class="summary">${summaryHtml}</div>
${sectionsHtml}
<script>window.onload = () => setTimeout(() => window.print(), 300);</script>
</body></html>`);
  win.document.close();
}

function formatCell(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

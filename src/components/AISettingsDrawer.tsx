import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useSettings } from "@/lib/settings";

export function AISettingsDrawer() {
  const [s, update] = useSettings();
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Settings2 className="h-4 w-4" /> AI Settings
        </Button>
      </SheetTrigger>
      <SheetContent className="w-[340px] sm:w-[380px]">
        <SheetHeader>
          <SheetTitle>AI Detection Settings</SheetTitle>
          <SheetDescription>Tuning preferences are saved on this device.</SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6 text-sm">
          <Group>
            <Label>Confidence threshold</Label>
            <div className="flex items-center gap-3">
              <Slider
                value={[s.confidence]}
                min={0.2}
                max={0.95}
                step={0.05}
                onValueChange={([v]) => update({ confidence: v })}
              />
              <span className="w-10 text-right font-mono text-xs">{s.confidence.toFixed(2)}</span>
            </div>
          </Group>

          <Group>
            <Label>Detection interval</Label>
            <div className="flex items-center gap-3">
              <Slider
                value={[s.intervalMs]}
                min={100}
                max={1000}
                step={50}
                onValueChange={([v]) => update({ intervalMs: v })}
              />
              <span className="w-14 text-right font-mono text-xs">{s.intervalMs}ms</span>
            </div>
          </Group>

          <Group>
            <Label>Tracking persistence</Label>
            <div className="flex items-center gap-3">
              <Slider
                value={[s.trackingPersistMs]}
                min={500}
                max={5000}
                step={250}
                onValueChange={([v]) => update({ trackingPersistMs: v })}
              />
              <span className="w-16 text-right font-mono text-xs">{s.trackingPersistMs}ms</span>
            </div>
          </Group>

          <ToggleRow label="Show bounding boxes" checked={s.showBoxes} onChange={(v) => update({ showBoxes: v })} />
          <ToggleRow label="Show labels" checked={s.showLabels} onChange={(v) => update({ showLabels: v })} />
          <ToggleRow label="Show counting line" checked={s.showLine} onChange={(v) => update({ showLine: v })} />
          <ToggleRow label="Tracking trails" checked={s.showTrails} onChange={(v) => update({ showTrails: v })} />
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Group({ children }: { children: React.ReactNode }) {
  return <div className="space-y-2">{children}</div>;
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border/60 bg-muted/30 px-3 py-2">
      <Label className="cursor-pointer">{label}</Label>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

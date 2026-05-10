import { Outlet } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { roleLabel } from "@/lib/permissions";
import { IdleLogout } from "@/components/IdleLogout";

export default function AppLayout() {
  const { roles, isAdmin } = useAuth();
  const label = roleLabel(roles);
  return (
    <SidebarProvider>
      <IdleLogout />
      <div className="flex min-h-screen w-full bg-background">
        <AppSidebar />
        <div className="flex flex-1 flex-col">
          <header className="flex h-12 items-center justify-between border-b border-border/60 bg-card/40 px-3 backdrop-blur">
            <SidebarTrigger />
            <div className="flex items-center gap-2">
              <span className="hidden text-xs text-muted-foreground sm:inline">
                Status:{" "}
                <span className="inline-flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" /> online
                </span>
              </span>
              <Badge variant={isAdmin ? "default" : "outline"} className="text-[10px] uppercase">
                {label}
              </Badge>
            </div>
          </header>
          <main className="relative flex-1">
            <div className="pointer-events-none fixed inset-0 glow-bg" aria-hidden />
            <div className="relative">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

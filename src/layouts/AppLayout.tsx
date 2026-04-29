import { Outlet } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";

export default function AppLayout() {
  const { isAdmin } = useAuth();
  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <AppSidebar />
        <div className="flex flex-1 flex-col">
          <header className="flex h-12 items-center justify-between border-b border-border/60 bg-card/40 px-3 backdrop-blur">
            <SidebarTrigger />
            <Badge variant={isAdmin ? "default" : "outline"} className="text-[10px] uppercase">
              {isAdmin ? "Admin" : "User"}
            </Badge>
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

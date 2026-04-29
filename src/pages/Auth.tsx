import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

const emailSchema = z.string().trim().email("Invalid email").max(255);
const passwordSchema = z.string().min(6, "Min 6 characters").max(72);
const nameSchema = z.string().trim().min(1, "Required").max(100);

export default function Auth() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  // login state
  const [li, setLi] = useState({ email: "", password: "" });
  // signup state
  const [su, setSu] = useState({ name: "", email: "", password: "" });

  useEffect(() => {
    document.title = "Sign in · SentinelCount";
  }, []);

  if (loading) return null;
  if (user) return <Navigate to="/" replace />;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      emailSchema.parse(li.email);
      passwordSchema.parse(li.password);
    } catch (err: any) {
      toast.error(err.errors?.[0]?.message ?? "Invalid input");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: li.email,
      password: li.password,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Welcome back");
    navigate("/", { replace: true });
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      nameSchema.parse(su.name);
      emailSchema.parse(su.email);
      passwordSchema.parse(su.password);
    } catch (err: any) {
      toast.error(err.errors?.[0]?.message ?? "Invalid input");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.signUp({
      email: su.email,
      password: su.password,
      options: {
        emailRedirectTo: `${window.location.origin}/`,
        data: { full_name: su.name },
      },
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Account created", { description: "You can now sign in." });
    navigate("/", { replace: true });
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background p-4">
      <div className="pointer-events-none fixed inset-0 glow-bg" aria-hidden />
      <Card className="relative w-full max-w-md border-border/60 bg-card p-8 shadow-card-soft">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl gradient-primary shadow-glow">
            <ShieldCheck className="h-6 w-6 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">SentinelCount</h1>
            <p className="text-sm text-muted-foreground">AI Employee Monitoring</p>
          </div>
        </div>

        <Tabs defaultValue="login">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="login">Sign in</TabsTrigger>
            <TabsTrigger value="signup">Sign up</TabsTrigger>
          </TabsList>

          <TabsContent value="login">
            <form onSubmit={handleLogin} className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label htmlFor="li-email">Email</Label>
                <Input
                  id="li-email"
                  type="email"
                  autoComplete="email"
                  value={li.email}
                  onChange={(e) => setLi({ ...li, email: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="li-pw">Password</Label>
                <Input
                  id="li-pw"
                  type="password"
                  autoComplete="current-password"
                  value={li.password}
                  onChange={(e) => setLi({ ...li, password: e.target.value })}
                  required
                />
              </div>
              <Button type="submit" disabled={busy} className="w-full">
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Sign in
              </Button>
            </form>
          </TabsContent>

          <TabsContent value="signup">
            <form onSubmit={handleSignup} className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label htmlFor="su-name">Full name</Label>
                <Input
                  id="su-name"
                  value={su.name}
                  onChange={(e) => setSu({ ...su, name: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="su-email">Email</Label>
                <Input
                  id="su-email"
                  type="email"
                  autoComplete="email"
                  value={su.email}
                  onChange={(e) => setSu({ ...su, email: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="su-pw">Password</Label>
                <Input
                  id="su-pw"
                  type="password"
                  autoComplete="new-password"
                  value={su.password}
                  onChange={(e) => setSu({ ...su, password: e.target.value })}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  First account becomes admin automatically.
                </p>
              </div>
              <Button type="submit" disabled={busy} className="w-full">
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Create account
              </Button>
            </form>
          </TabsContent>
        </Tabs>
      </Card>
    </div>
  );
}

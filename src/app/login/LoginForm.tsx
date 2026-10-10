"use client";

import { Lock, Mail } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, inputClass } from "@/components/ui";
import { api } from "@/lib/client";

export function LoginForm({ next }: { next?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setLoading(true);
    try {
      const { data } = await api<{ redirectTo: string }>("/api/auth/login", { method: "POST", body: { email, password } });
      router.replace(next ?? data.redirectTo);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-4" noValidate>
      {error && <Alert>{error}</Alert>}
      <div>
        <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-slate-700">Email</label>
        <div className="relative">
          <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className={`${inputClass} pl-9`} placeholder="you@hospital.com" />
        </div>
      </div>
      <div>
        <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-slate-700">Password</label>
        <div className="relative">
          <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={`${inputClass} pl-9`} />
        </div>
      </div>
      <Button type="submit" loading={loading} className="w-full py-2.5">
        {loading ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}

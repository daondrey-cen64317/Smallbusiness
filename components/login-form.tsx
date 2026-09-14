"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { ShieldCheck, UserRound } from "lucide-react";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();

  const buttonLabel = useMemo(() => {
    if (isLoading) {
      return "Prosím čekej…";
    }
    return mode === "login" ? "Přihlásit" : "Vytvořit účet";
  }, [isLoading, mode]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setIsLoading(true);

    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          throw error;
        }
        router.push("/");
        router.refresh();
      } else {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) {
          throw error;
        }
        setMessage("Účet byl vytvořen. Pokud je vyžadováno, potvrď e-mail a přihlas se.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Přihlášení selhalo.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Sales Gym</h1>
        <ShieldCheck className="h-5 w-5 text-blue-700" />
      </div>

      <p className="mb-5 text-sm text-slate-600">10 minut, 2× týdně. Mikro-learning pro bankovní prodej.</p>

      <div className="mb-4 flex gap-2 rounded-lg bg-slate-100 p-1">
        <button
          type="button"
          className={`w-1/2 rounded-md px-3 py-2 text-sm font-medium ${
            mode === "login" ? "bg-white text-blue-700 shadow-sm" : "text-slate-600"
          }`}
          onClick={() => setMode("login")}
        >
          Přihlášení
        </button>
        <button
          type="button"
          className={`w-1/2 rounded-md px-3 py-2 text-sm font-medium ${
            mode === "signup" ? "bg-white text-blue-700 shadow-sm" : "text-slate-600"
          }`}
          onClick={() => setMode("signup")}
        >
          Registrace
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">E-mail</label>
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            type="email"
            required
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-600 transition focus:ring-2"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Heslo</label>
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            required
            minLength={6}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-600 transition focus:ring-2"
          />
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-800 disabled:opacity-70"
        >
          <UserRound className="h-4 w-4" />
          {buttonLabel}
        </button>
      </form>

      {message ? <p className="mt-4 text-sm text-slate-600">{message}</p> : null}
    </div>
  );
}

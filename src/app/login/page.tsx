"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";

const initial: LoginState = {};

const agentes = [
  { nombre: "Orquestador", color: "bg-violet-500", glow: "shadow-violet-500/60" },
  { nombre: "Develop", color: "bg-blue-500", glow: "shadow-blue-500/60" },
  { nombre: "Testing", color: "bg-emerald-500", glow: "shadow-emerald-500/60" },
];

const inputClass =
  "w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3.5 py-2.5 text-slate-100 placeholder:text-slate-500 transition-colors duration-200 hover:border-slate-600 focus:border-violet-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60 aria-[invalid=true]:border-red-500/70";

export default function LoginPage() {
  const [state, action, pending] = useActionState(login, initial);
  const hasError = Boolean(state.error);

  return (
    <main className="relative flex min-h-screen flex-1 items-center justify-center overflow-hidden bg-slate-950 p-6 text-slate-100">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(139,92,246,0.18),transparent_55%),radial-gradient(ellipse_at_bottom_right,rgba(16,185,129,0.10),transparent_50%),radial-gradient(ellipse_at_bottom_left,rgba(59,130,246,0.12),transparent_50%)]"
      />

      <div className="relative w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="flex items-center gap-2" aria-hidden="true">
            {agentes.map((a) => (
              <span
                key={a.nombre}
                className={`h-3 w-3 rounded-full shadow-[0_0_12px] ${a.color} ${a.glow}`}
              />
            ))}
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Equipo de agentes
          </h1>
          <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-slate-400">
            {agentes.map((a) => (
              <li key={a.nombre} className="flex items-center gap-1.5">
                <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${a.color}`} />
                {a.nombre}
              </li>
            ))}
          </ul>
        </div>

        <form
          action={action}
          className="space-y-5 rounded-2xl border border-slate-700/70 bg-gradient-to-b from-slate-800/70 to-slate-900/80 p-7 shadow-2xl shadow-black/40 backdrop-blur"
        >
          <div className="space-y-1.5">
            <label htmlFor="user" className="block text-sm font-medium text-slate-300">
              Usuario
            </label>
            <input
              id="user"
              name="user"
              type="text"
              autoComplete="username"
              required
              aria-invalid={hasError}
              aria-describedby="login-error"
              className={inputClass}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="password" className="block text-sm font-medium text-slate-300">
              Contraseña
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              aria-invalid={hasError}
              aria-describedby="login-error"
              className={inputClass}
            />
          </div>

          <div id="login-error" role="alert" aria-live="polite" className="min-h-0">
            {state.error && (
              <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                {state.error}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-lg bg-gradient-to-r from-violet-600 via-blue-600 to-emerald-600 px-4 py-2.5 font-medium text-white shadow-lg shadow-violet-900/30 transition duration-200 hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? "Entrando…" : "Entrar"}
          </button>
        </form>
      </div>
    </main>
  );
}

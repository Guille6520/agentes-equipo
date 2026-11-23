"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  SESSION_COOKIE,
  checkCredentials,
  createSessionToken,
  sessionCookieOptions,
} from "@/lib/auth";

export type LoginState = { error?: string };

// Limitación simple en memoria: 5 fallos / 10 min por IP.
const MAX_FAILS = 5;
const WINDOW_MS = 10 * 60 * 1000;
const fails = new Map<string, { count: number; first: number }>();

export async function login(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
  const now = Date.now();
  const rec = fails.get(ip);
  if (rec && now - rec.first > WINDOW_MS) fails.delete(ip);
  const cur = fails.get(ip);
  if (cur && cur.count >= MAX_FAILS) {
    return { error: "Demasiados intentos. Inténtalo de nuevo en unos minutos." };
  }

  const user = String(formData.get("user") ?? "");
  const password = String(formData.get("password") ?? "");

  if (!checkCredentials(user, password)) {
    fails.set(ip, { count: (cur?.count ?? 0) + 1, first: cur?.first ?? now });
    return { error: "Usuario o contraseña incorrectos." };
  }

  fails.delete(ip);
  const store = await cookies();
  store.set(SESSION_COOKIE, createSessionToken(user), sessionCookieOptions);
  redirect("/");
}

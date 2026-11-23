import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "session";
export const SESSION_MAX_AGE = 8 * 60 * 60; // 8 horas, en segundos

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET no está definida");
  return s;
}

function sign(data: string): string {
  return createHmac("sha256", secret()).update(data).digest("base64url");
}

/** Comparación en tiempo constante, independiente de la longitud. */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHmac("sha256", "cmp").update(a).digest();
  const hb = createHmac("sha256", "cmp").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function checkCredentials(user: string, password: string): boolean {
  const u = process.env.DEMO_USER;
  const p = process.env.DEMO_PASSWORD;
  if (!u || !p) return false;
  // Se evalúan ambas para no filtrar cuál falla.
  const okUser = safeEqual(user, u);
  const okPass = safeEqual(password, p);
  return okUser && okPass;
}

export function createSessionToken(user: string): string {
  const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE;
  const payload = Buffer.from(JSON.stringify({ u: user, exp })).toString(
    "base64url",
  );
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(
  token: string | undefined,
): { user: string } | null {
  if (!token) return null;
  const [payload, sig, extra] = token.split(".");
  if (!payload || !sig || extra !== undefined) return null;
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (typeof data.exp !== "number" || data.exp < Date.now() / 1000)
      return null;
    return { user: String(data.u) };
  } catch {
    return null;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_MAX_AGE,
};

// Tacha secretos en los textos que salen del servidor (eventos, feedback de Testing, mensajes de error).
//
// Dos fuentes:
// 1. Los VALORES de las variables de entorno del proceso que no sean públicas ni triviales (longitud >= 8).
//    Se leen en cada llamada, así que cubren también variables añadidas después de arrancar.
// 2. Patrones de claves conocidas aunque no estén en el entorno: nvapi-, gsk_, AIza, sk-, y las
//    credenciales de una URL postgres(ql)://usuario:clave@.
// Es la última capa: el render aislado ya no tiene secretos que filtrar, pero si alguno llegara a un
// texto (un error de un proveedor, una excepción con la URL de la BD...), aquí se tacha.

export const REDACTED = "[oculto]";
const MIN_SECRET_LENGTH = 8;

/** Variables que no son secretas (rutas, nombres de sistema, entorno de Vercel...). Mayúsculas. */
const PUBLIC_NAMES = new Set([
  "NODE_ENV", "PATH", "HOME", "PWD", "OLDPWD", "SHELL", "USER", "LOGNAME", "LANG", "LANGUAGE", "TZ", "TERM",
  "HOSTNAME", "TMPDIR", "TEMP", "TMP", "SHLVL", "COLORTERM", "TERM_PROGRAM", "TERM_PROGRAM_VERSION", "EDITOR",
  "NODE_OPTIONS", "NODE_PATH", "NEXT_RUNTIME", "NEXT_TELEMETRY_DISABLED", "NEXT_PHASE", "PORT", "CI",
  "VERCEL", "VERCEL_ENV", "VERCEL_REGION", "VERCEL_URL", "VERCEL_BRANCH_URL", "VERCEL_PROJECT_PRODUCTION_URL",
  "VERCEL_GIT_PROVIDER", "VERCEL_GIT_REPO_SLUG", "VERCEL_GIT_REPO_OWNER", "VERCEL_GIT_COMMIT_REF",
  "VERCEL_GIT_COMMIT_SHA", "VERCEL_GIT_COMMIT_MESSAGE", "VERCEL_GIT_COMMIT_AUTHOR_LOGIN", "VERCEL_GIT_COMMIT_AUTHOR_NAME",
  "AWS_REGION", "AWS_DEFAULT_REGION", "AWS_EXECUTION_ENV", "AWS_LAMBDA_FUNCTION_NAME", "AWS_LAMBDA_FUNCTION_VERSION",
  "AWS_LAMBDA_FUNCTION_MEMORY_SIZE", "AWS_LAMBDA_LOG_GROUP_NAME", "AWS_LAMBDA_LOG_STREAM_NAME", "LAMBDA_TASK_ROOT",
  "LAMBDA_RUNTIME_DIR", "LD_LIBRARY_PATH",
  // Windows
  "SYSTEMROOT", "SYSTEMDRIVE", "WINDIR", "COMSPEC", "PATHEXT", "OS", "USERNAME", "USERDOMAIN", "USERDOMAIN_ROAMINGPROFILE",
  "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "LOGONSERVER", "COMPUTERNAME", "APPDATA", "LOCALAPPDATA", "PROGRAMDATA",
  "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMW6432", "COMMONPROGRAMFILES", "COMMONPROGRAMFILES(X86)", "COMMONPROGRAMW6432",
  "PUBLIC", "ALLUSERSPROFILE", "DRIVERDATA", "ONEDRIVE", "PSMODULEPATH", "SESSIONNAME", "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE", "PROCESSOR_IDENTIFIER", "PROCESSOR_LEVEL", "PROCESSOR_REVISION",
]);
const PUBLIC_PREFIXES = ["NEXT_PUBLIC_", "NPM_", "npm_", "VSCODE_", "GIT_", "TERM_", "XDG_", "LC_", "MSYS", "MINGW", "ORIGINAL_", "EXEPATH", "ACSVC"];

/** ¿Parece una ruta del sistema (no un secreto)? `C:\...`, `/usr/...`, listas separadas por `;` o `:` de rutas. */
const looksLikePath = (v: string) => /^(?:[A-Za-z]:[\\/]|\/|\\\\)/.test(v) && !/:\/\/|@/.test(v);

function isSensitiveEnv(name: string, value: string | undefined): value is string {
  if (!value || value.length < MIN_SECRET_LENGTH) return false;
  const upper = name.toUpperCase();
  if (PUBLIC_NAMES.has(upper) || PUBLIC_PREFIXES.some((p) => name.startsWith(p) || upper.startsWith(p.toUpperCase()))) return false;
  if (looksLikePath(value)) return false;
  // Booleanos y números no son secretos ("production", "true", "8080"...).
  if (/^(?:true|false|production|development|preview|test|\d+)$/i.test(value)) return false;
  return true;
}

/** Valores sensibles del entorno actual, de más largo a más corto (así un valor que contiene a otro se tacha entero). */
export function sensitiveEnvValues(env: Record<string, string | undefined> = process.env): string[] {
  const values = new Set<string>();
  for (const [name, value] of Object.entries(env)) if (isSensitiveEnv(name, value)) values.add(value);
  return [...values].sort((a, b) => b.length - a.length);
}

const PATTERNS: [RegExp, string][] = [
  [/nvapi-[A-Za-z0-9_-]{8,}/g, REDACTED],
  [/\bgsk_[A-Za-z0-9]{8,}/g, REDACTED],
  [/AIza[0-9A-Za-z_-]{16,}/g, REDACTED],
  [/\bsk-[A-Za-z0-9_-]{16,}/g, REDACTED],
  // Solo las credenciales: se conserva el esquema y el host para que el mensaje siga siendo útil.
  [/\b(postgres(?:ql)?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, `$1${REDACTED}@`],
];

/** Reemplaza por «[oculto]» los valores de variables sensibles y las claves con formato conocido. */
export function redact(text: string, env: Record<string, string | undefined> = process.env): string {
  if (!text) return text;
  let out = text;
  for (const value of sensitiveEnvValues(env)) if (out.includes(value)) out = out.split(value).join(REDACTED);
  for (const [re, by] of PATTERNS) out = out.replace(re, by);
  return out;
}

/** `redact` para valores opcionales (null/undefined se devuelven tal cual). */
export const redactNullable = <T extends string | null | undefined>(text: T): T =>
  (typeof text === "string" ? redact(text) : text) as T;

// Inserta un run de ejemplo para ver la UI sin motor de agentes.
// Uso: npx tsx scripts/seed-demo.ts   (lee DATABASE_URL de .env.local; no se imprime)
import { config } from "dotenv";

config({ path: ".env.local" });

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Falta DATABASE_URL en .env.local");
    process.exit(1);
  }
  const { db, runs, tasks, files, events } = await import("../src/db");

  const t0 = Date.now() - 4 * 60_000;
  const at = (sec: number) => new Date(t0 + sec * 1000);

  const [run] = await db
    .insert(runs)
    .values({ request: "[Ejemplo: ejecución simulada en curso] Añade una página de contacto", status: "running", createdAt: at(0) })
    .returning();

  const inserted = await db
    .insert(tasks)
    .values([
      {
        runId: run.id,
        title: "Crear la página /contacto",
        description: "Página con título, texto introductorio y el formulario de contacto.",
        status: "passed",
        attempts: 1,
        lastFeedback: "Cumple los criterios: la página renderiza y es accesible.",
        createdAt: at(5),
        updatedAt: at(80),
      },
      {
        runId: run.id,
        title: "Formulario con validación",
        description: "Campos nombre, email y mensaje con validación en cliente.",
        status: "failed",
        attempts: 2,
        lastFeedback: "El campo email acepta valores sin @ y falta mostrar los errores.",
        createdAt: at(5),
        updatedAt: at(150),
      },
      {
        runId: run.id,
        title: "Enlace en la navegación",
        description: "Añadir el enlace 'Contacto' a la cabecera del sitio.",
        status: "running",
        attempts: 1,
        createdAt: at(5),
        updatedAt: at(200),
      },
      {
        runId: run.id,
        title: "Estilos responsive",
        description: "Ajustar el diseño para móvil y escritorio.",
        status: "pending",
        attempts: 0,
        createdAt: at(5),
        updatedAt: at(5),
      },
    ])
    .returning();
  const [pagina, formulario, nav] = inserted;

  await db.insert(files).values([
    {
      taskId: pagina.id,
      path: "src/app/contacto/page.tsx",
      version: 1,
      createdAt: at(60),
      content: `import { ContactForm } from "@/components/ContactForm";

// Página de contacto
export default function ContactoPage() {
  return (
    <main className="mx-auto max-w-lg p-6">
      <h1 className="text-2xl font-bold">Contacto</h1>
      <p className="mt-2">Escríbenos y te responderemos en 24 horas.</p>
      <ContactForm />
    </main>
  );
}
`,
    },
    {
      taskId: formulario.id,
      path: "src/components/ContactForm.tsx",
      version: 1,
      createdAt: at(110),
      content: `"use client";
import { useState } from "react";

export function ContactForm() {
  const [email, setEmail] = useState("");
  return (
    <form className="mt-4 space-y-3">
      <input type="text" value={email} onChange={(e) => setEmail(e.target.value)} />
      <button type="submit">Enviar</button>
    </form>
  );
}
`,
    },
    {
      taskId: formulario.id,
      path: "src/components/ContactForm.tsx",
      version: 2,
      createdAt: at(140),
      content: `"use client";
import { useState } from "react";

export function ContactForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  function validate() {
    // TODO: validar formato de email
    setError(email.length > 0 ? null : "El email es obligatorio");
  }

  return (
    <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); validate(); }}>
      <label htmlFor="email">Email</label>
      <input id="email" type="text" value={email} onChange={(e) => setEmail(e.target.value)} />
      {error && <p role="alert">{error}</p>}
      <button type="submit">Enviar</button>
    </form>
  );
}
`,
    },
    {
      taskId: nav.id,
      path: "src/components/Nav.tsx",
      version: 1,
      createdAt: at(195),
      content: `import Link from "next/link";

export function Nav() {
  return (
    <nav className="flex gap-4">
      <Link href="/">Inicio</Link>
      <Link href="/contacto">Contacto</Link>
    </nav>
  );
}
`,
    },
  ]);

  await db.insert(events).values([
    { runId: run.id, agent: "orchestrator", message: "Petición recibida", createdAt: at(0) },
    { runId: run.id, agent: "orchestrator", message: "Plan creado: 4 tareas para la página de contacto", createdAt: at(5) },
    { runId: run.id, taskId: pagina.id, agent: "develop", message: "Escribiendo src/app/contacto/page.tsx", createdAt: at(30) },
    { runId: run.id, taskId: pagina.id, agent: "testing", message: "Revisando la página de contacto", createdAt: at(65) },
    { runId: run.id, taskId: pagina.id, agent: "testing", message: "Tarea aprobada a la primera", createdAt: at(80) },
    { runId: run.id, taskId: formulario.id, agent: "develop", message: "Escribiendo ContactForm.tsx (intento 1)", createdAt: at(100) },
    { runId: run.id, taskId: formulario.id, agent: "testing", message: "Rechazada: el email no se valida bien", createdAt: at(125) },
    { runId: run.id, taskId: formulario.id, agent: "develop", message: "Corrigiendo con el feedback (intento 2)", createdAt: at(135) },
    { runId: run.id, taskId: formulario.id, agent: "testing", message: "Rechazada de nuevo: faltan mensajes de error", createdAt: at(150) },
    { runId: run.id, taskId: nav.id, agent: "develop", message: "Añadiendo el enlace Contacto a Nav.tsx", createdAt: at(190) },
  ]);

  console.log(`Run de demo creado con id ${run.id} (${inserted.length} tareas).`);
}

main().catch((e) => {
  console.error("Error en el seed:", e instanceof Error ? e.message.replace(/postgres(ql)?:\/\/\S+/g, "[url]") : "desconocido");
  process.exit(1);
});

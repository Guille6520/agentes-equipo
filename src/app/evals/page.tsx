import type { Metadata } from "next";
import { EvalsDashboard } from "@/components/evals/EvalsDashboard";

export const metadata: Metadata = {
  title: "Evaluación de modelos · Equipo de agentes",
  description: "Comparativa de modelos para los tres agentes y relanzamiento de la evaluación con los modelos finalistas.",
};

export default function EvalsPage() {
  return <EvalsDashboard />;
}

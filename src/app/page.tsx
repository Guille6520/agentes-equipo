import type { Metadata } from "next";
import { Dashboard } from "@/components/Dashboard";

export const metadata: Metadata = {
  title: "Equipo de agentes",
  description: "Panel en vivo del equipo de agentes: orquestador, develop y testing.",
};

export default function Home() {
  return <Dashboard />;
}

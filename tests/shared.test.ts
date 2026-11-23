import "./setup";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { profileFor } from "@/lib/engine/shared";

describe("profileFor", () => {
  it("sin formulario: basic", () => assert.equal(profileFor("Enlace en la navegación", "Añade un enlace"), "basic"));
  it("formulario de contacto", () => assert.equal(profileFor("Formulario de contacto", "nombre, email y mensaje"), "contact-form"));
  it("contact en inglés", () => assert.equal(profileFor("Contact form", "x"), "contact-form"));
  it("formulario genérico (newsletter)", () => assert.equal(profileFor("Formulario de newsletter", "suscripción"), "form"));
  it("detecta 'form' como palabra", () => assert.equal(profileFor("Signup form", ""), "form"));
  it("'platform' no cuenta como form", () => assert.equal(profileFor("Platform header", "info"), "basic"));
});

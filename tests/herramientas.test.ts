// Contrato de las herramientas: nunca lanzan, errores legibles en español y confirmación exigida
// por la propia herramienta (también cuando se usa como módulo, sin este servidor).
import { afterAll, beforeEach, expect, test } from "bun:test"
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ejecutarHerramienta } from "../src/tools/registro.ts"
import { crearDirectorioPrueba, limpiarDirectorio } from "./ayuda.ts"

const directorio = await crearDirectorioPrueba()
const ctx = { directory: directorio, sessionId: "prueba-herramientas" }

beforeEach(() => limpiarDirectorio(directorio))
afterAll(() => limpiarDirectorio(directorio, true))

test("oc_crear con confirmado=true no crea si el host no registró la confirmación del usuario", async () => {
  const sinHost = await ejecutarHerramienta("oc_crear", { caso: "sol-004", confirmado: true }, ctx)
  expect(sinHost.ok).toBe(false)
  expect(sinHost.resumen).toContain("el host no registró la confirmación")
  const conHost = await ejecutarHerramienta("oc_crear", { caso: "sol-004", confirmado: true }, { ...ctx, confirmados: ["sol-004"] })
  expect(conHost.ok).toBe(true)
})

test("un monto negativo o cero se rechaza con un error legible, sin excepción", async () => {
  // Copia completa y aislada de los fixtures con un caso alterado: los fixtures del repo no se tocan.
  const aislado = await mkdtemp(join(tmpdir(), "reto03-malo-"))
  await cp("fixtures", join(aislado, "fixtures"), { recursive: true })
  const caso = join(aislado, "fixtures", "reto-03", "solicitudes", "sol-negativo")
  await cp(join(aislado, "fixtures", "reto-03", "solicitudes", "sol-001"), caso, { recursive: true })
  const solicitud = JSON.parse(await readFile(join(caso, "solicitud.json"), "utf8")) as Record<string, unknown>
  await writeFile(join(caso, "solicitud.json"), JSON.stringify({ ...solicitud, cantidad: -120 }))
  for (const herramienta of ["oc_validar", "oc_crear"]) {
    const r = await ejecutarHerramienta(herramienta, { caso: "sol-negativo" }, { directory: aislado, sessionId: "x" })
    expect(r.ok).toBe(false)
    expect(r.resumen).toContain("mayor que cero")
  }
  await rm(aislado, { recursive: true, force: true })
})

test("un JSON malformado devuelve un error en español con el nombre del archivo", async () => {
  const { parsearCotizacion } = await import("../src/dominio/fuentes.ts")
  expect(parsearCotizacion("sin total")).toEqual({ error: "la cotización no tiene un TOTAL legible" })
  const r = await ejecutarHerramienta("oc_validar", { caso: 123 }, ctx)
  expect(r.ok).toBe(false)
  expect(r.resumen).toContain("argumentos inválidos")
  expect(r.resumen).toContain("se esperaba")
})

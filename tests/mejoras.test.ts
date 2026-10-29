// Mejoras posteriores a la primera entrega: lectura de .xlsx real (P1), tope diario persistente
// y control de vigencia de la cotización dentro de RC5.
import { afterAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import ExcelJS from "exceljs"
import { ConsumoDiario } from "../src/agent/consumo.ts"
import { validarPaquete } from "../src/dominio/controles.ts"
import { cargarMaestros, cargarPaquete } from "../src/dominio/fuentes.ts"
import { ejecutarHerramienta } from "../src/tools/registro.ts"

const aislado = await mkdtemp(join(tmpdir(), "reto03-mejoras-"))
afterAll(() => rm(aislado, { recursive: true, force: true }))

describe("oc_leer_excel (P1)", () => {
  test("lee la primera hoja con encabezados, números, fechas y fórmulas", async () => {
    const libro = new ExcelJS.Workbook()
    const hoja = libro.addWorksheet("Solicitud")
    hoja.addRow(["solicitud_id", "descripcion", "cantidad", "valor_unitario", "valor_total", "fecha_solicitud"])
    hoja.addRow(["SOL-2026-001", "Licencias antivirus", 120, 95000, { formula: "C2*D2", result: 11400000 }, new Date("2026-08-20T00:00:00Z")])
    await mkdir(join(aislado, "out"), { recursive: true })
    await libro.xlsx.writeFile(join(aislado, "out", "solicitud.xlsx"))

    const r = await ejecutarHerramienta("oc_leer_excel", { ruta: "out/solicitud.xlsx" }, { directory: aislado, sessionId: "x" })
    expect(r.ok).toBe(true)
    const data = (JSON.parse(r.salida) as { data: { hoja: string; filas: Record<string, unknown>[] } }).data
    expect(data.hoja).toBe("Solicitud")
    expect(data.filas).toEqual([{ solicitud_id: "SOL-2026-001", descripcion: "Licencias antivirus", cantidad: 120, valor_unitario: 95000, valor_total: 11400000, fecha_solicitud: "2026-08-20" }])
    expect(r.resumen).toBe('hoja "Solicitud" · 1 filas')
  })

  test.each([
    ["../../etc/passwd.xlsx", "ruta no permitida"],
    ["src/config.xlsx", "ruta no permitida"],
    ["fixtures/reto-03/maestros/proveedores.json", "solo se leen archivos .xlsx"],
    ["out/no-existe.xlsx", "no existe el archivo"],
  ])("rechaza %s con error legible", async (ruta, mensaje) => {
    const r = await ejecutarHerramienta("oc_leer_excel", { ruta }, { directory: aislado, sessionId: "x" })
    expect(r.ok).toBe(false)
    expect(r.resumen).toContain(mensaje)
  })
})

describe("tope diario persistente", () => {
  test("sobrevive a un reinicio y se reinicia al cambiar de día", async () => {
    let dia = "2026-10-28"
    const primero = new ConsumoDiario(aislado, 1000, () => dia)
    await primero.sumar(900)
    expect(primero.alcanzado()).toBe(false)
    await primero.sumar(200)

    const tras_reinicio = new ConsumoDiario(aislado, 1000, () => dia)
    expect(tras_reinicio.tokens).toBe(1100)
    expect(tras_reinicio.alcanzado()).toBe(true)

    dia = "2026-10-29"
    expect(tras_reinicio.alcanzado()).toBe(false)
    expect(tras_reinicio.tokens).toBe(0)
  })
})

describe("RC5 · vigencia de la cotización", () => {
  test("una cotización vencida antes de la solicitud pide confirmación", async () => {
    const raiz = process.cwd()
    const paquete = await cargarPaquete(raiz, "sol-001")
    if (paquete.cotizacion) paquete.cotizacion.validez_hasta = "2026-08-01"
    const r = validarPaquete(paquete, await cargarMaestros(raiz))
    expect(r.confirmaciones.some((c) => c.codigo === "RC5" && c.detalle.includes("venció el 2026-08-01"))).toBe(true)
  })

  test("las 6 cotizaciones del reto están vigentes: los resultados del PRD no cambian", async () => {
    const raiz = process.cwd()
    const maestros = await cargarMaestros(raiz)
    for (const caso of ["sol-001", "sol-002", "sol-003", "sol-004", "sol-005", "sol-006"]) {
      const r = validarPaquete(await cargarPaquete(raiz, caso), maestros)
      expect(r.confirmaciones.some((c) => c.detalle.includes("venció"))).toBe(false)
    }
  })
})

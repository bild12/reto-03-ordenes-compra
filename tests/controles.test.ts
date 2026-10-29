// Motor de controles: la matriz declarativa gobierna el tipo de cada regla, y los bordes que
// abrirían un control (factura ilegible, cotización de otro proveedor) se detectan.
import { describe, expect, test } from "bun:test"
import { MATRIZ, validarPaquete, type Matriz } from "../src/dominio/controles.ts"
import { cargarMaestros, cargarPaquete } from "../src/dominio/fuentes.ts"

const raiz = process.cwd()
const maestros = await cargarMaestros(raiz)
const codigos = (h: { codigo: string }[]): string[] => h.map((x) => x.codigo)

describe("matriz declarativa (src/knowledge/controles.json)", () => {
  test("cambiar RC8 a 'bloqueo' en la matriz bloquea la OC retroactiva sin tocar código", async () => {
    const paquete = await cargarPaquete(raiz, "sol-005")
    expect(validarPaquete(paquete, maestros).apta).toBe(true)
    const estricta: Matriz = structuredClone(MATRIZ)
    estricta.reglas.RC8.tipo = "bloqueo"
    const resultado = validarPaquete(paquete, maestros, estricta)
    expect(resultado.apta).toBe(false)
    expect(codigos(resultado.bloqueos)).toEqual(["RC8"])
  })

  test("cambiar la tolerancia de RC5 al 10 % vuelve apta sin confirmación a sol-004", async () => {
    const paquete = await cargarPaquete(raiz, "sol-004")
    const tolerante: Matriz = structuredClone(MATRIZ)
    tolerante.parametros.tolerancia_cotizacion = 0.1
    expect(codigos(validarPaquete(paquete, maestros, tolerante).confirmaciones)).toEqual([])
  })
})

describe("bordes que no deben abrir un control", () => {
  test("factura adjunta pero ilegible → RC8 pide confirmación", async () => {
    const paquete = await cargarPaquete(raiz, "sol-001")
    paquete.faltantes.push("factura (la factura no tiene número, fecha o total legibles)")
    expect(codigos(validarPaquete(paquete, maestros).confirmaciones)).toContain("RC8")
  })

  test("cotización de un NIT distinto al proveedor → RC5 pide confirmación", async () => {
    const paquete = await cargarPaquete(raiz, "sol-001")
    if (paquete.cotizacion) paquete.cotizacion.nit = "901222333"
    const r = validarPaquete(paquete, maestros)
    expect(r.confirmaciones.some((c) => c.codigo === "RC5" && c.detalle.includes("901222333"))).toBe(true)
  })

  test("cantidad × unitario ≠ total → RC10 bloquea", async () => {
    const paquete = await cargarPaquete(raiz, "sol-001")
    paquete.solicitud.valor_total += 1000
    expect(codigos(validarPaquete(paquete, maestros).bloqueos)).toContain("RC10")
  })

  test("subárea de otro centro → RC4 bloquea", async () => {
    const paquete = await cargarPaquete(raiz, "sol-001")
    paquete.solicitud.subarea = "Marketing"
    expect(codigos(validarPaquete(paquete, maestros).bloqueos)).toContain("RC4")
  })

  test("aprobación anterior a la solicitud → RC9 pide confirmación", async () => {
    const paquete = await cargarPaquete(raiz, "sol-001")
    if (paquete.aprobacion) paquete.aprobacion.fecha = "2026-08-01T10:00:00-05:00"
    expect(codigos(validarPaquete(paquete, maestros).confirmaciones)).toContain("RC9")
  })
})

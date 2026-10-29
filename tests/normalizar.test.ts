// Trampas de formato de los fixtures, cubiertas una por una.
import { describe, expect, test } from "bun:test"
import { montoMencionado, parsearCotizacion } from "../src/dominio/fuentes.ts"
import { derivarUnidad, fechaLocal, normalizarNit, normalizarNombreProveedor, normalizarTexto, parsearMonto, textoBreve } from "../src/dominio/normalizar.ts"

describe("normalizadores", () => {
  test("montos en formato colombiano", () => {
    expect(parsearMonto("COP 11.400.000")).toBe(11_400_000)
    expect(parsearMonto("1.850.000,50")).toBe(1_850_000.5)
    expect(parsearMonto(95000)).toBe(95000)
    expect(parsearMonto("once millones")).toBeNull()
  })

  test("NIT sin puntos ni dígito de verificación", () => {
    expect(normalizarNit("900.555.111-2")).toBe("900555111")
    expect(normalizarNit("900555111")).toBe("900555111")
    expect(normalizarNit(undefined)).toBeNull()
  })

  test("correos y nombres con tildes", () => {
    expect(normalizarTexto("natalia.ríos@periferia-ficticia.com")).toBe("natalia.rios@periferia-ficticia.com")
    expect(normalizarNombreProveedor("TecnoSuministros S.A.S.")).toBe(normalizarNombreProveedor("tecnosuministros sas"))
  })

  test("fecha calendario local sin convertir a UTC", () => {
    expect(fechaLocal("2026-08-26T21:45:00-05:00")).toBe("2026-08-26")
    expect(fechaLocal("2026-13-45")).toBeNull()
  })

  test("texto breve SAP: máximo 40, sin palabras cortadas ni conectores al final", () => {
    const corto = textoBreve("Bolsa de 100 horas de arquitectura de nube para migración", 40)
    expect(corto).toBe("Bolsa de 100 horas de arquitectura")
    expect(corto.length).toBeLessThanOrEqual(40)
    expect(textoBreve("Papelería y tóner", 40)).toBe("Papelería y tóner")
  })

  test("unidad derivada de la descripción", () => {
    expect(derivarUnidad("Bolsa de 100 horas de arquitectura")).toBe("H")
    expect(derivarUnidad("Licencias antivirus, vigencia 12 meses")).toBe("UN")
    expect(derivarUnidad("Soporte mensual")).toBe("MES")
  })
})

describe("documentos", () => {
  test("cotización: total, NIT, referencia y validez", () => {
    const c = parsearCotizacion("COTIZACIÓN CA-2026-0310\nFecha: 2026-08-25\nProveedor: Cloud Andina S.A.S.\nNIT: 901.222.333-1\nTOTAL (IVA incluido): COP 26.500.000\nValidez de la oferta: 20 días")
    expect(c).toMatchObject({ referencia: "CA-2026-0310", nit: "901222333", total: 26_500_000, moneda: "COP", validez_hasta: "2026-09-14" })
  })

  test("monto aprobado explícito en el correo del líder", () => {
    expect(montoMencionado("Aprobado por 25 millones según la solicitud.")).toBe(25_000_000)
    expect(montoMencionado("Aprobado.")).toBeNull()
  })
})

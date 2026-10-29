// Pruebas del ciclo del agente con un modelo guionado (sin clave): demuestran que la confirmación
// humana y el tope de iteraciones los hace cumplir el servidor, no solo el prompt.
//   bun test
import { afterAll, beforeEach, describe, expect, test } from "bun:test"
import { casosConfirmados, ejecutarTurno } from "../src/agent/ciclo.ts"
import type { Sesion } from "../src/agent/sesiones.ts"
import type { LlamadaHerramienta, ProveedorLLM, RespuestaModelo } from "../src/llm/adapter.ts"
import { crearDirectorioPrueba, limpiarDirectorio } from "./ayuda.ts"

const directorio = await crearDirectorioPrueba()
const opciones = { directorio, maxIteraciones: 5, maxTokensSesion: 1_000_000 }

function sesionNueva(pendientes: string[] = []): Sesion {
  return { id: "prueba-ciclo", creada: "", mensajes: [], historial: [], pendientes, tokens: 0, ocupada: false }
}

/** Modelo falso: devuelve en orden las respuestas del guion. */
function guion(pasos: LlamadaHerramienta[][], textoFinal = "listo"): ProveedorLLM {
  let i = 0
  return {
    nombre: "guion",
    modelo: "guion",
    async enviar(): Promise<RespuestaModelo> {
      const llamadas = pasos[i++] ?? []
      return { texto: llamadas.length ? "" : textoFinal, llamadas, uso: { entrada: 10, salida: 5 } }
    },
  }
}

let secuencia = 0
const llamada = (nombre: string, argumentos: Record<string, unknown>): LlamadaHerramienta => ({ id: `${nombre}-${secuencia++}`, nombre, argumentos })
const validarYCrear = (caso: string): ProveedorLLM => guion([[llamada("oc_validar", { caso })], [llamada("oc_crear", { caso, confirmado: true })]])

beforeEach(() => limpiarDirectorio(directorio))
afterAll(() => limpiarDirectorio(directorio, true))

describe("confirmación humana (CA3)", () => {
  test("el servidor ignora confirmado=true si el usuario no confirmó", async () => {
    const turno = await ejecutarTurno(sesionNueva(), "Procesa sol-004 y no la crees hasta que confirme", validarYCrear("sol-004"), opciones)
    const crear = turno.toolCalls.find((t) => t.nombre === "oc_crear")
    expect(crear?.ok).toBe(false)
    expect(crear?.nota).toContain("ignoró confirmado=true")
    expect(turno.needsConfirmation).toBe(true)
    expect(turno.pendientes).toEqual(["sol-004"])
  })

  test("con confirmación explícita en el turno siguiente, crea la OC", async () => {
    const sesion = sesionNueva()
    await ejecutarTurno(sesion, "Procesa sol-004", guion([[llamada("oc_validar", { caso: "sol-004" })]]), opciones)
    const turno = await ejecutarTurno(sesion, "Confirmo, créala", guion([[llamada("oc_crear", { caso: "sol-004", confirmado: true })]]), opciones)
    expect(turno.confirmados).toEqual(["sol-004"])
    expect(turno.toolCalls[0]?.ok).toBe(true)
    expect(turno.toolCalls[0]?.resumen).toContain("4500000001")
    expect(turno.needsConfirmation).toBe(false)
  })

  test("la confirmación estructurada del front aplica solo al caso indicado", async () => {
    const sesion = sesionNueva(["sol-004", "sol-006"])
    const llm = guion([[llamada("oc_crear", { caso: "sol-004", confirmado: true }), llamada("oc_crear", { caso: "sol-006", confirmado: true })]])
    const turno = await ejecutarTurno(sesion, "Confirmo sol-004.", llm, opciones, ["sol-004"])
    expect(turno.toolCalls.map((t) => t.ok)).toEqual([true, false])
    expect(turno.pendientes).toEqual(["sol-006"])
  })

  test("la confirmación no se arrastra a un caso que no estaba pendiente", async () => {
    const turno = await ejecutarTurno(sesionNueva(["sol-004"]), "Confirmo", guion([[llamada("oc_crear", { caso: "sol-005", confirmado: true })]]), opciones)
    expect(turno.toolCalls[0]?.ok).toBe(false)
  })

  test("un bloqueo no se salta ni con confirmación", async () => {
    const turno = await ejecutarTurno(sesionNueva(["sol-003"]), "Confirmo", guion([[llamada("oc_crear", { caso: "sol-003", confirmado: true })]]), opciones)
    expect(turno.toolCalls[0]?.ok).toBe(false)
    expect(turno.toolCalls[0]?.resumen).toContain("bloqueado")
    expect(turno.pendientes).toEqual([])
  })
})

describe("lectura conservadora de la confirmación en texto libre", () => {
  const uno = ["sol-004"]
  const varios = ["sol-004", "sol-005", "sol-006"]
  test.each([
    ["Confirmo, crea la OC.", uno, ["sol-004"]],
    ["sí, créala", uno, ["sol-004"]],
    ["confirmo el valor 25 millones", uno, ["sol-004"]],
    ["Confirmo SOL-2026-004", varios, ["sol-004"]],
    ["confirmo sol-004 y sol-006", varios, ["sol-004", "sol-006"]],
    ["confirmo todas", varios, varios],
    ["confirmo las tres", varios, varios],
    ["Confirmo", varios, []],
    ["¿qué pasa si la creo?", uno, []],
    ["ok, explícame RC5", uno, []],
    ["confirmo que no quiero crearla", uno, []],
    ["Confirmo sol-004 pero no sol-005", varios, []],
    ["No, todavía no la crees.", uno, []],
    ["no la crees hasta que yo lo confirme", uno, []],
    ["muéstrame la OC", uno, []],
  ])("%s", (texto, pendientes, esperado) => {
    expect(casosConfirmados(texto, pendientes)).toEqual(esperado)
  })
})

describe("robustez del ciclo", () => {
  test("respeta el tope de iteraciones (CA1)", async () => {
    const infinito: ProveedorLLM = {
      nombre: "bucle",
      modelo: "bucle",
      async enviar() {
        return { texto: "", llamadas: [llamada("oc_leer_paquete", { caso: "sol-001" })], uso: { entrada: 1, salida: 1 } }
      },
    }
    const turno = await ejecutarTurno(sesionNueva(), "hola", infinito, opciones)
    expect(turno.toolCalls).toHaveLength(opciones.maxIteraciones)
    expect(turno.reply).toContain("tope de 5 pasos")
  })

  test("respeta el tope de tokens por sesión", async () => {
    const sesion = sesionNueva()
    sesion.tokens = opciones.maxTokensSesion
    const turno = await ejecutarTurno(sesion, "hola", guion([]), opciones)
    expect(turno.reply).toContain("tope")
    expect(turno.toolCalls).toHaveLength(0)
  })

  test("un error del proveedor se informa y la sesión sigue viva (CA5)", async () => {
    const sesion = sesionNueva()
    const caido: ProveedorLLM = { nombre: "caido", modelo: "caido", async enviar() { throw new Error("socket") } }
    const turno = await ejecutarTurno(sesion, "hola", caido, opciones)
    expect(turno.reply).toContain("La sesión sigue activa")
    const siguiente = await ejecutarTurno(sesion, "hola de nuevo", guion([], "aquí estoy"), opciones)
    expect(siguiente.reply).toBe("aquí estoy")
  })

  test("argumentos inválidos vuelven como error legible, sin excepción", async () => {
    const turno = await ejecutarTurno(sesionNueva(), "x", guion([[llamada("oc_validar", { caso: "../../etc" })]]), opciones)
    expect(turno.toolCalls[0]?.ok).toBe(false)
    expect(turno.toolCalls[0]?.resumen).toContain("argumentos inválidos")
  })
})

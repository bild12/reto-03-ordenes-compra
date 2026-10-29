// Ciclo del agente: prompt → modelo → herramientas → modelo … → respuesta.
// Controles de diseño: tope de iteraciones (CA1), tope de tokens por sesión, confirmación humana
// verificada por el servidor (CA3), cada llamada visible y registrada (CA4), errores claros (CA5).
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { matrizComoMarkdown } from "../dominio/controles.ts"
import { ErrorProveedor, type Mensaje, type ProveedorLLM } from "../llm/adapter.ts"
import { definiciones, ejecutarHerramienta } from "../tools/registro.ts"
import type { Sesion } from "./sesiones.ts"

export type LlamadaVisible = { nombre: string; argumentos: Record<string, unknown>; ok: boolean; resumen: string; nota?: string }

export type RespuestaTurno = {
  reply: string
  toolCalls: LlamadaVisible[]
  needsConfirmation: boolean
  pendientes: string[]
  /** Casos que el servidor dio por confirmados en este turno. */
  confirmados: string[]
  uso: { tokens_turno: number; tokens_sesion: number; entrada: number; salida: number; cache_leido: number }
}

export type OpcionesCiclo = { directorio: string; maxIteraciones: number; maxTokensSesion: number }

/** Comportamiento (agent/prompt.md) + conocimiento (src/knowledge/ordenes-compra.md). */
export function promptSistema(directorio: string): string {
  const comportamiento = readFileSync(join(directorio, "agent", "prompt.md"), "utf8")
  const conocimiento = readFileSync(join(directorio, "src", "knowledge", "ordenes-compra.md"), "utf8")
  return `${comportamiento}\n\n---\n\n# Conocimiento del proceso\n\n${conocimiento}\n${matrizComoMarkdown()}`
}

const NEGACION = /\b(no|todavia|aun|espera|esperemos|cancela|cancelar|detente|alto|pero|excepto|menos)\b/
const AFIRMACION = /^(si|confirmo|confirmado|procede|adelante|apruebo|autorizo|dale)\b|\bconfirmo\b|\b(crea|crear|creala|crealas)\b/
const TODOS = /\b(todas|todos|ambas|ambos|(las|los) (dos|tres|cuatro|cinco|seis))\b/

function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim()
}

/** Decide, en el servidor, qué casos pendientes confirma un mensaje de texto libre.
 *  Es deliberadamente conservador: ante pregunta, negación o ambigüedad no confirma nada y el
 *  agente vuelve a preguntar. Con varios pendientes exige nombrarlos ("sol-004") o decir "todas".
 *  El front evita la ambigüedad enviando la confirmación estructurada por caso (`confirmar`). */
export function casosConfirmados(texto: string, pendientes: readonly string[]): string[] {
  const t = normalizar(texto)
  if (pendientes.length === 0 || t.includes("?") || NEGACION.test(t) || !AFIRMACION.test(t)) return []
  const mencionados = [...t.matchAll(/\bsol-(?:\d{4}-)?(\d{3})\b/g)].map((m) => `sol-${m[1] ?? ""}`)
  if (mencionados.length > 0) return pendientes.filter((p) => mencionados.includes(p))
  if (pendientes.length === 1 || TODOS.test(t)) return [...pendientes]
  return []
}

function leerSalida(salida: string): { ok: boolean; data?: Record<string, unknown>; error?: string } {
  return JSON.parse(salida) as { ok: boolean; data?: Record<string, unknown>; error?: string }
}

const MAX_CARACTERES_RESULTADO = 24_000

export async function ejecutarTurno(
  sesion: Sesion,
  textoUsuario: string,
  llm: ProveedorLLM,
  opciones: OpcionesCiclo,
  confirmacionEstructurada?: readonly string[],
): Promise<RespuestaTurno> {
  const visibles: LlamadaVisible[] = []
  const ctx = { directory: opciones.directorio, sessionId: sesion.id, confirmados: [] as string[] }
  // Ventana de confirmación: solo vale para casos pendientes (se arrastran entre turnos hasta crearse)
  // que ESTE mensaje confirma explícitamente (botón por caso o texto inequívoco). Se consume en este turno.
  const confirmados = confirmacionEstructurada
    ? sesion.pendientes.filter((c) => confirmacionEstructurada.includes(c))
    : casosConfirmados(textoUsuario, sesion.pendientes)
  const confirmables = new Set(confirmados)
  ctx.confirmados = confirmados
  // Los pendientes se arrastran entre turnos hasta que la OC se crea (o el caso deja de ser apto).
  const pendientes = new Set<string>(sesion.pendientes)
  const creados = new Set<string>()
  let tokensTurno = 0
  const desglose = { entrada: 0, salida: 0, cache_leido: 0 }

  sesion.mensajes.push({ rol: "usuario", texto: textoUsuario })
  sesion.historial.push({ rol: "usuario", texto: textoUsuario, ts: new Date().toISOString() })

  const cerrar = (reply: string): RespuestaTurno => {
    // El historial para el modelo siempre termina en un mensaje del asistente sin llamadas pendientes.
    const ultimo = sesion.mensajes.at(-1)
    if (!ultimo || ultimo.rol !== "asistente" || ultimo.llamadas.length > 0) {
      sesion.mensajes.push({ rol: "asistente", texto: reply, llamadas: [] })
    }
    sesion.pendientes = [...pendientes].filter((c) => !creados.has(c))
    sesion.historial.push({ rol: "asistente", texto: reply, ts: new Date().toISOString(), toolCalls: visibles, needsConfirmation: sesion.pendientes.length > 0 })
    return {
      reply,
      toolCalls: visibles,
      needsConfirmation: sesion.pendientes.length > 0,
      pendientes: sesion.pendientes,
      confirmados,
      uso: { tokens_turno: tokensTurno, tokens_sesion: sesion.tokens, ...desglose },
    }
  }

  if (sesion.tokens >= opciones.maxTokensSesion) {
    return cerrar(`Esta sesión alcanzó el tope de ${opciones.maxTokensSesion.toLocaleString("es-CO")} tokens configurado para controlar costos. Abre una sesión nueva para continuar.`)
  }

  const herramientas = definiciones()
  const sistema: Mensaje = { rol: "sistema", texto: promptSistema(opciones.directorio) }

  for (let iteracion = 1; iteracion <= opciones.maxIteraciones; iteracion++) {
    let respuesta
    try {
      respuesta = await llm.enviar([sistema, ...sesion.mensajes], herramientas)
    } catch (error) {
      const mensaje = error instanceof ErrorProveedor ? error.message : "Ocurrió un error inesperado con el modelo."
      return cerrar(`⚠️ ${mensaje} La sesión sigue activa: puedes repetir tu mensaje.`)
    }
    tokensTurno += respuesta.uso.entrada + respuesta.uso.salida
    desglose.entrada += respuesta.uso.entrada
    desglose.salida += respuesta.uso.salida
    desglose.cache_leido += respuesta.uso.cache_leido ?? 0
    sesion.tokens += respuesta.uso.entrada + respuesta.uso.salida
    sesion.mensajes.push({ rol: "asistente", texto: respuesta.texto, llamadas: respuesta.llamadas })

    if (respuesta.llamadas.length === 0) return cerrar(respuesta.texto || "(sin respuesta del modelo)")

    const resultados: { id: string; nombre: string; contenido: string }[] = []
    for (const llamada of respuesta.llamadas) {
      const argumentos = { ...llamada.argumentos }
      const caso = typeof argumentos["caso"] === "string" ? argumentos["caso"] : ""
      let nota: string | undefined
      if (llamada.nombre === "oc_crear" && argumentos["confirmado"] === true && !confirmables.has(caso)) {
        argumentos["confirmado"] = false
        nota = "El servidor ignoró confirmado=true: el usuario no confirmó este caso en su último mensaje, así que la herramienta solo creará la OC si no tiene excepciones."
      }
      const ejecucion = await ejecutarHerramienta(llamada.nombre, argumentos, ctx)
      const salida = leerSalida(ejecucion.salida)
      if (llamada.nombre === "oc_validar" && salida.ok && salida.data) {
        const conf = (salida.data["confirmaciones"] as unknown[] | undefined) ?? []
        if (salida.data["apta"] === true && conf.length > 0) pendientes.add(caso)
        else pendientes.delete(caso)
      }
      if (llamada.nombre === "oc_crear") {
        if (salida.ok) creados.add(caso)
        else if (salida.error?.startsWith("requiere confirmación")) pendientes.add(caso)
        else if (salida.error?.startsWith("bloqueado")) pendientes.delete(caso)
      }
      visibles.push({ nombre: llamada.nombre, argumentos, ok: ejecucion.ok, resumen: ejecucion.resumen, ...(nota ? { nota } : {}) })
      const contenido = nota ? JSON.stringify({ ...salida, nota_servidor: nota }) : ejecucion.salida
      resultados.push({ id: llamada.id, nombre: llamada.nombre, contenido: contenido.slice(0, MAX_CARACTERES_RESULTADO) })
    }
    sesion.mensajes.push({ rol: "resultados", resultados })

    if (sesion.tokens >= opciones.maxTokensSesion) {
      return cerrar(`Alcancé el tope de tokens de la sesión. Avance hasta ahora: ${visibles.map((v) => `${v.nombre} → ${v.resumen}`).join("; ")}.`)
    }
  }

  const avance = visibles.map((v) => `- ${v.nombre}: ${v.resumen}`).join("\n")
  return cerrar(`Alcancé el tope de ${opciones.maxIteraciones} pasos en este turno. Esto es lo que alcancé a hacer:\n${avance}\n\nDime si continúo con lo pendiente.`)
}

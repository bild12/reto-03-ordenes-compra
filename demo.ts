// Verificación sin modelo: ejecuta las herramientas directamente sobre los 6 casos y compara
// el resultado contra los objetivos O1–O4 del PRD. Corre sin clave de ningún proveedor.
//   bun run demo.ts
import { readdir, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { ejecutarHerramienta } from "./src/tools/registro.ts"

const ctx = { directory: process.cwd(), sessionId: "demo" }

type Esperado = { creaSinConfirmar: boolean; bloqueos: string[]; confirmaciones: string[]; retroactiva: boolean }

// Fuente: PRD §3.1 (O1–O4) y §7.3.
const ESPERADO: Record<string, Esperado> = {
  "sol-001": { creaSinConfirmar: true, bloqueos: [], confirmaciones: [], retroactiva: false },
  "sol-002": { creaSinConfirmar: false, bloqueos: ["RC1"], confirmaciones: [], retroactiva: false },
  "sol-003": { creaSinConfirmar: false, bloqueos: ["RC2"], confirmaciones: [], retroactiva: false },
  "sol-004": { creaSinConfirmar: false, bloqueos: [], confirmaciones: ["RC5"], retroactiva: false },
  "sol-005": { creaSinConfirmar: false, bloqueos: [], confirmaciones: ["RC8"], retroactiva: true },
  "sol-006": { creaSinConfirmar: false, bloqueos: [], confirmaciones: ["RC6"], retroactiva: false },
}

type Validacion = { apta: boolean; bloqueos: { codigo: string }[]; confirmaciones: { codigo: string }[]; retroactiva: boolean }
const fallas: string[] = []

function verificar(condicion: boolean, mensaje: string): string {
  if (!condicion) fallas.push(mensaje)
  return condicion ? "✔" : "✘"
}

function datos<T>(salida: string): T | null {
  const r = JSON.parse(salida) as { ok: boolean; data?: T }
  return r.ok && r.data !== undefined ? r.data : null
}

async function procesar(caso: string, confirmado?: boolean): Promise<void> {
  const v = await ejecutarHerramienta("oc_validar", { caso }, ctx)
  const validacion = datos<Validacion>(v.salida)
  if (!validacion) {
    console.log(`  ${caso}: error de validación → ${v.resumen}`)
    return
  }
  await ejecutarHerramienta("oc_generar_evidencia", { caso }, ctx)
  const p = validacion.apta ? await ejecutarHerramienta("oc_construir_payload", { caso }, ctx) : null
  // En la demo, el "host" registra la confirmación del usuario para el caso (como hace el servidor).
  const ctxCrear = confirmado ? { ...ctx, confirmados: [caso] } : ctx
  const c = await ejecutarHerramienta("oc_crear", confirmado === undefined ? { caso } : { caso, confirmado }, ctxCrear)
  const creada = datos<{ numero_oc: string; idempotente: boolean }>(c.salida)
  const codigos = (h: { codigo: string }[]): string => h.map((x) => x.codigo).join(",") || "—"
  console.log(`  ${caso}${confirmado ? " (confirmado)" : ""}`)
  console.log(`    apta=${validacion.apta} · bloqueos=${codigos(validacion.bloqueos)} · confirmaciones=${codigos(validacion.confirmaciones)} · retroactiva=${validacion.retroactiva}`)
  if (p) console.log(`    payload: ${p.resumen}`)
  console.log(`    resultado: ${creada ? `OC ${creada.numero_oc}${creada.idempotente ? " (idempotente)" : ""}` : c.resumen}`)

  const esperado = ESPERADO[caso]
  if (!esperado || confirmado !== undefined) return
  const marcas = [
    verificar(esperado.bloqueos.every((b) => validacion.bloqueos.some((x) => x.codigo === b)) && (esperado.bloqueos.length > 0) === !validacion.apta, `${caso}: bloqueos esperados ${esperado.bloqueos.join(",") || "ninguno"}`),
    verificar(esperado.confirmaciones.every((b) => validacion.confirmaciones.some((x) => x.codigo === b)), `${caso}: confirmaciones esperadas ${esperado.confirmaciones.join(",")}`),
    verificar(esperado.retroactiva === validacion.retroactiva, `${caso}: retroactiva esperada ${esperado.retroactiva}`),
    verificar(esperado.creaSinConfirmar === (creada !== null), `${caso}: ${esperado.creaSinConfirmar ? "debía crear OC" : "no debía crear OC sin confirmación"}`),
  ]
  console.log(`    verificación PRD: ${marcas.join(" ")}`)
}

async function main(): Promise<void> {
  await rm(join(ctx.directory, "out"), { recursive: true, force: true })
  const casos = (await readdir(join(ctx.directory, "fixtures", "reto-03", "solicitudes"))).sort()

  console.log("\n1) Primera pasada: los 6 casos, sin confirmar nada")
  for (const caso of casos) await procesar(caso)

  console.log("\n2) Idempotencia: sol-001 por segunda vez")
  const repetida = await ejecutarHerramienta("oc_crear", { caso: "sol-001" }, ctx)
  const datosRepetida = datos<{ numero_oc: string; idempotente: boolean }>(repetida.salida)
  console.log(`    ${repetida.resumen}  ${verificar(datosRepetida?.idempotente === true && datosRepetida.numero_oc === "4500000001", "sol-001 debía ser idempotente con 4500000001")}`)

  console.log("\n3) Confirmación explícita del usuario: sol-004 (cotización) y sol-005 (retroactiva, O4)")
  await procesar("sol-004", true)
  await procesar("sol-005", true)
  const control = await readFile(join(ctx.directory, "out", "control.csv"), "utf8")
  const retroactivaCreada = control.split("\n").some((l) => l.startsWith("SOL-2026-005,creada,") && l.split(",")[3] === "true")
  console.log(`    control.csv registra SOL-2026-005 creada con retroactiva=true  ${verificar(retroactivaCreada, "sol-005 debía quedar creada y marcada retroactiva en control.csv")}`)

  console.log("\n4) Integridad: un payload con el precio alterado es rechazado")
  const construido = datos<{ orden: { posiciones: { precio_unitario: number }[] } }>((await ejecutarHerramienta("oc_construir_payload", { caso: "sol-006" }, ctx)).salida)
  if (construido) {
    const alterado = structuredClone(construido.orden)
    const posicion = alterado.posiciones[0]
    if (posicion) posicion.precio_unitario = 1
    const intento = await ejecutarHerramienta("oc_crear", { caso: "sol-006", payload: alterado, confirmado: true }, { ...ctx, confirmados: ["sol-006"] })
    console.log(`    ${intento.resumen.slice(0, 110)}…  ${verificar(!intento.ok, "el payload alterado debía rechazarse")}`)
  }

  console.log("\n5) confirmado=true sin confirmación registrada por el host no crea la OC (sol-006)")
  const sinHost = await ejecutarHerramienta("oc_crear", { caso: "sol-006", confirmado: true }, ctx)
  console.log(`    ${sinHost.resumen.slice(0, 110)}…  ${verificar(!sinHost.ok, "sol-006 no debía crearse sin confirmación del host")}`)

  console.log("\n6) Errores claros: caso inexistente y caso con ruta maliciosa")
  for (const caso of ["sol-999", "../maestros"]) {
    const r = await ejecutarHerramienta("oc_leer_paquete", { caso }, ctx)
    console.log(`    ${caso}: ${r.resumen}  ${verificar(!r.ok, `${caso} debía fallar con error legible`)}`)
  }

  console.log(`\nArchivos: out/sap/ordenes.jsonl · out/control.csv · out/log.jsonl · out/<caso>/{aprobacion.txt,aprobacion.pdf,trazabilidad.json}`)
  console.log(fallas.length === 0 ? "\nRESULTADO: todos los casos cumplen el PRD ✔\n" : `\nRESULTADO: ${fallas.length} diferencias con el PRD ✘\n - ${fallas.join("\n - ")}\n`)
  process.exitCode = fallas.length === 0 ? 0 : 1
}

await main()

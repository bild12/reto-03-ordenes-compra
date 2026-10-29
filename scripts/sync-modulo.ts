// Genera modulo/ desde las fuentes únicas de la app (sin copias divergentes):
//   agent/prompt.md               → modulo/agent.md (frontmatter + mismo cuerpo)
//   src/knowledge/ordenes-compra.md + matriz de controles.json → modulo/skill/ordenes-compra/SKILL.md
//   src/tools/oc.ts                → modulo/tools/oc.ts (reexporta el mismo archivo)
// tests/modulo.test.ts falla si modulo/ queda desactualizado.
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { matrizComoMarkdown } from "../src/dominio/controles.ts"

export const FRONTMATTER_AGENTE = `---
description: Agente que prepara y crea órdenes de compra en SAP a partir del paquete solicitud + cotización + aprobación, aplicando los controles RC1–RC10 y pidiendo confirmación humana ante excepciones.
mode: primary
permission:
  edit: deny
  bash: deny
---

`

export const FRONTMATTER_SKILL = `---
name: ordenes-compra
description: Conocimiento del proceso de órdenes de compra de Periferia — matriz de controles RC1–RC10, códigos SAP, convenciones de datos y tratamiento de OC retroactivas. Úsalo al validar o explicar una OC.
---

`

export const TOOLS_REEXPORT = `// Mismas herramientas que usa la aplicación: este archivo solo las reexporta (no hay copia divergente).
// Integración: el host debe pasar ctx.confirmados con los casos que el usuario confirmó; sin eso,
// oc_crear nunca crea una OC con excepciones.
// Uso: import * as oc from "./modulo/tools/oc.ts" → oc.leer_paquete, oc.validar, oc.construir_payload, oc.generar_evidencia, oc.crear
export * from "../../src/tools/oc.ts"
`

export async function contenidosEsperados(raiz: string): Promise<Record<string, string>> {
  const prompt = await readFile(join(raiz, "agent", "prompt.md"), "utf8")
  const conocimiento = await readFile(join(raiz, "src", "knowledge", "ordenes-compra.md"), "utf8")
  return {
    "modulo/agent.md": FRONTMATTER_AGENTE + prompt,
    "modulo/skill/ordenes-compra/SKILL.md": `${FRONTMATTER_SKILL}${conocimiento}\n${matrizComoMarkdown()}`,
    "modulo/tools/oc.ts": TOOLS_REEXPORT,
  }
}

if (import.meta.main) {
  const raiz = process.cwd()
  for (const [ruta, contenido] of Object.entries(await contenidosEsperados(raiz))) {
    await mkdir(join(raiz, ruta, ".."), { recursive: true })
    await writeFile(join(raiz, ruta), contenido, "utf8")
    console.log(`✔ ${ruta}`)
  }
}

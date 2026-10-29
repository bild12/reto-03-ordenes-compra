// El bonus exige que modulo/ use las mismas piezas que la app. Esta prueba lo garantiza.
import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { contenidosEsperados } from "../scripts/sync-modulo.ts"
import * as moduloTools from "../modulo/tools/oc.ts"
import * as appTools from "../src/tools/oc.ts"

test("modulo/ está sincronizado con agent/prompt.md y src/knowledge (correr bun run modulo:sync)", async () => {
  for (const [ruta, esperado] of Object.entries(await contenidosEsperados(process.cwd()))) {
    const actual = (await readFile(ruta, "utf8")).replace(/\r\n/g, "\n")
    expect(actual).toBe(esperado)
  }
})

test("modulo/tools exporta exactamente los mismos objetos de herramienta que la app", () => {
  expect(moduloTools.crear).toBe(appTools.crear)
  expect(Object.keys(moduloTools).sort()).toEqual(Object.keys(appTools).sort())
})

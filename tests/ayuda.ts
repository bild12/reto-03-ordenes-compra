// Directorio temporal para pruebas: enlaza fixtures/, agent/ y src/ del proyecto y escribe out/
// fuera del repositorio, para que `bun test` nunca toque el out/ real.
import { mkdtemp, rm, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

export async function crearDirectorioPrueba(): Promise<string> {
  const directorio = await mkdtemp(join(tmpdir(), "reto03-"))
  for (const carpeta of ["fixtures", "agent", "src"]) {
    await symlink(resolve(carpeta), join(directorio, carpeta), "junction")
  }
  return directorio
}

export async function limpiarDirectorio(directorio: string, completo = false): Promise<void> {
  await rm(completo ? directorio : join(directorio, "out"), { recursive: true, force: true })
}

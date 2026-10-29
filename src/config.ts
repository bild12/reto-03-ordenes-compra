// Configuración desde variables de entorno. La clave del modelo solo vive aquí, en el backend.
function entero(nombre: string, defecto: number): number {
  const valor = Number(process.env[nombre])
  return Number.isInteger(valor) && valor > 0 ? valor : defecto
}

export const config = {
  proveedor: process.env["LLM_PROVIDER"] ?? "anthropic",
  modelo: process.env["LLM_MODEL"] || "claude-sonnet-5-5",
  claveAnthropic: process.env["ANTHROPIC_API_KEY"] ?? "",
  maxIteraciones: entero("MAX_ITERACIONES_POR_TURNO", 25),
  maxTokensSesion: entero("MAX_TOKENS_POR_SESION", 200_000),
  /** Tope global de tokens por día (todas las sesiones): acota el gasto máximo de un link público. */
  maxTokensDia: entero("MAX_TOKENS_POR_DIA", 3_000_000),
  timeoutMs: entero("LLM_TIMEOUT_MS", 60_000),
  puerto: entero("PORT", 3000),
  /** Opcional: si se define, el chat exige la cabecera x-access-key (protege la clave en un link público). */
  claveAcceso: process.env["ACCESS_KEY"] ?? "",
}

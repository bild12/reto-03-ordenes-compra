// Fábrica del proveedor según LLM_PROVIDER. Agregar OpenAI/Azure es agregar un caso aquí.
import { config } from "../config.ts"
import { ErrorProveedor, type ProveedorLLM } from "./adapter.ts"
import { ProveedorAnthropic } from "./anthropic.ts"

export function crearProveedor(): ProveedorLLM {
  switch (config.proveedor) {
    case "anthropic":
      return new ProveedorAnthropic(config.claveAnthropic, config.modelo, config.timeoutMs)
    default:
      throw new ErrorProveedor(`Proveedor de modelo no soportado: ${config.proveedor}`)
  }
}

# Agente conversacional · Órdenes de Compra SAP (Reto 03)

Agente que lee el paquete de una solicitud de compra (solicitud, cotización, aprobación y factura), aplica los controles RC1–RC10, muestra la OC tal como quedaría en SAP y la crea en un SAP simulado. Antes de cualquier excepción pide confirmación humana.

El planteamiento completo, las decisiones y los riesgos están en **[SOLUCION.md](SOLUCION.md)**.

## Link de prueba

- **URL:** `https://reto-03-ordenes-compra.onrender.com` _(nombre definido en `render.yaml`; si Render lo asigna con sufijo, actualizar aquí)_
- **Clave de acceso (simulada, solo para la demo):** `periferia-reto03-demo`. El front la pide al abrir. Protege el consumo del modelo en el link público; no es una credencial real y se puede rotar cambiando `ACCESS_KEY` en Render.

Prompt sugerido para la demo (§11 del PRD):

```
Procesa la solicitud "sol-004". Muéstrame la OC como quedaría en SAP, qué
validaciones pasó y cuáles no, y no la crees hasta que yo lo confirme.
```

Luego responde `Confirmo` o usa el botón **Confirmar sol-004**.

## Arranque local (un comando)

Requisitos: [Bun](https://bun.sh) 1.2 o superior.

```bash
cp .env.example .env          # completar ANTHROPIC_API_KEY
bun install && bun run dev    # http://localhost:3000
```

En Windows (PowerShell): `Copy-Item .env.example .env` y luego `bun install; bun run dev`.

## Variables de entorno

| Variable | Obligatoria | Descripción |
|---|---|---|
| `ANTHROPIC_API_KEY` | Sí (para el chat) | Clave del proveedor. Solo en el backend; nunca en el repo, el front ni los logs. |
| `LLM_PROVIDER` | No | `anthropic` (por defecto). |
| `LLM_MODEL` | No | `claude-sonnet-5-5` por defecto. Alternativa económica: `claude-haiku-5-5`. |
| `MAX_ITERACIONES_POR_TURNO` | No | Tope de ciclos herramienta → modelo por turno (25). |
| `MAX_TOKENS_POR_SESION` | No | Tope de tokens por sesión (200000). |
| `MAX_TOKENS_POR_DIA` | No | Tope global diario para todas las sesiones (3000000). |
| `LLM_TIMEOUT_MS` | No | Timeout de cada llamada al modelo (60000). |
| `ACCESS_KEY` | No | Si se define, el chat exige esta clave (cabecera `x-access-key`). En el despliegue de demo vale `periferia-reto03-demo` (ver `render.yaml`); en local puede quedar vacía. |
| `PORT` | No | Puerto HTTP (3000). |

## Verificación sin modelo

```bash
bun run demo.ts      # 6 casos + idempotencia + confirmación + integridad, verificado contra O1–O4
bun test             # 52 pruebas: ciclo del agente, confirmación, controles, normalizadores, Excel, consumo, módulo
bun run verificar    # tipos + pruebas + demo
```

`demo.ts` no necesita clave, limpia `out/` al inicio y termina con `RESULTADO: todos los casos cumplen el PRD ✔`, o con la lista de diferencias y código de salida 1.

## API

| Método | Ruta | Cuerpo / respuesta |
|---|---|---|
| `POST` | `/api/chat` | `{ sessionId?, message, confirmar? }` → `{ ok, sessionId, reply, toolCalls[], needsConfirmation, pendientes[], confirmados[], uso }`. `confirmar` es la confirmación estructurada por caso que envía el botón del front. |
| `GET` | `/api/sessions/:id` | Historial completo, casos pendientes de confirmación y tokens consumidos |
| `GET` | `/api/health` | `{ ok, provider, model, requiere_clave_acceso }`, sin exponer claves |
| `GET` | `/` | Front de chat |

`toolCalls[]` trae `{ nombre, argumentos, ok, resumen, nota? }`. La `nota` aparece cuando el servidor corrige una llamada, por ejemplo al ignorar un `confirmado=true` sin confirmación real.

## Herramientas

| Herramienta | Qué hace |
|---|---|
| `oc_leer_paquete` | Normaliza correo, solicitud, cotización, aprobación y factura; reporta faltantes. |
| `oc_validar` | RC1–RC10 → `{ apta, bloqueos[], confirmaciones[], derivados, retroactiva }`. |
| `oc_construir_payload` | OC con esquema zod (§7.4) + `out/<caso>/trazabilidad.json`. |
| `oc_generar_evidencia` | `out/<caso>/aprobacion.txt` y `.pdf` con sha256. |
| `oc_leer_excel` | Lee un `.xlsx` real (P1): primera hoja, encabezados en la fila 1; solo dentro de `fixtures/` u `out/`. |
| `oc_crear` | Crea en SAP simulado (`out/sap/ordenes.jsonl`), idempotente; registra cada intento en `out/control.csv`. |

## Despliegue (Render, con Docker)

1. Sube el repositorio a GitHub.
2. En Render: **New → Blueprint** y selecciona el repo (usa `render.yaml`), o **New → Web Service → Docker**.
3. Configura `ANTHROPIC_API_KEY` como variable secreta en el panel: nunca va en el repo. `ACCESS_KEY` ya viene en `render.yaml` con el valor simulado `periferia-reto03-demo`.
4. Health check: `/api/health`.

El plan gratuito de Render suspende el servicio por inactividad: ábrelo unos minutos antes de la defensa. El `Dockerfile` también sirve en Railway, Fly.io o Azure Container Apps.

## Estructura

```
agent/prompt.md                  comportamiento del agente (system prompt)
src/knowledge/ordenes-compra.md  conocimiento del proceso que consulta el agente
src/knowledge/controles.json     matriz de controles: parámetros, tipo, acción, responsable
src/tools/oc.ts                  herramientas (oc_<export>) · registro.ts: validación zod + log
src/dominio/                     lógica determinista: normalizar, fuentes, controles, payload, evidencia, bitácoras
src/sap/adapter.ts · mock.ts     interfaz SapAdapter y SAP simulado
src/llm/adapter.ts · anthropic.ts  interfaz del proveedor LLM y su implementación
src/agent/ciclo.ts · sesiones.ts   ciclo del agente y sesiones
src/server.ts                    API HTTP
web/index.html                   front de chat
modulo/                          bonus: agente empaquetado (generado con `bun run modulo:sync`)
tests/                           pruebas automáticas
demo.ts                          verificación sin modelo
fixtures/                        entregados por Periferia (no modificar)
```

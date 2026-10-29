# Proceso de órdenes de compra · Periferia IT Group

## Para qué existe la OC

La orden de compra es un **control preventivo**: autoriza el gasto antes de que ocurra y fija proveedor, precio, imputación contable (centro de costo y subárea) y aprobador. Una OC creada después de la factura (retroactiva) deja de prevenir y solo legaliza un gasto hecho.

## Actores

| Actor | Rol |
|---|---|
| Solicitante | Envía el paquete: solicitud (Excel), cotización del proveedor y correo de aprobación del líder. |
| Líder aprobador | Responde "Aprobado". Debe estar registrado como aprobador del centro de costo y tener tope suficiente. |
| Analista administrativa | Usa este agente, revisa la OC propuesta y confirma excepciones. |
| Contabilidad / Auditoría | Consume `out/control.csv` y la evidencia de aprobación. |

## Matriz de controles

La matriz vigente (código, control, tipo, acción sugerida y responsable, más los parámetros como la tolerancia de cotización) **no se escribe aquí a mano**: se genera desde `src/knowledge/controles.json` y se anexa al final de este conocimiento. Así, si Contabilidad cambia un tipo o una tolerancia, el agente explica la regla vigente.

Criterios para explicar los hallazgos:

- Un **bloqueo** nunca se salta, ni con confirmación. Una **confirmación** requiere la decisión explícita de la analista, caso por caso. Un **derivado** solo se informa.
- RC1 busca al proveedor por NIT de la solicitud; si falta, por el NIT de la cotización; si falta, por nombre normalizado.
- RC3: si ningún aprobador del centro alcanza el monto, hay que escalar a la dirección (corregir el aprobador no basta).
- RC5: la cotización debe ser del mismo proveedor, en la misma moneda y estar vigente a la fecha de la solicitud. Si el líder aprobó un monto explícito menor que la cotización, recomienda re-aprobación en lugar de solo pedir confirmación.
- RC8: una OC retroactiva queda marcada para el indicador de la dirección; una factura ilegible no permite descartarla.

## Códigos SAP de referencia

- Indicadores de IVA: C0 excluido, C1 IVA 19 %, C2 IVA 5 %.
- Condiciones de pago: Z000 inmediato, Z015 15 días, Z030 30 días, Z060 60 días.
- Unidades: UN unidad, H hora, MES mes.
- Sociedad y organización de compras: 1000.
- Texto breve de posición: máximo 40 caracteres (el texto completo queda en la trazabilidad).

## Convenciones de datos

- Montos en formato colombiano (`11.400.000`); los valores de la solicitud y la cotización incluyen IVA.
- NIT sin puntos ni dígito de verificación.
- Las fechas se comparan como fecha calendario local (Bogotá).

## OC retroactivas

La dirección quiere medir qué porcentaje de OC se crean después de la factura. Cada intento queda en `out/control.csv` con la columna `retroactiva`. Al reportar un caso retroactivo, menciona que queda registrado para ese indicador.

---
name: ordenes-compra
description: Conocimiento del proceso de órdenes de compra de Periferia — matriz de controles RC1–RC10, códigos SAP, convenciones de datos y tratamiento de OC retroactivas. Úsalo al validar o explicar una OC.
---

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
- RC5: si el líder aprobó un monto explícito menor que la cotización, recomienda re-aprobación en lugar de solo pedir confirmación.
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

## Matriz de controles vigente (generada desde controles.json)

Parámetros: tolerancia de cotización 2 %, tolerancia aritmética ±1, texto breve SAP 40 caracteres, monedas COP/USD.

| Código | Control | Tipo | Acción sugerida | Responsable |
|---|---|---|---|---|
| RC1 | Proveedor existe en el maestro y está activo | bloqueo | Solicitar a Compras la creación o reactivación del proveedor en el maestro SAP, con RUT y certificación bancaria, antes de emitir la OC. | Compras (dueño del maestro de proveedores) |
| RC2 | Aprobación existe, dice 'Aprobado' y proviene de un aprobador del centro de costo | bloqueo | Pedir al solicitante la aprobación de un aprobador registrado para el centro de costo indicado. | Solicitante |
| RC3 | Valor total dentro del tope del aprobador | bloqueo | Escalar la aprobación a un aprobador con atribución suficiente según la matriz de delegación. | Solicitante / dueño de la matriz de aprobación |
| RC4 | Subárea pertenece al centro de costo | bloqueo | Pedir al solicitante corregir el centro de costo o la subárea en la solicitud. | Solicitante |
| RC5 | Cotización coincide con la solicitud (tolerancia 2 %) | confirmacion | Confirmar con el solicitante el valor correcto. Si el valor real es el de la cotización, actualizar la solicitud y obtener re-aprobación. | Analista administrativa |
| RC6 | Indicador de IVA informado (si falta, se deriva del proveedor) | confirmacion | Confirmar el indicador de IVA derivado del maestro de proveedores. | Analista administrativa |
| RC7 | Condiciones de pago informadas (si faltan, se derivan del proveedor) | derivado | Ninguna: se informa el valor derivado. | Analista administrativa |
| RC8 | OC no retroactiva (factura anterior a la solicitud) | confirmacion | Crear solo con confirmación explícita; queda marcada como retroactiva en el log de control para seguimiento de la dirección. | Analista administrativa / Dirección administrativa |
| RC9 | Aprobación posterior o igual a la fecha de solicitud | confirmacion | Confirmar que la aprobación corresponde a esta solicitud. | Analista administrativa |
| RC10 | Cantidad x valor unitario = valor total (± 1) | bloqueo | Pedir al solicitante corregir la cantidad, el valor unitario o el total de la solicitud. | Solicitante |

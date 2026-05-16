import math
import json
from urllib.parse import quote


def calcular_eoq(D: float, K: float, c1: float, T: float = 1.0) -> dict:
    """Calcula la Cantidad Económica de Pedido (EOQ / q0) usando el Modelo de Wilson.

    Args:
        D: Demanda total del período (unidades).
        K: Costo fijo por pedido ($/pedido).
        c1: Costo de mantenimiento por unidad por período ($/unidad/período).
        T: Duración del período (default: 1 año).

    Returns:
        Diccionario con q0, CTE, número de pedidos, tiempo entre pedidos y desglose de costos.
    """
    if any(v <= 0 for v in [D, K, c1, T]):
        return {"error": True, "mensaje": "Todos los parámetros deben ser números positivos (D>0, K>0, c1>0, T>0)."}

    q0_exacto = math.sqrt((2 * K * D) / (T * c1))
    q0 = round(q0_exacto)

    costo_pedido = (D / q0_exacto) * K
    costo_mantener = (q0_exacto / 2) * T * c1
    CTE_exacto = costo_pedido + costo_mantener

    CTE_redondeado = (D / q0) * K + (q0 / 2) * T * c1

    N = D / q0_exacto
    t = T / N
    t_dias = round(t * 365)

    return {
        "q0_exacto": round(q0_exacto, 2),
        "q0_redondeado": q0,
        "CTE_exacto": round(CTE_exacto, 2),
        "CTE_redondeado": round(CTE_redondeado, 2),
        "costo_pedido_periodo": round(costo_pedido, 2),
        "costo_mantener_periodo": round(costo_mantener, 2),
        "numero_pedidos": round(N, 2),
        "tiempo_entre_pedidos": round(t, 4),
        "tiempo_entre_pedidos_dias": t_dias,
        "parametros_usados": {"D": D, "K": K, "c1": c1, "T": T},
        "verificacion_formula": (
            f"q0 = sqrt((2 * {K} * {D}) / ({T} * {c1})) "
            f"= sqrt({round(2*K*D/(T*c1), 2)}) = {round(q0_exacto, 2)}"
        ),
    }


def validar_parametros(D: float, K: float, c1: float, T: float = 1.0) -> dict:
    """Valida que los parámetros para el cálculo EOQ sean correctos (numéricos y positivos).

    Args:
        D: Demanda total del período.
        K: Costo fijo por pedido.
        c1: Costo de mantenimiento por unidad por período.
        T: Duración del período (default: 1).

    Returns:
        Diccionario indicando si los parámetros son válidos y los errores encontrados.
    """
    errores = []
    campos = [
        ("D", "Demanda (D)", D),
        ("K", "Costo fijo por pedido (K)", K),
        ("c1", "Costo de mantenimiento (c1)", c1),
    ]

    for clave, nombre, valor in campos:
        if valor is None:
            errores.append(f"{nombre}: parámetro requerido, no fue proporcionado")
        elif valor <= 0:
            errores.append(f"{nombre}: debe ser mayor que 0 (recibido: {valor})")

    if T <= 0:
        errores.append(f"Duración del período (T): debe ser un número positivo (recibido: {T})")

    if errores:
        return {
            "valido": False,
            "errores": errores,
            "mensaje": "Parámetros inválidos:\n" + "\n".join(f"• {e}" for e in errores),
        }

    return {
        "valido": True,
        "mensaje": "Todos los parámetros son válidos. Procediendo al cálculo.",
        "parametros_validados": {"D": D, "K": K, "c1": c1, "T": T},
    }


def explicar_concepto(concepto: str) -> str:
    """Proporciona explicaciones sobre conceptos del Modelo EOQ/Wilson.

    Args:
        concepto: Nombre del concepto a explicar. Opciones: eoq, demanda, costo_pedido,
                  costo_mantenimiento, cte, supuestos, formula, restricciones.

    Returns:
        Explicación en texto markdown del concepto solicitado.
    """
    base = {
        "eoq": (
            "## Modelo EOQ (Cantidad Económica de Pedido)\n"
            "También conocido como **Modelo de Wilson** o Modelo I. Es un modelo determinístico "
            "estático que calcula el tamaño óptimo del lote de pedido que **minimiza el Costo Total "
            "Esperado (CTE)**.\n\n"
            "Equilibra dos fuerzas económicas contrapuestas:\n"
            "- **Costo de pedir** (disminuye si pedimos más cantidad cada vez)\n"
            "- **Costo de mantener** (aumenta si pedimos más cantidad cada vez)\n\n"
            "El óptimo está exactamente donde ambas curvas se intersectan."
        ),
        "demanda": (
            "## Demanda (D)\n"
            "Cantidad total de unidades requeridas durante el período de análisis T.\n\n"
            "**Supuesto clave**: en el EOQ la demanda es **constante y conocida** (determinística). "
            "No hay variabilidad.\n\n"
            "Ejemplo: D = 1.200 unidades/año."
        ),
        "costo_pedido": (
            "## Costo de Pedido / Preparación (K)\n"
            "Costo **fijo** asociado a emitir una orden de compra, "
            "**independiente del tamaño del lote**.\n\n"
            "Incluye: gastos administrativos, comunicación, recepción, logística.\n\n"
            "Ejemplo: K = $4.000 por pedido."
        ),
        "costo_mantenimiento": (
            "## Costo de Mantenimiento (c1)\n"
            "Costo de mantener **una unidad** almacenada durante **una unidad de tiempo**.\n\n"
            "Incluye: alquiler del depósito, seguros, deterioro, capital inmovilizado.\n\n"
            "Ejemplo: c1 = $800/unidad/año."
        ),
        "cte": (
            "## Costo Total Esperado (CTE)\n"
            "Función que el modelo **minimiza**:\n\n"
            "> **CTE = (D/q) × K + (q/2) × T × c1**\n\n"
            "Donde:\n"
            "- **(D/q) × K** = Costo total de emisión de órdenes en el período\n"
            "- **(q/2) × T × c1** = Costo total de almacenamiento en el período\n"
            "- q = cantidad pedida por orden"
        ),
        "supuestos": (
            "## Supuestos del Modelo EOQ/Wilson\n"
            "1. **Demanda constante y conocida** (sin variabilidad)\n"
            "2. **Plazo de entrega nulo** (o constante y conocido)\n"
            "3. **No se permiten faltantes**\n"
            "4. **Costo unitario constante** (sin descuentos por volumen)\n"
            "5. **Horizonte de planificación continuo**\n"
            "6. **Un solo producto** en la versión básica"
        ),
        "formula": (
            "## Fórmula de Wilson (Lote Óptimo)\n\n"
            "> **q₀ = √( 2 × K × D / (T × c1) )**\n\n"
            "| Símbolo | Significado |\n"
            "|---------|-------------|\n"
            "| D | Demanda total del período |\n"
            "| K | Costo fijo por pedido |\n"
            "| c1 | Costo de mantenimiento por unidad/período |\n"
            "| T | Duración del período (default: 1 año) |\n\n"
            "Se obtiene derivando CTE respecto a q e igualando a cero: dCTE/dq = 0."
        ),
        "restricciones": (
            "## Restricciones del Modelo\n\n"
            "**A. No negatividad:**\n> q ≥ 0 y N ≥ 0\n\n"
            "**B. Positividad de parámetros:**\n> D > 0, K > 0, c1 > 0, T > 0\n\n"
            "**C. Capacidad de almacenamiento:**\n> ∑(sᵢ × Nᵢₜ) ≤ S\n\n"
            "Donde sᵢ = espacio que ocupa una unidad y S = capacidad total del depósito."
        ),
    }

    concepto_norm = concepto.lower().strip()
    if concepto_norm in base:
        return base[concepto_norm]

    match = next((k for k in base if concepto_norm in k or k in concepto_norm), None)
    if match:
        return base[match]

    conceptos_disp = ", ".join(base.keys())
    return f'Concepto "{concepto}" no encontrado.\n\nConceptos disponibles: {conceptos_disp}'


def modo_practica(ejercicio: int = 1) -> dict:
    """Genera ejercicios de práctica del modelo EOQ con enunciado y solución.

    Args:
        ejercicio: Número de ejercicio a generar (1, 2 o 3).

    Returns:
        Diccionario con enunciado, datos del problema y solución correcta.
    """
    ejercicios = [
        {
            "id": 1,
            "contexto": "Ferretería local (bolsas de cemento)",
            "enunciado": (
                "Una ferretería en Resistencia vende **1.200 bolsas de cemento** por año.\n\n"
                "- Costo de emitir un pedido: **$4.000**\n"
                "- Costo de mantener una bolsa: **$800/año**\n"
                "- T = 1 año\n\n"
                "**¿Cuál es la cantidad óptima de pedido (q₀)?**"
            ),
            "datos": {"D": 1200, "K": 4000, "c1": 800, "T": 1},
            "pista": "Aplicá la Fórmula de Wilson: q₀ = √(2×K×D / T×c1). El numerador es 2×4000×1200 = 9.600.000",
        },
        {
            "id": 2,
            "contexto": "Distribuidora de pintura (latas)",
            "enunciado": (
                "Una distribuidora maneja **2.400 latas de pintura** por año.\n\n"
                "- Costo por pedido: **$5.000**\n"
                "- Costo de almacenamiento: **$600/lata/año**\n"
                "- T = 1 año\n\n"
                "**¿Cuál es el EOQ y cuántos pedidos se realizan por año?**"
            ),
            "datos": {"D": 2400, "K": 5000, "c1": 600, "T": 1},
            "pista": "El numerador es 2×5000×2400 = 24.000.000. El denominador es 600.",
        },
        {
            "id": 3,
            "contexto": "Depósito de tornillos (período trimestral)",
            "enunciado": (
                "Un depósito maneja **800 unidades de tornillos** por trimestre (T = 0,25 años).\n\n"
                "- Costo por orden: **$1.500**\n"
                "- Costo de mantener: **$200/unidad/año**\n\n"
                "**¿Cuál es el lote óptimo (q₀) y el tiempo entre pedidos en días?**"
            ),
            "datos": {"D": 800, "K": 1500, "c1": 200, "T": 0.25},
            "pista": "Atención: T=0,25 (trimestre). El denominador es T×c1 = 0,25 × 200 = 50",
        },
    ]

    idx = (ejercicio - 1) % len(ejercicios)
    ej = ejercicios[idx]

    D, K, c1, T = ej["datos"]["D"], ej["datos"]["K"], ej["datos"]["c1"], ej["datos"]["T"]
    q0_real = math.sqrt((2 * K * D) / (T * c1))
    q0_r = round(q0_real)
    N_real = D / q0_real
    t_real = T / N_real
    CTE_real = (D / q0_real) * K + (q0_real / 2) * T * c1

    return {
        "ejercicio_id": ej["id"],
        "contexto": ej["contexto"],
        "enunciado": ej["enunciado"],
        "datos": ej["datos"],
        "total_ejercicios": len(ejercicios),
        "solucion_correcta": {
            "q0_exacto": round(q0_real, 2),
            "q0_redondeado": q0_r,
            "CTE": round(CTE_real, 2),
            "N": round(N_real, 2),
            "t_dias": round(t_real * 365),
        },
        "pista": ej["pista"],
    }


def generar_grafico(D: float, K: float, c1: float, T: float = 1.0, q0: float = None) -> dict:
    """Genera una URL de gráfico con las curvas del Modelo EOQ usando QuickChart.io.

    Args:
        D: Demanda total del período.
        K: Costo fijo por pedido.
        c1: Costo de mantenimiento por unidad por período.
        T: Duración del período (default: 1).
        q0: Lote óptimo (si no se pasa, se calcula automáticamente).

    Returns:
        Diccionario con URL del gráfico, q0, CTE mínimo y descripción de las curvas.
    """
    if any(v <= 0 for v in [D, K, c1, T]):
        return {"error": "Parámetros inválidos para generar el gráfico."}

    if q0 is None or q0 <= 0:
        q0 = math.sqrt((2 * K * D) / (T * c1))

    q_min = max(1, round(q0 * 0.1))
    q_max = round(q0 * 3)
    PUNTOS = 40

    labels, costo_pedido_data, costo_mantener_data, costo_total_data = [], [], [], []

    for i in range(PUNTOS + 1):
        q = q_min + (q_max - q_min) * i / PUNTOS
        labels.append(round(q))
        costo_pedido_data.append(round((D / q) * K, 2))
        costo_mantener_data.append(round((q / 2) * T * c1, 2))
        costo_total_data.append(round((D / q) * K + (q / 2) * T * c1, 2))

    CTE_min = round((D / q0) * K + (q0 / 2) * T * c1, 2)
    q0_r = round(q0)

    chart_config = {
        "type": "line",
        "data": {
            "labels": labels,
            "datasets": [
                {
                    "label": "Costo de Pedido",
                    "data": costo_pedido_data,
                    "borderColor": "rgb(54, 162, 235)",
                    "borderWidth": 2,
                    "fill": False,
                    "tension": 0.4,
                    "pointRadius": 0,
                },
                {
                    "label": "Costo de Mantenimiento",
                    "data": costo_mantener_data,
                    "borderColor": "rgb(255, 99, 132)",
                    "borderWidth": 2,
                    "fill": False,
                    "tension": 0.4,
                    "pointRadius": 0,
                },
                {
                    "label": "Costo Total (CTE)",
                    "data": costo_total_data,
                    "borderColor": "rgb(40, 167, 69)",
                    "borderWidth": 3,
                    "fill": False,
                    "tension": 0.4,
                    "pointRadius": 0,
                },
            ],
        },
        "options": {
            "title": {
                "display": True,
                "text": f"Modelo EOQ - q0={q0_r} uds | CTE min=${CTE_min:,.2f}",
                "fontSize": 14,
            },
            "legend": {"position": "top"},
            "scales": {
                "xAxes": [{"scaleLabel": {"display": True, "labelString": "Cantidad de Pedido (q)"}}],
                "yAxes": [{"scaleLabel": {"display": True, "labelString": "Costo ($)"}}],
            },
        },
    }

    chart_url = "https://quickchart.io/chart?w=750&h=420&c=" + quote(json.dumps(chart_config))

    return {
        "url_grafico": chart_url,
        "q0_redondeado": q0_r,
        "CTE_minimo": CTE_min,
        "descripcion_curvas": [
            "Curva azul (Costo de Pedido): decrece hiperbólicamente cuando q aumenta.",
            "Curva roja (Costo de Mantenimiento): crece linealmente cuando q aumenta.",
            f"Curva verde (Costo Total): tiene forma de U. El mínimo es el EOQ (q₀={q0_r} unidades).",
            "El punto de intersección entre la curva azul y la roja coincide con el mínimo del CTE.",
        ],
        "interpretacion": (
            f"Cualquier cantidad mayor o menor que q₀={q0_r} unidades "
            f"genera un costo total mayor a ${CTE_min:,.2f}."
        ),
    }

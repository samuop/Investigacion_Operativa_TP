import math
import json
import os
import random
import base64
import urllib.request


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


# --- Modo práctica: generación dinámica de escenarios ---

_RUBROS_SEED = [
    ("Ferretería de barrio", "bolsas de cemento", "bolsa"),
    ("Distribuidora de pintura", "latas de pintura de 4L", "lata"),
    ("Panadería industrial", "kilos de harina 000", "kg"),
    ("Kiosco mayorista", "cajas de golosinas", "caja"),
    ("Tienda de electrónica", "auriculares bluetooth", "unidad"),
    ("Farmacia", "blisters de ibuprofeno 400mg", "blister"),
    ("Vivero", "bolsas de sustrato de 50L", "bolsa"),
    ("Imprenta", "resmas de papel A4", "resma"),
    ("Repuestería automotriz", "filtros de aceite", "filtro"),
    ("Carpintería", "planchas de MDF de 18mm", "plancha"),
    ("Bodega de vinos", "botellas de Malbec reserva", "botella"),
    ("Heladería artesanal", "kilos de chocolate cobertura", "kg"),
    ("Taller textil", "rollos de tela de algodón", "rollo"),
    ("Distribuidora gastronómica", "cajas de aceite de oliva", "caja"),
    ("Fábrica de muebles", "cajas de tornillos pasantes 6x70", "caja"),
    ("Importadora de juguetes", "sets de bloques de construcción", "set"),
    ("Vidriería", "planchas de vidrio float 4mm", "plancha"),
    ("Distribuidor de bebidas", "cajas de cerveza artesanal", "caja"),
]

_CIUDADES = [
    "Resistencia", "Corrientes", "Posadas", "Formosa", "Salta", "Mendoza",
    "Rosario", "La Plata", "Bahía Blanca", "Neuquén", "Córdoba", "Tucumán",
]


def _construir_prompt_escenario(seed: dict) -> str:
    return f"""Sos un generador de ejercicios para el Modelo EOQ (Wilson) de inventarios.
Tu tarea: inventar UN problema realista, en español rioplatense, con datos coherentes.

## Reglas estrictas
1. Devolvé EXCLUSIVAMENTE un objeto JSON válido, sin texto adicional, sin markdown, sin ```json.
2. Esquema requerido:
{{
  "contexto": "string corto (3-7 palabras) identificando el negocio y producto",
  "enunciado": "string en markdown con la historia del problema, datos en negrita, terminando con la pregunta",
  "datos": {{"D": número, "K": número, "c1": número, "T": número}},
  "pista": "string con una pista útil sin revelar el resultado final"
}}

3. Los parámetros DEBEN cumplir:
   - D (demanda del período): entero positivo entre 200 y 50.000
   - K (costo por pedido): entero positivo en pesos argentinos, entre 1.000 y 80.000
   - c1 (costo de mantener una unidad por período): número positivo entre 50 y 5.000
   - T (duración del período en años): uno de [1, 0.5, 0.25] (anual, semestral o trimestral)
   - El q0 resultante (raíz(2·K·D/(T·c1))) debe quedar entre 20 y 2.500 unidades aproximadamente.
   - Los números deben ser "redondos" y fáciles de leer (múltiplos de 50, 100, 500 o 1000 cuando sea posible).

4. El enunciado debe:
   - Tener entre 2 y 5 líneas.
   - Mencionar el rubro, la ciudad, y dar D, K, c1 y T explícitamente con sus unidades.
   - Usar formato markdown: **negrita** en los datos numéricos.
   - Terminar con una pregunta clara (cantidad óptima, CTE, número de pedidos, tiempo entre pedidos, etc).
   - NUNCA revelar el resultado.

5. La pista debe orientar (por ejemplo, recordar la fórmula o señalar el valor del numerador) pero NO dar el q0.

6. NO uses LaTeX. NO uses el símbolo $ excepto para precios concretos (ej: $4.500).

## Semillas de inspiración (usalas como guía, no copies literal)
- Rubro sugerido: {seed['rubro']}
- Producto sugerido: {seed['producto']}
- Unidad: {seed['unidad']}
- Ciudad sugerida: {seed['ciudad']}
- Período sugerido (T en años): {seed['T']}
- Escala de demanda sugerida: aproximadamente {seed['escala_D']} unidades

Recordá: respondé SOLO con el JSON, nada más."""


def _generar_escenario_llm() -> dict | None:
    """Intenta generar un escenario nuevo con Gemini. Devuelve None si falla."""
    api_key = os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        return None

    seed = {
        "rubro": random.choice(_RUBROS_SEED)[0],
        "producto": random.choice(_RUBROS_SEED)[1],
        "unidad": random.choice(_RUBROS_SEED)[2],
        "ciudad": random.choice(_CIUDADES),
        "T": random.choice([1, 1, 1, 0.5, 0.25]),
        "escala_D": random.choice([500, 1200, 2400, 5000, 10000, 20000]),
    }

    prompt = _construir_prompt_escenario(seed)
    modelo = os.environ.get("MODEL", "gemini-2.5-flash")

    payload = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 1.1,
            "responseMimeType": "application/json",
        },
    }).encode("utf-8")

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{modelo}:generateContent"
    try:
        req = urllib.request.Request(
            url,
            data=payload,
            headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read())
        texto = data["candidates"][0]["content"]["parts"][0]["text"].strip()
        if texto.startswith("```"):
            texto = texto.strip("`")
            if texto.startswith("json"):
                texto = texto[4:]
            texto = texto.strip()
        escenario = json.loads(texto)
    except Exception:
        return None

    if not _validar_escenario(escenario):
        return None
    return escenario


def _validar_escenario(esc: dict) -> bool:
    """Verifica que el escenario tenga estructura válida y q0 razonable."""
    try:
        datos = esc["datos"]
        D = float(datos["D"])
        K = float(datos["K"])
        c1 = float(datos["c1"])
        T = float(datos["T"])
        if D <= 0 or K <= 0 or c1 <= 0 or T <= 0:
            return False
        q0 = math.sqrt((2 * K * D) / (T * c1))
        if not (5 <= q0 <= 5000):
            return False
        if not (esc.get("enunciado") and esc.get("contexto")):
            return False
        return True
    except (KeyError, TypeError, ValueError):
        return False


def _escenario_fallback_aleatorio() -> dict:
    """Plantillas con datos aleatorizados; siempre producen un q0 sano."""
    plantilla = random.choice(_RUBROS_SEED)
    rubro, producto, unidad = plantilla
    ciudad = random.choice(_CIUDADES)
    T = random.choice([1, 1, 1, 0.5, 0.25])

    D = random.choice([600, 800, 1000, 1200, 1500, 2000, 2400, 3000, 5000, 7500, 10000])
    K = random.choice([1500, 2000, 3000, 4000, 5000, 7500, 10000, 15000])
    c1 = random.choice([100, 150, 200, 300, 400, 500, 600, 800, 1000])

    t_label = {1: "1 año", 0.5: "6 meses (semestre)", 0.25: "1 trimestre"}[T]
    enunciado = (
        f"Una **{rubro.lower()}** ubicada en **{ciudad}** maneja una demanda de "
        f"**{D:,} {producto}** durante un período de **{t_label}**.\n\n"
        f"- Costo de emitir un pedido: **${K:,}**\n"
        f"- Costo de mantener una unidad por año: **${c1:,}/{unidad}/año**\n"
        f"- T = {T} año\n\n"
        f"**¿Cuál es la cantidad óptima de pedido (q₀) y el CTE asociado?**"
    ).replace(",", ".")

    numerador = 2 * K * D
    pista = (
        f"Aplicá la fórmula de Wilson: q₀ = raiz(2·K·D / (T·c1)). "
        f"El numerador es 2·{K}·{D} = {numerador:,}.".replace(",", ".")
    )

    return {
        "contexto": f"{rubro} ({producto})",
        "enunciado": enunciado,
        "datos": {"D": D, "K": K, "c1": c1, "T": T},
        "pista": pista,
    }


def modo_practica(ejercicio: int = 1) -> dict:
    """Genera un ejercicio de práctica del modelo EOQ con un escenario inventado al vuelo.

    El escenario se genera dinámicamente con un LLM para evitar repetición.
    Si la generación falla, se usa una plantilla aleatorizada como fallback.
    La solución se recalcula siempre con la fórmula real, garantizando que el ejercicio cierre.

    Args:
        ejercicio: Parámetro de compatibilidad (ya no selecciona un fijo, solo se conserva).

    Returns:
        Diccionario con enunciado, datos del problema y solución correcta.
    """
    escenario = _generar_escenario_llm()
    fuente = "generado"
    if escenario is None:
        escenario = _escenario_fallback_aleatorio()
        fuente = "plantilla"

    datos = escenario["datos"]
    D = float(datos["D"])
    K = float(datos["K"])
    c1 = float(datos["c1"])
    T = float(datos["T"])

    q0_real = math.sqrt((2 * K * D) / (T * c1))
    q0_r = round(q0_real)
    N_real = D / q0_real
    t_real = T / N_real
    CTE_real = (D / q0_real) * K + (q0_real / 2) * T * c1

    return {
        "ejercicio_id": ejercicio,
        "fuente": fuente,
        "contexto": escenario["contexto"],
        "enunciado": escenario["enunciado"],
        "datos": {"D": D, "K": K, "c1": c1, "T": T},
        "solucion_correcta": {
            "q0_exacto": round(q0_real, 2),
            "q0_redondeado": q0_r,
            "CTE": round(CTE_real, 2),
            "N": round(N_real, 2),
            "t_dias": round(t_real * 365),
        },
        "pista": escenario.get("pista", "Aplicá la fórmula de Wilson: q₀ = raiz(2·K·D / (T·c1))."),
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

    # POST a QuickChart — evita el límite de longitud de GET
    payload = json.dumps({
        "chart": chart_config,
        "width": 750,
        "height": 420,
        "backgroundColor": "white",
        "format": "png",
    }).encode("utf-8")

    try:
        req = urllib.request.Request(
            "https://quickchart.io/chart/create",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read())
        chart_url = result.get("url", "")
    except Exception as e:
        chart_url = ""

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

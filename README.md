# Chatbot EOQ - Modelo de Wilson

Agente conversacional para calcular y explicar el **Modelo de Inventario EOQ (Cantidad Economica de Pedido)**, construido con [Google ADK](https://adk.dev) y Gemini.

## Requisitos previos

- Python 3.11 o superior
- Una API key de Google AI Studio (gratis)

## Instalacion

### 1. Clonar el repositorio

```bash
git clone <url-del-repo>
cd Investigacion_Operativa_TP
```

### 2. Crear y activar un entorno virtual

**Windows (PowerShell):**
```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

**Mac / Linux:**
```bash
python -m venv .venv
source .venv/bin/activate
```

> En PowerShell, si aparece un error de política de ejecución, correr primero:
> `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`

### 3. Instalar dependencias

```bash
pip install -r requirements.txt
```

### 4. Configurar la API key

Crear el archivo `.env` copiando el ejemplo:

```bash
# Windows
copy .env.example .env

# Mac / Linux
cp .env.example .env
```

Luego editar `.env` y reemplazar `tu_api_key_aqui` con tu key real.

> Obtenela gratis en [aistudio.google.com/apikey](https://aistudio.google.com/apikey) — solo necesitas una cuenta de Google.

## Correr el agente

### Opcion A: Chat en el navegador (recomendado)

```bash
adk web
```

Abre [http://localhost:8000](http://localhost:8000) en tu navegador. En el selector de agente elegir **eoq_chatbot**.

### Opcion B: Chat en la terminal

```bash
adk run eoq_agent
```

## Que puede hacer el chatbot

| Funcion | Ejemplo de mensaje |
|---|---|
| Calcular EOQ | "D=1200, K=4000, c1=800, calcular q0" |
| Explicar conceptos | "Que es el CTE?" / "Explica los supuestos del modelo" |
| Generar grafico | "Mostra el grafico de costos" |
| Modo practica | "Dame un ejercicio para practicar" |

## Estructura del proyecto

```
Investigacion_Operativa_TP/
├── eoq_agent/
│   ├── __init__.py     # Expone root_agent (requerido por ADK)
│   ├── agent.py        # Definicion del agente y system prompt
│   └── tools.py        # Las 5 herramientas del modelo EOQ
├── .env.example        # Plantilla de variables de entorno
├── .env                # Tu configuracion local (NO subir al repo)
├── requirements.txt    # Dependencias Python
└── README.md
```

## Solucion de problemas comunes

**`ModuleNotFoundError: google.adk`**
> Asegurarse de tener el entorno virtual activado y haber corrido `pip install -r requirements.txt`.

**`GOOGLE_API_KEY not set`**
> Verificar que el archivo `.env` existe en la raiz del proyecto y tiene la key correcta.

**`adk: command not found`**
> El entorno virtual no esta activado. Correr el paso de activacion nuevamente.

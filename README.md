## TP de Investigacion Operativa

**Equipo:** Solver Squad

**Integrantes:**
- Barabas, Axel Daniel
- Codas, Agustin Alejandro
- Ibaigorria, Ignacio Ivan
- Insaurralde, Sebastian
- Paredes, Samuel Octavio
- Zapata, Rodrigo

---

# Chatbot EOQ - Modelo de Wilson

Agente conversacional para calcular y explicar el **Modelo de Inventario EOQ (Cantidad Economica de Pedido)**, construido con [Google ADK](https://adk.dev), Gemini, FastAPI y React.

## Requisitos previos

- Python 3.11 o superior
- Node.js 20 o superior
- Una API key de Google AI Studio (gratis) — obtenerla en [aistudio.google.com/apikey](https://aistudio.google.com/apikey)

---

## Instalacion

### 1. Clonar el repositorio

```bash
git clone https://github.com/samuop/Investigacion_Operativa_TP.git
cd Investigacion_Operativa_TP
```

### 2. Crear y activar entorno virtual Python

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

> En PowerShell, si aparece un error de politica de ejecucion, correr primero:
> `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`

### 3. Instalar dependencias Python

```bash
pip install -r requirements.txt
```

### 4. Instalar dependencias del frontend

```bash
cd frontend
npm install
cd ..
```

---

## Correr el proyecto

El sistema tiene dos partes que deben correr en paralelo: el **backend** (Python) y el **frontend** (React). Abrir **dos terminales**.

### Terminal 1 — Backend (FastAPI + Agente ADK)

```powershell
# Windows
.\.venv\Scripts\Activate.ps1
uvicorn backend.main:app --reload
```

```bash
# Mac / Linux
source .venv/bin/activate
uvicorn backend.main:app --reload
```

El backend queda disponible en [http://localhost:8000](http://localhost:8000).

### Terminal 2 — Frontend (React)

```bash
cd frontend
npm run dev
```

El frontend queda disponible en [http://localhost:5173](http://localhost:5173).

---

## Configurar la API key desde la interfaz

1. Abrir [http://localhost:5173](http://localhost:5173) en el navegador
2. Hacer clic en **Configuracion** (boton abajo a la izquierda)
3. Ingresar la API key de Google AI Studio
4. Seleccionar el modelo deseado
5. Hacer clic en **Guardar**

La API key y el modelo quedan guardados en la base de datos local (`eoq.db`) y persisten entre sesiones.

> La API key **nunca se sube al repositorio**. Se guarda solo en la base de datos local.

---

## Que puede hacer el chatbot

| Modo | Ejemplo de mensaje |
|---|---|
| Calcular EOQ | "D=1200, K=4000, c1=800, calcular q0" |
| Explicar conceptos | "Que es el CTE?" / "Explica los supuestos del modelo" |
| Generar grafico | "Mostra el grafico de costos" |
| Modo practica | "Dame un ejercicio para practicar" |

---

## Estructura del proyecto

```
Investigacion_Operativa_TP/
├── eoq_agent/
│   ├── __init__.py       # Expone root_agent (requerido por ADK)
│   ├── agent.py          # Definicion del agente y system prompt
│   └── tools.py          # Las 5 herramientas del modelo EOQ
├── backend/
│   ├── __init__.py
│   ├── main.py           # API FastAPI + integracion ADK
│   ├── database.py       # Conexion SQLite
│   └── models.py         # Tablas: config, sessions, messages, eoq_logs
├── frontend/
│   └── src/
│       ├── api.ts         # Cliente HTTP al backend
│       ├── App.tsx        # Layout principal
│       ├── App.css        # Estilos globales
│       └── components/
│           ├── Chat.tsx      # Ventana de chat
│           ├── Sidebar.tsx   # Historial de sesiones
│           └── Settings.tsx  # Configuracion de API key y modelo
├── .env.example          # Plantilla de variables (solo para adk web)
├── requirements.txt      # Dependencias Python
└── README.md
```

---

## Solucion de problemas comunes

**`ModuleNotFoundError: google.adk`**
> El entorno virtual no esta activado o no se corrieron las dependencias. Activar el venv y correr `pip install -r requirements.txt`.

**`Error al conectar con el backend`**
> Verificar que el backend este corriendo en la Terminal 1 (`uvicorn backend.main:app --reload`).

**`No hay API key configurada`**
> Ir a Configuracion en el frontend e ingresar la API key antes de chatear.

**`Se alcanzo el limite diario de consultas`**
> La API key gratuita tiene un limite diario de 50 requests. Esperar al dia siguiente o cambiar el modelo a uno con mayor cuota desde Configuracion.

**Error de politica de ejecucion en PowerShell**
> Correr: `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`

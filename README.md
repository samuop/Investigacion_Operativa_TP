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

Solo necesitas tener instalado:

- **Python 3.11 o superior** — [python.org/downloads](https://www.python.org/downloads/)
  - En Windows: durante la instalación marcá la opción **"Add Python to PATH"**
- **Node.js 20 o superior** (trae `npm`) — [nodejs.org](https://nodejs.org/)
- Una **API key de Google AI Studio** (gratis) — [aistudio.google.com/apikey](https://aistudio.google.com/apikey)

> No hace falta crear el entorno virtual ni instalar dependencias a mano: el comando `npm run dev` se encarga de todo.

---

## Instalacion y ejecucion

### 1. Clonar el repositorio

```bash
git clone https://github.com/samuop/Investigacion_Operativa_TP.git
cd Investigacion_Operativa_TP
```

### 2. Un solo comando para todo

```bash
npm run dev
```

Eso es todo. El lanzador ([scripts/dev.mjs](scripts/dev.mjs)) se encarga automaticamente de:

1. **Crear el entorno virtual** de Python (`.venv`) si no existe
2. **Instalar las dependencias de Python** (`requirements.txt`) — solo si cambiaron
3. **Instalar las dependencias del frontend** — solo si faltan
4. **Levantar el backend y el frontend** en paralelo, usando el Python del venv directamente (no hace falta activar el venv a mano)

La **primera vez** tarda unos minutos (crea el venv e instala todo). Las siguientes arranca al instante porque detecta que ya esta todo listo.

- Backend disponible en [http://localhost:8000](http://localhost:8000) (prefijo `BACK` en celeste)
- Frontend disponible en [http://localhost:5173](http://localhost:5173) (prefijo `FRONT` en magenta)

Para cortar ambos procesos, `Ctrl+C` una sola vez.

> **Windows:** si aparece un error de politica de ejecucion de scripts, correr una vez:
> `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`

### Correr cada parte por separado (opcional)

Si activaste el venv manualmente, podes correr cada servicio por su cuenta:

```bash
npm run dev:back    # solo backend  (uvicorn)
npm run dev:front   # solo frontend (vite)
```

---

## Configurar la API key desde la interfaz

1. Abrir [http://localhost:5173](http://localhost:5173) en el navegador
2. Hacer clic en **Configuracion** (boton abajo a la izquierda)
3. Ingresar la API key de Google AI Studio
4. Seleccionar el modelo deseado (la lista se carga sola al ingresar la key)
5. Hacer clic en **Guardar**

La API key y el modelo quedan guardados en la base de datos local (`eoq.db`) y persisten entre sesiones.

> La API key **nunca se sube al repositorio**. Se guarda solo en la base de datos local, ignorada por git.

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
│   ├── package.json      # Dependencias del frontend
│   └── src/
│       ├── api.ts         # Cliente HTTP al backend
│       ├── App.tsx        # Layout principal
│       ├── App.css        # Estilos globales
│       └── components/
│           ├── Chat.tsx      # Ventana de chat
│           ├── Sidebar.tsx   # Historial de sesiones
│           └── Settings.tsx  # Configuracion de API key y modelo
├── scripts/
│   └── dev.mjs           # Lanzador: crea venv, instala deps y arranca todo
├── package.json          # Define `npm run dev`
├── requirements.txt      # Dependencias Python
└── README.md
```

> La API key **no se guarda en archivos** (no hay `.env`): se ingresa desde la interfaz y persiste en la base de datos local `eoq.db`, ignorada por git.

---

## Solucion de problemas comunes

**`No se encontró Python 3`**
> El lanzador no encontro Python. Instalalo desde [python.org/downloads](https://www.python.org/downloads/) y reabri la terminal. En Windows, marcar "Add Python to PATH" durante la instalacion.

**`ModuleNotFoundError: google.adk` o falla el backend al arrancar**
> Las dependencias de Python no se instalaron bien. Borrar la carpeta `.venv` y volver a correr `npm run dev` — se recrea desde cero.

**`Error al conectar con el backend`**
> El backend no esta corriendo o se cayo. Mirar la salida con prefijo `BACK` en la terminal de `npm run dev`.

**`No hay API key configurada`**
> Ir a Configuracion (boton abajo a la izquierda) e ingresar la API key antes de chatear.

**`Se alcanzo el limite diario de consultas`**
> La API key gratuita tiene una cuota diaria limitada. Se reestablece automaticamente al dia siguiente, o cambiar el modelo desde Configuracion.

**El modelo no aparece en la lista de Configuracion**
> La lista se carga consultando la API de Google con la key ingresada. Verificar que la key sea valida; los modelos aparecen unos segundos despues de pegarla.

**Error de politica de ejecucion en PowerShell**
> Correr: `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`

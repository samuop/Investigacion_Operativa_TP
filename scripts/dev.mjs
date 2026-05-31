#!/usr/bin/env node
/**
 * Lanzador todo-en-uno del Chatbot EOQ.
 *
 * `npm run dev` ejecuta este script, que:
 *   1. Crea el entorno virtual de Python (.venv) si no existe.
 *   2. Instala/actualiza las dependencias de Python si requirements.txt cambió.
 *   3. Instala las dependencias del frontend si faltan.
 *   4. Arranca backend (FastAPI) y frontend (Vite) en paralelo usando el
 *      Python del venv directamente — sin necesidad de activarlo a mano.
 *
 * Funciona en Windows, macOS y Linux. No requiere dependencias externas.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VENV = join(ROOT, ".venv");
const IS_WIN = process.platform === "win32";

// Rutas a los binarios del venv según el SO
const VENV_BIN = IS_WIN ? join(VENV, "Scripts") : join(VENV, "bin");
const VENV_PY = join(VENV_BIN, IS_WIN ? "python.exe" : "python");

// Archivo donde guardamos el hash de requirements.txt ya instalado
const REQ_FILE = join(ROOT, "requirements.txt");
const REQ_STAMP = join(VENV, ".requirements.stamp");

// ── Helpers de consola ──────────────────────────────────────────────
const c = {
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  magenta: (s) => `\x1b[35m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
};
const log = (msg) => console.log(`${c.green("[setup]")} ${msg}`);
const warn = (msg) => console.log(`${c.yellow("[setup]")} ${msg}`);

/**
 * Error de setup con mensaje amigable y sugerencias para el usuario.
 */
class SetupError extends Error {
  constructor(title, { detail = "", hints = [] } = {}) {
    super(title);
    this.title = title;
    this.detail = detail;
    this.hints = hints;
  }
}

/** Dibuja un cartel de error claro y accionable. */
function showError(err) {
  const W = 64;
  const line = (s = "") => {
    // Cortar/rellenar respetando ancho (sin contar códigos de color)
    const visible = s.replace(/\x1b\[[0-9;]*m/g, "");
    const pad = Math.max(0, W - visible.length);
    return `${c.red("│")} ${s}${" ".repeat(pad)} ${c.red("│")}`;
  };

  console.error("");
  console.error(c.red(`╭${"─".repeat(W + 2)}╮`));
  console.error(line(c.red(`✗  ${err.title ?? err.message}`)));
  if (err.detail) {
    console.error(line());
    for (const d of String(err.detail).split("\n")) console.error(line(c.dim(d)));
  }
  if (err.hints?.length) {
    console.error(line());
    console.error(line(c.yellow("Posibles soluciones:")));
    for (const h of err.hints) console.error(line(`  • ${h}`));
  }
  console.error(c.red(`╰${"─".repeat(W + 2)}╯`));
  console.error("");
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: "inherit", cwd: ROOT, ...opts });
  if (res.error) {
    if (res.error.code === "ENOENT") {
      throw new SetupError(`No se encontró el comando "${cmd}"`, {
        detail: `El sistema no pudo ejecutar: ${cmd} ${args.join(" ")}`,
        hints: [`Verificá que "${cmd}" esté instalado y en el PATH.`],
      });
    }
    throw res.error;
  }
  if (res.status !== 0) {
    throw new SetupError(`El comando falló (código ${res.status})`, {
      detail: `${cmd} ${args.join(" ")}`,
      hints: ["Revisá el detalle del error arriba para ver qué fallo."],
    });
  }
}

/** Encuentra un Python base para crear el venv. Prefiere `py -3` en Windows. */
function findBasePython() {
  const candidates = IS_WIN
    ? [["py", ["-3", "--version"]], ["python", ["--version"]], ["python3", ["--version"]]]
    : [["python3", ["--version"]], ["python", ["--version"]]];

  for (const [cmd, args] of candidates) {
    const res = spawnSync(cmd, args, { stdio: "ignore" });
    if (res.status === 0) {
      // Devolver el comando + args de creación de venv
      return cmd === "py" ? { cmd: "py", prefix: ["-3"] } : { cmd, prefix: [] };
    }
  }
  return null;
}

// ── 1. Crear venv si no existe ──────────────────────────────────────
function ensureVenv() {
  if (existsSync(VENV_PY)) return;

  const base = findBasePython();
  if (!base) {
    throw new SetupError("No se encontró Python 3", {
      detail: "El lanzador necesita Python 3.11+ para crear el entorno virtual.",
      hints: [
        "Instalalo desde https://www.python.org/downloads/",
        IS_WIN ? 'Marcá "Add Python to PATH" durante la instalación.' : "Verificá que 'python3' esté en el PATH.",
        "Reabrí la terminal después de instalarlo.",
      ],
    });
  }

  log(`Creando entorno virtual en ${c.dim(".venv")} ...`);
  run(base.cmd, [...base.prefix, "-m", "venv", VENV]);
  log(c.green("Entorno virtual creado."));
}

// ── 2. Instalar deps de Python si requirements.txt cambió ───────────
function ensurePythonDeps() {
  const current = readFileSync(REQ_FILE, "utf8");
  const installed = existsSync(REQ_STAMP) ? readFileSync(REQ_STAMP, "utf8") : "";

  if (current === installed) {
    log("Dependencias de Python al día.");
    return;
  }

  log("Instalando dependencias de Python ...");
  try {
    run(VENV_PY, ["-m", "pip", "install", "--upgrade", "pip", "--quiet"]);
    run(VENV_PY, ["-m", "pip", "install", "-r", REQ_FILE]);
  } catch {
    throw new SetupError("Falló la instalación de dependencias de Python", {
      detail: "pip no pudo instalar los paquetes de requirements.txt (ver detalle arriba).",
      hints: [
        "Revisá tu conexión a internet.",
        "Borrá la carpeta .venv y volvé a correr 'npm run dev' para recrearla limpia.",
      ],
    });
  }
  writeFileSync(REQ_STAMP, current);
  log(c.green("Dependencias de Python instaladas."));
}

// ── 3. Instalar deps del frontend si faltan ─────────────────────────
function ensureFrontendDeps() {
  const nodeModules = join(ROOT, "frontend", "node_modules");
  if (existsSync(nodeModules)) {
    log("Dependencias del frontend al día.");
    return;
  }
  log("Instalando dependencias del frontend ...");
  try {
    run(IS_WIN ? "npm.cmd" : "npm", ["--prefix", "frontend", "install"]);
  } catch {
    throw new SetupError("Falló la instalación de dependencias del frontend", {
      detail: "npm no pudo instalar los paquetes de frontend/package.json (ver detalle arriba).",
      hints: [
        "Revisá tu conexión a internet.",
        "Borrá frontend/node_modules y volvé a correr 'npm run dev'.",
      ],
    });
  }
  log(c.green("Dependencias del frontend instaladas."));
}

// ── 4. Arrancar ambos servicios en paralelo ─────────────────────────
function startServices() {
  console.log(`\n${c.green("▶ Levantando backend y frontend...")}\n`);

  // Backend: usar el python del venv → encuentra todas las dependencias
  const back = spawn(VENV_PY, ["-m", "uvicorn", "backend.main:app", "--reload"], {
    cwd: ROOT,
  });

  // Frontend: vite vía npm
  const front = spawn(IS_WIN ? "npm.cmd" : "npm", ["--prefix", "frontend", "run", "dev"], {
    cwd: ROOT,
  });

  pipe(back, "BACK", c.cyan);
  pipe(front, "FRONT", c.magenta);

  // Si uno muere, matamos al otro y salimos
  const killAll = () => {
    back.kill();
    front.kill();
  };
  back.on("exit", (code) => { warn(`backend terminó (${code})`); front.kill(); process.exit(code ?? 0); });
  front.on("exit", (code) => { warn(`frontend terminó (${code})`); back.kill(); process.exit(code ?? 0); });
  process.on("SIGINT", () => { killAll(); process.exit(0); });
  process.on("SIGTERM", () => { killAll(); process.exit(0); });
}

/** Prefija cada línea de salida de un proceso con [NOMBRE] coloreado. */
function pipe(proc, name, color) {
  const tag = color(`[${name}]`);
  const handle = (data) => {
    data.toString().split(/\r?\n/).forEach((line) => {
      if (line.length) console.log(`${tag} ${line}`);
    });
  };
  proc.stdout.on("data", handle);
  proc.stderr.on("data", handle);
}

// ── Main ────────────────────────────────────────────────────────────
try {
  ensureVenv();
  ensurePythonDeps();
  ensureFrontendDeps();
  startServices();
} catch (err) {
  if (err instanceof SetupError) {
    showError(err);
  } else {
    // Error inesperado: mostrarlo igual en el cartel, con el stack como detalle
    showError(new SetupError("Error inesperado al iniciar", {
      detail: err.stack ?? err.message,
      hints: ["Si no entendés el error, copialo y compartilo con el equipo."],
    }));
  }
  process.exit(1);
}

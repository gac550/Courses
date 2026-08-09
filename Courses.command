#!/bin/bash
# Lanzador de Courses para macOS.
#
# Doble clic desde el Finder para abrir la aplicacion. Funciona desde cualquier
# carpeta: todas las rutas se resuelven respecto de la ubicacion de este archivo,
# de modo que mover la carpeta completa no rompe nada.

cd "$(dirname "$0")" || exit 1

echo "Courses"
echo "======="
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js no esta instalado."
  echo "Instalarlo desde https://nodejs.org y volver a intentar."
  echo ""
  read -r -p "Pulsar Intro para cerrar..."
  exit 1
fi

# Primera ejecucion: instalar dependencias.
if [ ! -d "node_modules" ]; then
  echo "Primera ejecucion: instalando dependencias (puede tardar unos minutos)..."
  npm install || { echo "Fallo la instalacion."; read -r -p "Intro para cerrar..."; exit 1; }
  echo ""
fi

# Compilar solo si falta el build o si el codigo fuente es mas reciente.
needs_build=0
[ ! -f "dist/main/index.js" ] && needs_build=1
if [ "$needs_build" -eq 0 ]; then
  newer=$(find src electron.vite.config.mjs -newer dist/main/index.js 2>/dev/null | head -1)
  [ -n "$newer" ] && needs_build=1
fi

if [ "$needs_build" -eq 1 ]; then
  echo "Compilando la aplicacion..."
  npm run build || { echo "Fallo la compilacion."; read -r -p "Intro para cerrar..."; exit 1; }
  echo ""
fi

echo "Abriendo Courses..."
npx electron dist/main/index.js

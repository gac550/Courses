@echo off
REM Lanzador de Courses para Windows.
REM
REM Doble clic desde el Explorador para abrir la aplicacion. Funciona desde
REM cualquier carpeta: todas las rutas se resuelven respecto de la ubicacion de
REM este archivo, de modo que mover la carpeta completa no rompe nada.

cd /d "%~dp0"

echo Courses
echo =======
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js no esta instalado.
  echo Instalarlo desde https://nodejs.org y volver a intentar.
  echo.
  pause
  exit /b 1
)

REM Primera ejecucion: instalar dependencias.
if not exist "node_modules" (
  echo Primera ejecucion: instalando dependencias ^(puede tardar unos minutos^)...
  call npm install
  if errorlevel 1 (
    echo Fallo la instalacion.
    pause
    exit /b 1
  )
  echo.
)

REM Compilar si falta el build.
if not exist "dist\main\index.js" (
  echo Compilando la aplicacion...
  call npm run build
  if errorlevel 1 (
    echo Fallo la compilacion.
    pause
    exit /b 1
  )
  echo.
)

echo Abriendo Courses...
call npx electron dist/main/index.js

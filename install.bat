@echo off
echo ================================================
echo   BEST Frontend - Quick Installation
echo ================================================
echo.

REM Check Node.js
echo [1/5] Checking Node.js...
node --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js is not installed!
    echo Please install Node.js 18+ from https://nodejs.org
    pause
    exit /b 1
)
echo OK: Node.js found
echo.

REM Install dependencies
echo [2/5] Installing dependencies...
call npm install
if errorlevel 1 (
    echo ERROR: npm install failed!
    pause
    exit /b 1
)
echo OK: Dependencies installed
echo.

REM Create .env file
echo [3/5] Creating .env file...
if not exist .env (
    echo VITE_BACKEND_URL=http://localhost:3000 > .env
    echo OK: .env file created
) else (
    echo INFO: .env file already exists, skipping
)
echo.

REM Build project
echo [4/5] Building project...
call npm run build
if errorlevel 1 (
    echo ERROR: Build failed!
    pause
    exit /b 1
)
echo OK: Build successful
echo.

REM Done
echo [5/5] Installation complete!
echo.
echo ================================================
echo   Ready to use!
echo ================================================
echo.
echo To start development server:
echo   npm run dev
echo.
echo To start production server:
echo   npm run preview
echo.
echo To deploy:
echo   Deploy the 'dist' folder to your hosting
echo.
pause

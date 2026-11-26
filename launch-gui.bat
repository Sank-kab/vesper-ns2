@echo off
setlocal
cd /d "%~dp0"
set PORT=47821
set NODEEXE=C:\Program Files\nodejs\node.exe
if not exist "%NODEEXE%" set NODEEXE=node

powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 http://127.0.0.1:%PORT%/api/state; exit 0 } catch { exit 1 }"
if %errorlevel% neq 0 (
  start "Vesper Server" /min "%NODEEXE%" "%~dp0server.cjs"
  powershell -NoProfile -Command "for($i=0;$i -lt 25;$i++){ Start-Sleep -Milliseconds 250; try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 http://127.0.0.1:%PORT%/api/state; if($r.StatusCode -eq 200){ exit 0 } } catch {} } exit 1"
)

set EDGE="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if exist %EDGE% (
  start "" %EDGE% --app=http://127.0.0.1:%PORT% --window-size=1240,840
) else (
  start "" http://127.0.0.1:%PORT%
)

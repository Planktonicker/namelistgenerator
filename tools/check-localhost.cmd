@echo off
setlocal
title Namelist - can this PC run a localhost server?
echo(
echo ============================================================
echo   Can this PC serve admin.html over http://localhost ?
echo ============================================================
echo(
echo Nothing is installed, nothing is downloaded, and nothing
echo leaves this machine. Every check below looks for something
echo that is already here. Safe to run on a managed PC.
echo(

echo --- 1. Chrome ----------------------------------------------
echo Version 122 or newer is what can remember a folder
echo permission, which is the whole point of the exercise.
reg query "HKCU\Software\Google\Chrome\BLBeacon" /v version 2>nul
echo If nothing printed, open  chrome://version  and read line 1.
echo(

echo --- 2. Anything already here that can serve files -----------
where py       >nul 2>&1 && echo   FOUND   py       -^> py -m http.server 8000 --bind 127.0.0.1
where python   >nul 2>&1 && echo   FOUND   python   -^> python -m http.server 8000 --bind 127.0.0.1
where python3  >nul 2>&1 && echo   FOUND   python3
where node     >nul 2>&1 && echo   FOUND   node     -^> a few lines of script will do it
where php      >nul 2>&1 && echo   FOUND   php      -^> php -S 127.0.0.1:8000
where code     >nul 2>&1 && echo   FOUND   vscode   -^> the Live Server extension does this
if exist "%ProgramFiles%\IIS Express\iisexpress.exe" echo   FOUND   IIS Express
if exist "%ProgramFiles(x86)%\IIS Express\iisexpress.exe" echo   FOUND   IIS Express ^(x86^)
echo   Nothing listed means none of the usual ones are installed,
echo   which is normal on a managed PC and not the end of it.
echo(

echo --- 3. PowerShell ------------------------------------------
powershell -NoProfile -Command "Write-Host ('   version       : ' + $PSVersionTable.PSVersion); Write-Host ('   language mode : ' + $ExecutionContext.SessionState.LanguageMode)"
if errorlevel 1 echo   PowerShell would not run at all.
echo   FullLanguage is what you want here.
echo   ConstrainedLanguage means AppLocker is on and the check
echo   below will fail - that is the one real blocker.
echo(

echo --- 4. Can anything listen on 127.0.0.1 without admin? ------
echo A loopback socket needs no admin rights and no firewall
echo exception, unlike a server other machines can reach.
powershell -NoProfile -Command "try { $l = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 8123); $l.Start(); $l.Stop(); Write-Host '   YES - started and stopped a listener on 127.0.0.1:8123' } catch { Write-Host ('   NO  - ' + $_.Exception.Message) }"
echo(

echo --- 5. Is the port free? ------------------------------------
netstat -an | find ":8000 " | find "LISTENING"
if errorlevel 1 echo   Port 8000 is free.
echo(

echo ============================================================
echo   Send these results back and the launcher can be written
echo   for whichever of them is actually available.
echo ============================================================
echo(
echo One more thing to look at by hand, which cannot be scripted:
echo open  chrome://policy  and search for  FileSystem  . If IT has
echo pushed FileSystemReadAskForUrls or DefaultFileSystemReadGuard-
echo Setting, the remembered permission is off by policy and none
echo of this will help.
echo(
pause

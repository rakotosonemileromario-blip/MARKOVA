@echo off
rem Installe MARKOVA sur le telephone branche en USB (debogage USB active).
set ADB=D:\droid\platform-tools\adb.exe
echo Telephones detectes :
"%ADB%" devices
echo.
echo Installation de MARKOVA...
"%ADB%" install -r "%~dp0..\MARKOVA.apk"
echo.
echo Lancement...
"%ADB%" shell monkey -p com.markova.app -c android.intent.category.LAUNCHER 1
pause

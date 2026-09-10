@echo off
setlocal EnableExtensions
title Shopee Scraper - Installer dan Updater
color 0A
cls

set "INSTALL_DIR=%USERPROFILE%\Documents\ShopeeScraperExtension"
set "ZIP_URL=https://github.com/alawizv/shopeescraper/archive/refs/heads/main.zip"
set "TMP_DIR=%TEMP%\ShopeeScraperUpdate"
set "TMP_ZIP=%TMP_DIR%\main.zip"

echo ===============================================
echo    SHOPEE SCRAPER - INSTALLER / UPDATER
echo ===============================================
echo.

if exist "%INSTALL_DIR%\manifest.json" (
    set "MODE=UPDATE"
) else (
    set "MODE=INSTALL"
)

if "%MODE%"=="UPDATE" echo  Mode   : MEMPERBARUI extension yang sudah terpasang
if "%MODE%"=="INSTALL" echo  Mode   : INSTALASI PERTAMA KALI
echo  Folder : %INSTALL_DIR%
echo.
echo  Sedang mengunduh versi terbaru dari internet...
echo  (mohon tunggu, jangan tutup jendela ini)
echo.

rem -- Bersihkan folder sementara dari sisa proses sebelumnya --
if exist "%TMP_DIR%" rd /s /q "%TMP_DIR%" >nul 2>&1
mkdir "%TMP_DIR%" >nul 2>&1

rem -- Unduh ZIP memakai PowerShell (bawaan Windows, user tidak perlu install apa pun) --
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%ZIP_URL%' -OutFile '%TMP_ZIP%' -UseBasicParsing } catch { exit 1 }" 2>nul
if errorlevel 1 goto ERR_DOWNLOAD
if not exist "%TMP_ZIP%" goto ERR_DOWNLOAD

echo  Unduhan selesai. Memasang file...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $ErrorActionPreference='Stop'; Expand-Archive -LiteralPath '%TMP_ZIP%' -DestinationPath '%TMP_DIR%' -Force } catch { exit 1 }" 2>nul
if errorlevel 1 goto ERR_EXTRACT
if not exist "%TMP_DIR%\shopeescraper-main\manifest.json" goto ERR_EXTRACT

if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%" >nul 2>&1
xcopy "%TMP_DIR%\shopeescraper-main\*" "%INSTALL_DIR%\" /E /I /Y /Q >nul
if errorlevel 1 goto ERR_COPY

rd /s /q "%TMP_DIR%" >nul 2>&1

if "%MODE%"=="UPDATE" goto DONE_UPDATE
goto DONE_INSTALL


:DONE_UPDATE
cls
echo ===============================================
echo    UPDATE BERHASIL
echo ===============================================
echo.
echo  File terbaru sudah terpasang. Tinggal 1 langkah lagi:
echo.
echo    1. Buka Chrome
echo    2. Klik ikon Shopee Scraper di pojok kanan atas
echo    3. Klik tombol "Muat Ulang" di dalam popup
echo.
echo  Selesai! Extension langsung memakai versi terbaru.
echo.
echo  (Kalau tombol itu tidak ketemu: buka chrome://extensions
echo   lalu klik ikon panah melingkar pada kartu Shopee Scraper)
echo.
pause
exit /b 0


:DONE_INSTALL
cls
echo ===============================================
echo    INSTALASI BERHASIL
echo ===============================================
echo.
echo  Sekarang pasang ke Chrome, ikuti 4 langkah ini:
echo.
echo    1. Halaman Extensions Chrome akan terbuka otomatis
echo    2. Nyalakan "Developer mode" (tombol geser kanan atas)
echo    3. Klik tombol "Load unpacked"
echo    4. Pilih folder ini, lalu klik "Select Folder":
echo.
echo       %INSTALL_DIR%
echo.
echo  Setelah itu ikon extension muncul di toolbar Chrome.
echo.
pause
start chrome "chrome://extensions"
exit /b 0


:ERR_DOWNLOAD
color 0C
echo.
echo ===============================================
echo    GAGAL MENGUNDUH
echo ===============================================
echo.
echo  Penyebab yang paling sering:
echo    - Tidak ada koneksi internet
echo    - Internet kantor memblokir github.com
echo.
echo  Coba lagi setelah internet stabil.
echo.
pause
exit /b 1


:ERR_EXTRACT
color 0C
echo.
echo ===============================================
echo    GAGAL MEMBUKA FILE UNDUHAN
echo ===============================================
echo.
echo  File yang diunduh rusak atau tidak lengkap.
echo  Silakan jalankan file ini sekali lagi.
echo.
pause
exit /b 1


:ERR_COPY
color 0C
echo.
echo ===============================================
echo    GAGAL MENYALIN FILE
echo ===============================================
echo.
echo  Biasanya karena folder sedang dipakai program lain.
echo.
echo  Coba: tutup Chrome sepenuhnya, lalu jalankan file ini lagi.
echo.
pause
exit /b 1

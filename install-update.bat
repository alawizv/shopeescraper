@echo off
setlocal EnableExtensions
title Shopee Scraper - Installer dan Updater
color 0A
cls

set "DEFAULT_DIR=%USERPROFILE%\Documents\ShopeeScraperExtension"
set "ZIP_URL=https://github.com/alawizv/shopeescraper/archive/refs/heads/main.zip"
set "TMP_DIR=%TEMP%\ShopeeScraperUpdate"
set "TMP_ZIP=%TMP_DIR%\main.zip"

rem -- Folder tempat berkas .bat ini berada (tanpa backslash di ujung) --
set "SELF_DIR=%~dp0"
if "%SELF_DIR:~-1%"=="\" set "SELF_DIR=%SELF_DIR:~0,-1%"

rem ================================================================
rem  Menentukan folder yang akan diperbarui.
rem
rem  Skrip ini ikut terpasang di dalam folder extension, jadi kalau
rem  di sebelahnya ada manifest.json berarti INI folder extension-nya
rem  -- ke situlah update harus ditulis. Tanpa aturan ini, folder
rem  tujuan terpatok mati dan user yang menaruh extension di tempat
rem  lain akan melihat "UPDATE BERHASIL" padahal tidak ada yang
rem  berubah, karena Chrome memuat dari folder yang berbeda.
rem ================================================================
if exist "%SELF_DIR%\manifest.json" (
    set "INSTALL_DIR=%SELF_DIR%"
    set "MODE=UPDATE"
) else if exist "%DEFAULT_DIR%\manifest.json" (
    set "INSTALL_DIR=%DEFAULT_DIR%"
    set "MODE=UPDATE"
) else (
    set "INSTALL_DIR=%DEFAULT_DIR%"
    set "MODE=INSTALL"
)

echo ===============================================
echo    SHOPEE SCRAPER - INSTALLER / UPDATER
echo ===============================================
echo.

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

rem -- Simpan Client ID Google milik user sebelum manifest.json ditimpa --
rem    (README menyuruh user mengisinya sendiri untuk export Google Sheets)
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $id = (Get-Content '%INSTALL_DIR%\manifest.json' -Raw | ConvertFrom-Json).oauth2.client_id; if ($id -and $id -notlike 'GANTI_DENGAN*') { Set-Content '%TMP_DIR%\clientid.txt' -Value $id -Encoding Ascii -NoNewline } } catch {}" 2>nul

if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%" >nul 2>&1
rem -- Kalau tujuannya adalah folder tempat skrip ini sendiri berjalan,
rem    berkas .bat ini harus dilewati. cmd.exe membaca berkas .bat sambil
rem    berjalan; kalau berkasnya berubah di tengah jalan, eksekusi bisa
rem    melompat ke posisi acak. Di kasus lain (instalasi baru, atau skrip
rem    dijalankan dari Desktop) berkas ini justru HARUS ikut tersalin,
rem    supaya nanti berada di dalam folder extension.
rem -- Penyalinan memakai robocopy, bukan xcopy: kalau satu file gagal ditulis (mis.
rem    antivirus memblokirnya), xcopy berhenti di tengah jalan dan meninggalkan folder
rem    setengah ter-update (manifest baru, file baru belum ada). robocopy menyalin
rem    sisanya lalu melaporkan yang gagal lewat kode keluar >= 8.
rem    Folder tests, dev, dan .github hanya untuk pengembangan, tidak perlu disalin.
set "COPY_FAILED="
if /i "%INSTALL_DIR%"=="%SELF_DIR%" goto COPY_SKIP_SELF

robocopy "%TMP_DIR%\shopeescraper-main" "%INSTALL_DIR%" /E /R:0 /W:0 /NFL /NDL /NJH /NJS /NP /XD tests dev .github /LOG:"%TMP_DIR%\copy.log" >nul
goto COPY_CHECK

:COPY_SKIP_SELF
robocopy "%TMP_DIR%\shopeescraper-main" "%INSTALL_DIR%" /E /R:0 /W:0 /NFL /NDL /NJH /NJS /NP /XD tests dev .github /XF install-update.bat /LOG:"%TMP_DIR%\copy.log" >nul

:COPY_CHECK
if errorlevel 16 goto ERR_COPY
if errorlevel 8 set "COPY_FAILED=1"

:COPY_DONE

rem -- Kembalikan Client ID Google milik user ke manifest.json yang baru --
if exist "%TMP_DIR%\clientid.txt" (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $id = (Get-Content '%TMP_DIR%\clientid.txt' -Raw).Trim(); $f = '%INSTALL_DIR%\manifest.json'; $t = (Get-Content $f -Raw).Replace('GANTI_DENGAN_CLIENT_ID_GOOGLE_ANDA.apps.googleusercontent.com', $id); [IO.File]::WriteAllText($f, $t, (New-Object Text.UTF8Encoding $false)) } catch {}" 2>nul
    echo  Client ID Google milik kamu dipertahankan.
    echo.
)

if defined COPY_FAILED goto DONE_PARTIAL

rd /s /q "%TMP_DIR%" >nul 2>&1

if "%MODE%"=="UPDATE" goto DONE_UPDATE
goto DONE_INSTALL


:DONE_PARTIAL
color 0E
echo.
echo ===============================================
echo    SEBAGIAN FILE TIDAK BISA DISALIN
echo ===============================================
echo.
echo  Daftar file yang gagal:
echo.
type "%TMP_DIR%\copy.log"
echo.
echo  File lainnya sudah terpasang, jadi extension tetap bisa dipakai.
echo  Hanya bagian yang memakai file di atas yang mungkin tidak lengkap.
echo.
echo  Kalau pesannya menyebut "virus" atau "unwanted software":
echo  antivirus (mis. Windows Defender) memblokir file itu. Buka
echo  Windows Security ^> Virus ^& threat protection ^> Protection
echo  history untuk melihat file apa yang diblokir.
echo.
echo  Kalau pesannya menyebut file sedang dipakai: tutup Chrome
echo  sepenuhnya lalu jalankan file ini lagi.
echo.
rd /s /q "%TMP_DIR%" >nul 2>&1
pause
exit /b 2


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
echo  -----------------------------------------------
echo  Folder yang diperbarui:
echo  %INSTALL_DIR%
echo.
echo  Kalau versinya tidak berubah juga, kemungkinan Chrome
echo  memuat extension dari folder LAIN. Cek di chrome://extensions
echo  bagian "Loaded from" pada kartu Shopee Scraper.
echo  -----------------------------------------------
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
echo  Penyalin file (robocopy) tidak bisa berjalan atau folder
echo  tujuannya tidak bisa diakses.
echo.
echo  Coba: tutup Chrome sepenuhnya, lalu jalankan file ini lagi.
echo.
pause
exit /b 1

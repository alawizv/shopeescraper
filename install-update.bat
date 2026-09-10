@echo off
title Shopee Scraper -- Installer & Updater
color 0A
cls

echo ===============================================
echo    Shopee Scraper -- INSTALLER / UPDATER
echo ===============================================
echo.

set INSTALL_DIR=%USERPROFILE%\Documents\ShopeeScraperExtension
set REPO_URL=https://github.com/alawizv/shopeescraper.git

where git >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Git tidak ditemukan di komputer ini.
    echo.
    echo Silakan install Git terlebih dahulu:
    echo https://git-scm.com/download/win
    echo.
    echo Setelah install Git, jalankan file ini lagi.
    pause
    exit /b 1
)

if exist "%INSTALL_DIR%\.git" (
    echo [INFO] Update ditemukan. Memperbarui ke versi terbaru...
    echo.
    cd /d "%INSTALL_DIR%"
    git pull
    if %errorlevel% neq 0 (
        echo.
        echo [ERROR] Gagal update. Cek koneksi internet.
        pause
        exit /b 1
    )
    echo.
    echo ===============================================
    echo    UPDATE SELESAI!
    echo ===============================================
    echo.
    echo  Langkah terakhir:
    echo  - Chrome akan terbuka di halaman Extensions
    echo  - Cari "Shopee Product Scraper"
    echo  - Klik ikon refresh (panah melingkar) di card-nya
    echo.
) else (
    echo [INFO] Instalasi pertama kali. Mengunduh extension...
    echo.
    git clone "%REPO_URL%" "%INSTALL_DIR%"
    if %errorlevel% neq 0 (
        echo.
        echo [ERROR] Gagal download. Cek koneksi internet.
        pause
        exit /b 1
    )
    echo.
    echo ===============================================
    echo    INSTALASI SELESAI!
    echo ===============================================
    echo.
    echo  Langkah selanjutnya:
    echo  - Chrome akan terbuka di halaman Extensions
    echo  - Aktifkan "Developer mode" (toggle kanan atas)
    echo  - Klik "Load unpacked"
    echo  - Pilih folder:
    echo    %INSTALL_DIR%
    echo.
)

echo  Folder extension ada di:
echo  %INSTALL_DIR%
echo.
pause

start chrome "chrome://extensions"
exit /b 0

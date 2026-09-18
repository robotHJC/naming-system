@echo off
title 打包取名系统
cd /d "%~dp0"

rem ============================================================
rem  把取名系统打包到 dist\
rem
rem  只有「打包」这一步需要 Node.js，打包产物在任何电脑上
rem  双击即用，不需要任何环境。
rem
rem  可选参数会透传给 build-dist.js：
rem    --no-dict        固化的数据里不含字典，产物更小
rem    --no-zip         不生成压缩包
rem    --bake 文件名     指定要固化的数据文件
rem
rem  本文件保存为 GBK 编码，且不使用 chcp，原因见 namingTools.bat
rem ============================================================

set "NODE=node"
where node >nul 2>nul
if errorlevel 1 (
    if exist "C:\Program Files\nodejs\node.exe" (
        set "NODE=C:\Program Files\nodejs\node.exe"
    ) else (
        echo.
        echo   [错误] 未找到 Node.js，打包脚本需要它。
        echo          下载安装 https://nodejs.org/ 选 LTS 版即可。
        echo.
        echo   注意：只有打包这一步需要 Node，
        echo         打包出的 dist 目录可以拷到任何电脑上直接用。
        echo.
        pause
        exit /b 1
    )
)

"%NODE%" tools\build-dist.js %*

echo.
pause

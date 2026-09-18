@echo off
title 取名系统
cd /d "%~dp0"

rem ============================================================
rem  取名系统启动器
rem  纯前端实现：不需要 Python，不需要安装任何依赖。
rem  这里只是用默认浏览器打开 web\index.html。
rem  也可以直接双击 web\index.html，效果完全相同。
rem
rem  本文件保存为 GBK 编码，且不使用 chcp：
rem  因为 cmd 在 chcp 65001 下按字节解析批处理，
rem  遇到多字节汉字会把注释行从中间劈开并当成命令执行。
rem ============================================================

set "PAGE=%CD%\web\index.html"

if not exist "%PAGE%" (
    echo [错误] 找不到 %PAGE%
    echo        请确认 web\index.html 存在。
    pause
    exit /b 1
)

echo.
echo   正在用默认浏览器打开取名系统...
echo.
echo   如果没有自动弹出，请手动打开：
echo   %PAGE%
echo.
echo   提示：dist 目录下的「取名系统.html」是单文件版，
echo         可以单独拷到其他电脑上双击运行。
echo.

start "" "%PAGE%"

rem 想换用指定浏览器就改成下面这样：
rem start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" "%PAGE%"

exit /b 0

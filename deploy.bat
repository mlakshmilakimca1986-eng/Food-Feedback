@echo off
setlocal enabledelayedexpansion

echo ==========================================================
echo  Sri Chaitanya Food Feedback System - Deploy Automator
echo ==========================================================

:: Step 1: Handle Commit Message
set COMMIT_MSG=%~1
if "%COMMIT_MSG%"=="" (
    :: Generate a default timestamped message if none is provided
    set COMMIT_MSG=Auto-deployment: %date% %time%
)

echo.
echo [1/4] Staging changes in Git...
git add .
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to stage changes.
    goto :error
)

echo.
echo [2/4] Committing changes...
git commit -m "%COMMIT_MSG%"
if %ERRORLEVEL% neq 0 (
    echo [INFO] No new changes to commit or commit failed. Proceeding to deploy steps...
)

echo.
echo [3/4] Pushing to GitHub (origin/main)...
echo (This will trigger your Render automatic deployment hook)
git push origin main
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Git push to GitHub failed.
    goto :error
)

echo.
echo [4/4] Deploying to Firebase (Hosting and Functions)...
call firebase deploy
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Firebase deployment failed.
    goto :error
)

echo.
echo ==========================================================
echo  DEPLOYMENT COMPLETED SUCCESSFULLY!
echo ==========================================================
echo.
pause
exit /b 0

:error
echo.
echo ==========================================================
echo  [FAILED] Deployment stopped due to an error.
echo ==========================================================
echo.
pause
exit /b 1

@echo off
rem Coupe le scan d'offres de l'ancien radar (bot Telegram de la VM). Retour arriere : ajouter -Remettre.
powershell -NoProfile -ExecutionPolicy Bypass -File "%USERPROFILE%\Desktop\Harness-Agentic-Workflow\integrations\master-plan\couper-ancien-radar.ps1"

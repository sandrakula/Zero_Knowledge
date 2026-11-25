@echo off
rem One-command local dev stack. See scripts/dev.mjs for details.
rem Usage: scripts\dev.cmd [--infra-only|--stop]
node "%~dp0dev.mjs" %*

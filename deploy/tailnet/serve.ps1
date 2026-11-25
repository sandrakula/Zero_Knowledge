#!/usr/bin/env pwsh
<#
  Публикует локальный стенд через Tailscale:

    по умолчанию (serve)  — https://<машина>.<tailnet>.ts.net  только для tailnet
    -Public (funnel)      — тот же адрес, но доступен всему интернету

  В обоих случаях трафик идёт на http://127.0.0.1:<Port>, куда ничего,
  кроме этого скрипта, не смотрит.

  Примеры:
    ./serve.ps1              # только свои устройства (tailnet)
    ./serve.ps1 -Public      # публичная ссылка для друга (funnel)
    ./serve.ps1 -Port 3000   # если стек на другом порту
    ./serve.ps1 -Off         # снять и serve, и funnel
#>
param(
  [int]$Port = 8080,
  [switch]$Off,
  [switch]$Public
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$envFile = Join-Path $root '.env'

if (-not (Get-Command tailscale -ErrorAction SilentlyContinue)) {
  throw 'tailscale CLI не найден. Установи Tailscale и войди в свой tailnet: https://tailscale.com/download/windows'
}

if ($Off) {
  # funnel и serve делят один конфиг на порту 443, снимаем оба.
  tailscale funnel reset 2>$null
  tailscale serve --https=443 off 2>$null
  Write-Host 'Публикация снята: адрес больше не открывается ни из tailnet, ни из интернета.' -ForegroundColor Yellow
  exit 0
}

$status = tailscale status --json | ConvertFrom-Json
if (-not $status.Self -or $status.BackendState -ne 'Running') {
  throw 'Tailscale не запущен или не залогинен. Выполни: tailscale up'
}
$dnsName = $status.Self.DNSName.TrimEnd('.')

if (Test-Path $envFile) {
  $line = Get-Content $envFile |
    Where-Object { $_ -match '^\s*TAILNET_HOST\s*=' } |
    Select-Object -First 1
  if ($line) {
    $confHost = ($line -split '=', 2)[1].Trim().Trim('"').Trim("'")
    if ($confHost -and $confHost -ne $dnsName) {
      Write-Warning "В .env TAILNET_HOST=$confHost, а tailnet-имя этой машины — $dnsName."
      Write-Warning 'Ссылки и логин будут ломаться. Поправь .env и выполни: docker compose up -d app'
    }
  }
} else {
  Write-Warning ".env не найден рядом со скриптом ($envFile). Стек, скорее всего, ещё не настроен."
}

$mode = if ($Public) { 'funnel' } else { 'serve' }
tailscale $mode --bg --https=443 "http://127.0.0.1:$Port"

Write-Host ''
if ($Public) {
  Write-Host "Публичная ссылка: https://$dnsName/" -ForegroundColor Green
  Write-Host 'Открывается у кого угодно — Tailscale другу ставить не нужно.' -ForegroundColor Yellow
  Write-Host 'Снять: ./serve.ps1 -Off   |   Статус: tailscale funnel status'
} else {
  Write-Host "Стенд доступен: https://$dnsName/" -ForegroundColor Green
  Write-Host 'Только устройства в твоём tailnet.'
  Write-Host 'Снять: ./serve.ps1 -Off   |   Статус: tailscale serve status'
}

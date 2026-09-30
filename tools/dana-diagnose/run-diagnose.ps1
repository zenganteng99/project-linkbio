<#
.SYNOPSIS
  Wrapper PowerShell untuk tools/dana-diagnose/diagnose.mjs (diagnosa error pembayaran DANA).

.DESCRIPTION
  Menjalankan tool diagnosa tanpa mengubah kode produksi (worker/worker.js).
  Default DRY RUN; request nyata ke DANA hanya bila memakai -Live.

.EXAMPLE
  .\run-diagnose.ps1 -SelfTest
  .\run-diagnose.ps1 -DryRun
  .\run-diagnose.ps1 -Live -Variant division-id
  .\run-diagnose.ps1 -Live -Variant baseline,no-submerchant,division-id,clean
  .\run-diagnose.ps1 -Live -Variant clean -Json > hasil.json
#>
[CmdletBinding()]
param(
  [ValidateSet('all', 'baseline', 'no-submerchant', 'division-id', 'registered-origin', 'spec-timestamp', 'short-channel', 'clean')]
  [string[]]$Variant = @('all'),

  [double]$Amount = 285000,
  [string]$PackageName = 'Starter Package',
  [int]$DelayMs = 1200,

  [switch]$Live,
  [switch]$DryRun,
  [switch]$SelfTest,
  [switch]$Json,
  [string]$EnvFile
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$entry = Join-Path $here 'diagnose.mjs'

if (-not (Test-Path -LiteralPath $entry)) {
  Write-Host "[GAGAL] File tidak ditemukan: $entry" -ForegroundColor Red
  exit 2
}

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
  Write-Host '[GAGAL] Node.js tidak ada di PATH. Pasang Node.js 18+ dulu.' -ForegroundColor Red
  exit 2
}
Write-Host ("[INFO] Node " + (& node --version)) -ForegroundColor DarkGray

$defaultEnvFile = Join-Path $here 'env.local'
$resolvedEnvFile = $defaultEnvFile
if ($EnvFile) {
  if (Test-Path -LiteralPath $EnvFile) {
    $resolvedEnvFile = (Resolve-Path -LiteralPath $EnvFile).Path
  } else {
    $resolvedEnvFile = $EnvFile
    Write-Host "[INFO] File env yang diminta belum ada (akan dibuat? tidak): $EnvFile" -ForegroundColor Yellow
  }
}

if (-not $SelfTest -and -not (Test-Path -LiteralPath $resolvedEnvFile)) {
  Write-Host "[INFO] File kredensial belum ada: $resolvedEnvFile" -ForegroundColor Yellow
  Write-Host '       Salin env.local.example menjadi env.local lalu isi nilainya.' -ForegroundColor Yellow
  if ($Live) {
    Write-Host '[GAGAL] Mode -Live membutuhkan kredensial lengkap.' -ForegroundColor Red
    exit 2
  }
}

# Paksa format angka invariant (lokal Windows ID memakai koma sebagai desimal).
$amountArg = $Amount.ToString([System.Globalization.CultureInfo]::InvariantCulture)
# Gabungkan daftar varian menjadi satu argumen (mendukung -Variant baseline,no-submerchant).
$variantArg = ($Variant -join ',')

$nodeArgs = @($entry)
if ($SelfTest) {
  $nodeArgs += '--self-test'
} else {
  $nodeArgs += @('--variant', $variantArg, '--amount', $amountArg, '--package', $PackageName,
                 '--delay', "$DelayMs", '--env-file', $resolvedEnvFile)
  if ($Live -and -not $DryRun) { $nodeArgs += '--live' } else { $nodeArgs += '--dry-run' }
  if ($Json) { $nodeArgs += '--json' }
}

Write-Host ("[INFO] node " + ($nodeArgs -join ' ')) -ForegroundColor DarkGray
& node @nodeArgs
$code = $LASTEXITCODE

switch ($code) {
  0 { Write-Host '[SELESAI] Bacalah bagian KESIMPULAN OTOMATIS di atas.' -ForegroundColor Green }
  1 { Write-Host '[PERHATIAN] Semua varian ditolak DANA - ikuti langkah pada KESIMPULAN OTOMATIS.' -ForegroundColor Yellow }
  2 { Write-Host '[GAGAL] Data konfigurasi belum lengkap.' -ForegroundColor Red }
  default { Write-Host "[SELESAI] Exit code $code" -ForegroundColor Yellow }
}

exit $code

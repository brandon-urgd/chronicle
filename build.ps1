param([string]$Version)
$ErrorActionPreference = "Stop"

if ($Version) {
    if ($Version -notmatch '^\d+\.\d+\.\d+$') {
        Write-Host "ERROR: Version must be semver format (e.g. 2.5.0)" -ForegroundColor Red
        exit 1
    }
    Write-Host "`nBumping version to $Version ..." -ForegroundColor Magenta

    $tauriConf = "src-tauri\tauri.conf.json"
    $json = Get-Content $tauriConf -Raw | ConvertFrom-Json
    $json.package.version = $Version
    $tauriContent = $json | ConvertTo-Json -Depth 10
    [System.IO.File]::WriteAllText((Resolve-Path $tauriConf), $tauriContent, (New-Object System.Text.UTF8Encoding $false))
    Write-Host "  tauri.conf.json -> $Version" -ForegroundColor Cyan

    $cargoToml = "src-tauri\Cargo.toml"
    $cargoContent = Get-Content $cargoToml -Raw
    $cargoContent = $cargoContent -replace '(\[package\]\s*\nname\s*=\s*"[^"]*"\s*\n)version\s*=\s*"[^"]*"', "`$1version = `"$Version`""
    [System.IO.File]::WriteAllText((Resolve-Path $cargoToml), $cargoContent, (New-Object System.Text.UTF8Encoding $false))
    Write-Host "  Cargo.toml -> $Version" -ForegroundColor Cyan

    $pkgJson = "frontend\package.json"
    $pkg = Get-Content $pkgJson -Raw | ConvertFrom-Json
    $pkg.version = $Version
    $pkgContent = $pkg | ConvertTo-Json -Depth 10
    [System.IO.File]::WriteAllText((Resolve-Path $pkgJson), $pkgContent, (New-Object System.Text.UTF8Encoding $false))
    Write-Host "  package.json -> $Version" -ForegroundColor Cyan

    $constantsTs = "frontend\src\constants.ts"
    if (Test-Path $constantsTs) {
        $tsContent = (Get-Content $constantsTs -Raw) -replace "APP_VERSION = '[^']*'", "APP_VERSION = '$Version'"
        [System.IO.File]::WriteAllText((Resolve-Path $constantsTs), $tsContent, (New-Object System.Text.UTF8Encoding $false))
        Write-Host "  constants.ts -> $Version`n" -ForegroundColor Cyan
    }
}

$tauriJson = Get-Content "src-tauri\tauri.conf.json" -Raw | ConvertFrom-Json
$v = $tauriJson.package.version
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Chronicle Desktop Build  v$v" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

Write-Host "[1/2] Building frontend..." -ForegroundColor Yellow
Push-Location frontend
npm install
npm run build
Pop-Location
if (-not (Test-Path "frontend\dist\index.html")) { Write-Host "ERROR: Frontend build failed" -ForegroundColor Red; exit 1 }
Write-Host "  Frontend built -> frontend/dist/`n" -ForegroundColor Green

Write-Host "[2/2] Building Tauri desktop app (Rust backend + frontend bundle)..." -ForegroundColor Yellow
Push-Location src-tauri
$ErrorActionPreference = "Continue"
cargo tauri build 2>&1 | ForEach-Object { Write-Host "  $_" }
$tauriBuildExit = $LASTEXITCODE
$ErrorActionPreference = "Stop"
Pop-Location

$msi = Get-ChildItem -Path "src-tauri\target\release\bundle\msi\Chronicle_${v}_*.msi" -ErrorAction SilentlyContinue | Select-Object -First 1
$exe = Get-ChildItem -Path "src-tauri\target\release\bundle\nsis\Chronicle_${v}_*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1

# [3/3] Code signing (optional)
$signtoolPath = Get-ChildItem "C:\Program Files (x86)\Windows Kits\10\bin\*\x64\signtool.exe" -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
$signingCert = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert -ErrorAction SilentlyContinue | Where-Object { $_.Subject -eq "CN=Brandon Hill-Rogers" } | Select-Object -First 1

if ($signtoolPath -and $signingCert -and ($msi -or $exe)) {
    Write-Host "[3/3] Signing installers..." -ForegroundColor Yellow
    $signArgs = @("sign", "/a", "/fd", "SHA256", "/t", "http://timestamp.digicert.com", "/n", "Brandon Hill-Rogers")
    if ($msi) {
        & $signtoolPath.FullName @signArgs $msi.FullName 2>&1 | Out-Null
        Write-Host "  Signed: $($msi.Name)" -ForegroundColor Green
    }
    if ($exe) {
        & $signtoolPath.FullName @signArgs $exe.FullName 2>&1 | Out-Null
        Write-Host "  Signed: $($exe.Name)" -ForegroundColor Green
    }
} elseif ($msi -or $exe) {
    Write-Host "`n  Signing skipped -- signtool or code signing cert not found" -ForegroundColor DarkYellow
}

Write-Host "`n========================================" -ForegroundColor Green
Write-Host "  Build Complete!  v$v" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
if ($msi) { Write-Host "  MSI: $($msi.FullName)  ($([math]::Round($msi.Length / 1MB, 1)) MB)" -ForegroundColor Cyan }
if ($exe) { Write-Host "  EXE: $($exe.FullName)  ($([math]::Round($exe.Length / 1MB, 1)) MB)" -ForegroundColor Cyan }
if (-not $msi -and -not $exe) { Write-Host "  WARNING: No installer found. Check build output above." -ForegroundColor Yellow }
Write-Host ""

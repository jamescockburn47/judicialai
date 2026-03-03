# Judicial Review Launcher
# Kills ports 8002 and 5175, then starts backend and Tauri app in parallel.

$Root = Split-Path -Parent $MyInvocation.MyCommand.Definition
$BackendDir = Join-Path $Root "backend"
$FrontendDir = Join-Path $Root "frontend"
$EnvFile = Join-Path $Root ".env"
$CargoExe = "$env:USERPROFILE\.cargo\bin\cargo.exe"

# ── Kill old processes on our ports ──────────────────────────────────────────
Write-Host "Clearing ports 8002 and 5175..."
foreach ($port in @(8002, 5175)) {
    $lines = netstat -ano | Select-String "[:.]$port\s" | Select-String "LISTENING"
    foreach ($line in $lines) {
        $pid_val = ($line.ToString().Trim() -split '\s+')[-1]
        if ($pid_val -match '^\d+$' -and [int]$pid_val -gt 0) {
            Stop-Process -Id ([int]$pid_val) -Force -ErrorAction SilentlyContinue
            Write-Host "  Killed PID $pid_val on port $port"
        }
    }
}
Start-Sleep -Milliseconds 600

# ── .env setup ────────────────────────────────────────────────────────────────
if (-not (Test-Path $EnvFile)) {
    $example = Join-Path $Root ".env.example"
    if (Test-Path $example) { Copy-Item $example $EnvFile } else {
        Set-Content $EnvFile "ANTHROPIC_API_KEY=your_key_here`nRUST_LOG=bs_detector=info"
    }
    Write-Host ".env created. Add your ANTHROPIC_API_KEY before running analysis."
}
$envContent = Get-Content $EnvFile -Raw -ErrorAction SilentlyContinue
if ($envContent -match "your_key_here") {
    Write-Host "WARNING: ANTHROPIC_API_KEY not set - AI agents will not run"
}

# ── Seed demo matter to Documents/JudicialReview ─────────────────────────────
$demoSrc  = Join-Path $Root "frontend\src-tauri\demo-matters\rivera-v-harmon"
$demoDest = Join-Path ([Environment]::GetFolderPath('MyDocuments')) "JudicialReview\rivera-v-harmon"
if (-not (Test-Path (Join-Path $demoDest "matter.json"))) {
    Write-Host "Seeding demo matter..."
    New-Item -ItemType Directory -Force (Join-Path $demoDest "documents") | Out-Null
    Copy-Item (Join-Path $demoSrc "matter.json") $demoDest -Force
    Copy-Item (Join-Path $demoSrc "documents\*") (Join-Path $demoDest "documents") -Force
    Write-Host "  Seeded Rivera v. Harmon to $demoDest"
}

# ── Read env vars to pass to backend ─────────────────────────────────────────
$envExports = ""
foreach ($line in (Get-Content $EnvFile -ErrorAction SilentlyContinue)) {
    if ($line -match "^([A-Za-z_][A-Za-z0-9_]*)=(.+)$") {
        $envExports += "`$env:$($Matches[1]) = '$($Matches[2])'`n"
    }
}

# ── Write and launch backend ──────────────────────────────────────────────────
$backendScript = Join-Path $env:TEMP "jr_backend.ps1"
Set-Content $backendScript @"
$envExports
`$env:PATH = '$env:USERPROFILE\.cargo\bin;' + `$env:PATH
Set-Location '$BackendDir'
Write-Host 'Starting backend API...'
& '$CargoExe' run --bin bs-detector
"@
Write-Host "Starting backend..."
Start-Process powershell -ArgumentList "-NoExit -ExecutionPolicy Bypass -File `"$backendScript`"" -WindowStyle Normal

# ── Write and launch Tauri app ────────────────────────────────────────────────
# NOTE: First launch compiles the Tauri shell (~3-5 min). Subsequent launches are fast.
$tauriScript = Join-Path $env:TEMP "jr_tauri.ps1"
Set-Content $tauriScript @"
`$env:PATH = '$env:USERPROFILE\.cargo\bin;' + `$env:PATH
[System.Environment]::SetEnvironmentVariable('PATH', `$env:PATH, 'Process')
Set-Location '$FrontendDir'
if (-not (Test-Path 'node_modules')) { npm install }
`$env:VITE_API_URL = 'http://localhost:8002'
Write-Host 'Building Tauri app (first run ~3-5 min, then fast)...'
npx tauri dev
"@
Write-Host "Starting Tauri desktop app (compiles in parallel with backend)..."
Start-Process powershell -ArgumentList "-NoExit -ExecutionPolicy Bypass -File `"$tauriScript`"" -WindowStyle Normal

Write-Host ""
Write-Host "Both windows are now compiling. The desktop app will open automatically once ready."
Write-Host "Close both terminal windows to stop."

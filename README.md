Set-Location "C:\Users\Admin\Downloads\afyahub-hmis-kenya"

New-Item -ItemType Directory -Force -Path ".\build" | Out-Null

npx esbuild server.ts `
  --bundle `
  --platform=node `
  --format=esm `
  --packages=external `
  --outfile=build/server.js

if (Test-Path ".\build\server.js") {
    Write-Host "SUCCESS: Production startup file created."
} else {
    Write-Host "ERROR: Startup file was not created."
}

##running the generated file 
Set-Location "C:\Users\Admin\Downloads\afyahub-hmis-kenya"

Write-Host "`n--- Check JavaScript syntax ---"
node --check ".\build\server.js"

Write-Host "`n--- Confirm production frontend exists ---"
Test-Path ".\dist\index.html"

Write-Host "`n--- Confirm package uses ES modules ---"
npm pkg get type
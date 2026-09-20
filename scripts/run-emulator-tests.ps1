$ErrorActionPreference = 'Stop'

$javaHome = Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot '..\.local\jdk') -Directory -ErrorAction Stop |
  Where-Object { Test-Path (Join-Path $_.FullName 'bin\java.exe') } |
  Select-Object -First 1 -ExpandProperty FullName

if (-not $javaHome) {
  throw 'JDK local não encontrado em .local/jdk. Instale o JDK 21 ou defina JAVA_HOME antes de executar os emuladores.'
}

$env:JAVA_HOME = $javaHome
$env:Path = "$(Join-Path $javaHome 'bin');$env:Path"

Write-Host "Usando JDK local: $javaHome"
& npm run test:emulator
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

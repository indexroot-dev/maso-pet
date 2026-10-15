# Construye el APK de MasoPet sin Gradle, usando el SDK de Android y el Java que trae Android Studio.
#
# Uso (desde la carpeta del proyecto):
#   powershell -ExecutionPolicy Bypass -File android\construir-apk.ps1
#   powershell -ExecutionPolicy Bypass -File android\construir-apk.ps1 -Url https://masopet.cl -Version 1.1 -Codigo 2
#
# -Url     Dirección del servidor que abrirá la app. Por defecto: PUBLIC_URL del .env o la IP de este PC en la red.
# -Version Versión visible (1.0, 1.1…). -Codigo debe subir en cada versión nueva para poder actualizar la app.

param(
    [string]$Url = '',
    [string]$Version = '1.0',
    [int]$Codigo = 1
)

$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $PSScriptRoot
$android = $PSScriptRoot
$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { "$env:LOCALAPPDATA\Android\Sdk" }
$jbr = 'C:\Program Files\Android\Android Studio\jbr'
$buildTools = Get-ChildItem "$sdk\build-tools" -Directory | Sort-Object { [version]$_.Name } | Select-Object -Last 1
$plataforma = Get-ChildItem "$sdk\platforms" -Directory | Sort-Object Name | Select-Object -Last 1
$androidJar = Join-Path $plataforma.FullName 'android.jar'
$bt = $buildTools.FullName

if (-not (Test-Path "$jbr\bin\javac.exe")) { throw "No se encontró Java en $jbr (se instala con Android Studio)." }
if (-not (Test-Path $androidJar)) { throw "No se encontró el SDK de Android en $sdk." }
$env:JAVA_HOME = $jbr
$env:Path = "$jbr\bin;$env:Path"

function Ejecutar([string]$programa, [string[]]$argumentos) {
    & $programa @argumentos
    if ($LASTEXITCODE -ne 0) { throw "Falló: $programa $($argumentos -join ' ')" }
}

# Dirección del servidor
if (-not $Url) {
    $envArchivo = Join-Path $raiz '.env'
    if (Test-Path $envArchivo) {
        $linea = Get-Content $envArchivo | Where-Object { $_ -match '^\s*PUBLIC_URL\s*=' } | Select-Object -First 1
        if ($linea) { $Url = ($linea -split '=', 2)[1].Trim().Trim('"') }
    }
}
if (-not $Url) {
    $ip = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -like '192.168.*' -or $_.IPAddress -like '10.*' } | Select-Object -First 1 -ExpandProperty IPAddress
    $Url = "http://${ip}:3000"
}
if (-not $Url.EndsWith('/')) { $Url = "$Url/" }
Write-Host "Servidor de la app: $Url"

# Carpeta de trabajo limpia
$build = Join-Path $android 'build'
if (Test-Path $build) { Remove-Item $build -Recurse -Force }
New-Item -ItemType Directory -Force "$build\src", "$build\classes", "$build\dex" | Out-Null

# 1. Recursos (íconos) y manifiesto
Ejecutar "$bt\aapt2.exe" @('compile', '--dir', "$android\res", '-o', "$build\recursos.zip")
Ejecutar "$bt\aapt2.exe" @('link', '-o', "$build\base.apk", '-I', $androidJar, '--manifest', "$android\AndroidManifest.xml",
    '--min-sdk-version', '24', '--target-sdk-version', '34', '--version-code', "$Codigo", '--version-name', $Version, "$build\recursos.zip")

# 2. Código Java (con la URL del servidor) → .class → classes.dex
$fuente = Get-Content "$android\src\cl\masopet\app\MainActivity.java" -Raw -Encoding UTF8
$fuente = $fuente.Replace('__URL_APP__', $Url)
New-Item -ItemType Directory -Force "$build\src\cl\masopet\app" | Out-Null
[IO.File]::WriteAllText("$build\src\cl\masopet\app\MainActivity.java", $fuente, (New-Object Text.UTF8Encoding $false))
Ejecutar "$jbr\bin\javac.exe" @('-encoding', 'UTF-8', '-source', '11', '-target', '11', '-nowarn', '-Xlint:-options',
    '-classpath', $androidJar, '-d', "$build\classes", "$build\src\cl\masopet\app\MainActivity.java")
$clases = Get-ChildItem "$build\classes" -Recurse -Filter *.class | ForEach-Object { $_.FullName }
Ejecutar "$bt\d8.bat" (@('--release', '--min-api', '24', '--lib', $androidJar, '--output', "$build\dex") + $clases)

# 3. Empaquetar: agregar classes.dex, alinear y firmar
Copy-Item "$build\base.apk" "$build\sin-firmar.apk"
Push-Location "$build\dex"
try { Ejecutar "$bt\aapt.exe" @('add', "$build\sin-firmar.apk", 'classes.dex') } finally { Pop-Location }
Ejecutar "$bt\zipalign.exe" @('-p', '-f', '4', "$build\sin-firmar.apk", "$build\alineado.apk")

# La firma se crea una sola vez y debe conservarse: Android solo acepta actualizaciones firmadas con la misma llave
$firma = Join-Path $android 'firma'
$llave = Join-Path $firma 'masopet.keystore'
$archivoClave = Join-Path $firma 'clave.txt'
if (-not (Test-Path $llave)) {
    New-Item -ItemType Directory -Force $firma | Out-Null
    $clave = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 24 | ForEach-Object { [char]$_ })
    Set-Content -Path $archivoClave -Value $clave -Encoding ASCII
    Ejecutar "$jbr\bin\keytool.exe" @('-genkeypair', '-keystore', $llave, '-storepass', $clave, '-keypass', $clave, '-alias', 'masopet',
        '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000', '-dname', 'CN=MasoPet, O=MasoPet, C=CL')
    Write-Host 'Se creó una llave de firma nueva en android\firma (guárdala en un lugar seguro).'
}
$clave = (Get-Content $archivoClave -Raw).Trim()
$salida = Join-Path $android 'MasoPet.apk'
Ejecutar "$bt\apksigner.bat" @('sign', '--ks', $llave, '--ks-pass', "pass:$clave", '--ks-key-alias', 'masopet', '--out', $salida, "$build\alineado.apk")
Ejecutar "$bt\apksigner.bat" @('verify', $salida)

# 4. Publicarlo para descargarlo desde la portada de la app
$descargas = Join-Path $raiz 'public\descargas'
New-Item -ItemType Directory -Force $descargas | Out-Null
Copy-Item $salida (Join-Path $descargas 'MasoPet.apk') -Force

$tamano = [math]::Round((Get-Item $salida).Length / 1KB)
Write-Host ""
Write-Host "APK listo: $salida ($tamano KB) — versión $Version ($Codigo), abre $Url"
Write-Host "También se puede descargar desde la app en /descargas/MasoPet.apk"

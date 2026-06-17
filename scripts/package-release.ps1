param(
  [string]$Version = "",
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $ScriptRoot ".."))
$ExtensionRoot = Join-Path $RepoRoot "extension"
$AppRoot = Join-Path $RepoRoot "app"
$DistRoot = Join-Path $RepoRoot "dist"
$LicensePath = Join-Path $RepoRoot "LICENSE"
$NoticePath = Join-Path $RepoRoot "NOTICE"

if ([string]::IsNullOrWhiteSpace($Version)) {
  $manifest = Get-Content -LiteralPath (Join-Path $ExtensionRoot "manifest.json") -Raw | ConvertFrom-Json
  $Version = [string]$manifest.version
}

if ([string]::IsNullOrWhiteSpace($Version)) {
  throw "Version was not provided and could not be read from extension\manifest.json."
}

$DistFull = [System.IO.Path]::GetFullPath($DistRoot).TrimEnd('\') + '\'
$StagingRoot = Join-Path $DistRoot "staging\release-v$Version"
$ExtensionStage = Join-Path $StagingRoot "zero-latency-web-extension-v$Version"
$AppStage = Join-Path $StagingRoot "zero-latency-web-app-v$Version"
$ReviewStage = Join-Path $StagingRoot "zero-latency-web-chrome-review-bundle-v$Version"
$ReleaseStage = Join-Path $StagingRoot "zero-latency-web-release-v$Version"
$TestStage = Join-Path $StagingRoot "zero-latency-web-test-bundle-v$Version"

$ExtensionZip = Join-Path $DistRoot "zero-latency-web-extension-v$Version.zip"
$ChromeStoreZip = Join-Path $DistRoot "zero-latency-web-extension-chrome-web-store-v$Version.zip"
$AppZip = Join-Path $DistRoot "zero-latency-web-app-windows-x64-v$Version.zip"
$ReviewZip = Join-Path $DistRoot "zero-latency-web-chrome-review-bundle-v$Version.zip"
$ReleaseZip = Join-Path $DistRoot "zero-latency-web-release-v$Version.zip"
$TestZip = Join-Path $DistRoot "zero-latency-web-test-bundle-v$Version.zip"
$ShaFile = Join-Path $DistRoot "SHA256SUMS-v$Version.txt"

function Assert-DistPath {
  param([string]$Path)

  $full = [System.IO.Path]::GetFullPath($Path)
  if (-not ($full.StartsWith($DistFull, [System.StringComparison]::OrdinalIgnoreCase))) {
    throw "Refusing to operate outside dist: $full"
  }
}

function Remove-DistPathIfExists {
  param([string]$Path)

  Assert-DistPath $Path
  if (Test-Path -LiteralPath $Path) {
    Remove-Item -LiteralPath $Path -Recurse -Force
  }
}

function New-CleanDirectory {
  param([string]$Path)

  Remove-DistPathIfExists $Path
  New-Item -ItemType Directory -Path $Path -Force | Out-Null
}

function Copy-Directory {
  param(
    [string]$Source,
    [string]$Destination
  )

  if (-not (Test-Path -LiteralPath $Source -PathType Container)) {
    throw "Missing directory: $Source"
  }

  New-Item -ItemType Directory -Path $Destination -Force | Out-Null
  Copy-Item -Path (Join-Path $Source "*") -Destination $Destination -Recurse -Force
}

function Copy-File {
  param(
    [string]$Source,
    [string]$Destination
  )

  if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) {
    throw "Missing file: $Source"
  }

  $parent = Split-Path -Parent $Destination
  if ($parent) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }

  Copy-Item -LiteralPath $Source -Destination $Destination -Force
}

function New-ZipFromDirectoryContents {
  param(
    [string]$SourceDirectory,
    [string]$ZipPath
  )

  Remove-DistPathIfExists $ZipPath
  Compress-Archive -Path (Join-Path $SourceDirectory "*") -DestinationPath $ZipPath -CompressionLevel Optimal
}

function Write-TextFile {
  param(
    [string]$Path,
    [string]$Content
  )

  $parent = Split-Path -Parent $Path
  if ($parent) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }

  Set-Content -LiteralPath $Path -Value $Content -Encoding UTF8
}

function Assert-NoForbiddenRuntimeFiles {
  param([string]$Directory)

  $forbidden = Get-ChildItem -LiteralPath $Directory -Recurse -Force |
    Where-Object {
      $_.Name -in @(
        "debug-api-token.txt",
        "install-status.json",
        "app-runtime-events.jsonl",
        "allowed-extension-origin.txt",
        "allowed-extension-origins.txt"
      ) -or
      $_.FullName -match "\\portable\\logs(\\|$)"
    }

  if ($forbidden.Count -gt 0) {
    $list = ($forbidden | ForEach-Object { $_.FullName }) -join "`n"
    throw "Release package contains runtime-only files:`n$list"
  }
}

if (-not $SkipBuild) {
  & (Join-Path $ExtensionRoot "scripts\build-wasm.ps1")
  Push-Location $AppRoot
  try {
    cargo build --release
  } finally {
    Pop-Location
  }
}

New-Item -ItemType Directory -Path $DistRoot -Force | Out-Null
New-CleanDirectory $StagingRoot

New-CleanDirectory $ExtensionStage
Copy-File $LicensePath (Join-Path $ExtensionStage "LICENSE")
Copy-File $NoticePath (Join-Path $ExtensionStage "NOTICE")
Copy-File (Join-Path $ExtensionRoot "manifest.json") (Join-Path $ExtensionStage "manifest.json")
Copy-File (Join-Path $ExtensionRoot "service-worker.js") (Join-Path $ExtensionStage "service-worker.js")
Copy-File (Join-Path $ExtensionRoot "service-worker-scripts.js") (Join-Path $ExtensionStage "service-worker-scripts.js")
Copy-Directory (Join-Path $ExtensionRoot "_locales") (Join-Path $ExtensionStage "_locales")
Copy-Directory (Join-Path $ExtensionRoot "background") (Join-Path $ExtensionStage "background")
Copy-Directory (Join-Path $ExtensionRoot "popup") (Join-Path $ExtensionStage "popup")
Copy-Directory (Join-Path $ExtensionRoot "settings") (Join-Path $ExtensionStage "settings")
Copy-Directory (Join-Path $ExtensionRoot "shared") (Join-Path $ExtensionStage "shared")
Copy-Directory (Join-Path $ExtensionRoot "scripts\navigation") (Join-Path $ExtensionStage "scripts\navigation")
Copy-File (Join-Path $ExtensionRoot "scripts\navigation-interceptor.js") (Join-Path $ExtensionStage "scripts\navigation-interceptor.js")
Copy-Directory (Join-Path $ExtensionRoot "wasm\pkg") (Join-Path $ExtensionStage "wasm\pkg")
if (Test-Path -LiteralPath (Join-Path $ExtensionRoot "images") -PathType Container) {
  Copy-Directory (Join-Path $ExtensionRoot "images") (Join-Path $ExtensionStage "images")
}

$manifestCheck = Get-Content -LiteralPath (Join-Path $ExtensionStage "manifest.json") -Raw | ConvertFrom-Json
if ($manifestCheck.version -ne $Version) {
  throw "Extension manifest version $($manifestCheck.version) does not match requested version $Version."
}

New-CleanDirectory $AppStage
$CargoTargetDirectory = $null
$CargoConfigPath = Join-Path $AppRoot ".cargo\config.toml"
if (Test-Path -LiteralPath $CargoConfigPath -PathType Leaf) {
  $targetDirLine = Select-String -LiteralPath $CargoConfigPath -Pattern 'target-dir\s*=\s*"([^"]+)"' | Select-Object -First 1
  if ($targetDirLine -and $targetDirLine.Matches.Count -gt 0) {
    $CargoTargetDirectory = $targetDirLine.Matches[0].Groups[1].Value
    if (-not [System.IO.Path]::IsPathRooted($CargoTargetDirectory)) {
      $CargoTargetDirectory = Join-Path $AppRoot $CargoTargetDirectory
    }
  }
}
if ([string]::IsNullOrWhiteSpace($CargoTargetDirectory)) {
  $CargoMetadata = cargo metadata --format-version 1 --no-deps --manifest-path (Join-Path $AppRoot "Cargo.toml") | ConvertFrom-Json
  $CargoTargetDirectory = [string]$CargoMetadata.target_directory
}
$AppExe = Join-Path ([System.IO.Path]::GetFullPath($CargoTargetDirectory)) "release\zero-latency-web-app.exe"
$appReadme = @"
# Smart Preload Windows App

This optional Windows app improves Smart Preload's local browser integration.

Platform: Windows only.

## English

Setup order:
1. Install or enable the Smart Preload browser extension first.
2. Extract this zip to a normal writable folder. Do not run files directly from inside the zip.
3. Keep this app folder in its final location.
4. Run `install-register.cmd` from this folder.
5. After registration, you can also start `zero-latency-web-app.exe` from this folder.

Important notes:
- First binding succeeds only after the browser extension is installed or enabled.
- If you move this app folder later, run `install-register.cmd` again from the new location.
- After the first successful binding, the extension can wake the native app automatically when needed.

## 简体中文

设置顺序：
1. 先安装或启用 Smart Preload 浏览器扩展。
2. 把这个 zip 解压到普通可写文件夹。不要直接在 zip 压缩包里运行文件。
3. 先把 app 文件夹放到最终位置。
4. 从这个文件夹运行 `install-register.cmd`。
5. 注册后，也可以从这个文件夹启动 `zero-latency-web-app.exe`。

注意事项：
- 首次绑定需要先安装或启用浏览器扩展。
- 如果之后移动了 app 文件夹，需要在新位置重新运行 `install-register.cmd`。
- 首次绑定成功后，扩展在需要时可以自动唤起本地 app。

## 繁體中文

設定順序：
1. 先安裝或啟用 Smart Preload 瀏覽器擴充功能。
2. 把這個 zip 解壓縮到一般可寫入的資料夾。不要直接在 zip 壓縮包裡執行檔案。
3. 先把 app 資料夾放到最終位置。
4. 從這個資料夾執行 `install-register.cmd`。
5. 註冊後，也可以從這個資料夾啟動 `zero-latency-web-app.exe`。

注意事項：
- 首次綁定需要先安裝或啟用瀏覽器擴充功能。
- 如果之後移動了 app 資料夾，需要在新位置重新執行 `install-register.cmd`。
- 首次綁定成功後，擴充功能在需要時可以自動喚起本機 app。

## 日本語

セットアップ順:
1. 先に Smart Preload ブラウザ拡張機能をインストールまたは有効化します。
2. この zip を通常の書き込み可能なフォルダーへ展開します。zip の中から直接実行しないでください。
3. app フォルダーを最終的な場所に置きます。
4. このフォルダーから `install-register.cmd` を実行します。
5. 登録後は、このフォルダーの `zero-latency-web-app.exe` からも起動できます。

注意:
- 初回連携には、先にブラウザ拡張機能をインストールまたは有効化しておく必要があります。
- 後で app フォルダーを移動した場合は、新しい場所で `install-register.cmd` をもう一度実行してください。
- 初回連携が成功すると、必要なときに拡張機能がネイティブアプリを自動起動できます。

## 한국어

설정 순서:
1. Smart Preload 브라우저 확장 프로그램을 먼저 설치하거나 활성화합니다.
2. 이 zip을 일반 쓰기 가능한 폴더에 압축 해제합니다. zip 안에서 바로 실행하지 마세요.
3. app 폴더를 최종 위치에 둡니다.
4. 이 폴더에서 `install-register.cmd`를 실행합니다.
5. 등록 후에는 이 폴더의 `zero-latency-web-app.exe`로도 시작할 수 있습니다.

주의:
- 첫 연결은 브라우저 확장 프로그램이 먼저 설치되거나 활성화되어 있어야 성공합니다.
- 나중에 app 폴더를 옮기면 새 위치에서 `install-register.cmd`를 다시 실행해야 합니다.
- 첫 연결이 성공하면 확장 프로그램이 필요할 때 네이티브 앱을 자동으로 실행할 수 있습니다.

## Deutsch

Einrichtung:
1. Installieren oder aktivieren Sie zuerst die Smart Preload-Browsererweiterung.
2. Entpacken Sie diese zip-Datei in einen normalen beschreibbaren Ordner. Starten Sie Dateien nicht direkt aus der zip-Datei.
3. Legen Sie den app-Ordner an seinen endgueltigen Ort.
4. Fuehren Sie `install-register.cmd` aus diesem Ordner aus.
5. Nach der Registrierung koennen Sie auch `zero-latency-web-app.exe` aus diesem Ordner starten.

Hinweise:
- Die erste Kopplung funktioniert nur, wenn die Browsererweiterung bereits installiert oder aktiviert ist.
- Wenn Sie den app-Ordner spaeter verschieben, fuehren Sie `install-register.cmd` am neuen Ort erneut aus.
- Nach der ersten erfolgreichen Kopplung kann die Erweiterung die native App bei Bedarf automatisch starten.

## Francais

Ordre de configuration :
1. Installez ou activez d'abord l'extension de navigateur Smart Preload.
2. Extrayez ce zip dans un dossier normal avec droit d'ecriture. Ne lancez pas les fichiers directement depuis le zip.
3. Placez le dossier app a son emplacement final.
4. Executez `install-register.cmd` depuis ce dossier.
5. Apres l'enregistrement, vous pouvez aussi lancer `zero-latency-web-app.exe` depuis ce dossier.

Notes importantes :
- Le premier lien ne reussit que si l'extension du navigateur est deja installee ou activee.
- Si vous deplacez ensuite ce dossier app, executez a nouveau `install-register.cmd` depuis le nouvel emplacement.
- Apres le premier lien reussi, l'extension peut demarrer automatiquement l'application native quand c'est necessaire.

## Espanol

Orden de configuracion:
1. Instala o habilita primero la extension de navegador Smart Preload.
2. Extrae este zip en una carpeta normal con permiso de escritura. No ejecutes archivos directamente desde el zip.
3. Coloca la carpeta app en su ubicacion final.
4. Ejecuta `install-register.cmd` desde esta carpeta.
5. Despues del registro, tambien puedes iniciar `zero-latency-web-app.exe` desde esta carpeta.

Notas importantes:
- El primer enlace solo funciona si la extension del navegador ya esta instalada o habilitada.
- Si mueves esta carpeta app mas adelante, ejecuta `install-register.cmd` otra vez desde la nueva ubicacion.
- Despues del primer enlace correcto, la extension puede iniciar la app nativa automaticamente cuando sea necesario.

## Portugues (Brasil)

Ordem de configuracao:
1. Instale ou ative primeiro a extensao de navegador Smart Preload.
2. Extraia este zip em uma pasta normal com permissao de escrita. Nao execute arquivos diretamente dentro do zip.
3. Coloque a pasta app no local final.
4. Execute `install-register.cmd` a partir desta pasta.
5. Depois do registro, voce tambem pode iniciar `zero-latency-web-app.exe` por esta pasta.

Observacoes importantes:
- A primeira vinculacao so funciona se a extensao do navegador ja estiver instalada ou ativada.
- Se voce mover esta pasta app depois, execute `install-register.cmd` novamente no novo local.
- Depois da primeira vinculacao bem-sucedida, a extensao pode iniciar o app nativo automaticamente quando necessario.

## Русский

Порядок настройки:
1. Сначала установите или включите расширение браузера Smart Preload.
2. Распакуйте этот zip в обычную папку с правом записи. Не запускайте файлы прямо из zip-архива.
3. Поместите папку app в окончательное расположение.
4. Запустите `install-register.cmd` из этой папки.
5. После регистрации также можно запускать `zero-latency-web-app.exe` из этой же папки.

Важные примечания:
- Первое связывание успешно работает только после установки или включения расширения браузера.
- Если позже переместить папку app, нужно снова запустить `install-register.cmd` из нового расположения.
- После первого успешного связывания расширение сможет автоматически запускать нативное приложение при необходимости.

License: Apache License 2.0. See LICENSE and NOTICE.
"@

Copy-File $AppExe (Join-Path $AppStage "zero-latency-web-app.exe")
Copy-File (Join-Path $AppRoot "install-register.cmd") (Join-Path $AppStage "install-register.cmd")
Copy-File (Join-Path $AppRoot "install-register.ps1") (Join-Path $AppStage "install-register.ps1")
Copy-File $LicensePath (Join-Path $AppStage "LICENSE")
Copy-File $NoticePath (Join-Path $AppStage "NOTICE")
Write-TextFile (Join-Path $AppStage "START-HERE.md") $appReadme
Write-TextFile (Join-Path $AppStage "README.md") $appReadme
Write-TextFile (Join-Path $AppStage "VERSION.txt") $Version
New-Item -ItemType Directory -Path (Join-Path $AppStage "portable\native-messaging") -Force | Out-Null
Assert-NoForbiddenRuntimeFiles $AppStage

New-ZipFromDirectoryContents $ExtensionStage $ExtensionZip
Copy-Item -LiteralPath $ExtensionZip -Destination $ChromeStoreZip -Force
New-ZipFromDirectoryContents $AppStage $AppZip

$reviewInstructions = @"
# Smart Preload v$Version - Chrome Web Store review notes

Upload package:
- zero-latency-web-extension-chrome-web-store-v$Version.zip

Native app package for reviewer testing:
- zero-latency-web-app-windows-x64-v$Version.zip

Reviewer setup:
1. Install the Smart Preload extension from the submitted Chrome Web Store package.
2. Extract the native app zip to a normal writable folder.
3. Run install-register.cmd in the extracted native app folder.
4. Open Chrome or Edge, then use regular web pages to verify prediction/preload behavior.
5. The native app is a Windows-only local tray/API helper. It exposes local endpoints only on 127.0.0.1:45831 and only accepts extension origins or an explicit local debug token.

Important setup order:
- For the first binding, install or enable the browser extension before running install-register.cmd or starting the native app.
- After binding succeeds, the extension can wake the native app automatically when the app is offline.

Native app scope:
- Native Messaging wake bridge and liveness heartbeat.
- Per-user HKCU registration for the native messaging host.
- Window hide/show support for background preload windows.
- System activity and performance telemetry for local-only preload pressure hints.
- Tray menu and lifecycle control.

Extension-owned logic:
- Visit graph learning.
- Link scoring and preload scheduling.
- Navigation interception and hidden-tab/native preload activation.
- AI provider calls and API key storage.

No remote hosted extension code is used. The extension package contains the executable extension JavaScript and the local wasm engine needed for graph queries.
"@

$releaseReadme = @"
# Smart Preload v$Version

Contents:
- START-HERE.md
- README.md
- zero-latency-web-extension-v$Version.zip
- zero-latency-web-app-windows-x64-v$Version.zip
- SHA256SUMS.txt
- LICENSE
- NOTICE

Smart Preload prepares pages you are likely to open next so browsing can feel faster, especially when working across many tabs.

Platform:
- Extension: Chrome and Edge.
- Companion app: Windows only.

## English

Install:
1. Install or load the extension package in Chrome or Edge.
2. Extract the Windows app package to a normal writable folder.
3. Keep the app folder in its final location.
4. Run `install-register.cmd` from the extracted app folder.
5. After registration, you can start `zero-latency-web-app.exe` from the same folder. After the first successful binding, the extension can wake it automatically.

Notes:
- Install or enable the browser extension before running the Windows app for the first time.
- Do not run the Windows app directly from inside the zip.
- If the app folder is moved later, run `install-register.cmd` again from the new location.

## 简体中文

安装：
1. 在 Chrome 或 Edge 中安装或加载扩展包。
2. 把 Windows app 包解压到普通可写文件夹。
3. 先把 app 文件夹放到最终位置。
4. 从解压后的 app 文件夹运行 `install-register.cmd`。
5. 注册后，可以从同一文件夹启动 `zero-latency-web-app.exe`。首次绑定成功后，扩展可以自动唤起它。

注意：
- 第一次运行 Windows app 前，必须先安装或启用浏览器扩展。
- 不要直接在 zip 压缩包里运行 Windows app。
- 如果之后移动了 app 文件夹，需要在新位置重新运行 `install-register.cmd`。

## 繁體中文

安裝：
1. 在 Chrome 或 Edge 中安裝或載入擴充功能包。
2. 把 Windows app 包解壓縮到一般可寫入的資料夾。
3. 先把 app 資料夾放到最終位置。
4. 從解壓縮後的 app 資料夾執行 `install-register.cmd`。
5. 註冊後，可以從同一資料夾啟動 `zero-latency-web-app.exe`。首次綁定成功後，擴充功能可以自動喚起它。

注意：
- 第一次執行 Windows app 前，必須先安裝或啟用瀏覽器擴充功能。
- 不要直接在 zip 壓縮包裡執行 Windows app。
- 如果之後移動了 app 資料夾，需要在新位置重新執行 `install-register.cmd`。

## 日本語

インストール:
1. Chrome または Edge に拡張機能パッケージをインストールまたは読み込みます。
2. Windows アプリパッケージを通常の書き込み可能なフォルダーへ展開します。
3. app フォルダーを最終的な場所に置きます。
4. 展開した app フォルダーから `install-register.cmd` を実行します。
5. 登録後は、同じフォルダーの `zero-latency-web-app.exe` から起動できます。初回連携後は拡張機能が自動起動できます。

注意:
- 初めて Windows アプリを実行する前に、ブラウザ拡張機能をインストールまたは有効化してください。
- Windows アプリを zip の中から直接実行しないでください。
- app フォルダーを後で移動した場合は、新しい場所で `install-register.cmd` をもう一度実行してください。

## 한국어

설치:
1. Chrome 또는 Edge에 확장 프로그램 패키지를 설치하거나 로드합니다.
2. Windows 앱 패키지를 일반 쓰기 가능한 폴더에 압축 해제합니다.
3. app 폴더를 최종 위치에 둡니다.
4. 압축 해제한 app 폴더에서 `install-register.cmd`를 실행합니다.
5. 등록 후에는 같은 폴더의 `zero-latency-web-app.exe`로 시작할 수 있습니다. 첫 연결 후에는 확장 프로그램이 자동으로 실행할 수 있습니다.

주의:
- Windows 앱을 처음 실행하기 전에 브라우저 확장 프로그램을 먼저 설치하거나 활성화해야 합니다.
- Windows 앱을 zip 안에서 바로 실행하지 마세요.
- 나중에 app 폴더를 옮기면 새 위치에서 `install-register.cmd`를 다시 실행해야 합니다.

## Deutsch

Installation:
1. Installieren oder laden Sie das Erweiterungspaket in Chrome oder Edge.
2. Entpacken Sie das Windows-App-Paket in einen normalen beschreibbaren Ordner.
3. Legen Sie den app-Ordner an seinen endgueltigen Ort.
4. Fuehren Sie `install-register.cmd` aus dem entpackten app-Ordner aus.
5. Nach der Registrierung koennen Sie `zero-latency-web-app.exe` aus demselben Ordner starten. Nach der ersten Kopplung kann die Erweiterung die App automatisch starten.

Hinweise:
- Installieren oder aktivieren Sie die Browsererweiterung, bevor Sie die Windows-App zum ersten Mal starten.
- Starten Sie die Windows-App nicht direkt aus der zip-Datei.
- Wenn der app-Ordner spaeter verschoben wird, fuehren Sie `install-register.cmd` am neuen Ort erneut aus.

## Francais

Installation :
1. Installez ou chargez le package d'extension dans Chrome ou Edge.
2. Extrayez le package de l'application Windows dans un dossier normal avec droit d'ecriture.
3. Placez le dossier app a son emplacement final.
4. Executez `install-register.cmd` depuis le dossier app extrait.
5. Apres l'enregistrement, vous pouvez lancer `zero-latency-web-app.exe` depuis le meme dossier. Apres le premier lien, l'extension peut le demarrer automatiquement.

Notes :
- Installez ou activez l'extension du navigateur avant le premier lancement de l'application Windows.
- Ne lancez pas l'application Windows directement depuis le zip.
- Si le dossier app est deplace ensuite, executez a nouveau `install-register.cmd` depuis le nouvel emplacement.

## Espanol

Instalacion:
1. Instala o carga el paquete de extension en Chrome o Edge.
2. Extrae el paquete de la app de Windows en una carpeta normal con permiso de escritura.
3. Coloca la carpeta app en su ubicacion final.
4. Ejecuta `install-register.cmd` desde la carpeta app extraida.
5. Despues del registro, puedes iniciar `zero-latency-web-app.exe` desde la misma carpeta. Tras el primer enlace, la extension puede iniciarla automaticamente.

Notas:
- Instala o habilita la extension del navegador antes de ejecutar la app de Windows por primera vez.
- No ejecutes la app de Windows directamente desde el zip.
- Si mueves la carpeta app despues, ejecuta `install-register.cmd` otra vez desde la nueva ubicacion.

## Portugues (Brasil)

Instalacao:
1. Instale ou carregue o pacote da extensao no Chrome ou Edge.
2. Extraia o pacote do app Windows em uma pasta normal com permissao de escrita.
3. Coloque a pasta app no local final.
4. Execute `install-register.cmd` a partir da pasta app extraida.
5. Depois do registro, voce pode iniciar `zero-latency-web-app.exe` pela mesma pasta. Depois da primeira vinculacao, a extensao pode iniciar o app automaticamente.

Observacoes:
- Instale ou ative a extensao do navegador antes de executar o app Windows pela primeira vez.
- Nao execute o app Windows diretamente dentro do zip.
- Se a pasta app for movida depois, execute `install-register.cmd` novamente no novo local.

## Русский

Установка:
1. Установите или загрузите пакет расширения в Chrome или Edge.
2. Распакуйте пакет Windows-приложения в обычную папку с правом записи.
3. Поместите папку app в окончательное расположение.
4. Запустите `install-register.cmd` из распакованной папки app.
5. После регистрации можно запускать `zero-latency-web-app.exe` из той же папки. После первого связывания расширение сможет запускать приложение автоматически.

Примечания:
- Перед первым запуском Windows-приложения установите или включите расширение браузера.
- Не запускайте Windows-приложение прямо из zip-архива.
- Если позже переместить папку app, снова запустите `install-register.cmd` из нового расположения.

The SHA256SUMS.txt file can be used to verify the downloaded zip files.

License: Apache License 2.0. See LICENSE and NOTICE.
"@

$testGuide = @"
# Smart Preload v$Version test bundle

Recommended smoke checks:
1. Install the extension package.
2. Extract and register the native app package with install-register.cmd.
3. Confirm /health is reachable from the extension.
4. Confirm app and extension heartbeat stay online.
5. Test normal preload activation on several navigation-friendly sites.
6. Test Chrome/Chromium and Edge in parallel.
7. Test incognito behavior with the incognito exclusion setting both enabled and disabled.
8. Test resource-pressure policy with the fullscreen/game policy set to sleep.
9. Confirm popup and settings show the performance warning only when the local app reports pressure without an external workload.

This bundle is for internal QA and reviewer handoff. Runtime logs and debug tokens are intentionally excluded from the app package.

First binding order: install or enable the browser extension first, then run install-register.cmd or start the native app. After binding succeeds, the extension can wake the native app automatically.

License: Apache License 2.0. See LICENSE and NOTICE.
"@

New-CleanDirectory $ReviewStage
New-Item -ItemType Directory -Path (Join-Path $ReviewStage "chrome-web-store-upload") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $ReviewStage "native-app-reviewer-bundle") -Force | Out-Null
Copy-File $ChromeStoreZip (Join-Path $ReviewStage "chrome-web-store-upload\zero-latency-web-extension-chrome-web-store-v$Version.zip")
Copy-File $AppZip (Join-Path $ReviewStage "native-app-reviewer-bundle\zero-latency-web-app-windows-x64-v$Version.zip")
Copy-File $LicensePath (Join-Path $ReviewStage "LICENSE")
Copy-File $NoticePath (Join-Path $ReviewStage "NOTICE")
Write-TextFile (Join-Path $ReviewStage "REVIEW-INSTRUCTIONS.md") $reviewInstructions

New-CleanDirectory $ReleaseStage
Copy-File $ExtensionZip (Join-Path $ReleaseStage "zero-latency-web-extension-v$Version.zip")
Copy-File $AppZip (Join-Path $ReleaseStage "zero-latency-web-app-windows-x64-v$Version.zip")
Copy-File $LicensePath (Join-Path $ReleaseStage "LICENSE")
Copy-File $NoticePath (Join-Path $ReleaseStage "NOTICE")
Write-TextFile (Join-Path $ReleaseStage "START-HERE.md") $releaseReadme
Write-TextFile (Join-Path $ReleaseStage "README.md") $releaseReadme

New-CleanDirectory $TestStage
Copy-Directory $ExtensionStage (Join-Path $TestStage "zero-latency-web-extension-v$Version")
Copy-Directory $AppStage (Join-Path $TestStage "zero-latency-web-app-v$Version")
Copy-File $ExtensionZip (Join-Path $TestStage "zero-latency-web-extension-v$Version.zip")
Copy-File $AppZip (Join-Path $TestStage "zero-latency-web-app-windows-x64-v$Version.zip")
Copy-File $LicensePath (Join-Path $TestStage "LICENSE")
Copy-File $NoticePath (Join-Path $TestStage "NOTICE")
Write-TextFile (Join-Path $TestStage "README-TEST-GUIDE.md") $testGuide

function Get-HashLines {
  param([string[]]$Paths)

  foreach ($zip in $Paths) {
  $hash = Get-FileHash -LiteralPath $zip -Algorithm SHA256
  "$($hash.Hash.ToLowerInvariant())  $(Split-Path -Leaf $zip)"
  }
}

Set-Content -LiteralPath (Join-Path $ReviewStage "SHA256SUMS.txt") -Value (Get-HashLines @($ChromeStoreZip, $AppZip)) -Encoding ASCII
Set-Content -LiteralPath (Join-Path $ReleaseStage "SHA256SUMS.txt") -Value (Get-HashLines @($ExtensionZip, $AppZip)) -Encoding ASCII
Set-Content -LiteralPath (Join-Path $TestStage "SHA256SUMS.txt") -Value (Get-HashLines @($ExtensionZip, $AppZip)) -Encoding ASCII

New-ZipFromDirectoryContents $ReviewStage $ReviewZip
New-ZipFromDirectoryContents $ReleaseStage $ReleaseZip
New-ZipFromDirectoryContents $TestStage $TestZip

$artifactZips = @(
  $ExtensionZip,
  $ChromeStoreZip,
  $AppZip,
  $ReviewZip,
  $ReleaseZip,
  $TestZip
)
$hashLines = Get-HashLines $artifactZips
Set-Content -LiteralPath $ShaFile -Value $hashLines -Encoding ASCII
foreach ($zip in $artifactZips) {
  $hash = Get-FileHash -LiteralPath $zip -Algorithm SHA256
  Set-Content -LiteralPath "$zip.sha256.txt" -Value "$($hash.Hash.ToLowerInvariant())  $(Split-Path -Leaf $zip)" -Encoding ASCII
}

Write-Host "[Smart Preload] Release packages generated for v$Version"
foreach ($zip in $artifactZips) {
  Write-Host "  $zip"
}
Write-Host "  $ShaFile"

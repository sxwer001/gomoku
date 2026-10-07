# =============================================================================
#  构建安卓 APK
#  不依赖 Gradle / Android Studio：直接调用 SDK 里的
#  aapt2 → javac → d8 → zipalign → apksigner
#
#  用法：  pwsh -File tools\build-android.ps1
#  说明：  javac/keytool 用 JDK 8（保证 -source 8 可用），
#          d8/apksigner 用 JDK 11+ 运行（build-tools 34 的 d8 是 Java 11 字节码）
# =============================================================================
param(
  [string]$Sdk         = 'D:\Android\sdk',
  [string]$BuildTools  = '34.0.0',
  [string]$Platform    = 'android-34',
  [int]   $VersionCode = 2,
  [string]$VersionName = '1.0.1',
  [int]   $MinSdk      = 21,
  [int]   $TargetSdk   = 34,
  [string]$JavaHome    = 'C:\Program Files\Java\jdk1.8.0_231',
  [string]$JavaRuntime = 'C:\Program Files\Java\jdk-26.0.1',
  [string]$Python      = 'C:\Users\sxw18\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe'
)

# 注意：这里刻意用 Continue 而不是 Stop。
# SDK 里的命令行工具（javac/d8/apksigner）会往 stderr 写告警，而 Windows PowerShell 5.1
# 会把原生命令的 stderr 包装成 ErrorRecord，在 Stop 模式下会被当成终止错误。
# 因此统一改成「用退出码判断」，每一步都有 $LASTEXITCODE 检查。
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$root    = Split-Path -Parent $PSScriptRoot
$proj    = Join-Path $root 'android'
$work    = Join-Path $root 'build\android'
$release = Join-Path $root 'release\android'

$bt         = Join-Path $Sdk "build-tools\$BuildTools"
$androidJar = Join-Path $Sdk "platforms\$Platform\android.jar"
$aapt2      = Join-Path $bt 'aapt2.exe'
$d8         = Join-Path $bt 'd8.bat'
$zipalign   = Join-Path $bt 'zipalign.exe'
$apksigner  = Join-Path $bt 'apksigner.bat'
$javac      = Join-Path $JavaHome 'bin\javac.exe'
$keytool    = Join-Path $JavaHome 'bin\keytool.exe'

function Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }
function Fail($msg) { Write-Host "✗ $msg" -ForegroundColor Red; exit 1 }

# ---------------------------------------------------------------- 环境检查
Step '检查工具链'
foreach ($t in @($aapt2, $d8, $zipalign, $apksigner, $androidJar, $javac, $keytool, (Join-Path $JavaRuntime 'bin\java.exe'))) {
  if (-not (Test-Path $t)) { Fail "缺少：$t" }
  Write-Host "  ✓ $t"
}
if (-not (Test-Path (Join-Path $proj 'assets\index.html'))) {
  Write-Host '  · assets/index.html 不存在，从 dist 复制'
}

# ---------------------------------------------------------------- 准备目录
Step '准备目录'
if (Test-Path $work) { Remove-Item $work -Recurse -Force }
foreach ($d in @($work, (Join-Path $work 'classes'), (Join-Path $work 'dex'), (Join-Path $work 'gen'))) {
  New-Item -ItemType Directory -Force -Path $d | Out-Null
}
New-Item -ItemType Directory -Force -Path $release | Out-Null

# 把最新构建好的单文件游戏拷进 assets
$gameHtml = Join-Path $root 'dist\index.html'
if (-not (Test-Path $gameHtml)) { Fail '未找到 dist\index.html，请先运行 npm run build' }
$assets = Join-Path $proj 'assets'
New-Item -ItemType Directory -Force -Path $assets | Out-Null
Copy-Item $gameHtml (Join-Path $assets 'index.html') -Force
$gameKb = [math]::Round((Get-Item (Join-Path $assets 'index.html')).Length / 1KB, 1)
Write-Host "  ✓ 游戏资源已就绪（$gameKb KB）"

# ---------------------------------------------------------------- aapt2 compile
Step 'aapt2 compile（编译资源）'
$resZip = Join-Path $work 'resources.zip'
& $aapt2 compile --dir (Join-Path $proj 'res') -o $resZip
if ($LASTEXITCODE -ne 0) { Fail 'aapt2 compile 失败' }
Write-Host "  ✓ $resZip"

# ---------------------------------------------------------------- aapt2 link
Step 'aapt2 link（链接资源 + 清单 + assets）'
$baseApk = Join-Path $work 'base.apk'
$genDir  = Join-Path $work 'gen'
& $aapt2 link `
  -o $baseApk `
  -I $androidJar `
  --manifest (Join-Path $proj 'AndroidManifest.xml') `
  -A $assets `
  --java $genDir `
  --min-sdk-version $MinSdk `
  --target-sdk-version $TargetSdk `
  --version-code $VersionCode `
  --version-name $VersionName `
  $resZip
if ($LASTEXITCODE -ne 0) { Fail 'aapt2 link 失败' }
Write-Host "  ✓ $baseApk"

# ---------------------------------------------------------------- javac
Step 'javac（编译 Java 源码）'
$sources = @()
$sources += Get-ChildItem (Join-Path $genDir 'com') -Recurse -Filter *.java | ForEach-Object { $_.FullName }
$sources += Get-ChildItem (Join-Path $proj 'java') -Recurse -Filter *.java | ForEach-Object { $_.FullName }
Write-Host ("  · 源文件：" + ($sources | ForEach-Object { Split-Path $_ -Leaf }) -join ', ')
$classesDir = Join-Path $work 'classes'
# 输出先收起来，只有失败时才打印（避免 javac 中文告警在控制台乱码）
$javacOut = & $javac -source 8 -target 8 -encoding UTF-8 -nowarn `
  -bootclasspath $androidJar -d $classesDir $sources 2>&1
if ($LASTEXITCODE -ne 0) {
  $javacOut | Where-Object { $_ -notmatch 'bootstrap class path' } | ForEach-Object { Write-Host "    $_" }
  Fail 'javac 编译失败'
}
$classCount = (Get-ChildItem $classesDir -Recurse -Filter *.class).Count
Write-Host "  ✓ 生成 $classCount 个 .class"

# ---------------------------------------------------------------- d8
Step 'd8（转成 Dex）'
# build-tools 34 的 d8 需要 Java 11+，切到新 JDK 运行；javac 仍用 JDK 8
if (-not (Test-Path (Join-Path $JavaRuntime 'bin\java.exe'))) { Fail "缺少 Java 11+ 运行时：$JavaRuntime" }
$env:JAVA_HOME = $JavaRuntime
$env:PATH = (Join-Path $JavaRuntime 'bin') + ';' + $env:PATH
Write-Host "  · 运行时：$JavaRuntime"
$dexDir = Join-Path $work 'dex'
$classFiles = Get-ChildItem $classesDir -Recurse -Filter *.class | ForEach-Object { $_.FullName }
& $d8 --release --min-api $MinSdk --lib $androidJar --output $dexDir $classFiles
if ($LASTEXITCODE -ne 0) { Fail 'd8 转换失败' }
$dexFile = Join-Path $dexDir 'classes.dex'
if (-not (Test-Path $dexFile)) { Fail '未生成 classes.dex' }
Write-Host ("  ✓ classes.dex（" + [math]::Round((Get-Item $dexFile).Length / 1KB, 1) + " KB）")

# ---------------------------------------------------------------- 合并 dex
Step '把 classes.dex 合入 APK（Python zipfile）'
# 不用 .NET ZipArchive：它会整体重写压缩包，且在 PowerShell 5.1 下可能静默失败，
# 导致产出「没有 dex 的 APK」——真机安装必报「安装包异常」。
$unsigned = Join-Path $work 'unsigned.apk'
if (-not (Test-Path $python)) { Fail "缺少 Python：$python" }
& $python (Join-Path $PSScriptRoot 'build-apk.py') $baseApk $dexFile $unsigned
if ($LASTEXITCODE -ne 0) { Fail '组装 APK 失败' }

# 硬校验：压缩包里必须真的有 classes.dex
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zipCheck = [System.IO.Compression.ZipFile]::OpenRead($unsigned)
try {
  $dexEntry = $zipCheck.GetEntry('classes.dex')
  $arscEntry = $zipCheck.GetEntry('resources.arsc')
  if ($null -eq $dexEntry) { Fail 'APK 里没有 classes.dex' }
  if ($null -eq $arscEntry) { Fail 'APK 里没有 resources.arsc' }
  if ($arscEntry.CompressedLength -ne $arscEntry.Length) { Fail 'resources.arsc 被压缩了，Android 11+ 会拒绝安装' }
  Write-Host ("  ✓ classes.dex {0} 字节，resources.arsc {1} 字节（未压缩）" -f $dexEntry.Length, $arscEntry.Length)
} finally { $zipCheck.Dispose() }

# ---------------------------------------------------------------- zipalign
Step 'zipalign（4 字节对齐）'
$aligned = Join-Path $work 'aligned.apk'
& $zipalign -f -p 4 $unsigned $aligned
if ($LASTEXITCODE -ne 0) { Fail 'zipalign 失败' }
Write-Host '  ✓ 已完成'

# ---------------------------------------------------------------- 签名
Step 'apksigner（签名）'
# 密钥放在 tools\ 下（而不是 $work）——$work 每次构建都会被清空，
# 放里面会导致每次生成新密钥、新旧包签名不一致，安卓会拒绝覆盖安装。
$ks = Join-Path $PSScriptRoot 'debug.keystore'
$ksPass = 'android'
if (-not (Test-Path $ks)) {
  & $keytool -genkeypair -v `
    -keystore $ks -storetype JKS -alias androiddebugkey `
    -keyalg RSA -keysize 2048 -validity 10000 `
    -storepass $ksPass -keypass $ksPass `
    -dname 'CN=Gomoku Debug, OU=Gomoku, O=Gomoku, L=CN, C=CN' 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail '生成签名密钥失败' }
  Write-Host '  · 已生成调试签名密钥'
}
$apkName = "Gomoku-Android-$VersionName.apk"
$apkOut  = Join-Path $release $apkName
if (Test-Path $apkOut) { Remove-Item $apkOut -Force }
& $apksigner sign `
  --ks $ks --ks-key-alias androiddebugkey `
  --ks-pass "pass:$ksPass" --key-pass "pass:$ksPass" `
  --v1-signing-enabled true --v2-signing-enabled true `
  --out $apkOut $aligned
if ($LASTEXITCODE -ne 0) { Fail 'apksigner 签名失败' }

Step '校验'
& $apksigner verify --verbose $apkOut | Select-Object -First 8
& $aapt2 dump badging $apkOut 2>$null | Select-String -Pattern '^package|^application-label|^launchable-activity|^sdkVersion|^targetSdkVersion'

$kb = [math]::Round((Get-Item $apkOut).Length / 1KB, 1)
Write-Host "`n✅ 已生成：$apkOut  ($kb KB)" -ForegroundColor Green

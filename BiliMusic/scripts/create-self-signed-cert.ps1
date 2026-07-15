# 生成自签名证书脚本（开发测试用）
# 运行方式: .\scripts\create-self-signed-cert.ps1

param(
    [string]$CertName = "BiliMusic",
    [string]$OutputDir = "./certs",
    [int]$ValidityDays = 365
)

# 检查 OpenSSL
$openssl = Get-Command openssl -ErrorAction SilentlyContinue
if (-not $openssl) {
    Write-Host "OpenSSL 未找到。正在尝试安装..." -ForegroundColor Yellow

    # 尝试使用 winget 安装
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($winget) {
        winget install OpenSSL.Light
        Write-Host "请重启 PowerShell 后再次运行此脚本" -ForegroundColor Cyan
        exit
    } else {
        Write-Error "请手动安装 OpenSSL: https://slproweb.com/products/Win32OpenSSL.html"
        exit 1
    }
}

# 创建输出目录
if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir | Out-Null
    Write-Host "创建目录: $OutputDir" -ForegroundColor Green
}

$keyFile = "$OutputDir/signing-key.pem"
$certFile = "$OutputDir/signing-cert.pem"
$pfxFile = "$OutputDir/signing-cert.pfx"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  生成自签名证书用于代码签名"
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 生成私钥和证书
Write-Host "1. 生成私钥和证书..." -ForegroundColor Yellow
& openssl req -x509 -newkey rsa:4096 `
    -keyout $keyFile `
    -out $certFile `
    -days $ValidityDays `
    -nodes `
    -subj "/CN=$CertName/O=Developer/C=CN" `
    -quiet

if ($LASTEXITCODE -ne 0) {
    Write-Error "证书生成失败"
    exit 1
}

Write-Host "   ✓ 私钥: $keyFile" -ForegroundColor Green
Write-Host "   ✓ 证书: $certFile" -ForegroundColor Green

# 生成密码
$password = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 16 | ForEach-Object { [char]$_ })
$passwordFile = "$OutputDir/cert-password.txt"
$password | Out-File -FilePath $passwordFile -Encoding UTF8

Write-Host ""
Write-Host "2. 转换为 PFX 格式..." -ForegroundColor Yellow
& openssl pkcs12 -export `
    -in $certFile `
    -inkey $keyFile `
    -out $pfxFile `
    -name $CertName `
    -password pass:$password

if ($LASTEXITCODE -ne 0) {
    Write-Error "PFX 转换失败"
    exit 1
}

Write-Host "   ✓ PFX: $pfxFile" -ForegroundColor Green
Write-Host "   ✓ 密码已保存到: $passwordFile" -ForegroundColor Green

# 显示证书信息
Write-Host ""
Write-Host "3. 证书信息:" -ForegroundColor Yellow
& openssl x509 -in $certFile -noout -subject -dates

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  证书生成完成！"
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "下一步:" -ForegroundColor Cyan
Write-Host "1. 安装证书到受信任的根证书颁发机构" -ForegroundColor White
Write-Host "   双击 $pfxFile 并按照向导安装" -ForegroundColor Gray
Write-Host ""
Write-Host "2. 配置 package.json:" -ForegroundColor White
Write-Host @"
   "win": {
     "signAndEditExecutable": true,
     "verifyUpdateCodeSignature": true,
     "certificateFile": "$pfxFile",
     "certificatePassword": "@env:CERT_PASSWORD"
   }
"@ -ForegroundColor Gray
Write-Host ""
Write-Host "3. 打包时设置环境变量:" -ForegroundColor White
Write-Host "   \$env:CERT_PASSWORD = Get-Content $passwordFile" -ForegroundColor Gray
Write-Host "   npm run pack:portable" -ForegroundColor Gray
Write-Host ""
Write-Host "⚠️  警告: 自签名证书仅用于开发测试！" -ForegroundColor Yellow
Write-Host "   正式发布请购买商业代码签名证书。" -ForegroundColor Yellow
Write-Host ""

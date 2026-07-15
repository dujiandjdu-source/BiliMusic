# Windows 代码签名配置指南

## 当前状态

当前 `package.json` 中的构建配置禁用了代码签名：
```json
"win": {
  "signAndEditExecutable": false,
  "verifyUpdateCodeSignature": false
}
```

这会导致 Windows 显示"未知发布者"安全警告，且自动更新不会验证签名。

## 方案一：自签名证书（开发/测试用）

### 1. 创建自签名证书

```powershell
# 安装 OpenSSL（如果还没有）
# 使用 winget: winget install OpenSSL.Light

# 创建私钥和证书
openssl req -x509 -newkey rsa:4096 -keyout signing-key.pem -out signing-cert.pem -days 365 -nodes -subj "/CN=BiliMusic/O=YourName/C=CN"

# 转换为 PFX 格式（electron-builder 需要）
openssl pkcs12 -export -in signing-cert.pem -inkey signing-key.pem -out signing-cert.pfx -name "BiliMusic"
```

### 2. 更新 package.json

```json
"win": {
  "target": "portable",
  "signAndEditExecutable": true,
  "verifyUpdateCodeSignature": true,
  "certificateFile": "./certs/signing-cert.pfx",
  "certificatePassword": "your-password"
}
```

### 3. 安装证书到受信任的根证书颁发机构

用户需要手动安装证书才能信任：
1. 双击 `.pfx` 文件
2. 选择"本地计算机"
3. 输入密码
4. 选择"将所有证书放入下列存储"
5. 选择"受信任的根证书颁发机构"

## 方案二：购买商业代码签名证书（正式发布用）

### 推荐供应商

| 供应商 | 价格（每年） | 类型 | 备注 |
|--------|-------------|------|------|
| Sectigo (原 Comodo) | ~$200-400 | OV | 最常用 |
| DigiCert | ~$400-600 | OV/EV | 知名品牌 |
| SSL.com | ~$200-300 | OV/EV | 性价比高 |
| Certum | ~$100-200 | OV | 欧洲供应商 |

### OV vs EV 证书

- **OV (Organization Validated)**: 标准验证，显示组织名称
- **EV (Extended Validation)**: 扩展验证，显示绿色地址栏，需要更严格的验证

对于桌面应用，OV 证书通常足够。

### 购买流程

1. 选择供应商并购买证书
2. 提交组织验证材料（营业执照等）
3. 完成电话/邮件验证
4. 下载证书并转换为 PFX 格式
5. 配置 electron-builder

## 方案三：Azure Key Vault 云签名（推荐）

使用云 HSM 保护私钥，更安全。

### 1. 创建 Azure Key Vault

```bash
# 登录 Azure
az login

# 创建资源组
az group create --name BiliMusicSigning --location eastasia

# 创建 Key Vault
az keyvault create --name BiliMusicVault --resource-group BiliMusicSigning --location eastasia
```

### 2. 创建证书

```bash
# 创建自签名证书用于测试
az keyvault certificate create --vault-name BiliMusicVault --name BiliMusicCert --policy "$(az keyvault certificate get-default-policy)"
```

### 3. 配置 electron-builder

```json
"win": {
  "signAndEditExecutable": true,
  "verifyUpdateCodeSignature": true,
  "azureSignOptions": {
    "endpoint": "https://BiliMusicVault.vault.azure.net",
    "certificateName": "BiliMusicCert"
  }
}
```

### 4. 安装 Azure 签名工具

```bash
npm install --save-dev @wavesync/electron-azure-sign
```

## 配置 electron-builder

### 完整配置示例（package.json）

```json
{
  "build": {
    "appId": "com.bilimusic.app",
    "productName": "BiliMusic",
    "directories": {
      "output": "release"
    },
    "files": [
      "dist/**/*",
      "electron/**/*",
      "package.json"
    ],
    "win": {
      "target": [
        {
          "target": "portable",
          "arch": ["x64"]
        },
        {
          "target": "nsis",
          "arch": ["x64"]
        }
      ],
      "signAndEditExecutable": true,
      "verifyUpdateCodeSignature": true,
      "publisherName": "Your Company Name",
      "signDlls": true
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true,
      "createDesktopShortcut": true,
      "createStartMenuShortcut": true
    },
    "publish": {
      "provider": "github",
      "owner": "dujiandjdu-source",
      "repo": "BiliMusic",
      "vPrefixedTagName": true
    }
  }
}
```

### 使用环境变量保护证书密码

不要直接将密码写在 package.json 中：

```json
"win": {
  "certificateFile": "./certs/signing-cert.pfx",
  "certificatePassword": "@env:CERT_PASSWORD"
}
```

打包时设置环境变量：

```powershell
$env:CERT_PASSWORD="your-password"
npm run pack:portable
```

### GitHub Actions 自动签名

```yaml
# .github/workflows/release.yml
name: Release

on:
  push:
    tags:
      - 'v*'

jobs:
  build:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      
      - uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'npm'
      
      - run: npm ci
      
      # 使用 GitHub Secrets 存储证书
      - name: Setup certificate
        run: |
          echo "${{ secrets.WIN_CERT_BASE64 }}" | base64 -d > signing-cert.pfx
      
      - name: Build and release
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          WIN_CERT_PASSWORD: ${{ secrets.WIN_CERT_PASSWORD }}
        run: npm run pack:portable
```

## 验证签名

打包完成后验证：

```powershell
# 使用 PowerShell 验证
Get-AuthenticodeSignature -FilePath "./release/BiliMusic 1.0.1.exe"

# 使用 signtool（Windows SDK）
signtool verify /pa "./release/BiliMusic 1.0.1.exe"
```

## 常见问题

### 1. 签名后文件大小增加

正常。签名会添加证书信息和哈希值，通常增加 1-5KB。

### 2. SmartScreen 仍然显示警告

- 自签名证书：无法避免，需要积累声誉
- 商业证书：首次发布可能需要几天建立声誉
- EV 证书：立即消除 SmartScreen 警告

### 3. 证书过期

代码签名证书有过期时间，但已签名的文件在过期后仍然有效（使用时间戳）。确保打包时启用时间戳：

```json
"win": {
  "timeStampServer": "http://timestamp.digicert.com"
}
```

### 4. 自动更新签名验证失败

确保 `verifyUpdateCodeSignature` 为 `true`，且发布到 GitHub Releases 的文件已签名。

## 下一步建议

1. **短期（开发测试）**：使用自签名证书
2. **中期（小范围发布）**：购买 OV 证书（如 Sectigo）
3. **长期（正式发布）**：考虑 EV 证书或 Azure Key Vault

---

**注意**：请将证书文件（.pfx, .pem）添加到 .gitignore，不要提交到版本控制！

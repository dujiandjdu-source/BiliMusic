#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const cryptoLib = require("@clamber_l/crypto");

const input = process.argv[2];
const keyArg = process.argv.find((value) => value.startsWith("--key="));
const suppliedKey = keyArg?.slice("--key=".length);

const fail = (message, code = 1) => {
  console.error(message);
  process.exitCode = code;
};

const readFooter = (filePath) => {
  const stat = fs.statSync(filePath);
  const length = Math.min(stat.size, 4096);
  const buffer = Buffer.alloc(length);
  const fd = fs.openSync(filePath, "r");
  try {
    fs.readSync(fd, buffer, 0, length, stat.size - length);
  } finally {
    fs.closeSync(fd);
  }
  return { stat, footer: cryptoLib.QMCFooter.parse(buffer) };
};

const decode = (filePath, outputPath, ekey, footerSize) => {
  const sourceSize = fs.statSync(filePath).size - footerSize;
  const cipher = new cryptoLib.QMC2(ekey);
  const inputFd = fs.openSync(filePath, "r");
  const tempPath = `${outputPath}.partial`;
  const outputFd = fs.openSync(tempPath, "w");
  const chunkSize = 2 * 1024 * 1024;
  let offset = 0;

  try {
    while (offset < sourceSize) {
      const length = Math.min(chunkSize, sourceSize - offset);
      const chunk = Buffer.allocUnsafe(length);
      fs.readSync(inputFd, chunk, 0, length, offset);
      cipher.decrypt(chunk, offset);

      if (offset === 0) {
        const magic = chunk.subarray(0, 4).toString("ascii");
        if (!["fLaC", "OggS", "RIFF"].includes(magic) && magic.slice(0, 3) !== "ID3") {
          throw new Error(`解密后的文件头无效（${chunk.subarray(0, 8).toString("hex")}），eKey 不匹配`);
        }
      }

      fs.writeSync(outputFd, chunk);
      offset += length;
      const percent = ((offset / sourceSize) * 100).toFixed(1);
      process.stdout.write(`\r正在解密 ${percent}%`);
    }
  } catch (error) {
    fs.closeSync(outputFd);
    fs.closeSync(inputFd);
    cipher.free();
    fs.rmSync(tempPath, { force: true });
    throw error;
  }

  fs.closeSync(outputFd);
  fs.closeSync(inputFd);
  cipher.free();
  fs.renameSync(tempPath, outputPath);
  process.stdout.write("\n");
};

const main = async () => {
  if (!input) {
    fail("用法: npm run qmc:decode -- <歌曲.mflac> [--key=<eKey>]");
    return;
  }

  const filePath = path.resolve(input);
  if (!fs.existsSync(filePath)) {
    fail(`文件不存在: ${filePath}`);
    return;
  }

  await cryptoLib.ready;
  const { footer } = readFooter(filePath);
  if (!footer) {
    fail("未识别到 QMC2 文件尾；这个文件可能不是 mflac，或文件不完整。");
    return;
  }

  const footerSize = footer.size;
  const embeddedKey = footer.ekey;
  const mediaName = footer.mediaName;
  footer.free();

  console.log(`媒体标识: ${mediaName || "未知"}`);
  console.log(`QMC 文件尾: ${footerSize} 字节`);

  const ekey = suppliedKey || embeddedKey;
  if (!ekey) {
    fail(
      "该文件是新版 MusicEx/QMC2，未内嵌 eKey。需要从下载它的 QQ 音乐客户端密钥缓存中取得 eKey 后再解码。",
      2,
    );
    return;
  }

  const outputPath = filePath.replace(/\.(mflac|qmcflac)$/i, ".decoded.flac");
  decode(filePath, outputPath, ekey, footerSize);
  console.log(`解密完成: ${outputPath}`);
};

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));

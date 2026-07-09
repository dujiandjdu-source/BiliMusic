const { app, BrowserWindow, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

module.exports = function (ipc) {
  const sendToRenderers = (channel, payload) => {
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, payload);
      }
    });
  };

  ipc.handle("open-file-dialog", async () => {
    const r = await dialog.showOpenDialog({
      properties: ["openFile", "multiFile"],
      filters: [{ name: "Audio", extensions: ["mp3","flac","wav","aac","ogg","m4a"] }],
    });
    return r.filePaths;
  });

  ipc.handle("store-get", (_, k) => {
    try { return JSON.parse(fs.readFileSync(configPath(), "utf-8"))[k]; } catch { return null; }
  });

  ipc.handle("store-set", (_, k, v) => {
    const p = configPath();
    let data = {};
    try { data = JSON.parse(fs.readFileSync(p, "utf-8")); } catch {}
    data[k] = v;
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(data));
    return true;
  });

  ipc.handle("download:audio", async (_, url, title) => {
    const dir = path.join(app.getPath("music"), "BiliMusic");
    fs.mkdirSync(dir, { recursive: true });
    const name = (title || "track").replace(/[<>:"/\\|?*]/g, "_").substring(0, 80);
    const out = path.join(dir, `${name}.mp3`);
    if (fs.existsSync(out)) return { ok: true, path: out };

    return new Promise((resolve) => {
      const ff = spawn("ffmpeg", ["-y","-i",url,"-vn","-acodec","libmp3lame","-ab","192k","-ar","44100","-ac","2",out]);
      ff.stderr.on("data", (d) => {
        const m = d.toString().match(/time=(\d+):(\d+):(\d+)/);
        if (m) sendToRenderers("dl:progress", { time: +m[1]*3600 + +m[2]*60 + +m[3] });
      });
      ff.on("close", (code) => {
        if (code === 0) sendToRenderers("dl:done", { path: out });
        resolve({ ok: code === 0, path: code === 0 ? out : null });
      });
      ff.on("error", () => resolve({ ok: false }));
    });
  });
};

function configPath() { return path.join(app.getPath("userData"), "config.json"); }

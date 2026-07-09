const { app, session } = require("electron");
const path = require("path");
const { getUpVideos, getVideoInfo, getPlayableAudio } =
  require("../electron/ipc/bilibili.js")._test;

const API_BASE = "https://api.bilibili.com";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

app.setPath("userData", path.join(app.getPath("appData"), "bili-music"));

const headers = {
  "User-Agent": UA,
  Referer: "https://www.bilibili.com/",
  Origin: "https://www.bilibili.com",
};

app.whenReady().then(async () => {
  try {
    const ses = session.defaultSession;
    const authCookieNames = new Set(["SESSDATA", "bili_jct", "DedeUserID"]);
    const cookies = await ses.cookies.get({ domain: ".bilibili.com" });
    const presentAuthCookies = cookies
      .map((cookie) => cookie.name)
      .filter((name) => authCookieNames.has(name));
    console.log(`登录 Cookie: ${presentAuthCookies.length > 0 ? presentAuthCookies.join(", ") : "无"}`);
    const navResponse = await ses.fetch(`${API_BASE}/x/web-interface/nav`, {
      headers,
    });
    const nav = await navResponse.json();
    console.log(`登录状态: ${nav.data?.isLogin ? "已登录" : "未登录"}`);

    let videoList = null;
    try {
      videoList = await getUpVideos(ses, String(nav.data?.mid || 2), 1, 2);
      console.log(`视频列表接口: code=${videoList.code}, count=${videoList.list.length}`);
    } catch (error) {
      console.log(`视频列表接口: 当前网络触发风控（${error.message}）`);
    }

    const bvid = videoList?.list?.[0]?.bvid || "BV1GJ411x7h7";
    const info = await getVideoInfo(ses, bvid);
    const audio = await getPlayableAudio(ses, bvid, info.pages[0]?.cid);
    console.log(
      `音轨接口: ${audio.remoteUrl ? "可用" : "不可用"}, codec=${audio.codec || "unknown"}`,
    );
    app.exit(audio.remoteUrl ? 0 : 1);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    app.exit(1);
  }
});

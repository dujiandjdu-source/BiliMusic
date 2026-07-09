/**
 * Bilibili service facade.
 *
 * In Electron, requests run in the main process so login cookies, WBI signing,
 * Referer headers and the audio proxy all use one persistent session.
 */

const API_BASE = "https://api.bilibili.com";
const PASS_BASE = "https://passport.bilibili.com";

const getDesktopApi = () => window.electronAPI?.bili;
const BVID_RE = /BV[0-9A-Za-z]{10}/i;

const json = async (url: string) => {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) throw new Error(`Bilibili HTTP ${response.status}`);
  return response.json();
};

export async function getQRCode() {
  const data = getDesktopApi()
    ? await getDesktopApi()!.getQRCode()
    : await json(`${PASS_BASE}/x/passport-login/web/qrcode/generate`);

  if (data.code === 0 && data.data?.url) {
    data.data.imgDataUrl = await generateQRDataUrl(data.data.url);
  }
  return data;
}

export async function checkQRLogin(qrcodeKey: string) {
  const api = getDesktopApi();
  return api
    ? api.checkQRLogin(qrcodeKey)
    : json(
        `${PASS_BASE}/x/passport-login/web/qrcode/poll?qrcode_key=${encodeURIComponent(qrcodeKey)}`,
      );
}

export async function getLoginStatus() {
  const api = getDesktopApi();
  if (api) return api.getLoginStatus();

  try {
    const result = await json(`${API_BASE}/x/web-interface/nav`);
    const data = result.data;
    return result.code === 0 && data?.isLogin
      ? {
          isLogin: true,
          uname: data.uname,
          mid: String(data.mid),
          face: data.face,
          level: data.level_info?.current_level || 0,
        }
      : { isLogin: false };
  } catch {
    return { isLogin: false };
  }
}

export async function logout() {
  const api = getDesktopApi();
  return api ? api.logout() : { success: false };
}

export async function getFollowedUpList(page = 1, pageSize = 30) {
  const api = getDesktopApi();
  if (!api) {
    return {
      list: [],
      total: 0,
      code: -1,
      message: "请在 BiliMusic 桌面版中浏览关注列表",
    };
  }
  return api.getFollowedUpList(page, pageSize);
}

export async function searchUp(keyword: string) {
  const api = getDesktopApi();
  if (!api) return { list: [], total: 0 };
  return api.searchUp(keyword);
}

export function extractBvid(input: string) {
  return input.match(BVID_RE)?.[0] ?? null;
}

export function getBilibiliVideoUrl(bvid: string, page = 1) {
  return `https://www.bilibili.com/video/${encodeURIComponent(bvid)}${page > 1 ? `?p=${page}` : ""}`;
}

export function getBilibiliPlayerUrl(bvid: string, page = 1) {
  const params = new URLSearchParams({
    bvid,
    page: String(page),
    high_quality: "1",
    autoplay: "0",
  });
  return `https://player.bilibili.com/player.html?${params.toString()}`;
}

export async function searchVideos(keyword: string, page = 1, pageSize = 20) {
  const query = keyword.trim();
  if (!query) return { list: [], total: 0 };

  const bvid = extractBvid(query);
  if (bvid) {
    const info = await getVideoInfo(bvid);
    return {
      list: info ? [info] : [],
      total: info ? 1 : 0,
      code: info ? 0 : -404,
      message: info ? "" : "没有找到这个视频",
    };
  }

  const api = getDesktopApi();
  if (!api) {
    return {
      list: [],
      total: 0,
      code: -1,
      message: "请在 BiliMusic 桌面版中搜索 B 站视频",
    };
  }
  return api.searchVideos(query, page, pageSize);
}

export async function getUpVideos(upMid: string, page = 1, pageSize = 30) {
  const api = getDesktopApi();
  if (!api) {
    return {
      list: [],
      total: 0,
      code: -1,
      message: "请在 BiliMusic 桌面版中查看视频",
    };
  }
  return api.getUpVideos(upMid, page, pageSize);
}

export async function getVideoInfo(bvid: string) {
  const api = getDesktopApi();
  if (!api) {
    const result = await json(
      `${API_BASE}/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`,
    );
    return result.code === 0 ? result.data : null;
  }
  return api.getVideoInfo(bvid);
}

export async function getVideoAudioUrl(
  bvid: string,
  cid?: number,
  quality: import("../types").AudioQuality = "auto",
) {
  const api = getDesktopApi();
  if (!api) return null;
  return api.getVideoAudioUrl(bvid, cid, quality);
}

function generateQRDataUrl(text: string): Promise<string> {
  const url =
    "https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=" +
    encodeURIComponent(text);

  return fetch(url)
    .then((response) => {
      if (!response.ok) throw new Error("QR service unavailable");
      return response.blob();
    })
    .then(
      (blob) =>
        new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        }),
    )
    .catch(() => text);
}

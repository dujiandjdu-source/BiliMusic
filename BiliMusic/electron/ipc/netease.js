const crypto = require("crypto");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const API_BASE = "https://api.bilibili.com";

const requestHeaders = (extra = {}) => ({
  "User-Agent": UA,
  Referer: "https://music.163.com/",
  Origin: "https://music.163.com",
  ...extra,
});

const biliHeaders = (extra = {}) => ({
  "User-Agent": UA,
  Referer: "https://www.bilibili.com/",
  Origin: "https://www.bilibili.com",
  ...extra,
});

// --- Netease audio resolution ---
// Try multiple sources: proxy API (primary), then direct Netease API, then B站
const NET_PROXY = "https://api.jimsdeng.eu.org";

const tryNeteaseAudio = async (ses, songId, quality = "standard") => {
  const levelMap = { auto: "exhigh", standard: "standard", high: "higher", lossless: "lossless" };
  const level = levelMap[quality] || "exhigh";

  // Step 1: Try proxy API (same source as search/lyrics)
  try {
    const proxyResult = await ses.fetch(
      `${NET_PROXY}/song/url/v1?id=${encodeURIComponent(songId)}&level=${encodeURIComponent(level)}`,
      { headers: { "User-Agent": UA } }
    );
    const proxyData = await proxyResult.json();
    if (proxyData.code === 200 && proxyData.data?.[0]?.url) {
      return { url: proxyData.data[0].url, source: "netease-proxy", quality: proxyData.data[0].level || level };
    }
  } catch (e) {
    console.warn("[netease] Proxy audio failed, trying direct:", e.message);
  }

  // Step 2: Try direct Netease API
  try {
    const result = await ses.fetch(
      "https://music.163.com/api/song/enhance/player/url/v1",
      {
        method: "POST",
        headers: {
          ...requestHeaders(),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          ids: `[${songId}]`,
          level,
          encodeType: "aac",
        }).toString(),
      }
    );
    const data = await result.json();
    if (data.code === 200 && data.data?.[0]?.url) {
      return { url: data.data[0].url, source: "netease", quality: data.data[0].type || level };
    }
  } catch (e) {
    console.warn("[netease] Direct API failed:", e.message);
  }

  return null;
};

// --- B站 fallback: search for song audio on B站 ---
const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

const fileKey = (url) => new URL(url).pathname.split("/").pop().split(".")[0];
const getMixinKey = (imgKey, subKey) =>
  MIXIN_KEY_ENC_TAB.map((i) => (imgKey + subKey)[i]).join("").slice(0, 32);

const getWbiKey = async (ses) => {
  const nav = await ses.fetch(`${API_BASE}/x/web-interface/nav`, { headers: biliHeaders() });
  const navData = await nav.json();
  const img = navData?.data?.wbi_img;
  if (!img?.img_url || !img?.sub_url) throw new Error("WBI key unavailable");
  return getMixinKey(fileKey(img.img_url), fileKey(img.sub_url));
};

const signWbi = async (ses, params) => {
  const mixinKey = await getWbiKey(ses);
  const signed = new URLSearchParams();
  const values = { ...params, wts: Math.floor(Date.now() / 1000) };
  Object.keys(values).sort().forEach((key) => {
    signed.set(key, String(values[key]).replace(/[!'()*]/g, ""));
  });
  signed.set("w_rid", crypto.createHash("md5").update(signed.toString() + mixinKey).digest("hex"));
  return signed.toString();
};

const searchBiliForAudio = async (ses, keyword) => {
  try {
    const signed = await signWbi(ses, { search_type: "video", keyword, page: 1 });
    const result = await ses.fetch(
      `${API_BASE}/x/web-interface/wbi/search/type?${signed}`,
      { headers: biliHeaders() }
    );
    const data = await result.json();
    if (data.code !== 0 || !data.data?.result?.length) return null;

    const bvid = data.data.result[0].bvid;
    if (!bvid) return null;

    const infoResult = await ses.fetch(
      `${API_BASE}/x/web-interface/view?bvid=${bvid}`,
      { headers: biliHeaders() }
    );
    const infoData = await infoResult.json();
    if (infoData.code !== 0) return null;

    const cid = infoData.data?.pages?.[0]?.cid || infoData.data?.cid;
    if (!cid) return null;

    const playResult = await ses.fetch(
      `${API_BASE}/x/player/playurl?bvid=${bvid}&cid=${cid}&fnval=4048&fourk=1`,
      { headers: biliHeaders() }
    );
    const playData = await playResult.json();
    if (playData.code !== 0) return null;

    const dash = playData.data?.dash;
    if (!dash?.audio?.length) return null;

    const audio = dash.audio.sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0))[0];
    if (!audio?.baseUrl && !audio?.base_url) return null;

    return {
      url: audio.baseUrl || audio.base_url,
      source: "bilibili",
      bvid,
      cid,
      title: infoData.data.title,
      author: infoData.data.owner?.name,
      pic: infoData.data.pic,
    };
  } catch (e) {
    console.warn("B站 fallback search failed:", e.message);
    return null;
  }
};

// Known song ID -> title/artist mapping for B站 fallback
const songMetaCache = new Map();

const setSongMeta = (songId, title, artist) => {
  songMetaCache.set(songId, { title, artist });
};

// Cache resolved audio URLs with TTL to avoid repeated API calls
const audioUrlCache = new Map();
const AUDIO_URL_TTL = 3600000; // 1 hour

// Stream audio with proper Range support
const streamAudio = (ses, request, remoteUrl, source) => {
  const headers = {};
  if (source === "netease") {
    headers["User-Agent"] = UA;
    headers["Referer"] = "https://music.163.com/";
  } else {
    headers["User-Agent"] = UA;
    headers["Referer"] = "https://www.bilibili.com/";
    headers["Origin"] = "https://www.bilibili.com";
  }
  const range = request.headers.get("range");
  if (range) headers["Range"] = range;
  return ses.fetch(remoteUrl, { method: request.method, headers });
};

// --- Custom protocol handler ---
const registerNeteaseProtocol = (ses) => {
  const { protocol } = require("electron");

  protocol.handle("netease-audio", async (request) => {
    try {
      const url = new URL(request.url);
      const songId = url.hostname;
      const quality = url.searchParams.get("quality") || "standard";
      const cacheKey = `${songId}:${quality}`;

      // Check cache first
      const cached = audioUrlCache.get(cacheKey);
      if (cached && Date.now() - cached.time < AUDIO_URL_TTL) {
        return streamAudio(ses, request, cached.url, cached.source);
      }

      // Step 1: Try Netease directly
      const neteaseResult = await tryNeteaseAudio(ses, songId, quality);
      if (neteaseResult?.url) {
        audioUrlCache.set(cacheKey, { url: neteaseResult.url, time: Date.now(), source: "netease" });
        return streamAudio(ses, request, neteaseResult.url, "netease");
      }

      // Step 2: Try B站 fallback
      const meta = songMetaCache.get(songId);
      if (meta) {
        const keyword = `${meta.title} ${meta.artist}`;
        const biliResult = await searchBiliForAudio(ses, keyword);
        if (biliResult?.url) {
          audioUrlCache.set(cacheKey, { url: biliResult.url, time: Date.now(), source: "bilibili" });
          return streamAudio(ses, request, biliResult.url, "bilibili");
        }
      }

      return new Response("No playable audio source available", { status: 404 });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Audio proxy failed";
      console.error("[netease-audio] Error:", msg);
      return new Response(msg, { status: 502 });
    }
  });
};

module.exports = function registerNetease(ipc, ses) {
  registerNeteaseProtocol(ses);

  ipc.handle("netease:audio-url", async (_, songId, quality) => {
    try {
      const neteaseResult = await tryNeteaseAudio(ses, songId, quality);
      if (neteaseResult?.url) {
        return {
          url: `netease-audio://${songId}?quality=${quality || "standard"}`,
          code: 200,
          source: "netease",
        };
      }
      return {
        url: `netease-audio://${songId}?quality=${quality || "standard"}`,
        code: 200,
        source: "pending",
      };
    } catch (error) {
      return { url: null, code: -1, message: error instanceof Error ? error.message : String(error) };
    }
  });

  ipc.handle("netease:set-meta", async (_, songId, title, artist) => {
    setSongMeta(songId, title, artist);
    return true;
  });
};

module.exports._test = { tryNeteaseAudio, searchBiliForAudio, setSongMeta, streamAudio };
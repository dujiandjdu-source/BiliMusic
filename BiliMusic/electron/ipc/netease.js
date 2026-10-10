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

    // Reuse the complete playback query and codec selection from Bilibili imports.
    const audio = await require('./bilibili.js').getPlayableAudio(ses, bvid, cid, 'high');

    return {
      url: audio.remoteUrl,
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
  const key = String(songId || "").trim();
  if (!key) return;
  songMetaCache.set(key, {
    title: String(title || "").trim(),
    artist: String(artist || "").trim(),
  });
};

// Cache resolved audio URLs with TTL to avoid repeated API calls
const audioUrlCache = new Map();
const AUDIO_URL_TTL = 3600000; // 1 hour
const EXPIRED_AUDIO_STATUSES = new Set([401, 403, 404, 410]);

const resolveAudio = async (ses, songId, quality) => {
  const neteaseResult = await tryNeteaseAudio(ses, songId, quality);
  if (neteaseResult?.url) {
    return { url: neteaseResult.url, source: "netease" };
  }

  const meta = songMetaCache.get(String(songId));
  if (!meta) return null;

  const keyword = [meta.title, meta.artist].filter(Boolean).join(" ");
  if (!keyword) return null;
  const biliResult = await searchBiliForAudio(ses, keyword);
  return biliResult?.url
    ? { url: biliResult.url, source: "bilibili" }
    : null;
};

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
const parseAudioSongId = (value) => {
  const url = new URL(value);
  const parts = url.hostname.split('.');
  const legacyId = parts.length === 4 && parts.every(part => /^\d+$/.test(part) && Number(part) <= 255)
    ? String(parts.reduce((result, part) => result * 256 + Number(part), 0)) : url.hostname;
  const songId = url.hostname === 'play' ? decodeURIComponent(url.pathname.slice(1)) : legacyId;
  return /^\d{1,18}$/.test(songId) ? songId : null;
};
const registerNeteaseProtocol = (ses) => {
  const { protocol } = require("electron");

  protocol.handle("netease-audio", async (request) => {
    try {
      const url = new URL(request.url);
      // Standard Chromium schemes normalize a numeric hostname as an IPv4 address.
      // Store IDs in the path; recover old numeric-host URLs for existing libraries.
      const songId = parseAudioSongId(request.url);
      if (!songId) return new Response('Invalid song ID', { status: 400 });
      const quality = url.searchParams.get("quality") || "standard";
      const cacheKey = `${songId}:${quality}`;

      // Check cache first
      const cached = audioUrlCache.get(cacheKey);
      if (cached && Date.now() - cached.time >= AUDIO_URL_TTL) {
        audioUrlCache.delete(cacheKey);
      }

      let resolved = audioUrlCache.get(cacheKey);
      if (!resolved) {
        resolved = await resolveAudio(ses, songId, quality);
        if (!resolved) {
          return new Response("No playable audio source available", { status: 404 });
        }
        resolved = { ...resolved, time: Date.now() };
        audioUrlCache.set(cacheKey, resolved);
      }

      let response = await streamAudio(ses, request, resolved.url, resolved.source);
      if (EXPIRED_AUDIO_STATUSES.has(response.status)) {
        audioUrlCache.delete(cacheKey);
        const refreshed = await resolveAudio(ses, songId, quality);
        if (refreshed) {
          audioUrlCache.set(cacheKey, { ...refreshed, time: Date.now() });
          response = await streamAudio(ses, request, refreshed.url, refreshed.source);
        }
      }
      return response;
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
    return {
      url: `netease-audio://play/${encodeURIComponent(songId)}?quality=${encodeURIComponent(quality || "standard")}`,
      code: 200,
      source: "pending",
    };
  });

  ipc.handle("netease:set-meta", async (_, songId, title, artist) => {
    setSongMeta(songId, title, artist);
    return true;
  });
};

module.exports._test = { tryNeteaseAudio, searchBiliForAudio, setSongMeta, streamAudio, parseAudioSongId };

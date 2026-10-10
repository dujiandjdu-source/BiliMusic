const { protocol } = require("electron");
const crypto = require("crypto");

const API_BASE = "https://api.bilibili.com";
const PASS_BASE = "https://passport.bilibili.com";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];
const cookieStoreReady = new WeakMap();

const requestHeaders = (extra = {}) => ({
  "User-Agent": UA,
  Referer: "https://www.bilibili.com/",
  Origin: "https://www.bilibili.com",
  ...extra,
});

const toError = (error) => ({
  code: -1,
  message: error instanceof Error ? error.message : String(error),
});

const cleanTitle = (value) =>
  String(value || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');

const normalizePic = (value) => {
  if (!value) return "";
  const text = String(value);
  if (text.startsWith("//")) return `https:${text}`;
  if (text.startsWith("http://")) return text.replace("http://", "https://");
  return text;
};

const parseDuration = (value) => {
  if (typeof value === "number") return value;
  const parts = String(value || "")
    .split(":")
    .map((part) => Number(part));
  if (parts.some((part) => Number.isNaN(part))) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
};

const fetchJson = async (ses, url, options = {}) => {
  if (!cookieStoreReady.has(ses)) {
    cookieStoreReady.set(
      ses,
      ses.cookies.get({}).catch(() => []),
    );
  }
  await cookieStoreReady.get(ses);
  const response = await ses.fetch(url, {
    ...options,
    headers: requestHeaders(options.headers),
  });
  if (!response.ok) {
    throw new Error(`Bilibili HTTP ${response.status}`);
  }
  return response.json();
};

const getMixinKey = (imgKey, subKey) =>
  MIXIN_KEY_ENC_TAB.map((index) => (imgKey + subKey)[index])
    .join("")
    .slice(0, 32);

const fileKey = (url) =>
  new URL(url).pathname.split("/").pop().split(".")[0];

const getWbiKey = async (ses) => {
  const nav = await fetchJson(ses, `${API_BASE}/x/web-interface/nav`);
  const img = nav.data?.wbi_img;
  if (!img?.img_url || !img?.sub_url) {
    throw new Error(nav.message || "无法获取 B 站 WBI 密钥");
  }
  return getMixinKey(fileKey(img.img_url), fileKey(img.sub_url));
};

const signWbi = async (ses, params) => {
  const mixinKey = await getWbiKey(ses);
  const signed = new URLSearchParams();
  const values = { ...params, wts: Math.floor(Date.now() / 1000) };

  Object.keys(values)
    .sort()
    .forEach((key) => {
      const value = String(values[key]).replace(/[!'()*]/g, "");
      signed.set(key, value);
    });

  signed.set(
    "w_rid",
    crypto.createHash("md5").update(signed.toString() + mixinKey).digest("hex"),
  );
  return signed.toString();
};

const getLoginStatus = async (ses) => {
  const result = await fetchJson(ses, `${API_BASE}/x/web-interface/nav`);
  const data = result.data;
  if (result.code !== 0 || !data?.isLogin) {
    return { isLogin: false };
  }
  return {
    isLogin: true,
    uname: data.uname,
    mid: String(data.mid),
    face: data.face,
    level: data.level_info?.current_level || 0,
  };
};

const getVideoInfo = async (ses, bvid) => {
  const result = await fetchJson(
    ses,
    `${API_BASE}/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`,
  );
  if (result.code !== 0 || !result.data) {
    throw new Error(result.message || "无法读取视频信息");
  }
  const data = result.data;
  return {
    bvid: data.bvid,
    aid: data.aid,
    title: cleanTitle(data.title),
    pic: normalizePic(data.pic),
    duration: data.duration,
    author: data.owner?.name,
    mid: String(data.owner?.mid || ""),
    pages: (data.pages || []).map((page) => ({
      cid: page.cid,
      page: page.page,
      part: page.part,
      duration: page.duration,
    })),
  };
};

const pickAudioByQuality = (audio, quality = "auto") => {
  const list = audio
    .map((item) => ({
      item,
      bandwidth: item?.bandwidth || 0,
      codec: item?.codecs || "",
    }))
    .sort((a, b) => b.bandwidth - a.bandwidth);

  if (list.length === 0) return null;
  if (quality === "standard") return list[list.length - 1]?.item || null;
  if (quality === "high") {
    const nonFlac = list.filter((entry) => !/flac/i.test(entry.codec));
    return nonFlac[0]?.item || list[0]?.item || null;
  }
  return list[0]?.item || null;
};

const getPlayableAudio = async (ses, bvid, cid, quality = "auto") => {
  let pageCid = cid;
  if (!pageCid) {
    const info = await getVideoInfo(ses, bvid);
    pageCid = info.pages[0]?.cid;
  }
  if (!pageCid) {
    throw new Error("视频没有可播放的分 P");
  }

  const query = new URLSearchParams({
    bvid,
    cid: String(pageCid),
    qn: "80",
    fnver: "0",
    fnval: "4048",
    fourk: "1",
  });
  const result = await fetchJson(
    ses,
    `${API_BASE}/x/player/playurl?${query.toString()}`,
  );
  if (result.code !== 0 || !result.data) {
    throw new Error(result.message || "无法获取视频音频");
  }

  const dash = result.data.dash || {};
  const audio = [
    ...(dash.flac?.audio ? [dash.flac.audio] : []),
    ...(dash.dolby?.audio || []),
    ...(dash.audio || []),
  ].filter(Boolean);
  const best = pickAudioByQuality(audio, quality);
  const remoteUrl =
    best?.baseUrl || best?.base_url || result.data.durl?.[0]?.url;
  if (!remoteUrl) {
    throw new Error("B 站没有返回可用的音轨");
  }

  return {
    remoteUrl,
    cid: pageCid,
    bandwidth: best?.bandwidth || 0,
    codec: best?.codecs || "",
    quality,
  };
};

const stableAudioUrl = (bvid, cid) =>
  `bili-audio://play/${encodeURIComponent(bvid)}?cid=${encodeURIComponent(cid)}`;

const stableAudioUrlWithQuality = (bvid, cid, quality = "auto") =>
  `${stableAudioUrl(bvid, cid)}&quality=${encodeURIComponent(quality)}`;

const getUpVideos = async (ses, mid, page = 1, pageSize = 30) => {
  const signed = await signWbi(ses, {
    mid,
    pn: page,
    ps: pageSize,
    order: "pubdate",
    platform: "web",
    web_location: "1550101",
  });
  let result = await fetchJson(
    ses,
    `${API_BASE}/x/space/wbi/arc/search?${signed}`,
  );
  if (result.code !== 0) {
    const legacy = new URLSearchParams({
      mid,
      pn: String(page),
      ps: String(pageSize),
      order: "pubdate",
    });
    const fallback = await fetchJson(
      ses,
      `${API_BASE}/x/space/arc/search?${legacy.toString()}`,
    ).catch(() => null);
    if (fallback?.code === 0) result = fallback;
  }

  return {
    list: (result.data?.list?.vlist || []).map((item) => ({
      bvid: item.bvid,
      title: cleanTitle(item.title),
      pic: normalizePic(item.pic),
      duration: item.length,
      play: item.play,
      author: item.author,
      mid: String(item.mid || mid),
    })),
    total: result.data?.page?.count || 0,
    code: result.code,
    message: result.message,
  };
};

const searchVideos = async (ses, keyword, page = 1, pageSize = 20) => {
  const params = {
    search_type: "video",
    keyword,
    page,
    page_size: pageSize,
    order: "totalrank",
    duration: 0,
    tids: 0,
  };

  let result = await fetchJson(
    ses,
    `${API_BASE}/x/web-interface/wbi/search/type?${await signWbi(ses, params)}`,
  );

  if (result.code !== 0) {
    const legacy = new URLSearchParams(
      Object.fromEntries(
        Object.entries(params).map(([key, value]) => [key, String(value)]),
      ),
    );
    result = await fetchJson(
      ses,
      `${API_BASE}/x/web-interface/search/type?${legacy.toString()}`,
    );
  }

  return {
    list: (result.data?.result || [])
      .filter((item) => item.bvid)
      .map((item) => ({
        bvid: item.bvid,
        aid: item.aid,
        title: cleanTitle(item.title),
        pic: normalizePic(item.pic),
        duration: parseDuration(item.duration),
        durationText: item.duration,
        play: item.play,
        author: cleanTitle(item.author || item.author_name),
        mid: String(item.mid || item.upic_mid || ""),
        description: cleanTitle(item.description),
        arcurl: item.arcurl,
      })),
    total: result.data?.numResults || 0,
    code: result.code,
    message: result.message,
  };
};

// Cache resolved audio URLs to avoid repeated API calls (3+ HTTP round-trips per request)
// Key: bvid+cid+quality, Value: { remoteUrl, expiry }
const audioUrlCache = new Map();
const AUDIO_URL_CACHE_TTL = 30 * 60 * 1000; // 30 minutes (B站 URLs typically valid ~1 hour)
const EXPIRED_AUDIO_STATUSES = new Set([401, 403, 404, 410]);

const getCacheKey = (bvid, cid, quality) => `${bvid}|${cid || ""}|${quality}`;

const getCachedAudioUrl = (bvid, cid, quality) => {
  const key = getCacheKey(bvid, cid, quality);
  const entry = audioUrlCache.get(key);
  if (entry && Date.now() < entry.expiry) {
    return entry.remoteUrl;
  }
  if (entry) audioUrlCache.delete(key);
  return null;
};

const setCachedAudioUrl = (bvid, cid, quality, remoteUrl) => {
  const key = getCacheKey(bvid, cid, quality);
  audioUrlCache.set(key, { remoteUrl, expiry: Date.now() + AUDIO_URL_CACHE_TTL });
  // Evict oldest entries if cache grows too large
  if (audioUrlCache.size > 200) {
    const firstKey = audioUrlCache.keys().next().value;
    audioUrlCache.delete(firstKey);
  }
};

const registerProtocol = (ses) => {
  protocol.handle("bili-audio", async (request) => {
    try {
      const url = new URL(request.url);
      const bvid = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
      const cid = url.searchParams.get("cid") || undefined;
      const quality = url.searchParams.get("quality") || "auto";
      if (!bvid) {
        return new Response("Missing bvid", { status: 400 });
      }

      // Try cache first to skip 3+ API round-trips
      let remoteUrl = getCachedAudioUrl(bvid, cid, quality);
      if (!remoteUrl) {
        const audio = await getPlayableAudio(ses, bvid, cid, quality);
        remoteUrl = audio.remoteUrl;
        setCachedAudioUrl(bvid, cid, quality, remoteUrl);
      }

      const headers = requestHeaders();
      const range = request.headers.get("range");
      if (range) headers.Range = range;

      let response = await ses.fetch(remoteUrl, {
        method: request.method,
        headers,
      });
      if (EXPIRED_AUDIO_STATUSES.has(response.status)) {
        audioUrlCache.delete(getCacheKey(bvid, cid, quality));
        const refreshed = await getPlayableAudio(ses, bvid, cid, quality);
        remoteUrl = refreshed.remoteUrl;
        setCachedAudioUrl(bvid, cid, quality, remoteUrl);
        response = await ses.fetch(remoteUrl, {
          method: request.method,
          headers,
        });
      }
      return response;
    } catch (error) {
      return new Response(
        error instanceof Error ? error.message : "Bilibili audio failed",
        { status: 502 },
      );
    }
  });
};

module.exports = function registerBilibili(ipc, ses) {
  registerProtocol(ses);

  ipc.handle("bili:login-status", async () => {
    try {
      return await getLoginStatus(ses);
    } catch {
      return { isLogin: false };
    }
  });

  ipc.handle("bili:qrcode", async () => {
    try {
      return await fetchJson(
        ses,
        `${PASS_BASE}/x/passport-login/web/qrcode/generate`,
      );
    } catch (error) {
      return toError(error);
    }
  });

  ipc.handle("bili:qrcode-poll", async (_, key) => {
    try {
      return await fetchJson(
        ses,
        `${PASS_BASE}/x/passport-login/web/qrcode/poll?qrcode_key=${encodeURIComponent(key)}`,
      );
    } catch (error) {
      return toError(error);
    }
  });

  ipc.handle("bili:logout", async () => {
    const cookies = await ses.cookies.get({ domain: ".bilibili.com" });
    await Promise.all(
      cookies.map((cookie) => {
        const domain = cookie.domain.replace(/^\./, "");
        return ses.cookies.remove(`https://${domain}${cookie.path}`, cookie.name);
      }),
    );
    return { success: true };
  });

  ipc.handle("bili:followings", async (_, page = 1, pageSize = 30) => {
    try {
      const login = await getLoginStatus(ses);
      if (!login.isLogin || !login.mid) {
        return { list: [], total: 0, code: -101, message: "账号未登录" };
      }
      const query = new URLSearchParams({
        vmid: login.mid,
        pn: String(page),
        ps: String(pageSize),
        order: "desc",
        order_type: "attention",
      });
      const result = await fetchJson(
        ses,
        `${API_BASE}/x/relation/followings?${query.toString()}`,
      );
      return {
        list: (result.data?.list || []).map((item) => ({
          mid: String(item.mid),
          uname: item.uname,
          face: item.face,
          sign: item.sign,
          videoCount: item.video_count || 0,
        })),
        total: result.data?.total || 0,
        code: result.code,
        message: result.message,
      };
    } catch (error) {
      return { list: [], total: 0, ...toError(error) };
    }
  });

  ipc.handle("bili:search-up", async (_, keyword) => {
    try {
      const signed = await signWbi(ses, {
        search_type: "bili_user",
        keyword,
        page: 1,
      });
      let result = await fetchJson(
        ses,
        `${API_BASE}/x/web-interface/wbi/search/type?${signed}`,
      );
      if (result.code !== 0) {
        const legacy = new URLSearchParams({
          search_type: "bili_user",
          keyword,
          page: "1",
        });
        result = await fetchJson(
          ses,
          `${API_BASE}/x/web-interface/search/type?${legacy.toString()}`,
        );
      }
      return {
        list: (result.data?.result || []).map((item) => ({
          mid: String(item.mid),
          uname: cleanTitle(item.uname),
          face: item.upic,
          sign: item.usign,
          videoCount: item.videos || 0,
          fans: item.fans || 0,
        })),
        total: result.data?.numResults || 0,
        code: result.code,
        message: result.message,
      };
    } catch (error) {
      return { list: [], total: 0, ...toError(error) };
    }
  });

  ipc.handle("bili:search-videos", async (_, keyword, page = 1, pageSize = 20) => {
    try {
      return await searchVideos(ses, keyword, page, pageSize);
    } catch (error) {
      return { list: [], total: 0, ...toError(error) };
    }
  });

  ipc.handle("bili:up-videos", async (_, mid, page = 1, pageSize = 30) => {
    try {
      return await getUpVideos(ses, mid, page, pageSize);
    } catch (error) {
      return { list: [], total: 0, ...toError(error) };
    }
  });

  ipc.handle("bili:video-info", async (_, bvid) => {
    try {
      return await getVideoInfo(ses, bvid);
    } catch {
      return null;
    }
  });

  ipc.handle("bili:audio-url", async (_, bvid, cid, quality = "auto") => {
    try {
      const audio = await getPlayableAudio(ses, bvid, cid, quality);
      setCachedAudioUrl(bvid, audio.cid, quality, audio.remoteUrl);
      return {
        url: stableAudioUrlWithQuality(bvid, audio.cid, quality),
        cid: audio.cid,
        bandwidth: audio.bandwidth,
        codec: audio.codec,
        quality: audio.quality,
      };
    } catch (error) {
      return { url: null, ...toError(error) };
    }
  });
};

module.exports._test = {
  getMixinKey,
  cleanTitle,
  signWbi,
  getVideoInfo,
  getPlayableAudio,
  getUpVideos,
  searchVideos,
};

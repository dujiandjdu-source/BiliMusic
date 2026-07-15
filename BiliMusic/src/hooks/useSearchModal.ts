import { useState, useEffect, useCallback, useRef } from "react";
import { Song } from "../types";
import { NeteaseTrackInfo } from "../services/lyricsService";
import { useQueueSearchProvider } from "./useQueueSearchProvider";
import {
  useNeteaseSearchProvider,
  NeteaseSearchProviderExtended,
} from "./useNeteaseSearchProvider";
import {
  useBilibiliSearchProvider,
  BilibiliSearchProviderExtended,
} from "./useBilibiliSearchProvider";
import { BilibiliVideoInfo } from "../types";
import { extractBvid } from "../services/bilibiliService";

export type SearchSource = "netease" | "album" | "bilibili";
export type SearchResultItem = Song | NeteaseTrackInfo | BilibiliVideoInfo;

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  track: SearchResultItem;
  type: SearchSource;
}

interface UseSearchModalParams {
  queue: Song[];
  currentSong: Song | null;
  isPlaying: boolean;
  isOpen: boolean;
}

export const useSearchModal = ({
  queue,
  currentSong,
  isPlaying,
  isOpen,
}: UseSearchModalParams) => {
  // Search query state
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState<SearchSource>("netease");

  // Navigation State
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Context Menu State
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // Search Providers
  const queueProvider = useQueueSearchProvider({ queue });
  const neteaseProvider = useNeteaseSearchProvider();
  const bilibiliProvider = useBilibiliSearchProvider();

  // Queue search results (real-time)
  const [albumResults, setQueueResults] = useState<{ s: Song; i: number }[]>(
    [],
  );

  // Offset for Netease pagination
  const [neteaseOffset, setNeteaseOffset] = useState(0);
  const [bilibiliOffset, setBilibiliOffset] = useState(0);
  const LIMIT = 30;
  const BILI_LIMIT = 20;

  // Update queue results in real-time
  useEffect(() => {
    if (activeTab === "album") {
      queueProvider.search(query).then((results) => {
        const mappedResults = (results as Song[]).map((s) => {
          const originalIndex = queue.findIndex((qs) => qs.id === s.id);
          return { s, i: originalIndex };
        });
        setQueueResults(mappedResults);
      });
    }
  }, [query, activeTab, queue]);

  // Reset selected index when switching tabs or query changes
  useEffect(() => {
    setSelectedIndex(-1);
  }, [activeTab, query]);

  // Reset context menu when modal closes
  useEffect(() => {
    if (!isOpen) {
      setContextMenu(null);
    }
  }, [isOpen]);

  // --- Search Actions ---

  const performNeteaseSearch = useCallback(async () => {
    if (!query.trim()) return;
    setNeteaseOffset(0);
    setSelectedIndex(-1);
    await neteaseProvider.performSearch(query);
  }, [query, neteaseProvider]);

  const performBilibiliSearch = useCallback(async () => {
    if (!query.trim()) return;
    setBilibiliOffset(0);
    setSelectedIndex(-1);
    await bilibiliProvider.performSearch(query);
  }, [bilibiliProvider, query]);

  const loadMoreNetease = useCallback(async () => {
    if (neteaseProvider.isLoading || !neteaseProvider.hasMore) return;
    const nextOffset = neteaseOffset + LIMIT;
    await neteaseProvider.loadMore(query, nextOffset, LIMIT);
    setNeteaseOffset(nextOffset);
  }, [neteaseProvider, neteaseOffset, query]);

  const loadMoreBilibili = useCallback(async () => {
    if (bilibiliProvider.isLoading || !bilibiliProvider.hasMore) return;
    const nextOffset = bilibiliOffset + BILI_LIMIT;
    await bilibiliProvider.loadMore(query, nextOffset, BILI_LIMIT);
    setBilibiliOffset(nextOffset);
  }, [bilibiliOffset, bilibiliProvider, query]);

  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const { scrollTop, clientHeight, scrollHeight } = e.currentTarget;
      // Load more when within 200px of bottom (was 100px)
      if (scrollHeight - scrollTop - clientHeight > 200) return;

      if (activeTab === "netease") {
        loadMoreNetease();
      } else if (activeTab === "bilibili") {
        loadMoreBilibili();
      }
    },
    [activeTab, loadMoreBilibili, loadMoreNetease],
  );

  // --- Navigation ---

  const scrollToItem = useCallback((index: number) => {
    const el = itemRefs.current[index];
    if (el) {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, []);

  const navigateDown = useCallback(() => {
    const listLength =
      activeTab === "album"
        ? albumResults.length
        : activeTab === "netease"
          ? neteaseProvider.results.length
          : bilibiliProvider.results.length;
    if (listLength === 0) return;

    const next = Math.min(selectedIndex + 1, listLength - 1);
    setSelectedIndex(next);
    scrollToItem(next);
  }, [
    activeTab,
    selectedIndex,
    albumResults.length,
    neteaseProvider.results.length,
    bilibiliProvider.results.length,
    scrollToItem,
  ]);

  const navigateUp = useCallback(() => {
    const prev = Math.max(selectedIndex - 1, 0);
    setSelectedIndex(prev);
    scrollToItem(prev);
  }, [selectedIndex, scrollToItem]);

  const switchTab = useCallback(() => {
    setActiveTab((prev) => {
      if (prev === "netease") return "album";
      if (prev === "album") return "bilibili";
      return "netease";
    });
    setSelectedIndex(-1);
  }, []);

  // --- Context Menu ---

  const openContextMenu = useCallback(
    (e: React.MouseEvent, item: SearchResultItem, type: SearchSource) => {
      e.preventDefault();
      let x = e.clientX;
      let y = e.clientY;

      if (x + 200 > window.innerWidth) x -= 200;
      if (y + 100 > window.innerHeight) y -= 100;

      setContextMenu({
        visible: true,
        x,
        y,
        track: item,
        type,
      });
    },
    [],
  );

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  // --- Now Playing Matcher ---
  const isNowPlaying = useCallback(
    (item: SearchResultItem) => {
      if (!currentSong) return false;
      if ("isNetease" in item && item.isNetease && currentSong.isNetease) {
        return item.neteaseId === currentSong.neteaseId;
      }
      if ("bvid" in item && currentSong.isBilibili) {
        return item.bvid === currentSong.bvid;
      }
      return (
        item.title === currentSong.title &&
        "artist" in item &&
        item.artist === currentSong.artist
      );
    },
    [currentSong],
  );

  const looksLikeBilibiliInput = query.includes("bilibili.com") || !!extractBvid(query);

  // Determine what to show in results area
  const showNeteasePrompt =
    activeTab === "netease" &&
    !neteaseProvider.hasSearched &&
    query.trim().length > 0;

  const showNeteaseEmpty =
    activeTab === "netease" &&
    neteaseProvider.hasSearched &&
    neteaseProvider.results.length === 0 &&
    !neteaseProvider.isLoading;

  const showNeteaseLoading =
    activeTab === "netease" &&
    neteaseProvider.isLoading &&
    neteaseProvider.results.length === 0;

  const showNeteaseInitial =
    activeTab === "netease" &&
    !neteaseProvider.hasSearched &&
    query.trim().length === 0;

  const showBilibiliPrompt =
    activeTab === "bilibili" &&
    !bilibiliProvider.hasSearched &&
    query.trim().length > 0;

  const showBilibiliEmpty =
    activeTab === "bilibili" &&
    bilibiliProvider.hasSearched &&
    bilibiliProvider.results.length === 0 &&
    !bilibiliProvider.isLoading;

  const showBilibiliLoading =
    activeTab === "bilibili" &&
    bilibiliProvider.isLoading &&
    bilibiliProvider.results.length === 0;

  const showBilibiliInitial =
    activeTab === "bilibili" &&
    !bilibiliProvider.hasSearched &&
    query.trim().length === 0;

  return {
    // State
    query,
    setQuery,
    activeTab,
    setActiveTab,
    selectedIndex,
    contextMenu,

    // Providers
    queueProvider,
    neteaseProvider,
    bilibiliProvider,

    // Results
    albumResults,

    // Refs
    itemRefs,

    // Actions
    performNeteaseSearch,
    performBilibiliSearch,
    loadMoreNetease,
    loadMoreBilibili,
    handleScroll,

    // Navigation
    navigateDown,
    navigateUp,
    switchTab,
    scrollToItem,

    // Context Menu
    openContextMenu,
    closeContextMenu,

    // Helpers
    isNowPlaying,

    // Display flags
    showNeteasePrompt,
    showNeteaseEmpty,
    showNeteaseInitial,
    showNeteaseLoading,
    showBilibiliPrompt,
    showBilibiliEmpty,
    showBilibiliInitial,
    showBilibiliLoading,
    looksLikeBilibiliInput,

    // Constants
    LIMIT,
    BILI_LIMIT,
  };
};

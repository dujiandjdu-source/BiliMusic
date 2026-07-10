
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTransition, animated } from "@react-spring/web";
import { AudioQuality, MusicLibrary, Song } from "../types";
import {
  CheckIcon,
  GripIcon,
  PlusIcon,
  QueueIcon,
  TrashIcon,
  SelectAllIcon,
  LikeIcon,
} from "./Icons";
import { useI18n } from "../hooks/useI18n";
import { useKeyboardScope } from "../hooks/useKeyboardScope";
import ImportMusicDialog from "./ImportMusicDialog";

const PANEL_STYLES = `
  .playlist-scrollbar {
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.65) rgba(255, 255, 255, 0.02);
  }
  .playlist-scrollbar::-webkit-scrollbar {
    width: 8px;
  }
  .playlist-scrollbar::-webkit-scrollbar-track {
    background: rgba(255, 255, 255, 0.02);
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.07);
    backdrop-filter: blur(28px);
  }
  .playlist-scrollbar::-webkit-scrollbar-thumb {
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.75), rgba(255, 255, 255, 0.5));
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.35);
    backdrop-filter: blur(24px);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.3);
  }
  .playlist-scrollbar::-webkit-scrollbar-thumb:hover {
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.85), rgba(255, 255, 255, 0.72));
  }
  @keyframes eq-bounce {
    0%, 100% { transform: scaleY(0.4); opacity: 0.8; }
    50% { transform: scaleY(1); opacity: 1; }
  }
`;

const ITEM_HEIGHT = 74;
const CARD_HEIGHT = 66;
const OVERSCAN = 5;

interface PlaylistPanelProps {
    isOpen: boolean;
    onClose: () => void;
    queue: Song[];
    currentSongId?: string;
    onPlay: (index: number) => void;
    onImport: (url: string) => Promise<boolean>;
    onReorder: (ids: string[]) => void;
    onRemove: (ids: string[]) => void;
    library: MusicLibrary;
    onToggleLiked: (id: string) => void;
    onToggleFavorite: (id: string) => void;
    onQualityChange: (id: string, quality: AudioQuality) => void;
    accentColor: string;
}

interface PressState {
  id: string;
  song: Song;
  index: number;
  x: number;
  y: number;
  ptr: number;
  timer: number;
  done: () => void;
}

interface DragState {
    id: string;
    song: Song;
    index: number;
    to: number;
    x: number;
    y: number;
    w: number;
    h: number;
    lift: number;
    ptr: number;
}

interface RowState {
    song: Song;
    index: number;
    view: number;
    isGroupHeader?: boolean;
    isSeparator?: boolean;
    groupBvid?: string;
    groupTitle?: string;
    groupArtist?: string;
    groupCover?: string;
    groupChildCount?: number;
    groupFirstSongIndex?: number;
}

type SourceFilter = "all" | "local" | "bilibili" | "remote" | "bili-multi";
type SortMode = "queue" | "title" | "artist";

interface ArtProps {
  src?: string;
  alt: string;
  dim?: boolean;
  eager?: boolean;
}

const HOLD_MS = 220;
const HOLD_SLOP = 10;

const Art = React.memo(({ src, alt, dim = false, eager = false }: ArtProps) => {
  if (!src) {
    return (
      <div className="relative h-11 w-11 flex-shrink-0 overflow-hidden rounded-lg border border-white/5 bg-gray-800 shadow-sm">
        <div className="flex h-full w-full items-center justify-center bg-gray-700 text-[10px] text-white/20">♪</div>
      </div>
    );
  }

  return (
    <div className="relative h-11 w-11 flex-shrink-0 overflow-hidden rounded-lg border border-white/5 bg-gray-800 shadow-sm">
      <img
        src={src}
        alt={alt}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        draggable={false}
        className={`block h-full w-full object-cover transition-opacity duration-300 ${dim ? "opacity-40 blur-[1px]" : ""}`.trim()}
      />
    </div>
  );
});

Art.displayName = "Art";

const sourceAt = (view: number, drag: DragState | null) => {
  if (!drag) {
    return view;
  }

  if (view === drag.to) {
    return drag.index;
  }

  if (drag.index < drag.to && view >= drag.index && view < drag.to) {
    return view + 1;
  }

  if (drag.index > drag.to && view > drag.to && view <= drag.index) {
    return view - 1;
  }

  return view;
};

const move = (list: string[], from: number, to: number) => {
    const next = [...list];
    const [id] = next.splice(from, 1);
    if (!id) {
        return list;
    }
    next.splice(to, 0, id);
    return next;
};

const PlaylistPanel = React.memo(({
    isOpen,
    onClose,
    queue,
    currentSongId,
    onPlay,
    onImport,
    onReorder,
    onRemove,
    library,
    onToggleLiked,
    onToggleFavorite,
    onQualityChange,
    accentColor
}: PlaylistPanelProps) => {
    const { dict } = useI18n();
    const [isAdding, setIsAdding] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [drag, setDrag] = useState<DragState | null>(null);
    const [query, setQuery] = useState("");
    const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
    const [sortMode, setSortMode] = useState<SortMode>("queue");
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

    const panelRef = useRef<HTMLDivElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const ghostRef = useRef<HTMLDivElement>(null);
    const pressRef = useRef<PressState | null>(null);
    const dragRef = useRef<DragState | null>(null);
    const skipRef = useRef(false);
    const [scrollTop, setScrollTop] = useState(0);
    const [listHeight, setListHeight] = useState(0);

    const normalizedQuery = query.trim().toLocaleLowerCase();
    // Detect multi-P groups (B站 videos with same bvid + multiple tracks)
    const multiPartGroups = useMemo(() => {
        const groups = new Map<string, { bvid: string; title: string; artist: string; coverUrl?: string; songs: Song[] }>();
        queue.forEach((song) => {
            if (song.source === "bilibili" && song.bvid) {
                const existing = groups.get(song.bvid);
                if (existing) {
                    existing.songs.push(song);
                } else {
                    // Extract base title (remove " - PartName" suffix)
                    const baseTitle = (song.title || "").replace(/\s*[-–—]\s*[^-–—]+$/, "").trim() || song.title;
                    groups.set(song.bvid, {
                        bvid: song.bvid,
                        title: baseTitle,
                        artist: song.upName || song.artist,
                        coverUrl: song.coverUrl,
                        songs: [song],
                    });
                }
            }
        });
        // Only keep groups with more than 1 song
        const result = new Map<string, typeof groups extends Map<string, infer V> ? V : never>();
        groups.forEach((group, bvid) => {
            if (group.songs.length > 1) result.set(bvid, group);
        });
        return result;
    }, [queue]);

    const visibleQueue = useMemo(() => {
        const rows: Array<{ song?: Song; index: number; isGroupHeader?: boolean; isSeparator?: boolean; groupBvid?: string; groupTitle?: string; groupArtist?: string; groupCover?: string; groupChildCount?: number; groupFirstSongIndex?: number }> = [];

        // ===== PASS 1: Multi-P groups (headers + expanded children) =====
        const addedGroups = new Set<string>();
        const groupSongs: Array<{ song: Song; index: number }> = [];  // children that belong to groups
        const singleSongs: Array<{ song: Song; index: number }> = [];  // standalone songs

        queue.forEach((song, index) => {
            if (song.source === "bilibili" && song.bvid && multiPartGroups.has(song.bvid)) {
                groupSongs.push({ song, index });
            } else {
                // Apply source filter to singles
                if (sourceFilter === "all" || sourceFilter === song.source) {
                    if (!normalizedQuery) {
                        singleSongs.push({ song, index });
                    } else if (`${song.title}\n${song.artist}\n${song.album || ""}`.toLocaleLowerCase().includes(normalizedQuery)) {
                        singleSongs.push({ song, index });
                    }
                }
            }
        });

        // Process groups in order of first appearance
        const groupOrder: Array<{ bvid: string; group: typeof multiPartGroups extends Map<string, infer V> ? V : never }> = [];
        const seenOrder = new Set<string>();
        groupSongs.forEach(({ song }) => {
            if (!seenOrder.has(song.bvid!)) {
                seenOrder.add(song.bvid!);
                const group = multiPartGroups.get(song.bvid!)!;
                groupOrder.push({ bvid: song.bvid!, group });
            }
        });

        // Add groups
        groupOrder.forEach(({ bvid, group }) => {
            const matchesQuery = !normalizedQuery ||
                `${group.title}\n${group.artist}`.toLocaleLowerCase().includes(normalizedQuery) ||
                group.songs.some(s => `${s.title}\n${s.artist}`.toLocaleLowerCase().includes(normalizedQuery));

            if (!matchesQuery) return;
            if (sourceFilter !== "all" && sourceFilter !== "bilibili" && sourceFilter !== "bili-multi") return;

            // Group header
            const _firstSongIdx = queue.findIndex((s) => s.id === group.songs[0]?.id);
            rows.push({
                index: -1, isGroupHeader: true,
                groupBvid: bvid, groupTitle: group.title,
                groupArtist: group.artist, groupCover: group.coverUrl,
                groupChildCount: group.songs.length,
                groupFirstSongIndex: _firstSongIdx,
            });

            // Children (if expanded) + apply query filter
            if (!collapsedGroups.has(bvid)) {
                group.songs.forEach((song) => {
                    const realIdx = queue.findIndex((s) => s.id === song.id);
                    if (!normalizedQuery) { rows.push({ song, index: realIdx }); return; }
                    if (`${song.title}\n${song.artist}`.toLocaleLowerCase().includes(normalizedQuery)) {
                        rows.push({ song, index: realIdx });
                    }
                });
            }
        });

        // ===== Separator =====
        if (rows.length > 0 && singleSongs.length > 0) {
            rows.push({ index: -1, isSeparator: true });
        }

        // ===== PASS 2: Single songs =====
        if (sortMode === "title") {
            singleSongs.sort((a, b) => a.song.title.localeCompare(b.song.title, "zh-CN"));
        } else if (sortMode === "artist") {
            singleSongs.sort((a, b) =>
                a.song.artist.localeCompare(b.song.artist, "zh-CN") ||
                a.song.title.localeCompare(b.song.title, "zh-CN")
            );
        }

        singleSongs.forEach(({ song, index }) => {
            rows.push({ song, index });
        });

        return rows;
    }, [collapsedGroups, multiPartGroups, normalizedQuery, queue, sortMode, sourceFilter]);

    const smartViewActive =
        normalizedQuery.length > 0 || sourceFilter !== "all" || sortMode !== "queue";

    // ESC key support using keyboard scope
    useKeyboardScope(
        (e: KeyboardEvent) => {
            if (e.key === 'Escape' && !isAdding) {
                e.preventDefault();
                onClose();
                return true; // Claim the event
            }
            return false;
        },
        100, // High priority
        isOpen, // Only active when panel is open
    );

    // Handle animation visibility with react-spring
    const transitions = useTransition(isOpen, {
        from: { opacity: 0, transform: 'translateY(20px) scale(0.95)' },
        enter: { opacity: 1, transform: 'translateY(0px) scale(1)' },
        leave: { opacity: 0, transform: 'translateY(20px) scale(0.95)' },
        config: { tension: 280, friction: 24 }, // Rebound feel
        onRest: () => {
            if (!isOpen) {
                setIsEditing(false);
                setSelectedIds(new Set());
            }
        }
    });

    // Scroll to current song when opening
    useEffect(() => {
        if (isOpen && listRef.current) {
            const index = queue.findIndex(s => s.id === currentSongId);
            if (index !== -1) {
                const containerHeight = listRef.current.clientHeight;
                const targetScroll = Math.max(
                    0,
                    (index * ITEM_HEIGHT) - (containerHeight / 2) + (ITEM_HEIGHT / 2),
                );
                listRef.current.scrollTop = targetScroll;
                setScrollTop(targetScroll);
            } else {
                listRef.current.scrollTop = 0;
                setScrollTop(0);
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    // Close on click outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (isOpen && !isAdding && panelRef.current && !panelRef.current.contains(event.target as Node)) {
                onClose();
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen, onClose, isAdding]);

    const handleImport = async (url: string) => {
        const success = await onImport(url);
        if (success) {
            setIsAdding(false);
        }
        return success;
    };

    const toggleSelection = (id: string) => {
        const newSet = new Set(selectedIds);
        if (newSet.has(id)) {
            newSet.delete(id);
        } else {
            newSet.add(id);
        }
        setSelectedIds(newSet);
    };

    const handleDelete = () => {
        onRemove(Array.from(selectedIds));
        setSelectedIds(new Set());
        setIsEditing(false);
    };

    const handleSelectAll = () => {
        const visibleIds = visibleQueue.filter((row) => row.song).map(({ song }) => song!.id);
        const allVisibleSelected =
            visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
        if (allVisibleSelected) {
            const next = new Set(selectedIds);
            visibleIds.forEach((id) => next.delete(id));
            setSelectedIds(next);
        } else {
            setSelectedIds(new Set([...selectedIds, ...visibleIds]));
        }
    };

    useEffect(() => {
        const validIds = new Set(queue.map((song) => song.id));
        setSelectedIds((prev) => {
            const next = new Set([...prev].filter((id) => validIds.has(id)));
            return next.size === prev.size ? prev : next;
        });
    }, [queue]);

    const clearSmartView = () => {
        setQuery("");
        setSourceFilter("all");
        setSortMode("queue");
    };

    useEffect(() => {
        if (!listRef.current) return;
        listRef.current.scrollTop = 0;
        setScrollTop(0);
    }, [normalizedQuery, sortMode, sourceFilter]);

    const cancelPress = useCallback(() => {
        const state = pressRef.current;
        if (!state) {
            return;
        }

        state.done();
        pressRef.current = null;
    }, []);

    const clearDrag = useCallback(() => {
        dragRef.current = null;
        setDrag(null);
        ghostRef.current?.style.removeProperty("--ghost-y");
        document.body.style.userSelect = "";
    }, []);

    useEffect(() => {
        if (!isOpen || isEditing || queue.length < 2 || smartViewActive) {
            cancelPress();
            clearDrag();
        }
    }, [cancelPress, clearDrag, isEditing, isOpen, queue.length, smartViewActive]);

    useEffect(() => {
        return () => {
            cancelPress();
            clearDrag();
        };
    }, [cancelPress, clearDrag]);

    const getIndex = useCallback((y: number, lift: number, h: number) => {
        const list = listRef.current;
        if (!list || queue.length === 0) {
            return 0;
        }

        const rect = list.getBoundingClientRect();
        const raw = y - rect.top + list.scrollTop - lift + (h / 2);
        return Math.max(
            0,
            Math.min(queue.length - 1, Math.floor(raw / ITEM_HEIGHT)),
        );
    }, [queue.length]);

    const syncGhost = useCallback((state: DragState | null) => {
        if (!state || !ghostRef.current) {
            return;
        }

        ghostRef.current.style.setProperty("--ghost-y", `${state.y - state.lift}px`);
    }, []);

    useLayoutEffect(() => {
        syncGhost(drag);
    }, [drag, syncGhost]);

    useLayoutEffect(() => {
        const list = listRef.current;
        if (!list) {
            return;
        }

        const sync = () => {
            setListHeight(list.clientHeight);
        };

        sync();

        if (typeof ResizeObserver === "undefined") {
            return;
        }

        const observer = new ResizeObserver(() => {
            sync();
        });

        observer.observe(list);
        return () => {
            observer.disconnect();
        };
    }, [isOpen]);

    const beginDrag = useCallback((state: PressState, row: HTMLDivElement) => {
        const rect = row.getBoundingClientRect();
        const item: DragState = {
            id: state.id,
            song: state.song,
            index: state.index,
            to: state.index,
            x: rect.left,
            y: state.y,
            w: rect.width,
            h: rect.height,
            lift: state.y - rect.top,
            ptr: state.ptr,
        };

        skipRef.current = true;
        document.body.style.userSelect = "none";
        dragRef.current = { ...item };
        setDrag(item);
    }, []);

    const handlePress = (
        e: React.PointerEvent<HTMLElement>,
        song: Song,
        index: number,
        instant = false,
    ) => {
        if (isEditing || smartViewActive || queue.length < 2 || !listRef.current || pressRef.current || dragRef.current) {
            return;
        }
        if (e.pointerType === "mouse" && e.button !== 0) {
            return;
        }
        if (e.pointerType === "mouse" && !instant) {
            return;
        }

        const row = e.currentTarget instanceof HTMLDivElement
            ? e.currentTarget
            : e.currentTarget.closest("[data-song-row]");
        if (!(row instanceof HTMLDivElement)) {
            return;
        }

        const block = (event: TouchEvent) => {
            event.preventDefault();
        };

        const onMove = (event: PointerEvent) => {
            if (event.pointerId !== state.ptr) {
                return;
            }

            const item = dragRef.current;
            if (!item) {
                if (Math.hypot(event.clientX - state.x, event.clientY - state.y) > HOLD_SLOP) {
                    cancelPress();
                }
                return;
            }

            if (event.cancelable) {
                event.preventDefault();
            }

            const next = {
                ...item,
                y: event.clientY,
                to: getIndex(event.clientY, item.lift, item.h),
            };
            dragRef.current = next;
            syncGhost(next);
            setDrag((prev) => {
                if (!prev || event.pointerId !== prev.ptr || prev.to === next.to) {
                    return prev;
                }
                return {
                    ...prev,
                    y: next.y,
                    to: next.to,
                };
            });
        };

        const onEnd = (event: PointerEvent) => {
            if (event.pointerId !== state.ptr) {
                return;
            }

            const item = dragRef.current;
            cancelPress();
            if (!item) {
                return;
            }

            clearDrag();
            window.setTimeout(() => {
                skipRef.current = false;
            }, 0);

            if (item.to === item.index) {
                return;
            }

            onReorder(move(queue.map((song) => song.id), item.index, item.to));
        };

        const state: PressState = {
            id: song.id,
            song,
            index,
            x: e.clientX,
            y: e.clientY,
            ptr: e.pointerId,
            timer: 0,
            done: () => {
                window.clearTimeout(state.timer);
                window.removeEventListener("pointermove", onMove);
                window.removeEventListener("pointerup", onEnd);
                window.removeEventListener("pointercancel", onEnd);
                window.removeEventListener("touchmove", block);
            },
        };

        const start = () => {
            if (pressRef.current !== state) {
                return;
            }

            window.addEventListener("touchmove", block, { passive: false });
            beginDrag(state, row);
        };

        state.timer = instant ? 0 : window.setTimeout(start, HOLD_MS);

        pressRef.current = state;
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onEnd);
        window.addEventListener("pointercancel", onEnd);
        if (instant) {
            start();
        }
    };

    // Virtual List Logic
    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
        setScrollTop(e.currentTarget.scrollTop);
    };

    const { virtualItems, totalHeight } = useMemo(() => {
        const totalHeight = visibleQueue.length * ITEM_HEIGHT;
        if (visibleQueue.length === 0) {
            return {
                virtualItems: [],
                totalHeight,
            };
        }

        const height = listHeight || 600;

        let startIndex = Math.floor(scrollTop / ITEM_HEIGHT);
        let endIndex = Math.ceil((scrollTop + height) / ITEM_HEIGHT);

        startIndex = Math.max(0, startIndex - OVERSCAN);
        endIndex = Math.min(visibleQueue.length, endIndex + OVERSCAN);

        const virtualItems: RowState[] = [];
        for (let view = startIndex; view < endIndex; view += 1) {
            const row = smartViewActive
                ? visibleQueue[view]
                : visibleQueue[drag ? sourceAt(view, drag) : view];
            if (!row) continue;
            const index = row.index;
            const song = row.song;
            // Include group headers and songs
            virtualItems.push({
                song: song as Song,
                index,
                view,
                ...(row.isGroupHeader ? {
                    isGroupHeader: true,
                    groupBvid: row.groupBvid,
                    groupTitle: row.groupTitle,
                    groupArtist: row.groupArtist,
                    groupCover: row.groupCover,
                    groupChildCount: row.groupChildCount,
                        groupFirstSongIndex: row.groupFirstSongIndex,
                } : {}),
                ...(row.isSeparator ? {
                    isSeparator: true,
                } : {}),
            } as any);
        }

        return {
            virtualItems,
            totalHeight,
        };
    }, [drag, listHeight, scrollTop, smartViewActive, visibleQueue]);

    useEffect(() => {
        if (!drag) {
            return;
        }

        let frame = 0;
        const tick = () => {
            const list = listRef.current;
            const state = dragRef.current;
            if (!list || !state) {
                return;
            }

            const rect = list.getBoundingClientRect();
            const edge = 64;
            let delta = 0;

            if (state.y < rect.top + edge) {
                delta = -Math.ceil(((rect.top + edge) - state.y) / 8);
            } else if (state.y > rect.bottom - edge) {
                delta = Math.ceil((state.y - (rect.bottom - edge)) / 8);
            }

            if (delta !== 0) {
                const top = Math.max(
                    0,
                    Math.min(list.scrollHeight - list.clientHeight, list.scrollTop + delta),
                );

                if (top !== list.scrollTop) {
                    list.scrollTop = top;
                    setScrollTop(top);
                    const next = {
                        ...state,
                        to: getIndex(state.y, state.lift, state.h),
                    };
                    dragRef.current = next;
                    setDrag((prev) => {
                        if (!prev || prev.to === next.to) {
                            return prev;
                        }
                        return {
                            ...prev,
                            y: next.y,
                            to: next.to,
                        };
                    });
                }
            }

            frame = window.requestAnimationFrame(tick);
        };

        frame = window.requestAnimationFrame(tick);
        return () => window.cancelAnimationFrame(frame);
    }, [drag?.id, getIndex]);

    return (
        <>
            <style>{PANEL_STYLES}</style>
            {drag && (
                <div
                    ref={ghostRef}
                    className="pointer-events-none fixed z-[80]"
                    style={{
                        top: 0,
                        left: drag.x,
                        transform: "translate3d(0, var(--ghost-y, 0px), 0)",
                        width: drag.w,
                    }}
                >
                    <div className="flex h-[66px] scale-[1.02] items-center gap-3 rounded-2xl border border-white/10 bg-black/45 px-2 shadow-[0_24px_50px_rgba(0,0,0,0.35)] backdrop-blur-[28px]">
                        <Art src={drag.song.coverUrl} alt={drag.song.title} eager />
                        <div className="flex-1 min-w-0 flex flex-col justify-center gap-0.5">
                            <div
                                className="text-[15px] font-semibold truncate leading-tight"
                                style={{
                                    color: drag.song.id === currentSongId
                                        ? accentColor
                                        : "rgba(255,255,255,0.92)",
                                }}
                            >
                                {drag.song.title}
                            </div>
                            <div className="text-[13px] text-white/50 truncate font-medium">
                                {drag.song.artist}
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {transitions((style, item) => item && (
                <animated.div
                    ref={panelRef}
                    style={{ ...style, maxHeight: '60vh' }}
                    className={`
                        absolute bottom-full right-0 mb-4 z-50
                        w-[390px] max-w-[calc(100vw-24px)]
                        bg-black/10 backdrop-blur-[100px] saturate-150
                        rounded-[32px]
                        shadow-[0_20px_50px_rgba(0,0,0,0.3)]
                        border border-white/5
                        flex flex-col overflow-hidden
                        origin-bottom-right
                    `}
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* iOS 18 Style Header */}
                    <div className="px-5 pt-5 pb-3 shrink-0 flex items-center justify-between bg-transparent border-b border-white/5">
                        <div className="flex flex-col">
                            <h3 className="text-white text-lg font-bold leading-none tracking-tight">{dict.list.playingNext}</h3>
                            <span className="text-white/40 text-xs font-medium mt-1">
                                {smartViewActive
                                    ? `${visibleQueue.length} / ${queue.length} 首`
                                    : dict.list.songs(queue.length)}
                            </span>
                        </div>

                        <div className="flex items-center gap-2">
                            {isEditing ? (
                                <>
                                    <button
                                        onClick={handleSelectAll}
                                        className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${visibleQueue.length > 0 && visibleQueue.filter((row) => row.song).every(({ song }) => selectedIds.has(song!.id)) ? 'text-white bg-white/10' : 'text-white/50 hover:text-white hover:bg-white/10'}`}
                                        title={dict.list.selectAll}
                                    >
                                        <SelectAllIcon className="w-5 h-5" />
                                    </button>
                                    <button
                                        onClick={handleDelete}
                                        className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${selectedIds.size > 0 ? 'text-red-400 hover:bg-red-500/10' : 'text-white/20 cursor-not-allowed'}`}
                                        title={dict.list.deleteSelected}
                                        disabled={selectedIds.size === 0}
                                    >
                                        <TrashIcon className="w-5 h-5" />
                                    </button>
                                    <button
                                        onClick={() => setIsEditing(false)}
                                        className="w-8 h-8 rounded-full flex items-center justify-center transition-all hover:bg-white/10"
                                        style={{ color: accentColor }}
                                        title={dict.list.done}
                                    >
                                        <CheckIcon className="w-5 h-5" />
                                    </button>
                                </>
                            ) : (
                                <>
                                    <button
                                        onClick={() => setIsAdding(true)}
                                        className="w-8 h-8 rounded-full flex items-center justify-center transition-all text-white/50 hover:text-white hover:bg-white/10"
                                        title={dict.list.addFromUrl}
                                    >
                                        <PlusIcon className="w-5 h-5" />
                                    </button>
                                    <button
                                        onClick={() => setIsEditing(true)}
                                        className="w-8 h-8 rounded-full flex items-center justify-center transition-all text-white/50 hover:text-white hover:bg-white/10"
                                        title={dict.list.edit}
                                    >
                                        <QueueIcon className="w-5 h-5" />
                                    </button>
                                </>
                            )}
                        </div>
                    </div>

                    <div className="shrink-0 space-y-2 border-b border-white/5 px-4 py-3">
                        <div className="flex items-center gap-2">
                            <div className="relative min-w-0 flex-1">
                                <input
                                    value={query}
                                    onChange={(event) => setQuery(event.target.value)}
                                    placeholder="搜索歌曲、歌手或专辑"
                                    className="h-9 w-full rounded-xl border border-white/8 bg-white/5 pl-3 pr-8 text-xs text-white outline-none placeholder:text-white/30 focus:border-white/20"
                                />
                                {query && (
                                    <button
                                        onClick={() => setQuery("")}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 text-sm text-white/35 hover:text-white"
                                        aria-label="清除搜索"
                                    >
                                        ×
                                    </button>
                                )}
                            </div>
                            <div className="flex items-center gap-1">
                            {([
                                ["queue", "顺序"],
                                ["title", "歌名"],
                                ["artist", "歌手"],
                            ] as Array<[SortMode, string]>).map(([value, label]) => (
                                <button
                                    key={value}
                                    onClick={() => setSortMode(value)}
                                    className={`rounded-full px-2.5 py-1 text-[11px] transition-colors ${
                                        sortMode === value
                                            ? "bg-white/15 text-white"
                                            : "text-white/40 hover:bg-white/5 hover:text-white/70"
                                    }`}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                            {([
                                ["all", "全部"],
                                ["local", "本地"],
                                ["bilibili", "B站"],
                                ["remote", "在线"],
                                ["bili-multi", "分P"],
                            ] as Array<[SourceFilter, string]>).map(([value, label]) => (
                                <button
                                    key={value}
                                    onClick={() => setSourceFilter(value)}
                                    className={`rounded-full px-2.5 py-1 text-[11px] transition-colors ${
                                        sourceFilter === value
                                            ? "bg-white/15 text-white"
                                            : "text-white/40 hover:bg-white/5 hover:text-white/70"
                                    }`}
                                >
                                    {label}
                                </button>
                            ))}
                            {smartViewActive && (
                                <button
                                    onClick={clearSmartView}
                                    className="ml-auto text-[11px] text-white/35 hover:text-white/70"
                                >
                                    重置
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Scrollable List with Virtualization */}
                    <div
                        ref={listRef}
                        onScroll={handleScroll}
                        className="flex-1 overflow-y-auto playlist-scrollbar px-2 py-2 relative"
                    >
                        {visibleQueue.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-32 text-white/30 space-y-2">
                                <p className="text-xs font-medium">
                                    {queue.length === 0 ? dict.list.empty : "没有匹配的歌曲"}
                                </p>
                            </div>
                        ) : (
                            <div style={{ height: `${totalHeight}px`, position: 'relative' }}>
                                {virtualItems.map((item) => {
                                    const song = item.song;
                                    const index = item.index;
                                    const view = item.view;

                                    // Separator
                                    if (item.isSeparator) {
                                        return (
                                            <div
                                                key="group-separator"
                                                className="mx-3 my-1 border-t border-white/10"
                                                style={{
                                                    position: "absolute",
                                                    top: `${view * ITEM_HEIGHT}px`,
                                                    width: "calc(100% - 24px)",
                                                    height: "24px",
                                                    display: "flex",
                                                    alignItems: "center",
                                                }}
                                            >
                                                <span className="text-[10px] text-white/20 px-2">── 以下为单独歌曲 ──</span>
                                            </div>
                                        );
                                    }

                                    // Group header rendering
                                    if (!song && item.isGroupHeader) {
                                        const isCollapsed = collapsedGroups.has(item.groupBvid!);
                                        return (
                                            <div
                                                key={`group-${item.groupBvid}`}
                                                className="group flex items-center gap-3 px-3 py-2 mx-1 my-0.5 cursor-pointer hover:bg-white/5 rounded-xl transition-colors border border-emerald-500/10 bg-emerald-500/[0.03] active:scale-[0.98]"
                                                style={{
                                                    height: "52px",
                                                    position: "absolute",
                                                    top: `${view * ITEM_HEIGHT}px`,
                                                    width: "calc(100% - 10px)",
                                                }}
                                                onClick={() => { if (isEditing) { const childIds = queue.filter(s => s.bvid === item.groupBvid).map(s => s.id); const ns = new Set(selectedIds); const allSel = childIds.every(id => ns.has(id)); if (allSel) { childIds.forEach(id => ns.delete(id)); } else { childIds.forEach(id => ns.add(id)); } setSelectedIds(ns); return; } setCollapsedGroups((prev) => {
                                                        const next = new Set(prev);
                                                        const bvid = item.groupBvid!;
                                                        if (next.has(bvid)) next.delete(bvid);
                                                        else next.add(bvid);
                                                        return next;
                                                    });
                                                }}
                                            >
                                                <div className="relative h-9 w-9 flex-shrink-0 overflow-hidden rounded-lg border border-emerald-500/20 bg-emerald-900/20">
                                                    {item.groupCover ? (
                                                        <img src={item.groupCover} className="h-full w-full object-cover" alt="" />
                                                    ) : (
                                                        <div className="flex h-full w-full items-center justify-center text-emerald-300/50 text-[10px] font-bold">P</div>
                                                    )}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="text-[13px] font-semibold text-emerald-100/90 truncate">{item.groupTitle}</div>
                                                    <div className="text-[11px] text-white/35">{item.groupArtist} · {item.groupChildCount} 个分P</div>
                                                </div>
                                                <div className="shrink-0 text-white/30 text-xs px-2">
                                                    {isCollapsed ? "▶" : "▼"}
                                                </div>
                                            </div>
                                        );
                                    }

                                    if (!song) return null;

                                    const isCurrent = song.id === currentSongId;
                                    const isSelected = selectedIds.has(song.id);
                                    const isDrag = drag?.id === song.id;
                                    const isLiked = library.likedSongIds.includes(song.id);
                                    const isFavorite = library.favoriteSongIds.includes(song.id);

                                    return (
                                        <div
                                            key={song.id}
                                            data-song-row={song.id}
                                             onPointerDown={(e) => handlePress(e, song, index)}
                                            onContextMenu={(e) => {
                                                if (!isEditing) {
                                                    e.preventDefault();
                                                }
                                            }}
                                            onClick={() => {
                                                if (skipRef.current) {
                                                    return;
                                                }
                                                if (isEditing) toggleSelection(song.id);
                                                else onPlay(index);
                                            }}
                                            className={`
                                     absolute left-0 right-0 h-[66px]
                                     group flex items-center gap-3 p-2 mx-2 rounded-2xl cursor-pointer transition-all duration-200
                                     ${isEditing ? 'hover:bg-white/10' : isCurrent ? 'bg-white/10 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)]' : 'hover:bg-white/5'}
                                     ${isDrag ? 'opacity-0 scale-[0.98]' : ''}
                                 `}
                                            style={{
                                                top: `${view * ITEM_HEIGHT}px`,
                                                height: `${CARD_HEIGHT}px`,
                                                touchAction: isEditing ? 'auto' : 'pan-y',
                                                transition: 'top 180ms ease, opacity 180ms ease, transform 180ms ease',
                                                willChange: 'top, opacity, transform',
                                            }}
                                        >
                                            {/* Edit Mode Checkbox */}
                                            {isEditing && (
                                                <div className={`
                                        w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ml-1
                                        ${isSelected ? 'border-transparent' : 'border-white/20 group-hover:border-white/40'}
                                    `}
                                                    style={{ backgroundColor: isSelected ? accentColor : 'transparent' }}
                                                >
                                                    {isSelected && (
                                                        <CheckIcon className="w-3 h-3 text-white" />
                                                    )}
                                                </div>
                                            )}

                                            {/* Cover & Indicator */}
                                            <div className="relative">
                                                <Art
                                                    src={song.coverUrl}
                                                    alt={song.title}
                                                    dim={isCurrent && !isEditing}
                                                />

                                                {/* Redesigned Now Playing Indicator (Equalizer) */}
                                                {isCurrent && !isEditing && (
                                                    <div className="absolute inset-0 flex items-center justify-center gap-[3px]">
                                                        <div className="w-[3px] bg-current rounded-full animate-[eq-bounce_1s_ease-in-out_infinite]" style={{ height: '12px', color: accentColor }}></div>
                                                        <div className="w-[3px] bg-current rounded-full animate-[eq-bounce_1s_ease-in-out_infinite_0.2s]" style={{ height: '20px', color: accentColor }}></div>
                                                        <div className="w-[3px] bg-current rounded-full animate-[eq-bounce_1s_ease-in-out_infinite_0.4s]" style={{ height: '15px', color: accentColor }}></div>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Text + Actions (hover toggles between layers) */}
                                            <div className="flex-1 min-w-0 relative">
                                                {/* Default: title + artist (fades out on hover) */}
                                                <div className="group-hover:opacity-0 transition-opacity duration-150">
                                                    <div className="flex flex-col justify-center gap-0.5">
                                                        <div className={`text-[15px] font-semibold truncate leading-tight transition-colors duration-300`}
                                                            style={{ color: isCurrent ? accentColor : 'rgba(255,255,255,0.9)' }}>
                                                            {song.title}
                                                        </div>
                                                        <div className="text-[13px] text-white/50 truncate font-medium">
                                                            {song.artist}
                                                        </div>
                                                    </div>
                                                </div>
                                                {/* Hover overlay: 收藏 - 品质 - 删除 - 拖拽 */}
                                                {!isEditing && (
                                                    <div className="absolute inset-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                                                        <button
                                                            type="button"
                                                            title={isFavorite ? "取消收藏" : "收藏"}
                                                            onClick={(e) => {
                                                                e.preventDefault();
                                                                e.stopPropagation();
                                                                onToggleFavorite(song.id);
                                                            }}
                                                            className={`h-7 rounded-lg px-2 text-[11px] transition-colors ${
                                                                isFavorite
                                                                    ? "bg-amber-500/10 text-amber-200"
                                                                    : "text-white/35 hover:bg-white/8 hover:text-amber-100"
                                                            }`}
                                                        >
                                                            收藏
                                                        </button>
                                                        <select
                                                            value={song.audioQuality || "auto"}
                                                            title="歌曲品质"
                                                            onClick={(e) => e.stopPropagation()}
                                                            onPointerDown={(e) => e.stopPropagation()}
                                                            onChange={(event) => {
                                                                event.preventDefault();
                                                                event.stopPropagation();
                                                                onQualityChange(
                                                                    song.id,
                                                                    event.target.value as AudioQuality,
                                                                );
                                                            }}
                                                            className="h-7 rounded-lg border border-white/8 bg-black/35 px-1.5 text-[11px] text-white/55 outline-none hover:text-white"
                                                        >
                                                            <option value="auto">自动</option>
                                                            <option value="lossless">无损</option>
                                                            <option value="high">高品</option>
                                                            <option value="standard">标准</option>
                                                        </select>
                                                        <button
                                                            type="button"
                                                            title="删除"
                                                            onClick={(e) => {
                                                              e.stopPropagation();
                                                              onRemove([song.id]);
                                                            }}
                                                            className="shrink-0 flex h-7 w-7 items-center justify-center rounded-full text-white/30 hover:text-red-300 hover:bg-white/5 transition-all duration-200"
                                                        >
                                                          <svg className="w-3.5 h-3.5" viewBox="0 0 12 12" fill="none"><path d="M2 3h8M4.5 3V2.5a.5.5 0 01.5-.5h2a.5.5 0 01.5.5V3M5 5.5v3M7 5.5v3M2.5 3l.7 6.3a.5.5 0 00.5.45h4.6a.5.5 0 00.5-.45L9.5 3" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                                        </button>

                                                    </div>
                                                )}
                                            </div>
                                            {/* Like button - always visible, outside hover container */}
                                            {!isEditing && (
                                                <button
                                                    type="button"
                                                    title={isLiked ? "取消喜欢" : "喜欢"}
                                                    onClick={(e) => {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        onToggleLiked(song.id);
                                                    }}
                                                    className={`shrink-0 flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${
                                                        isLiked
                                                            ? "text-pink-300 bg-pink-500/10"
                                                            : "text-white/30 hover:bg-white/8 hover:text-pink-200"
                                                    }`}
                                                >
                                                    <LikeIcon className="h-4 w-4" filled={isLiked} />
                                                </button>
                                            )}
                                            {/* Drag handle - far right */}
                                            {!isEditing && !smartViewActive && (
                                                <button
                                                    type="button"
                                                    title={dict.list.drag}
                                                    aria-label={dict.list.reorder(song.title)}
                                                    onPointerDown={(e) => {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        handlePress(e, song, index, true);
                                                    }}
                                                    onClick={(e) => {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                    }}
                                                    className="shrink-0 flex h-7 w-7 items-center justify-center rounded-lg text-white/15 group-hover:text-white/45 hover:text-white/70 hover:bg-white/8 transition-all duration-200 ml-0.5"
                                                    style={{ cursor: isDrag ? 'grabbing' : 'grab' }}
                                                >
                                                    <GripIcon className="w-3.5 h-3.5" />
                                                </button>
                                            )}
                                         </div>
                                     );
                                 })}
                            </div>
                        )}
                    </div>

                </animated.div>
            ))}

            {/* Import Music Dialog */}
            <ImportMusicDialog
                isOpen={isAdding}
                onClose={() => setIsAdding(false)}
                onImport={handleImport}
            />
        </>
    );
});

PlaylistPanel.displayName = "PlaylistPanel";

export default PlaylistPanel;
import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { Song } from "../types";
import { normalizeBilibiliCollections } from "../services/songMetadata";

/** Keep consecutive async imports on the same authoritative queue snapshot. */
export const useQueueState = () => {
  const [queue, publishQueue] = useState<Song[]>([]);
  const queueRef = useRef<Song[]>([]);
  const setQueue: Dispatch<SetStateAction<Song[]>> = useCallback((update) => {
    const next = normalizeBilibiliCollections(typeof update === "function" ? update(queueRef.current) : update);
    if (next === queueRef.current) return;
    queueRef.current = next;
    publishQueue(next);
  }, []);
  return { queue, queueRef, setQueue };
};

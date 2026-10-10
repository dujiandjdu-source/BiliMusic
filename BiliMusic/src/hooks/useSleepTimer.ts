import { useEffect, useRef, useState } from 'react';
import { SleepTimer, type SleepTimerState } from '../services/sleepTimer';

export function useSleepTimer(pause: () => void, songId?: string) {
  const pauseRef = useRef(pause); pauseRef.current = pause;
  const [state, setState] = useState<SleepTimerState>({ mode: 'off' });
  const timerRef = useRef<SleepTimer | null>(null);
  if (!timerRef.current) timerRef.current = new SleepTimer(() => pauseRef.current(), setState);
  const timer = timerRef.current;
  useEffect(() => { timer.songChanged(songId); }, [songId, timer]);
  useEffect(() => () => timer.cancel(), [timer]);
  return { state, timer };
}

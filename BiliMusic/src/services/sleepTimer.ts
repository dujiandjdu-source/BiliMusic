export type SleepTimerState = { mode: 'off' } | { mode: 'deadline'; expiresAt: number } | { mode: 'song'; songId: string };
interface TimerClock {
  now: () => number;
  schedule: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  cancel: (handle: ReturnType<typeof setTimeout>) => void;
}

export class SleepTimer {
  state: SleepTimerState = { mode: 'off' };
  private handle?: ReturnType<typeof setTimeout>;
  constructor(private stop: () => void, private notify: (state: SleepTimerState) => void,
    private clock: TimerClock = { now: () => Date.now(), schedule: (callback, delay) => setTimeout(callback, delay), cancel: (handle) => clearTimeout(handle) }) {}

  cancel = () => {
    if (this.handle !== undefined) this.clock.cancel(this.handle);
    this.handle = undefined;
    this.state = { mode: 'off' };
    this.notify(this.state);
  };
  private finish = () => { this.cancel(); this.stop(); };
  private check = () => {
    if (this.state.mode !== 'deadline') return;
    const remaining = this.state.expiresAt - this.clock.now();
    if (remaining <= 0) this.finish();
    else this.handle = this.clock.schedule(this.check, Math.min(remaining, 60000));
  };
  armMinutes = (minutes: 15 | 30 | 60) => {
    if (![15, 30, 60].includes(minutes)) return;
    this.cancel(); this.state = { mode: 'deadline', expiresAt: this.clock.now() + minutes * 60000 };
    this.notify(this.state); this.check();
  };
  armAfterSong = (songId: string) => {
    if (!songId) return;
    this.cancel(); this.state = { mode: 'song', songId }; this.notify(this.state);
  };
  songChanged = (songId?: string) => {
    if (this.state.mode === 'song' && this.state.songId !== songId) this.cancel();
  };
  consumeEnded = (songId?: string): boolean => {
    if ((this.state.mode === 'song' && this.state.songId === songId) ||
      (this.state.mode === 'deadline' && this.state.expiresAt <= this.clock.now())) {
      this.finish(); return true;
    }
    return false;
  };
}

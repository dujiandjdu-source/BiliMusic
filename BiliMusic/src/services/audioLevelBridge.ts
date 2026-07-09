type Listener = (level: number) => void;

const listeners = new Set<Listener>();

let level = 0;

const clamp = (value: number) => Math.max(0, Math.min(1, value));

export const publishAudioLevel = (value: number) => {
  level = clamp(value);
  listeners.forEach((fn) => fn(level));
};

export const subscribeAudioLevel = (fn: Listener) => {
  listeners.add(fn);
  fn(level);
  return () => listeners.delete(fn);
};

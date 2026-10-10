import { useRef, type PointerEvent } from "react";

/** Capture immediately; an IPC reply must never revive a released pointer. */
export const useWindowDrag = () => {
  const active = useRef<{
    id: number; x: number; y: number; latestX: number; latestY: number;
    position?: [number, number];
  } | null>(null);
  const move = () => {
    const drag = active.current;
    if (!drag?.position) return;
    void window.electronAPI?.win.moveTo(
      drag.position[0] + drag.latestX - drag.x,
      drag.position[1] + drag.latestY - drag.y,
    ).catch(() => { active.current = null; });
  };
  return {
    onPointerDown(event: PointerEvent<HTMLDivElement>) {
      if (event.button !== 0 || !window.electronAPI?.win?.getPosition ||
        (event.target as HTMLElement).closest("button, input, a")) return;
      const drag = { id: event.pointerId, x: event.screenX, y: event.screenY,
        latestX: event.screenX, latestY: event.screenY };
      event.currentTarget.setPointerCapture(event.pointerId);
      active.current = drag;
      void window.electronAPI.win.getPosition().then((position) => {
        if (active.current !== drag) return;
        active.current.position = position;
        move();
      }).catch(() => { if (active.current === drag) active.current = null; });
    },
    onPointerMove(event: PointerEvent<HTMLDivElement>) {
      const drag = active.current;
      if (!drag || drag.id !== event.pointerId) return;
      drag.latestX = event.screenX; drag.latestY = event.screenY;
      move();
    },
    onPointerUp() { active.current = null; },
    onPointerCancel() { active.current = null; },
    onLostPointerCapture() { active.current = null; },
  };
};

import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';

export const SWIPE_THRESHOLD = 72;
const LOCK_DISTANCE = 12;
const EDGE_GUTTER = 24;
type Direction = 'left' | 'right';
type Gesture = { id: number; owner: HTMLElement; pointerType: string; captured: boolean; x: number; y: number; dx: number; axis: 'pending' | 'horizontal' | 'vertical'; moved: boolean };

/** Pointer gestures leave native vertical scrolling/pinch zoom to the browser.
 * No action runs until release, and a drag can never also activate a row click.
 */
export function useSwipe({ onSwipe, disabled = false, rightOnly = false, ignoreInteractive = false }: {
  onSwipe: (direction: Direction) => void; disabled?: boolean; rightOnly?: boolean; ignoreInteractive?: boolean;
}) {
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);
  const [tracking, setTracking] = useState(false);
  const [offset, setOffset] = useState(0);
  function cancel() {
    if (gesture.current?.moved) suppressClick.current = true;
    gesture.current = null; setTracking(false); setOffset(0);
  }
  useEffect(() => {
    if (!tracking) return;
    const otherPointer = (event: globalThis.PointerEvent) => {
      if (gesture.current && event.pointerId !== gesture.current.id) {
        suppressClick.current = true; gesture.current = null; setTracking(false); setOffset(0);
      }
    };
    const blur = () => {
      if (gesture.current?.moved) suppressClick.current = true;
      gesture.current = null; setTracking(false); setOffset(0);
    };
    document.addEventListener('pointerdown', otherPointer, true);
    window.addEventListener('blur', blur);
    return () => { document.removeEventListener('pointerdown', otherPointer, true); window.removeEventListener('blur', blur); };
  }, [tracking]);
  const handlers = {
    onPointerDown(event: PointerEvent<HTMLElement>) {
      if (gesture.current) { cancel(); return; }
      if (!event.isPrimary || event.button !== 0) return;
      suppressClick.current = false;
      // Leave screen-edge swipes to browser navigation. No preventDefault here.
      if (event.clientX < EDGE_GUTTER || event.clientX > window.innerWidth - EDGE_GUTTER) return;
      if (ignoreInteractive && (event.target as Element).closest('button, a, input, select, textarea, [contenteditable="true"]')) return;
      gesture.current = { id: event.pointerId, owner: event.currentTarget, pointerType: event.pointerType, captured: false, x: event.clientX, y: event.clientY, dx: 0, axis: 'pending', moved: false };
      setTracking(true);
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      const current = gesture.current;
      if (!current || current.id !== event.pointerId) return;
      const dx = event.clientX - current.x, dy = event.clientY - current.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) >= LOCK_DISTANCE) current.moved = true;
      if (current.axis === 'pending' && current.moved) {
        if (Math.abs(dx) > Math.abs(dy) * 1.4) current.axis = 'horizontal';
        else if (Math.abs(dy) >= Math.abs(dx) || Math.max(Math.abs(dx), Math.abs(dy)) >= 24) current.axis = 'vertical';
      }
      if (current.axis !== 'horizontal') return;
      current.dx = rightOnly ? Math.max(0, dx) : dx;
      suppressClick.current = true;
      // Keep taps on the original button. Only a deliberate horizontal drag
      // transfers capture to the stationary surface (never the moving text).
      if (!current.captured) {
        try { event.currentTarget.setPointerCapture?.(event.pointerId); current.captured = true; } catch { cancel(); return; }
      }
      // Capture does not disable native scrolling: touch-action still gives
      // vertical pan/pinch to the browser, which can cancel this gesture.
      if (event.cancelable) event.preventDefault();
      setOffset(Math.max(-112, Math.min(112, current.dx)));
    },
    onPointerUp(event: PointerEvent<HTMLElement>) {
      const current = gesture.current;
      if (!current || current.id !== event.pointerId) return;
      const finalDx = event.clientX - current.x, finalDy = event.clientY - current.y;
      const allowedDx = rightOnly ? Math.max(0, finalDx) : finalDx;
      const action = !disabled && current.axis === 'horizontal' && Math.abs(allowedDx) >= SWIPE_THRESHOLD && Math.abs(finalDx) > Math.abs(finalDy) * 1.4
        ? allowedDx > 0 ? 'right' : 'left' : null;
      cancel();
      if (action) onSwipe(action);
    },
    onPointerLeave(event: PointerEvent<HTMLElement>) {
      if (gesture.current?.id === event.pointerId && gesture.current.pointerType === 'mouse' && !event.currentTarget.hasPointerCapture?.(event.pointerId)) cancel();
    },
    onPointerCancel(event: PointerEvent<HTMLElement>) {
      if (gesture.current?.id === event.pointerId) cancel();
    },
    onLostPointerCapture(event: PointerEvent<HTMLElement>) {
      // A descendant's implicit capture transfer bubbles. It is not loss of
      // OUR capture; canceling here made actual touch swipes snap back.
      const current = gesture.current;
      if (current && current.id === event.pointerId && event.target === current.owner) cancel();
    },
    onClickCapture(event: MouseEvent<HTMLElement>) {
      // Keyboard activation (detail=0) remains available even just after a drag.
      if (suppressClick.current && event.detail !== 0) { event.preventDefault(); event.stopPropagation(); }
    },
  };
  return { handlers, offset, tracking, ready: Math.abs(offset) >= SWIPE_THRESHOLD };
}

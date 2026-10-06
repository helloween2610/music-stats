import { useEffect, useRef } from 'react';
import { BackGesture } from '@/lib/swipe-back';

export function useSwipeBack(routeKey: string, onBack: () => void) {
  const callback = useRef(onBack); callback.current = onBack;
  // Keep suppressing the gesture's click even after navigation changes the route.
  const suppressClickUntil = useRef(0);
  useEffect(() => {
    const gesture = new BackGesture();
    const cancel = () => gesture.cancel();
    const start = (event: TouchEvent) => {
      cancel();
      if (event.touches.length !== 1 || document.querySelector('[aria-modal="true"],.zaui-sheet-mask')) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest('.sc,.app-header') || target.closest('input,textarea,select,[contenteditable="true"],[role="slider"],.sheet,[data-swipe-back="off"]')) return;
      for (let node: Element | null = target; node && node !== document.body; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.touchAction === 'none' || (node.scrollWidth > node.clientWidth && /auto|scroll/.test(style.overflowX))) return;
      }
      gesture.begin(event.touches[0].clientX, event.touches[0].clientY);
    };
    const move = (event: TouchEvent) => {
      if (event.touches.length !== 1) return cancel();
      if (gesture.move(event.touches[0].clientX, event.touches[0].clientY)) {
        if (event.cancelable) event.preventDefault();
        suppressClickUntil.current = Date.now() + 500;
      }
    };
    const end = (event: TouchEvent) => {
      if (event.touches.length || document.querySelector('[aria-modal="true"],.zaui-sheet-mask')) return cancel();
      const touch = event.changedTouches[0];
      if (touch && gesture.move(touch.clientX, touch.clientY)) suppressClickUntil.current = Date.now() + 500;
      if (gesture.end()) callback.current();
    };
    const click = (event: MouseEvent) => {
      if (Date.now() < suppressClickUntil.current) { event.preventDefault(); event.stopPropagation(); }
    };
    document.addEventListener('touchstart', start, { passive: true });
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('touchend', end);
    document.addEventListener('touchcancel', cancel);
    document.addEventListener('click', click, true);
    return () => {
      document.removeEventListener('touchstart', start); document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', end); document.removeEventListener('touchcancel', cancel);
      document.removeEventListener('click', click, true);
    };
  }, [routeKey]);
}

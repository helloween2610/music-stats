import { IOS_APP } from '@/config';

// Stats on iPhone intentionally keeps full motion, independently of the system setting.
export function shouldReduceMotion() {
  return !IOS_APP && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

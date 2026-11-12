import { act, render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { AuthRibbon } from '../../src/features/auth/AuthRibbon';

it('preserves source morph timings and pauses with offscreen, visibility and motion preferences', () => {
  const media = new EventTarget();
  let reduced = false;
  Object.defineProperty(media, 'matches', { get: () => reduced });
  const removeMedia = vi.spyOn(media, 'removeEventListener');
  vi.stubGlobal('matchMedia', () => media);
  let visibility: DocumentVisibilityState = 'visible';
  const visibilitySpy = vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  let intersect: IntersectionObserverCallback = () => {};
  const disconnect = vi.fn(); const observe = vi.fn();
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { intersect = callback; }
    observe = observe;
    disconnect = disconnect;
  });
  const pause = vi.fn(); const resume = vi.fn();
  Object.defineProperty(SVGSVGElement.prototype, 'pauseAnimations', { configurable: true, value: pause });
  Object.defineProperty(SVGSVGElement.prototype, 'unpauseAnimations', { configurable: true, value: resume });
  const removeVisibility = vi.spyOn(document, 'removeEventListener');
  const { container, unmount } = render(<AuthRibbon />);
  expect([...container.querySelectorAll('animate')].map((el) => el.getAttribute('dur'))).toEqual(['12s', '9s', '11s', '6.5s']);
  expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
  expect(container.querySelectorAll('button, a, [tabindex]')).toHaveLength(0);
  expect(observe).toHaveBeenCalledOnce(); expect(resume).toHaveBeenCalled();
  act(() => intersect([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver));
  expect(container.firstElementChild?.className).toContain('--paused'); expect(pause).toHaveBeenCalled();
  act(() => intersect([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
  expect(container.firstElementChild?.className).not.toContain('--paused');
  act(() => { visibility = 'hidden'; document.dispatchEvent(new Event('visibilitychange')); });
  expect(container.firstElementChild?.className).toContain('--paused');
  act(() => { reduced = true; media.dispatchEvent(new Event('change')); });
  expect(container.querySelectorAll('animate')).toHaveLength(0);
  act(() => { reduced = false; media.dispatchEvent(new Event('change')); });
  expect(container.querySelectorAll('animate')).toHaveLength(4);
  unmount(); expect(disconnect).toHaveBeenCalledOnce();
  expect(removeMedia).toHaveBeenCalledWith('change', expect.any(Function));
  expect(removeVisibility).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  visibilitySpy.mockRestore(); removeVisibility.mockRestore();
  delete (SVGSVGElement.prototype as Partial<SVGSVGElement>).pauseAnimations;
  delete (SVGSVGElement.prototype as Partial<SVGSVGElement>).unpauseAnimations;
});

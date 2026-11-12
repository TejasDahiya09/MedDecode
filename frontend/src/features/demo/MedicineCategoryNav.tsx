import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { categoryCellWidth, categoryScrollState, categoryScrollTarget } from './catalog-carousel';
import type { CatalogCategory } from './catalog-data';

const categoryPaths: Readonly<Record<string,string>> = {
 tablet: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM6 18 18 6',
 capsule: 'm8 4 12 12M7 3a5 5 0 0 1 7 0l7 7a5 5 0 0 1-7 7l-7-7a5 5 0 0 1 0-7Z',
 syrup: 'M9 2h6v5l3 3v12H6V10l3-3ZM6 13h12M9 17h6',
 ointment: 'M5 3h14l-2 14H7ZM9 17v5h6v-5M8 7h8',
 vitamins: 'M8 2h8v4H8ZM6 6h12v16H6ZM9 14h6m-3-3v6',
 'first-aid': 'M3 7h18v14H3ZM8 7V3h8v4m-4 5v5m-3-2h6',
 'daily-care': 'M12 2s8 9 8 13a8 8 0 0 1-16 0c0-4 8-13 8-13Z',
};

export function MedicineCategoryNav({
  categories,
  selected,
  onSelect,
}: {
  readonly categories: readonly CatalogCategory[];
  readonly selected: string;
  readonly onSelect: (id: string) => void;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const id = useId();
  const [edges, setEdges] = useState({ overflow: false, previous: false, next: false });
  const reveal = useCallback((element: HTMLElement) => {
    const container = rail.current;
    if (!container) return;
    const item = element.getBoundingClientRect();
    const bounds = container.getBoundingClientRect();
    const delta =
      item.left < bounds.left + 2
        ? item.left - bounds.left - 2
        : item.right > bounds.right - 2
          ? item.right - bounds.right + 2
          : 0;
    if (delta) {
      if (typeof container.scrollBy === 'function') container.scrollBy({ left: delta, behavior: 'instant' });
      else container.scrollLeft += delta;
    }
  }, []);
  useEffect(() => {
    const container = rail.current;
    if (!container || !track.current || typeof ResizeObserver === 'undefined') return;
    const content = track.current;
    const geometry = () => {
      const minimum = parseFloat(
        getComputedStyle(container).getPropertyValue('--market-category-min'),
      );
      const gap = parseFloat(getComputedStyle(content).columnGap);
      const natural = content.children.length * (minimum + gap) - gap;
      const fits = natural <= (container.parentElement?.clientWidth ?? 0) - 4 + 1;
      return { minimum, gap, fits };
    };
    const measure = () => {
      const fitsWithoutArrows = geometry().fits;
      const next = fitsWithoutArrows
        ? { overflow: false, previous: false, next: false }
        : categoryScrollState(container.scrollLeft, container.scrollWidth, container.clientWidth);
      setEdges((previous) =>
        previous.overflow === next.overflow &&
        previous.previous === next.previous &&
        previous.next === next.next
          ? previous
          : next,
      );
    };
    const resized = () => {
      const { minimum, gap, fits } = geometry();
      const width = fits ? minimum : categoryCellWidth(container.clientWidth - 4, minimum, gap);
      const value = `${width}px`;
      if (container.style.getPropertyValue('--market-category-cell') !== value)
        container.style.setProperty('--market-category-cell', value);
      const focused = document.activeElement;
      const active =
        focused instanceof HTMLElement && container.contains(focused)
          ? focused
          : container.querySelector<HTMLElement>('[aria-pressed="true"]');
      if (active) reveal(active);
      measure();
    };
    container.addEventListener('scroll', measure, { passive: true });
    const observer = new ResizeObserver(resized);
    observer.observe(container);
    observer.observe(track.current);
    resized();
    return () => {
      container.removeEventListener('scroll', measure);
      observer.disconnect();
    };
  }, [categories, reveal]);
  useEffect(() => {
    const active = rail.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (active) reveal(active);
  }, [selected, categories, reveal]);
  const scroll = (direction: -1 | 1) => {
    const container = rail.current;
    if (!container) return;
    container.scrollTo({
      left: categoryScrollTarget(
        container.scrollLeft,
        container.scrollWidth,
        container.clientWidth,
        direction,
        (track.current?.children[0]?.getBoundingClientRect().width ?? 0) +
          parseFloat(getComputedStyle(track.current ?? container).columnGap),
        parseFloat(getComputedStyle(track.current ?? container).columnGap),
      ),
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth',
    });
  };
  return (
    <nav
      className="cc-market-categories"
      data-overflow={edges.overflow}
      aria-label="Browse medicine categories"
    >
      <button
        className="cc-market-category-arrow cc-market-category-arrow--previous"
        type="button"
        aria-label="Previous categories"
        aria-controls={id}
        hidden={!edges.overflow}
        disabled={!edges.previous}
        onClick={() => scroll(-1)}
      >
        <Icon name="chevron" />
      </button>
      <div
        ref={rail}
        id={id}
        className="cc-market-category-rail"
        role="group"
        aria-label="Categories"
        tabIndex={0}
        onFocusCapture={(event) => {
          if (event.target !== event.currentTarget) reveal(event.target);
        }}
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const options = Array.from(
            event.currentTarget.querySelectorAll<HTMLButtonElement>('[aria-pressed]'),
          );
          const index = options.indexOf(event.target as HTMLButtonElement);
          if (index < 0) {
            if (event.key === 'Home' || event.key === 'End')
              event.currentTarget.scrollTo({
                left: event.key === 'Home' ? 0 : event.currentTarget.scrollWidth,
                behavior: 'instant',
              });
            else scroll(event.key === 'ArrowLeft' ? -1 : 1);
          } else {
            const next =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? options.length - 1
                  : Math.max(
                      0,
                      Math.min(options.length - 1, index + (event.key === 'ArrowLeft' ? -1 : 1)),
                    );
            options[next]?.focus({ preventScroll: true });
            if (options[next]) reveal(options[next]);
          }
        }}
      >
        <div ref={track} className="cc-market-category-track">
          {[{ id: '', name: 'All' }, ...categories].map((category) => (
            <button
              type="button"
              className="cc-market-category-option"
              key={category.id}
              aria-pressed={selected === category.id}
              aria-label={category.name}
              title={category.name}
              onClick={() => onSelect(category.id)}
            >
              <span>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path
                    d={
                      category.id
                        ? (categoryPaths[category.id] ?? 'M4 4h16v16H4ZM8 8h8m-8 4h8m-8 4h5')
                        : 'M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h7v7h-7Z'
                    }
                  />
                </svg>
              </span>
              <span className="cc-market-category-label">{category.name}</span>
            </button>
          ))}
        </div>
      </div>
      <button
        className="cc-market-category-arrow"
        type="button"
        aria-label="Next categories"
        aria-controls={id}
        hidden={!edges.overflow}
        disabled={!edges.next}
        onClick={() => scroll(1)}
      >
        <Icon name="chevron" />
      </button>
    </nav>
  );
}

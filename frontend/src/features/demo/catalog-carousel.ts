export function categoryScrollState(left: number, width: number, viewport: number) {
  const maximum = Math.max(0, width - viewport);
  return { overflow: maximum > 1, previous: left > 1, next: left < maximum - 1 };
}

export function categoryScrollTarget(
  left: number,
  width: number,
  viewport: number,
  direction: -1 | 1,
  stride = 0,
  gap = 0,
) {
  if (stride > 0) {
    const count = Math.max(1, Math.floor((viewport - 4 + gap) / stride + 0.001));
    const index =
      direction === 1 ? Math.floor((left + 1) / stride) : Math.ceil((left - 1) / stride);
    return Math.max(
      0,
      Math.min(Math.max(0, width - viewport), (index + direction * count) * stride),
    );
  }
  return Math.max(0, Math.min(Math.max(0, width - viewport), left + direction * viewport * 0.85));
}

export function categoryCellWidth(available: number, minimum: number, gap: number) {
  const count = Math.max(1, Math.floor((available + gap) / (minimum + gap)));
  return Math.max(minimum, (available - gap * (count - 1)) / count);
}

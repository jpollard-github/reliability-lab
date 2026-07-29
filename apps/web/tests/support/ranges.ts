export function resolvedTestRange(now = Date.now()) {
  return {
    from: new Date(now - 60_000).toISOString(),
    to: new Date(now + 60_000).toISOString(),
  };
}

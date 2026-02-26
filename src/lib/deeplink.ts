interface PendingScroll {
  surah: number;
  ayah: number;
}

let pendingScroll: PendingScroll | null = null;

export function setPendingScroll(surah: number, ayah: number) {
  pendingScroll = { surah, ayah };
}

export function consumePendingScroll(): PendingScroll | null {
  const value = pendingScroll;
  pendingScroll = null;
  return value;
}

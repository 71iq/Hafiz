import { readerContent } from "@/modules/hafiz-reader-content";

export const classicInstalled = () => readerContent.isClassicInstalled();

export async function downloadClassic(progress: (pages: number) => void): Promise<void> {
  // Bound concurrent requests. A failed batch settles before retry, and verified pages stay on disk.
  for (let first = 1; first <= 604; first += 4) {
    const last = Math.min(first + 3, 604);
    const batch = [];
    for (let page = first; page <= last; page++) batch.push(readerContent.downloadClassicPage(page));
    const results = await Promise.allSettled(batch);
    for (const result of results) {
      if (result.status === "rejected") throw result.reason;
    }
    progress(last);
  }
  await readerContent.finishClassicInstall();
}

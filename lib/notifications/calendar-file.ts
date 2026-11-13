/** Web: download the .ics file. Calendar apps open it from the downloads list. */
export async function saveCalendarFile(fileName: string, contents: string): Promise<void> {
  if (typeof document === "undefined") throw new Error("Calendar download needs a browser document");
  const url = URL.createObjectURL(new Blob([contents], { type: "text/calendar;charset=utf-8" }));
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

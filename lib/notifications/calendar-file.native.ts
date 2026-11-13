import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

/** Native: write the .ics file to the cache and open the share sheet, where Calendar can import it. */
export async function saveCalendarFile(fileName: string, contents: string): Promise<void> {
  const file = new File(Paths.cache, fileName);
  file.create({ overwrite: true });
  file.write(contents);
  if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing is not available on this device");
  await Sharing.shareAsync(file.uri, { mimeType: "text/calendar", UTI: "public.calendar-event" });
}

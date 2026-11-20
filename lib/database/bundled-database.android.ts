import { defaultDatabaseDirectory } from "expo-sqlite";
import { readerContent } from "@/modules/hafiz-reader-content";

export const importBundledDatabase = (name: string) => readerContent.seedDatabase(defaultDatabaseDirectory, name);

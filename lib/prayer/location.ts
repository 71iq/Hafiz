import * as Location from "expo-location";
import { roundCoordinate } from "@/lib/prayer/times";

export type Coordinates = Readonly<{ latitude: number; longitude: number }>;

export type DeviceLocationResult =
  | { kind: "ok"; coordinates: Coordinates }
  | { kind: "denied"; canAskAgain: boolean }
  | { kind: "unavailable" };

/**
 * Ask for the device position once, only after the user taps "Use my location". The result is
 * rounded and returned to the caller, which stores it on this device only. Nothing is uploaded.
 */
export async function requestDeviceCoordinates(): Promise<DeviceLocationResult> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) return { kind: "denied", canAskAgain: permission.canAskAgain };
  try {
    const position =
      (await Location.getLastKnownPositionAsync({ maxAge: 6 * 60 * 60 * 1000 })) ??
      (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }));
    return {
      kind: "ok",
      coordinates: {
        latitude: roundCoordinate(position.coords.latitude),
        longitude: roundCoordinate(position.coords.longitude),
      },
    };
  } catch {
    return { kind: "unavailable" };
  }
}

/**
 * Read a typed latitude and longitude. Accepts a comma as the decimal mark and Arabic-Indic digits.
 * Returns null unless both are numbers in range.
 */
export function parseManualCoordinates(latitudeText: string, longitudeText: string): Coordinates | null {
  const latitude = parseCoordinate(latitudeText);
  const longitude = parseCoordinate(longitudeText);
  if (latitude === null || longitude === null) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude: roundCoordinate(latitude), longitude: roundCoordinate(longitude) };
}

function parseCoordinate(text: string): number | null {
  const normalized = text
    .trim()
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace("٫", ".")
    .replace(",", ".")
    .replace("−", "-");
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

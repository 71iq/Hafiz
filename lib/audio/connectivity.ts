import NetInfo from "@react-native-community/netinfo";

/**
 * True only when the device definitely reports no connection. NetInfo reports null before its first
 * probe and some browsers cannot tell, so an unknown state is treated as online and the request runs.
 */
export async function isDefinitelyOffline(): Promise<boolean> {
  try {
    const state = await NetInfo.fetch();
    return state.isConnected === false;
  } catch {
    return false;
  }
}

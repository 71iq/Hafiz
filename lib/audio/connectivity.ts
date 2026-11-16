import NetInfo from "@react-native-community/netinfo";

export async function isDefinitelyOffline(): Promise<boolean> {
  try {
    const state = await NetInfo.fetch();
    return state.isConnected === false;
  } catch {
    return false;
  }
}

/**
 * Android system navigation buttons follow the resolved theme (NavigationBarTheme.android.tsx). Web
 * and iOS have no such bar, so they render nothing and never load the Android module.
 */
export function NavigationBarTheme() {
  return null;
}

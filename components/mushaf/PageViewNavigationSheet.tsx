import { ChevronDown, MoveHorizontal, MoveVertical } from "lucide-react-native";
import { DropdownMenu, type DropdownMenuItem } from "@/components/ui/DropdownMenu";
import type { UIStrings } from "@/lib/i18n/strings";
import { useStrings } from "@/lib/i18n/useStrings";
import { useSettings, type PageScroll } from "@/lib/settings/context";

export function pageLayoutMenuItems(
  s: Pick<UIStrings, "pageScrollVertical" | "pageScrollHorizontal" | "pageLayoutGroup">,
  pageScroll: PageScroll,
  setPageScroll: (value: PageScroll) => void,
): DropdownMenuItem[] {
  return [
    {
      key: "page-layout-vertical",
      label: s.pageScrollVertical,
      group: s.pageLayoutGroup,
      checked: pageScroll === "vertical",
      icon: (color) => <MoveVertical size={17} color={color} />,
      onPress: () => setPageScroll("vertical"),
    },
    {
      key: "page-layout-horizontal",
      label: s.pageScrollHorizontal,
      group: s.pageLayoutGroup,
      checked: pageScroll === "horizontal",
      icon: (color) => <MoveHorizontal size={17} color={color} />,
      onPress: () => setPageScroll("horizontal"),
    },
  ];
}

export function PageLayoutMenu() {
  const s = useStrings();
  const { pageScroll, setPageScroll, isRTL } = useSettings();
  return (
    <DropdownMenu
      triggerLabel={s.pageLayoutGroup}
      items={pageLayoutMenuItems(s, pageScroll, setPageScroll)}
      align={isRTL ? "end" : "start"}
      width={240}
      className="h-11 w-11 bg-surface-high dark:bg-surface-dark-high"
      triggerIcon={(color) => <ChevronDown size={17} color={color} />}
    />
  );
}

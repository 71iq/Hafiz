import { useEffect, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import {
  AlignJustify,
  BookMarked,
  BookOpen,
  CircleHelp,
  Eye,
  EyeOff,
  Home,
  ListMusic,
  Navigation,
  ScanLine,
  Search,
  SlidersHorizontal,
} from "lucide-react-native";
import { DropdownMenu, type DropdownMenuItem } from "@/components/ui/DropdownMenu";
import { PageLayoutMenu, pageLayoutMenuItems } from "@/components/mushaf/PageViewNavigationSheet";
import { interpolate, useStrings } from "@/lib/i18n/useStrings";
import { useSettings } from "@/lib/settings/context";
import { inverseSurfaceColors } from "@/lib/ui/inverse-surface";
import { TOOLBAR_GAP, TOOLBAR_GUTTER, TOOLBAR_TARGET, usesWideToolbar } from "@/lib/mushaf/reader-toolbar";

const TOOLTIP_LONG_PRESS_MS = 1500;

type Props = {
  viewportWidth: number;
  isPageMode: boolean;
  onToggleMode: () => void;
  onSearch: () => void;
  hideActive: boolean;
  onToggleHide: () => void;
  recitationAvailable: boolean;
  recitationActive: boolean;
  onRecitation: () => void;
  settingsActive: boolean;
  onReadingSettings: () => void;
  onBookmarks: () => void;
  onGoTo: () => void;
  onHome: () => void;
  focusAvailable: boolean;
  onFocus: () => void;
  onHelp: () => void;
};

/**
 * The reader toolbar. Below 768px (or whenever the full toolbar does not fit) it is one row of six
 * 44px targets in order: mode switch, Search, Hide/Show, Recitation, Reading settings, More, with
 * 16px gutters and 4px gaps, wrapping below 316px. More holds Bookmarks, Go to, Home, available
 * Focus, the shortcuts help and, in page mode, the Page layout choices. At wider sizes the mode
 * switch shows its short label, page mode adds a 44px direction chevron, and the other actions get
 * their own targets. Every icon has a localized name, shown as a tooltip on web hover or focus and
 * on native long press.
 */
export function ReaderToolbar({
  viewportWidth,
  isPageMode,
  onToggleMode,
  onSearch,
  hideActive,
  onToggleHide,
  recitationAvailable,
  recitationActive,
  onRecitation,
  settingsActive,
  onReadingSettings,
  onBookmarks,
  onGoTo,
  onHome,
  focusAvailable,
  onFocus,
  onHelp,
}: Props) {
  const s = useStrings();
  const { isDark, isRTL, pageScroll, setPageScroll } = useSettings();
  const [availableWidth, setAvailableWidth] = useState(viewportWidth);
  const iconColor = isDark ? "#a3a3a3" : "#7A634D";
  const activeColor = isDark ? "#2dd4bf" : "#0d9488";

  const wideActionCount = 6 + (recitationAvailable ? 1 : 0) + (focusAvailable ? 1 : 0) + 1;
  const wide = usesWideToolbar(viewportWidth, availableWidth, {
    actionCount: wideActionCount,
    showsDirectionChevron: isPageMode,
  });

  const modeLabel = interpolate(s.readerModeSwitchLabel, {
    current: isPageMode ? s.mushafViewPage : s.mushafViewVerse,
    next: isPageMode ? s.mushafViewVerse : s.mushafViewPage,
  });
  // Verse view hides ayah text; page view toggles the page reveal mode (selected state shows it is on).
  const hideLabel = isPageMode ? s.revealPageMode : hideActive ? s.readerShowAyahText : s.readerHideAyahText;
  const ModeIcon = isPageMode ? BookOpen : AlignJustify;

  const moreItems: DropdownMenuItem[] = [];
  if (!wide) {
    moreItems.push(
      {
        key: "bookmarks",
        label: s.bookmarksTitle,
        icon: (color) => <BookMarked size={17} color={color} />,
        onPress: onBookmarks,
      },
      { key: "goto", label: s.goTo, icon: (color) => <Navigation size={17} color={color} />, onPress: onGoTo },
      { key: "home", label: s.tabHome, icon: (color) => <Home size={17} color={color} />, onPress: onHome },
    );
    if (focusAvailable) {
      moreItems.push({
        key: "focus",
        label: s.enterFocusMode,
        icon: (color) => <ScanLine size={17} color={color} />,
        onPress: onFocus,
      });
    }
  }
  moreItems.push({
    key: "help",
    label: s.readerHelpTitle,
    icon: (color) => <CircleHelp size={17} color={color} />,
    onPress: onHelp,
  });
  if (isPageMode && !wide) moreItems.push(...pageLayoutMenuItems(s, pageScroll, setPageScroll));

  const more = (
    <ToolbarTooltip label={s.readerMore} key="more">
      <DropdownMenu
        triggerLabel={s.readerMore}
        items={moreItems}
        align={isRTL ? "start" : "end"}
        width={260}
        className="h-11 w-11 bg-transparent"
      />
    </ToolbarTooltip>
  );

  const items: ReactNode[] = [];
  if (wide) {
    items.push(
      <ToolbarButton
        key="mode"
        label={modeLabel}
        onPress={onToggleMode}
        wideLabel={isPageMode ? s.readerModeShortPage : s.readerModeShortVerse}
        active
      >
        <ModeIcon size={18} color={activeColor} />
      </ToolbarButton>,
    );
    if (isPageMode) {
      items.push(
        <ToolbarTooltip label={s.pageLayoutGroup} key="layout">
          <PageLayoutMenu />
        </ToolbarTooltip>,
      );
    }
    items.push(
      <ToolbarButton key="home" label={s.tabHome} onPress={onHome}>
        <Home size={18} color={iconColor} />
      </ToolbarButton>,
      <ToolbarButton key="bookmarks" label={s.bookmarksTitle} onPress={onBookmarks}>
        <BookMarked size={18} color={iconColor} />
      </ToolbarButton>,
      <ToolbarButton key="goto" label={s.goTo} onPress={onGoTo}>
        <Navigation size={18} color={iconColor} />
      </ToolbarButton>,
    );
    if (recitationAvailable) {
      items.push(
        <ToolbarButton key="recitation" label={s.recitationToolbar} onPress={onRecitation} active={recitationActive}>
          <ListMusic size={18} color={recitationActive ? activeColor : iconColor} />
        </ToolbarButton>,
      );
    }
    items.push(
      <ToolbarButton key="hide" label={hideLabel} onPress={onToggleHide} active={hideActive} pressed={hideActive}>
        {hideActive ? <EyeOff size={18} color={activeColor} /> : <Eye size={18} color={iconColor} />}
      </ToolbarButton>,
    );
    if (focusAvailable) {
      items.push(
        <ToolbarButton key="focus" label={s.enterFocusMode} onPress={onFocus}>
          <ScanLine size={18} color={iconColor} />
        </ToolbarButton>,
      );
    }
    items.push(
      <ToolbarButton key="search" label={s.readerSearch} onPress={onSearch}>
        <Search size={18} color={iconColor} />
      </ToolbarButton>,
      <ToolbarButton key="settings" label={s.readingSettingsButton} onPress={onReadingSettings} active={settingsActive}>
        <SlidersHorizontal size={18} color={settingsActive ? activeColor : iconColor} />
      </ToolbarButton>,
      more,
    );
  } else {
    items.push(
      <ToolbarButton key="mode" label={modeLabel} onPress={onToggleMode} active>
        <ModeIcon size={18} color={activeColor} />
      </ToolbarButton>,
      <ToolbarButton key="search" label={s.readerSearch} onPress={onSearch}>
        <Search size={18} color={iconColor} />
      </ToolbarButton>,
      <ToolbarButton key="hide" label={hideLabel} onPress={onToggleHide} active={hideActive} pressed={hideActive}>
        {hideActive ? <EyeOff size={18} color={activeColor} /> : <Eye size={18} color={iconColor} />}
      </ToolbarButton>,
    );
    if (recitationAvailable) {
      items.push(
        <ToolbarButton key="recitation" label={s.recitationToolbar} onPress={onRecitation} active={recitationActive}>
          <ListMusic size={18} color={recitationActive ? activeColor : iconColor} />
        </ToolbarButton>,
      );
    }
    items.push(
      <ToolbarButton key="settings" label={s.readingSettingsButton} onPress={onReadingSettings} active={settingsActive}>
        <SlidersHorizontal size={18} color={settingsActive ? activeColor : iconColor} />
      </ToolbarButton>,
      more,
    );
  }

  return (
    <View
      accessibilityRole="toolbar"
      onLayout={(event) => {
        const width = Math.round(event.nativeEvent.layout.width);
        if (width > 0) setAvailableWidth((current) => (current === width ? current : width));
      }}
      style={{
        direction: isRTL ? "rtl" : "ltr",
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "center",
        gap: TOOLBAR_GAP,
        paddingHorizontal: TOOLBAR_GUTTER,
        paddingVertical: 4,
      }}
    >
      {items}
    </View>
  );
}

/** A small label under a toolbar icon on web hover or focus and on native long press. */
function ToolbarTooltip({ label, children }: { label: string; children: ReactNode }) {
  const { isDark } = useSettings();
  const [visible, setVisible] = useState(false);
  const colors = inverseSurfaceColors(isDark);
  const hoverProps =
    Platform.OS === "web"
      ? ({
          onMouseEnter: () => setVisible(true),
          onMouseLeave: () => setVisible(false),
          onFocus: () => setVisible(true),
          onBlur: () => setVisible(false),
        } as Record<string, unknown>)
      : {};
  return (
    <View style={{ position: "relative" }} {...hoverProps}>
      {children}
      {visible ? <TooltipBubble label={label} colors={colors} /> : null}
    </View>
  );
}

function TooltipBubble({ label, colors }: { label: string; colors: ReturnType<typeof inverseSurfaceColors> }) {
  return (
    <View
      pointerEvents="none"
      style={{ position: "absolute", top: TOOLBAR_TARGET + 4, start: -60, end: -60, alignItems: "center", zIndex: 100 }}
    >
      <View
        style={{
          backgroundColor: colors.background,
          borderRadius: 8,
          paddingHorizontal: 8,
          paddingVertical: 4,
          maxWidth: 200,
        }}
      >
        <Text style={{ color: colors.text, fontFamily: "Manrope_600SemiBold", fontSize: 12, textAlign: "center" }}>
          {label}
        </Text>
      </View>
    </View>
  );
}

function ToolbarButton({
  label,
  onPress,
  active = false,
  pressed: togglePressed,
  wideLabel,
  children,
}: {
  label: string;
  onPress: () => void;
  active?: boolean;
  /** Set for toggle buttons, exposed as their pressed state. */
  pressed?: boolean;
  /** The short current-mode label shown beside the icon on the wide toolbar. */
  wideLabel?: string;
  children: ReactNode;
}) {
  const { isDark } = useSettings();
  const [tooltip, setTooltip] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const colors = inverseSurfaceColors(isDark);
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );
  const showBriefly = () => {
    setTooltip(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setTooltip(false), TOOLTIP_LONG_PRESS_MS);
  };
  const webProps =
    Platform.OS === "web"
      ? ({
          onHoverIn: () => setTooltip(true),
          onHoverOut: () => setTooltip(false),
          onFocus: () => setTooltip(true),
          onBlur: () => setTooltip(false),
        } as Record<string, unknown>)
      : { onLongPress: showBriefly, delayLongPress: 400 };
  return (
    <View style={{ position: "relative" }}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={togglePressed !== undefined ? { selected: togglePressed } : undefined}
        {...webProps}
        className={`h-11 flex-row items-center justify-center gap-1.5 rounded-full ${
          active ? "bg-primary-accent/10 dark:bg-primary-bright/10" : ""
        } ${wideLabel ? "px-3" : "w-11"}`}
        style={({ pressed }) => ({ minWidth: TOOLBAR_TARGET, transform: [{ scale: pressed ? 0.96 : 1 }] })}
      >
        {children}
        {wideLabel ? (
          <Text
            className="text-primary-accent dark:text-primary-bright"
            numberOfLines={1}
            style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}
          >
            {wideLabel}
          </Text>
        ) : null}
      </Pressable>
      {tooltip ? <TooltipBubble label={label} colors={colors} /> : null}
    </View>
  );
}

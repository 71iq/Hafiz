// This file is web-only and used to configure the root HTML for every
// web page during static rendering.
// The contents of this function only run in Node.js environments and
// do not have access to the DOM or browser APIs.
export default function Root({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover" />

        <title>Hafiz</title>
        <meta
          name="description"
          content="Hafiz helps you memorize through reflection with Mushaf reading, word study, tafsir, private notes, and review tools."
        />
        <link rel="canonical" href="https://hafizquran.app" />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="Hafiz" />
        <meta property="og:title" content="Hafiz" />
        <meta
          property="og:description"
          content="Memorize through reflection with Mushaf reading, word study, tafsir, private notes, and review tools."
        />
        <meta property="og:url" content="https://hafizquran.app" />
        <meta property="og:image" content="https://hafizquran.app/icon.png?v=2" />
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content="Hafiz" />
        <meta
          name="twitter:description"
          content="Memorize through reflection with Mushaf reading, word study, tafsir, private notes, and review tools."
        />
        <meta name="twitter:image" content="https://hafizquran.app/icon.png?v=2" />

        {/* Favicon / tab icon */}
        <link rel="icon" type="image/png" sizes="48x48" href="/favicon.png?v=2" />
        <link rel="shortcut icon" type="image/png" href="/favicon.png?v=2" />

        {/* PWA / Add-to-Home */}
        <link rel="manifest" href="/manifest.webmanifest" />
        <meta name="theme-color" content="#003638" />
        <meta name="application-name" content="Hafiz" />

        {/* iOS Add-to-Home */}
        <link rel="apple-touch-icon" href="/icon.png?v=2" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="Hafiz" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />

        <script dangerouslySetInnerHTML={{ __html: startupThemeScript }} />

        {/* Allow the document body to overflow by 1px so mobile browsers
            register a scrollable page and collapse their URL bar. #root stays
            clipped to the dynamic viewport (100dvh) so internal lists keep
            working exactly as before. */}
        <style dangerouslySetInnerHTML={{ __html: urlBarHideStyles }} />

        {/* On first load, nudge window scroll so iOS/Android immediately hide
            the URL bar instead of waiting for the user to scroll the body. */}
        <script dangerouslySetInnerHTML={{ __html: urlBarHideScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

const urlBarHideStyles = `
html {
  /* Body needs to be the scroll container, not html — iOS only hides the
     URL bar when a body-level scroll is observed. */
  overflow: hidden;
  height: 100%;
}
body {
  margin: 0;
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(13, 148, 136, 0.55) transparent;
  /* Anchor the visible content to the large viewport and add a sliver of
     extra height so window scroll is always possible. */
  min-height: calc(100dvh + 1px);
  background-color: rgb(var(--color-surface, 255 255 255));
  /* Prefer smooth momentum on iOS so the scroll-to-1px nudge doesn't feel
     sudden. */
  -webkit-overflow-scrolling: touch;
}
#root {
  height: 100dvh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
* {
  scrollbar-width: thin;
  scrollbar-color: rgba(13, 148, 136, 0.55) transparent;
}
*::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
*::-webkit-scrollbar-track {
  background: transparent;
}
*::-webkit-scrollbar-thumb {
  background: rgba(13, 148, 136, 0.45);
  border: 2px solid transparent;
  border-radius: 999px;
  background-clip: padding-box;
}
*::-webkit-scrollbar-thumb:hover {
  background: rgba(13, 148, 136, 0.7);
  border: 2px solid transparent;
  background-clip: padding-box;
}
*::-webkit-scrollbar-corner {
  background: transparent;
}
@media (prefers-color-scheme: dark) {
  * {
    scrollbar-color: rgba(45, 212, 191, 0.55) transparent;
  }
  *::-webkit-scrollbar-thumb {
    background: rgba(45, 212, 191, 0.45);
    border: 2px solid transparent;
    background-clip: padding-box;
  }
  *::-webkit-scrollbar-thumb:hover {
    background: rgba(45, 212, 191, 0.7);
    border: 2px solid transparent;
    background-clip: padding-box;
  }
}`;

const urlBarHideScript = `
(function () {
  var nudge = function () {
    if (window.scrollY < 1) {
      window.scrollTo(0, 1);
    }
  };
  var run = function () {
    nudge();
    // Retry — some mobile browsers ignore the first scroll call before the
    // page is fully settled.
    setTimeout(nudge, 0);
    setTimeout(nudge, 300);
    setTimeout(nudge, 900);
  };
  if (document.readyState === 'complete') {
    run();
  } else {
    window.addEventListener('load', run, { once: true });
  }
  window.addEventListener('orientationchange', function () { setTimeout(nudge, 200); });
})();
`;

const startupThemeScript = `
(function () {
  try {
    var palettes = {
      beige: {
        surface: "#FFF8F1",
        variables: {
          "--color-surface": "255 248 241",
          "--color-surface-low": "249 243 235",
          "--color-surface-mid": "240 235 227",
          "--color-surface-high": "232 225 218",
          "--color-surface-dim": "223 217 209",
          "--color-surface-bright": "255 255 255",
          "--color-surface-dark": "255 248 241",
          "--color-surface-dark-low": "249 243 235",
          "--color-surface-dark-mid": "240 235 227",
          "--color-surface-dark-high": "232 225 218",
          "--color-surface-dark-dim": "223 217 209",
          "--color-surface-dark-bright": "255 255 255"
        }
      },
      white: {
        surface: "#FFFFFF",
        variables: {
          "--color-surface": "255 255 255",
          "--color-surface-low": "248 250 252",
          "--color-surface-mid": "244 244 245",
          "--color-surface-high": "229 231 235",
          "--color-surface-dim": "209 213 219",
          "--color-surface-bright": "255 255 255",
          "--color-surface-dark": "255 255 255",
          "--color-surface-dark-low": "248 250 252",
          "--color-surface-dark-mid": "244 244 245",
          "--color-surface-dark-high": "229 231 235",
          "--color-surface-dark-dim": "209 213 219",
          "--color-surface-dark-bright": "255 255 255"
        }
      },
      dark: {
        surface: "#0A0A0A",
        variables: {
          "--color-surface": "10 10 10",
          "--color-surface-low": "20 20 20",
          "--color-surface-mid": "26 26 26",
          "--color-surface-high": "38 38 38",
          "--color-surface-dim": "15 15 15",
          "--color-surface-bright": "45 45 45",
          "--color-surface-dark": "10 10 10",
          "--color-surface-dark-low": "20 20 20",
          "--color-surface-dark-mid": "26 26 26",
          "--color-surface-dark-high": "38 38 38",
          "--color-surface-dark-dim": "15 15 15",
          "--color-surface-dark-bright": "45 45 45"
        }
      },
      amoled: {
        surface: "#000000",
        variables: {
          "--color-surface": "0 0 0",
          "--color-surface-low": "3 3 3",
          "--color-surface-mid": "8 8 8",
          "--color-surface-high": "15 15 15",
          "--color-surface-dim": "0 0 0",
          "--color-surface-bright": "24 24 24",
          "--color-surface-dark": "0 0 0",
          "--color-surface-dark-low": "3 3 3",
          "--color-surface-dark-mid": "8 8 8",
          "--color-surface-dark-high": "15 15 15",
          "--color-surface-dark-dim": "0 0 0",
          "--color-surface-dark-bright": "24 24 24"
        }
      }
    };
    var isPalette = function (value) {
      return value === "beige" || value === "white" || value === "dark" || value === "amoled";
    };
    var normalizeTheme = function (value) {
      if (value === "light") return "beige";
      if (isPalette(value) || value === "system" || value === "scheduled") return value;
      return null;
    };
    var normalizeTime = function (value) {
      var match = /^(\\d{1,2}):(\\d{2})$/.exec(value || "");
      if (!match) return null;
      var hours = Number(match[1]);
      var minutes = Number(match[2]);
      if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
      return String(hours).padStart(2, "0") + ":" + String(minutes).padStart(2, "0");
    };
    var minuteOfDay = function (time) {
      var parts = time.split(":");
      return Number(parts[0]) * 60 + Number(parts[1]);
    };
    var now = new Date();
    var currentMinute = now.getHours() * 60 + now.getMinutes();
    var systemTheme =
      window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "beige";
    var theme = normalizeTheme(window.localStorage.getItem("hafiz_theme")) || "system";
    var scheduledTheme = window.localStorage.getItem("hafiz_scheduled_theme");
    scheduledTheme = isPalette(scheduledTheme) ? scheduledTheme : "dark";
    var scheduledTime = normalizeTime(window.localStorage.getItem("hafiz_scheduled_switch_time")) || "21:00";
    var effectiveTheme =
      theme === "system"
        ? systemTheme
        : theme === "scheduled"
          ? currentMinute >= minuteOfDay(scheduledTime)
            ? scheduledTheme
            : systemTheme
          : theme;
    var palette = palettes[effectiveTheme] || palettes.beige;
    var root = document.documentElement;
    Object.keys(palette.variables).forEach(function (name) {
      root.style.setProperty(name, palette.variables[name]);
    });
    root.style.backgroundColor = palette.surface;
  } catch (error) {}
})();
`;

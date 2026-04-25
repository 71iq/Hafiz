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
        <meta name="description" content="Quran retention with spaced repetition" />

        {/* Favicon / tab icon */}
        <link rel="icon" type="image/png" href="/logo.png" />
        <link rel="shortcut icon" type="image/png" href="/logo.png" />

        {/* PWA / Add-to-Home */}
        <link rel="manifest" href="/manifest.webmanifest" />
        <meta name="theme-color" content="#003638" />
        <meta name="application-name" content="Hafiz" />

        {/* iOS Add-to-Home */}
        <link rel="apple-touch-icon" href="/logo.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="Hafiz" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />

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
  background-color: #fff;
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
  body { background-color: #000; }
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

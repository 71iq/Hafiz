const QPC_V4_TAJWEED_PUBLIC_PATH = "/fonts/QPC_V4_TAJWEED_WOFF2";

export const QPC_V4_TAJWEED_FONTS = new Proxy({}, {
  get(_target, prop) {
    const page = Number(prop);
    if (!Number.isInteger(page) || page < 1 || page > 604) return undefined;
    return `${QPC_V4_TAJWEED_PUBLIC_PATH}/p${page}.woff2`;
  },
}) as Record<number, string>;

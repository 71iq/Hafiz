const colorVar = (name, fallback) => `rgb(var(${name}, ${fallback}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
    "./lib/**/*.{js,jsx,ts,tsx}",
  ],
  presets: [require("nativewind/preset")],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        manrope: ["Manrope"],
        "manrope-medium": ["Manrope_500Medium"],
        "manrope-semibold": ["Manrope_600SemiBold"],
        "manrope-bold": ["Manrope_700Bold"],
        "noto-serif": ["NotoSerif_400Regular"],
        "noto-serif-medium": ["NotoSerif_500Medium"],
        "noto-serif-bold": ["NotoSerif_700Bold"],
      },
      colors: {
        // === Surface hierarchy (DESIGN.md "The Digital Sanctuary") ===
        surface: {
          DEFAULT: colorVar("--color-surface", "255 248 241"), // base layer
          low: colorVar("--color-surface-low", "249 243 235"), // grouped content
          mid: colorVar("--color-surface-mid", "240 235 227"), // elevated content
          high: colorVar("--color-surface-high", "232 225 218"), // interactive cards
          dim: colorVar("--color-surface-dim", "223 217 209"), // receded backgrounds
          bright: colorVar("--color-surface-bright", "255 255 255"), // most elevated
        },
        // Dark mode surfaces
        "surface-dark": {
          DEFAULT: colorVar("--color-surface-dark", "10 10 10"), // base
          low: colorVar("--color-surface-dark-low", "20 20 20"), // grouped
          mid: colorVar("--color-surface-dark-mid", "26 26 26"), // elevated
          high: colorVar("--color-surface-dark-high", "38 38 38"), // interactive
          dim: colorVar("--color-surface-dark-dim", "15 15 15"), // receded
          bright: colorVar("--color-surface-dark-bright", "45 45 45"), // most elevated
        },
        // === Primary (deep teal) ===
        primary: {
          DEFAULT: "#003638", // deep teal
          soft: "#1B4D4F", // primary-container
          muted: "#0f766e", // teal-700 equivalent
          accent: "#0d9488", // teal-600 — main CTA/interactive
          light: "#14b8a6", // teal-500
          bright: "#2dd4bf", // teal-400 — dark mode accent
          subtle: "#f0fdfa", // teal-50 — lightest bg tint
        },
        // === Secondary (warm gold) ===
        gold: {
          DEFAULT: "#FDDC91", // secondary-container
          light: "#FFF4D9", // lightest
          dark: "#785F22", // on-secondary-container
        },
        // === Text ===
        charcoal: "#2D2D2D", // light mode body text (never pure black)
        // === Legacy scales (for gradations) ===
        warm: {
          50: "#FFF8F1",
          100: "#F9F3EB",
          200: "#E8E1DA",
          300: "#DFD9D1",
          400: "#b9a085",
          500: "#a58a6c",
          600: "#8a7058",
          700: "#6e5a47",
          800: "#5a4a3c",
          900: "#4a3e33",
        },
        teal: {
          50: "#f0fdfa",
          100: "#ccfbf1",
          200: "#99f6e4",
          300: "#5eead4",
          400: "#2dd4bf",
          500: "#14b8a6",
          600: "#0d9488",
          700: "#0f766e",
          800: "#115e59",
          900: "#003638",
          950: "#1B4D4F",
        },
        // === Outline (ghost borders — DESIGN.md 10% opacity only) ===
        outline: {
          DEFAULT: "rgba(223, 217, 209, 0.10)",
          subtle: "rgba(223, 217, 209, 0.05)",
        },
      },
      borderRadius: {
        "2xl": "1rem",
        "3xl": "1.5rem",
        "4xl": "2rem",
      },
      spacing: {
        18: "4.5rem",
        22: "5.5rem",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

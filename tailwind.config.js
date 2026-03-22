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
          DEFAULT: "#FFF8F1", // base layer
          low: "#F9F3EB", // grouped content
          mid: "#F0EBE3", // elevated content
          high: "#E8E1DA", // interactive cards
          dim: "#DFD9D1", // receded backgrounds
          bright: "#FFFFFF", // most elevated
        },
        // Dark mode surfaces
        "surface-dark": {
          DEFAULT: "#0A0A0A", // base
          low: "#141414", // grouped
          mid: "#1A1A1A", // elevated
          high: "#262626", // interactive
          dim: "#0F0F0F", // receded
          bright: "#2D2D2D", // most elevated
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
  plugins: [],
};

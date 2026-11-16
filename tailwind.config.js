const colorVar = (name, fallback) => `rgb(var(${name}, ${fallback}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}", "./lib/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        manrope: ["Manrope_400Regular"],
        "manrope-medium": ["Manrope_500Medium"],
        "manrope-semibold": ["Manrope_600SemiBold"],
        "manrope-bold": ["Manrope_700Bold"],
        "noto-serif": ["NotoSerif_400Regular"],
        "noto-serif-medium": ["NotoSerif_500Medium"],
        "noto-serif-bold": ["NotoSerif_700Bold"],
      },
      colors: {
        surface: {
          DEFAULT: colorVar("--color-surface", "255 255 255"),
          low: colorVar("--color-surface-low", "248 250 252"),
          mid: colorVar("--color-surface-mid", "244 244 245"),
          high: colorVar("--color-surface-high", "229 231 235"),
          dim: colorVar("--color-surface-dim", "209 213 219"),
          bright: colorVar("--color-surface-bright", "255 255 255"),
        },
        "surface-dark": {
          DEFAULT: colorVar("--color-surface-dark", "10 10 10"),
          low: colorVar("--color-surface-dark-low", "20 20 20"),
          mid: colorVar("--color-surface-dark-mid", "26 26 26"),
          high: colorVar("--color-surface-dark-high", "38 38 38"),
          dim: colorVar("--color-surface-dark-dim", "15 15 15"),
          bright: colorVar("--color-surface-dark-bright", "45 45 45"),
        },
        primary: {
          DEFAULT: "#003638",
          soft: "#1B4D4F",
          muted: "#0f766e",
          accent: "#0d9488",
          light: "#14b8a6",
          bright: "#2dd4bf",
          subtle: "#f0fdfa",
        },
        gold: {
          DEFAULT: "#FDDC91",
          light: "#FFF4D9",
          dark: "#785F22",
        },
        charcoal: "#2D2D2D",
        warm: {
          50: colorVar("--color-warm-50", "255 248 241"),
          100: colorVar("--color-warm-100", "249 243 235"),
          200: colorVar("--color-warm-200", "232 225 218"),
          300: colorVar("--color-warm-300", "223 217 209"),
          400: colorVar("--color-warm-400", "133 105 79"),
          500: colorVar("--color-warm-500", "122 99 77"),
          600: colorVar("--color-warm-600", "110 90 71"),
          700: colorVar("--color-warm-700", "110 90 71"),
          800: colorVar("--color-warm-800", "90 74 60"),
          900: colorVar("--color-warm-900", "74 62 51"),
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

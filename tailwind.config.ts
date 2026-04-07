import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
        "gradient-conic":
          "conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))",
      },
      animation: {
        "fade-in":       "fade-in 0.6s ease forwards",
        "slide-up":      "slide-up 0.5s ease forwards",
        "pulse-ring":    "pulse-ring 2s ease-in-out infinite",
        "wave":          "wave 1s ease-in-out infinite",
        "blink":         "blink 1.4s ease-in-out infinite",
        "pulse-dot":     "pulse-dot 2.2s ease-in-out infinite",
        "float-gradient":"float-gradient 16s ease-in-out infinite",
      },
      keyframes: {
        "fade-in":    { from: { opacity: "0" }, to: { opacity: "1" } },
        "slide-up":   { from: { opacity: "0", transform: "translateY(16px)" }, to: { opacity: "1", transform: "translateY(0)" } },
        "pulse-ring": { "0%, 100%": { opacity: "0.4", transform: "scale(1)" }, "50%": { opacity: "0.8", transform: "scale(1.08)" } },
        "wave":       { "0%, 100%": { transform: "scaleY(0.4)" }, "50%": { transform: "scaleY(1.2)" } },
        "blink":      { "0%, 100%": { opacity: "1" }, "50%": { opacity: "0.3" } },
        "pulse-dot":  {
          "0%, 100%": { opacity: "1",   transform: "scale(1)" },
          "50%":       { opacity: "0.4", transform: "scale(0.7)" },
        },
        "float-gradient": {
          "0%, 100%": { transform: "translate(0, 0) scale(1)",          opacity: "0.7" },
          "33%":       { transform: "translate(40px, -28px) scale(1.07)", opacity: "0.45" },
          "66%":       { transform: "translate(-28px, 18px) scale(0.95)", opacity: "0.8" },
        },
      },
    },
  },
  plugins: [],
};
export default config;

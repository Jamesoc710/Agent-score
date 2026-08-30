import type { Config } from "tailwindcss";

// Colours are semantic tokens resolved from CSS custom properties in `app/globals.css`, not
// Tailwind shades. `bg-surface` / `text-ink-muted` mean the same thing in both themes, so dark
// mode is a redefinition of ~40 channels there rather than a `dark:` variant on every class.
//
// `darkMode` stays on Tailwind's default `media` strategy: the theme follows
// `prefers-color-scheme` with no client JavaScript, no localStorage read, and therefore no
// flash of the wrong theme. A manual toggle would need a client component and a blocking
// inline script; the site ships one client component on purpose (see docs/ARCHITECTURE.md).
const token = (name: string) => `rgb(var(--c-${name}) / <alpha-value>)`;

const config: Config = {
  darkMode: "media",
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: token("canvas"),
        surface: {
          DEFAULT: token("surface"),
          2: token("surface-2"),
        },
        line: {
          DEFAULT: token("line"),
          soft: token("line-soft"),
        },
        ink: {
          DEFAULT: token("ink"),
          strong: token("ink-strong"),
          body: token("ink-body"),
          muted: token("ink-muted"),
        },
        accent: {
          DEFAULT: token("accent"),
          hover: token("accent-hover"),
          soft: token("accent-soft"),
        },
        good: {
          DEFAULT: token("good"),
          soft: token("good-soft"),
          ink: token("good-ink"),
          bar: token("bar-good"),
        },
        mid: {
          DEFAULT: token("mid"),
          soft: token("mid-soft"),
          ink: token("mid-ink"),
          bar: token("bar-mid"),
        },
        bad: {
          DEFAULT: token("bad"),
          soft: token("bad-soft"),
          ink: token("bad-ink"),
          bar: token("bar-bad"),
        },
        emphasis: {
          DEFAULT: token("emphasis"),
          line: token("emphasis-line"),
          ink: token("emphasis-ink"),
          body: token("emphasis-body"),
          muted: token("emphasis-muted"),
          link: token("emphasis-link"),
        },
        notice: {
          DEFAULT: token("notice"),
          line: token("notice-line"),
          ink: token("notice-ink"),
          body: token("notice-body"),
          soft: token("notice-soft"),
        },
      },
    },
  },
  plugins: [],
};

export default config;

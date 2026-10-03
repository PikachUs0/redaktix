/** Theme tokens previously inlined in the Tailwind CDN config scripts. */
export default {
  darkMode: "class",
  content: [
    "./index.html",
    "./editor.html",
    "./src/**/*.{js,html}",
  ],
  theme: {
    extend: {
  "colors": {
    "darkbg": "#0B0F19",
    "cardbg": "#111827",
    "elevated": "#172033",
    "surfaceborder": "#1E293B",
    "borderlight": "rgba(255, 255, 255, 0.08)",
    "brandblue": "#2563EB",
    "brandbluehover": "#1D4ED8",
    "brandbluelight": "#3B82F6",
    "emeraldcustom": "#10B981",
    "ambercustom": "#F97316",
    "surface-dim": "#d2d9f4",
    "on-secondary-container": "#00714d",
    "on-tertiary-fixed-variant": "#653e00",
    "on-primary-container": "#eeefff",
    "surface-container-low": "#f2f3ff",
    "secondary-container": "#6cf8bb",
    "on-error": "#ffffff",
    "surface-container": "#eaedff",
    "error-container": "#ffdad6",
    "surface": "#faf8ff",
    "on-tertiary-fixed": "#2a1700",
    "on-secondary-fixed-variant": "#005236",
    "surface-container-lowest": "#ffffff",
    "on-surface-variant": "#434655",
    "secondary": "#006c49",
    "inverse-primary": "#b4c5ff",
    "surface-bright": "#faf8ff",
    "on-primary-fixed-variant": "#003ea8",
    "on-surface": "#131b2e",
    "tertiary": "#784b00",
    "tertiary-fixed-dim": "#ffb95f",
    "inverse-surface": "#283044",
    "background": "#faf8ff",
    "tertiary-fixed": "#ffddb8",
    "inverse-on-surface": "#eef0ff",
    "on-background": "#131b2e",
    "error": "#ba1a1a",
    "on-tertiary-container": "#ffeedd",
    "primary-container": "#2563eb",
    "surface-tint": "#0053db",
    "on-tertiary": "#ffffff",
    "primary": "#004ac6",
    "on-secondary-fixed": "#002113",
    "tertiary-container": "#996100",
    "outline-variant": "#c3c6d7",
    "on-primary-fixed": "#00174b",
    "outline": "#737686",
    "on-secondary": "#ffffff",
    "surface-container-high": "#e2e7ff",
    "surface-container-highest": "#dae2fd",
    "on-primary": "#ffffff",
    "secondary-fixed-dim": "#4edea3",
    "primary-fixed": "#dbe1ff",
    "on-error-container": "#93000a",
    "secondary-fixed": "#6ffbbe",
    "primary-fixed-dim": "#b4c5ff",
    "surface-variant": "#dae2fd"
  },
  "fontFamily": {
    "geist": [
      "Geist",
      "system-ui",
      "sans-serif"
    ],
    "mono": [
      "JetBrains Mono",
      "ui-monospace",
      "monospace"
    ],
    "inter": [
      "Inter",
      "system-ui",
      "sans-serif"
    ],
    "headline-lg": [
      "Geist",
      "system-ui",
      "sans-serif"
    ],
    "label-code": [
      "JetBrains Mono",
      "ui-monospace",
      "monospace"
    ],
    "display-hero": [
      "Geist",
      "system-ui",
      "sans-serif"
    ],
    "display-hero-mobile": [
      "Geist",
      "system-ui",
      "sans-serif"
    ],
    "headline-md": [
      "Geist",
      "system-ui",
      "sans-serif"
    ],
    "body-sm": [
      "Geist",
      "system-ui",
      "sans-serif"
    ],
    "headline-xl-mobile": [
      "Geist",
      "system-ui",
      "sans-serif"
    ],
    "headline-xl": [
      "Geist",
      "system-ui",
      "sans-serif"
    ],
    "label-caps": [
      "Geist",
      "system-ui",
      "sans-serif"
    ],
    "headline-sm": [
      "Geist",
      "system-ui",
      "sans-serif"
    ],
    "body-md": [
      "Geist",
      "system-ui",
      "sans-serif"
    ],
    "body-lg": [
      "Geist",
      "system-ui",
      "sans-serif"
    ]
  },
  "spacing": {
    "container-max": "76rem",
    "gutter-lg": "1.5rem",
    "section-lg": "7.5rem",
    "gutter-xl": "2rem",
    "gutter-md": "1rem",
    "section-sm": "3rem",
    "gutter-sm": "0.5rem",
    "gutter-xs": "0.25rem",
    "section-md": "5rem"
  },
  "borderRadius": {
    "DEFAULT": "0.25rem",
    "lg": "0.5rem",
    "xl": "0.75rem",
    "full": "9999px"
  },
  "fontSize": {
    "headline-lg": [
      "30px",
      {
        "lineHeight": "38px",
        "letterSpacing": "-0.02em",
        "fontWeight": "600"
      }
    ],
    "label-code": [
      "12px",
      {
        "lineHeight": "16px",
        "letterSpacing": "-0.01em",
        "fontWeight": "500"
      }
    ],
    "display-hero": [
      "56px",
      {
        "lineHeight": "64px",
        "letterSpacing": "-0.03em",
        "fontWeight": "600"
      }
    ],
    "display-hero-mobile": [
      "36px",
      {
        "lineHeight": "44px",
        "letterSpacing": "-0.02em",
        "fontWeight": "600"
      }
    ],
    "headline-md": [
      "22px",
      {
        "lineHeight": "30px",
        "letterSpacing": "-0.015em",
        "fontWeight": "600"
      }
    ],
    "body-sm": [
      "13px",
      {
        "lineHeight": "20px",
        "letterSpacing": "0em",
        "fontWeight": "400"
      }
    ],
    "headline-xl-mobile": [
      "28px",
      {
        "lineHeight": "36px",
        "letterSpacing": "-0.02em",
        "fontWeight": "600"
      }
    ],
    "headline-xl": [
      "40px",
      {
        "lineHeight": "48px",
        "letterSpacing": "-0.025em",
        "fontWeight": "600"
      }
    ],
    "label-caps": [
      "11px",
      {
        "lineHeight": "16px",
        "letterSpacing": "0.06em",
        "fontWeight": "600"
      }
    ],
    "headline-sm": [
      "18px",
      {
        "lineHeight": "26px",
        "letterSpacing": "-0.01em",
        "fontWeight": "600"
      }
    ],
    "body-md": [
      "15px",
      {
        "lineHeight": "24px",
        "letterSpacing": "-0.005em",
        "fontWeight": "400"
      }
    ],
    "body-lg": [
      "18px",
      {
        "lineHeight": "28px",
        "letterSpacing": "-0.01em",
        "fontWeight": "400"
      }
    ]
  }
},
  },
};

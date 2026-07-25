// Brand kit for milestone emails. Mirrors the public status page so
// the email and the page feel like the same product - values track
// app/globals.css, which in turn follows the approved web brand
// guidelines (fame-website/docs/brand-guidelines.md).

export const fameTheme = {
  colors: {
    pink: "#ff467c",
    pinkHover: "#e63d6e",
    pinkLight: "#f9d2e3",
    dark: "#292a25",
    cream: "#f8f1eb", // page background
    card: "#ffffff",
    // Warm, matching the page. The cool greys these replaced (#e5e7eb /
    // #6b7280) fight the cream background - web brand guidelines s.9,
    // decisions 3 and 5.
    border: "#e7ded4",
    textMuted: "#6b6470",
    mint: "#cee8e0",
  },
  fontFamily:
    "'Figtree', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  // Used in the email head for clients that support web fonts (Apple
  // Mail, iOS Mail, Gmail web in some cases). Outlook desktop falls
  // back to the system sans-serif via the font stack above.
  figtreeUrl:
    "https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&display=swap",
  logoUrl:
    "https://cdn.prod.website-files.com/65af97212977390aef05af1b/65bcbe23cfb0eb14d2ce0063_logo.svg",
  // PNG export of the same wordmark, hosted on shoots.fame.so/public.
  // Email clients reject SVG (Outlook desktop entirely, Gmail's image
  // proxy intermittently) - PNG renders reliably across all of them.
  // Rendered at 300x177 from the SVG via resvg, intrinsic 100x59.
  // Email <Img> uses this URL with width=47 / height=28 attrs.
  logoPngUrl: "https://shoots.fame.so/fame-logo.png",
  // Square pink "F" icon - used as a fallback / favicon-style mark
  // when the full wordmark might break in restricted email clients.
  logoFIconUrl:
    "https://cdn.prod.website-files.com/65af97212977390aef05af1b/65dbc8c137b6d056d81db0ad_fame-f-icon-square-pink-cream%403x%201.png",
  radius: "12px",
} as const;

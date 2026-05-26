// Brand kit for milestone emails. Mirrors the public status page so
// the email and the page feel like the same product. Source of truth
// for variables in app/globals.css and the page header.

export const fameTheme = {
  colors: {
    pink: "#ff467c",
    pinkHover: "#e63d6e",
    pinkLight: "#f9d2e3",
    dark: "#292a25",
    cream: "#f8f1eb", // page background
    card: "#ffffff",
    border: "#e5e7eb",
    textMuted: "#6b7280",
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
  // Square pink "F" icon - used as a fallback / favicon-style mark
  // when the full wordmark might break in restricted email clients.
  logoFIconUrl:
    "https://cdn.prod.website-files.com/65af97212977390aef05af1b/65dbc8c137b6d056d81db0ad_fame-f-icon-square-pink-cream%403x%201.png",
  radius: "12px",
} as const;

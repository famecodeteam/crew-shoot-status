// Render a React Email JSX tree to the HTML + plain-text Resend needs.
// Wraps @react-email/render so callers don't import it directly - keeps
// our send + template surface clean.

import { render } from "@react-email/render";
import type { ReactElement } from "react";

export type RenderedEmail = {
  html: string;
  text: string;
};

export async function renderEmail(element: ReactElement): Promise<RenderedEmail> {
  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ]);
  return { html, text };
}

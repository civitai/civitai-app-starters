import type { Metadata } from 'next';
import './globals.css';
// Civitai design-system TOKENS. Loaded in the layout so the custom properties
// are present in the SSR HTML on first paint. No cascade-layer ordering is
// involved: `@civitai/theme/styles.css` declares no `@layer` at all. The
// `@layer` line in globals.css ordered the COMPONENT sheet, which this starter
// no longer imports — see below.
//
// The component SHEET (`@civitai/components/styles.css`) is deliberately NOT
// imported. This starter renders the design system through
// `@civitai/components-react`, which since 0.8.0 binds the `<civitai-*>` custom
// elements; those style themselves in shadow DOM off these tokens and never
// read that sheet, so importing it shipped ~32 kB of unused CSS on the critical
// path of the starter that exists for SEO. Add it back (with the
// `@civitai/components` dependency) if you write bare `data-civitai-ui` markup
// — see that package's MARKUP.md. The Svelte starters do exactly that, and
// import it for real.
import '@civitai/theme/styles.css';

export const metadata: Metadata = {
  title: 'Civitai App Starter',
  description: 'Minimal Next.js + Civitai OAuth + orchestrator demo.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-12">
          {children}
        </main>
      </body>
    </html>
  );
}

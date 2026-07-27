import type { Metadata } from 'next';
import './globals.css';
// Civitai design system — tokens + component CSS. Loaded in the layout so the
// styles are present in the SSR HTML on first paint (order-locked by the
// @layer declaration at the top of globals.css).
import '@civitai/theme/styles.css';
import '@civitai/components/styles.css';

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

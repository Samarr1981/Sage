import type { Metadata } from 'next';
import './globals.css';
import { Analytics } from "@vercel/analytics/next"
import { ClerkProvider } from '@clerk/nextjs';

export const metadata: Metadata = {
  title: 'Sage — Adaptive Oral Examiner',
  description: 'AI-powered voice assessment that adapts to your answers in real time.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body>
          {children}
          <Analytics />
        </body>
      </html>
    </ClerkProvider>
  );
}
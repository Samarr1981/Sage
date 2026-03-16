import type { Metadata } from 'next';
import './globals.css';

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
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
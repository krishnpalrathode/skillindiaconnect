import type { Metadata } from 'next';
import { MockSetup } from '@/mocks/mock-setup';
import './globals.css';

export const metadata: Metadata = {
  title: 'SkillIndiaConnect',
  description: 'Blue-collar recruitment platform',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <MockSetup />
        {children}
      </body>
    </html>
  );
}

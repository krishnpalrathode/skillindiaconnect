import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Noto_Sans_Arabic } from 'next/font/google';
import { getLocale } from 'next-intl/server';
import { getDir } from '@/lib/dir';
import type { Locale } from '@/i18n/routing';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
  weight: ['400', '500', '600', '700'],
});

const notoSansArabic = Noto_Sans_Arabic({
  subsets: ['arabic'],
  variable: '--font-arabic',
  display: 'swap',
  weight: ['400', '500', '600', '700'],
});

export const metadata: Metadata = {
  title: 'SkillIndiaConnect',
  description:
    'Blue-collar recruitment platform connecting skilled workers in India with Gulf and local employers.',
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = (await getLocale()) as Locale;
  const dir = getDir(locale);

  return (
    <html lang={locale} dir={dir} className={`${inter.variable} ${notoSansArabic.variable}`}>
      <body className={dir === 'rtl' ? 'font-arabic' : 'font-sans'}>{children}</body>
    </html>
  );
}

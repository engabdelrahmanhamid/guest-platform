import { Amiri, El_Messiri } from 'next/font/google';

// Display faces for the invitation templates. Not preloaded: a guest downloads only the face
// their invitation's template uses. Formal and Minimal use the product's IBM Plex Sans Arabic.
export const amiri = Amiri({
  subsets: ['arabic', 'latin'],
  weight: ['400', '700'],
  variable: '--font-elegant',
  display: 'swap',
  preload: false,
});

export const elMessiri = El_Messiri({
  subsets: ['arabic', 'latin'],
  weight: ['500', '700'],
  variable: '--font-celebration',
  display: 'swap',
  preload: false,
});

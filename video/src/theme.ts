import { loadFont as loadInter } from '@remotion/google-fonts/Inter';
import { loadFont as loadJetBrainsMono } from '@remotion/google-fonts/JetBrainsMono';

// The colors match the gitrac.dev website (www/style.css).
export const colors = {
  background: '#0b0d17',
  raised: '#12152a',
  border: '#23284a',
  text: '#e6e8f2',
  muted: '#9aa0bd',
  accent: '#8b8ff8',
  accentStrong: '#6366f1',
  terminal: '#0f1221',
};

export const fonts = {
  sans: loadInter('normal', {
    weights: ['400', '500', '600', '700'],
    subsets: ['latin'],
  }).fontFamily,
  mono: loadJetBrainsMono('normal', {
    weights: ['400', '500'],
    subsets: ['latin'],
  }).fontFamily,
};

import { useColorScheme } from 'react-native';

/**
 * Gatherly design tokens for native surfaces.
 * Mirrors the web design system (globals.css) so both clients feel like one product.
 */
interface Palette {
  background: string;
  surface: string;
  surface2: string;
  surface3: string;
  ink: string;
  inkSecondary: string;
  inkTertiary: string;
  hairline: string;
  accent: string;
  accentSoft: string;
  success: string;
  warning: string;
  danger: string;
  glassTint: string;
}

export const palette: Record<'light' | 'dark', Palette> = {
  light: {
    background: '#f5f5f7',
    surface: '#ffffff',
    surface2: '#f0f0f3',
    surface3: '#e8e8ed',
    ink: '#1d1d1f',
    inkSecondary: '#6e6e73',
    inkTertiary: '#aeaeb2',
    hairline: 'rgba(0,0,0,0.08)',
    accent: '#0a84ff',
    accentSoft: 'rgba(10,132,255,0.12)',
    success: '#30d158',
    warning: '#ff9f0a',
    danger: '#ff453a',
    glassTint: 'rgba(255,255,255,0.72)',
  },
  dark: {
    background: '#000000',
    surface: '#1c1c1e',
    surface2: '#2c2c2e',
    surface3: '#3a3a3c',
    ink: '#f5f5f7',
    inkSecondary: '#98989d',
    inkTertiary: '#636366',
    hairline: 'rgba(255,255,255,0.12)',
    accent: '#0a84ff',
    accentSoft: 'rgba(10,132,255,0.22)',
    success: '#30d158',
    warning: '#ff9f0a',
    danger: '#ff453a',
    glassTint: 'rgba(28,28,30,0.72)',
  },
};

export type ThemeColors = Palette;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 10, md: 14, lg: 20, xl: 28, full: 999 } as const;

export const typography = {
  largeTitle: { fontSize: 32, fontWeight: '800' as const, letterSpacing: -0.6 },
  title: { fontSize: 22, fontWeight: '700' as const, letterSpacing: -0.4 },
  headline: { fontSize: 17, fontWeight: '600' as const },
  body: { fontSize: 16, fontWeight: '400' as const },
  subhead: { fontSize: 14, fontWeight: '400' as const },
  caption: { fontSize: 12, fontWeight: '500' as const },
} as const;

export function useTheme(): { colors: ThemeColors; scheme: 'light' | 'dark' } {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return { colors: palette[scheme], scheme };
}

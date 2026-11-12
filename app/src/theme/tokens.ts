import { Platform } from 'react-native';

export type ThemeMode = 'light' | 'dark';

export const lightColors = {
  primary: '#1F5D3A',
  primaryDark: '#16462B',
  primaryLight: '#2E7D50',
  primarySoft: '#E3EFE6',
  primaryGlow: 'rgba(31, 93, 58, 0.22)',
  bgCream: '#F6F7F2',
  bgSage: '#EAF1E7',
  bgMapLand: '#EBF0E6',
  bgMapPark: '#D7E6D3',
  bgMapWater: '#C3DCE8',
  bgMapRoad: '#F9FAF6',
  bgCard: '#FFFFFF',
  bgSoft: '#F0F4EE',
  gold: '#DF9F20',
  goldSoft: '#FDF5DF',
  goldText: '#78550A',
  paypalBlue: '#0070BA',
  paypalSoft: '#EAF4FB',
  textPrimary: '#18251E',
  textSecondary: '#58675D',
  textMuted: '#88978E',
  border: '#DCE5DD',
  success: '#257E4E',
  successSoft: '#E2F2E8',
  warning: '#C98A1A',
  warningSoft: '#FDF4DC',
  danger: '#B8382D',
  dangerSoft: '#FBECEB',
  white: '#FFFFFF',
  floatingPillBg: 'rgba(248, 250, 247, 0.84)',
  floatingPillBorder: 'rgba(255, 255, 255, 0.90)',
  switchPillBg: '#222222',
  switchPillText: '#FFFFFF',
  sheetScrim: 'rgba(11, 24, 16, 0.38)',
} as const;

export const darkColors = {
  primary: '#36A165',
  primaryDark: '#5CE094',
  primaryLight: '#49B87A',
  primarySoft: 'rgba(54, 161, 101, 0.20)',
  primaryGlow: 'rgba(54, 161, 101, 0.30)',
  bgCream: '#0B120E',
  bgSage: '#121E17',
  bgMapLand: '#111A14',
  bgMapPark: '#17281D',
  bgMapWater: '#0F2230',
  bgMapRoad: '#18221C',
  bgCard: '#15211A',
  bgSoft: '#1B2A21',
  gold: '#F0B43A',
  goldSoft: 'rgba(240, 180, 58, 0.18)',
  goldText: '#F6C968',
  paypalBlue: '#3CA7F2',
  paypalSoft: 'rgba(60, 167, 242, 0.18)',
  textPrimary: '#F0F6F2',
  textSecondary: '#A8BAB0',
  textMuted: '#788B80',
  border: 'rgba(255, 255, 255, 0.12)',
  success: '#3DBB78',
  successSoft: 'rgba(61, 187, 120, 0.20)',
  warning: '#F0B43A',
  warningSoft: 'rgba(240, 180, 58, 0.20)',
  danger: '#F26B5E',
  dangerSoft: 'rgba(242, 107, 94, 0.20)',
  white: '#FFFFFF',
  floatingPillBg: 'rgba(18, 28, 22, 0.86)',
  floatingPillBorder: 'rgba(255, 255, 255, 0.18)',
  switchPillBg: '#F2F6F3',
  switchPillText: '#142019',
  sheetScrim: 'rgba(0, 0, 0, 0.62)',
} as const;

export type ThemePalette = {
  [K in keyof typeof lightColors]: string;
};

export const colors = lightColors;

export function getPalette(mode: ThemeMode): ThemePalette {
  return mode === 'dark' ? darkColors : lightColors;
}

export const fonts = {
  wordmark: 'Outfit_700Bold',
  serif: 'PlayfairDisplay_700Bold',
  serifSemi: 'PlayfairDisplay_600SemiBold',
  sans: 'Inter_400Regular',
  sansMedium: 'Inter_500Medium',
  sansSemi: 'Inter_600SemiBold',
  sansBold: 'Inter_700Bold',
} as const;

export const radii = {
  sm: 10,
  md: 16,
  lg: 22,
  xl: 28,
  pill: 999,
} as const;

export const spacing = {
  xs: 6,
  sm: 10,
  md: 16,
  lg: 22,
  xl: 28,
} as const;

export const shadows = {
  soft: Platform.select({
    ios: {
      shadowColor: '#16291D',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.08,
      shadowRadius: 14,
    },
    android: {
      elevation: 4,
    },
    default: {
      shadowColor: '#16291D',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.08,
      shadowRadius: 14,
    },
  }),
  card: Platform.select({
    ios: {
      shadowColor: '#16291D',
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.12,
      shadowRadius: 20,
    },
    android: {
      elevation: 8,
    },
    default: {
      shadowColor: '#16291D',
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.12,
      shadowRadius: 20,
    },
  }),
};

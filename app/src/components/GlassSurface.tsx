import React from 'react';
import { Platform, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useRoamr } from '../context/RoamrContext';
import { radii, shadows } from '../theme/tokens';

export type GlassTone = 'light' | 'ultraThin' | 'forest' | 'gold';

interface GlassSurfaceProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  intensity?: number;
  tint?: 'light' | 'dark' | 'default';
  tone?: GlassTone;
  borderRadius?: number;
}

interface ToneVisual {
  overlayBg: string;
  gradientColors: [string, string, string];
  borderColor: string;
  specularTopColor: string;
  innerRimColor: string;
  glareColors: [string, string];
  defaultTint: 'light' | 'dark';
}

const LIGHT_TONE_CONFIG: Record<GlassTone, ToneVisual> = {
  light: {
    overlayBg: 'rgba(255, 255, 255, 0.20)',
    gradientColors: [
      'rgba(255, 255, 255, 0.34)',
      'rgba(255, 255, 255, 0.06)',
      'rgba(218, 240, 230, 0.20)',
    ],
    borderColor: 'rgba(255, 255, 255, 0.68)',
    specularTopColor: 'rgba(255, 255, 255, 0.72)',
    innerRimColor: 'rgba(255, 255, 255, 0.30)',
    glareColors: ['rgba(255, 255, 255, 0.26)', 'rgba(255, 255, 255, 0.0)'],
    defaultTint: 'light',
  },
  ultraThin: {
    overlayBg: 'rgba(255, 255, 255, 0.11)',
    gradientColors: [
      'rgba(255, 255, 255, 0.22)',
      'rgba(255, 255, 255, 0.04)',
      'rgba(210, 235, 248, 0.14)',
    ],
    borderColor: 'rgba(255, 255, 255, 0.48)',
    specularTopColor: 'rgba(255, 255, 255, 0.55)',
    innerRimColor: 'rgba(255, 255, 255, 0.18)',
    glareColors: ['rgba(255, 255, 255, 0.18)', 'rgba(255, 255, 255, 0.0)'],
    defaultTint: 'light',
  },
  forest: {
    overlayBg: 'rgba(20, 76, 44, 0.58)',
    gradientColors: [
      'rgba(66, 178, 114, 0.34)',
      'rgba(24, 88, 52, 0.64)',
      'rgba(12, 52, 30, 0.74)',
    ],
    borderColor: 'rgba(255, 255, 255, 0.36)',
    specularTopColor: 'rgba(255, 255, 255, 0.44)',
    innerRimColor: 'rgba(255, 255, 255, 0.16)',
    glareColors: ['rgba(255, 255, 255, 0.18)', 'rgba(255, 255, 255, 0.0)'],
    defaultTint: 'dark',
  },
  gold: {
    overlayBg: 'rgba(255, 250, 236, 0.26)',
    gradientColors: [
      'rgba(255, 255, 255, 0.42)',
      'rgba(253, 242, 210, 0.14)',
      'rgba(246, 212, 128, 0.22)',
    ],
    borderColor: 'rgba(255, 255, 255, 0.70)',
    specularTopColor: 'rgba(255, 255, 255, 0.76)',
    innerRimColor: 'rgba(255, 248, 224, 0.34)',
    glareColors: ['rgba(255, 255, 255, 0.26)', 'rgba(255, 255, 255, 0.0)'],
    defaultTint: 'light',
  },
};

const DARK_TONE_CONFIG: Record<GlassTone, ToneVisual> = {
  light: {
    // Apple iOS 26 Dark Liquid Glass: smoked obsidian with subtle uniform rim
    overlayBg: 'rgba(14, 22, 18, 0.64)',
    gradientColors: [
      'rgba(255, 255, 255, 0.12)',
      'rgba(16, 26, 20, 0.26)',
      'rgba(54, 161, 101, 0.14)',
    ],
    borderColor: 'rgba(255, 255, 255, 0.18)',
    specularTopColor: 'rgba(255, 255, 255, 0.24)',
    innerRimColor: 'rgba(255, 255, 255, 0.08)',
    glareColors: ['rgba(255, 255, 255, 0.10)', 'rgba(255, 255, 255, 0.0)'],
    defaultTint: 'dark',
  },
  ultraThin: {
    overlayBg: 'rgba(10, 18, 14, 0.46)',
    gradientColors: [
      'rgba(255, 255, 255, 0.08)',
      'rgba(12, 20, 16, 0.18)',
      'rgba(60, 167, 242, 0.10)',
    ],
    borderColor: 'rgba(255, 255, 255, 0.14)',
    specularTopColor: 'rgba(255, 255, 255, 0.18)',
    innerRimColor: 'rgba(255, 255, 255, 0.06)',
    glareColors: ['rgba(255, 255, 255, 0.08)', 'rgba(255, 255, 255, 0.0)'],
    defaultTint: 'dark',
  },
  forest: {
    overlayBg: 'rgba(14, 58, 34, 0.72)',
    gradientColors: [
      'rgba(72, 202, 130, 0.26)',
      'rgba(18, 68, 40, 0.62)',
      'rgba(8, 32, 18, 0.80)',
    ],
    borderColor: 'rgba(104, 218, 152, 0.32)',
    specularTopColor: 'rgba(104, 218, 152, 0.36)',
    innerRimColor: 'rgba(255, 255, 255, 0.10)',
    glareColors: ['rgba(255, 255, 255, 0.10)', 'rgba(255, 255, 255, 0.0)'],
    defaultTint: 'dark',
  },
  gold: {
    overlayBg: 'rgba(32, 26, 14, 0.66)',
    gradientColors: [
      'rgba(240, 180, 58, 0.20)',
      'rgba(28, 24, 14, 0.32)',
      'rgba(240, 180, 58, 0.12)',
    ],
    borderColor: 'rgba(246, 201, 104, 0.28)',
    specularTopColor: 'rgba(246, 201, 104, 0.32)',
    innerRimColor: 'rgba(255, 224, 160, 0.10)',
    glareColors: ['rgba(255, 236, 190, 0.10)', 'rgba(255, 255, 255, 0.0)'],
    defaultTint: 'dark',
  },
};

export function GlassSurface({
  children,
  style,
  contentStyle,
  intensity = 68,
  tint,
  tone = 'light',
  borderRadius = radii.xl,
}: GlassSurfaceProps) {
  const { isDark } = useRoamr();
  const cfg = isDark ? DARK_TONE_CONFIG[tone] : LIGHT_TONE_CONFIG[tone];
  const resolvedTint = tint || cfg.defaultTint;

  const overlays = (
    <>
      <LinearGradient
        colors={cfg.gradientColors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <LinearGradient
        colors={cfg.glareColors}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={styles.topGlare}
        pointerEvents="none"
      />
      <View
        style={[
          styles.innerRim,
          {
            borderRadius: Math.max(0, borderRadius - 1.5),
            borderColor: cfg.innerRimColor,
          },
        ]}
        pointerEvents="none"
      />
    </>
  );

  if (Platform.OS === 'web') {
    return (
      <View
        style={[
          styles.webWrap,
          {
            borderRadius,
            backgroundColor: cfg.overlayBg,
            borderColor: cfg.borderColor,
            // @ts-expect-error web backdropFilter
            backdropFilter: 'blur(24px) saturate(210%)',
            WebkitBackdropFilter: 'blur(24px) saturate(210%)',
          },
          shadows.card,
          style,
        ]}
      >
        {overlays}
        <View style={[styles.contentLayer, contentStyle]}>{children}</View>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.nativeOuter,
        { borderRadius },
        Platform.OS === 'ios'
          ? shadows.card
          : isDark
          ? styles.androidHaloDark
          : styles.androidHaloLight,
        style,
      ]}
    >
      {Platform.OS === 'ios' ? (
        <BlurView
          intensity={intensity}
          tint={resolvedTint}
          style={[
            styles.blurWrap,
            {
              borderRadius,
              borderColor: cfg.borderColor,
              backgroundColor: cfg.overlayBg,
            },
          ]}
        >
          {overlays}
          <View style={[styles.contentLayer, contentStyle]}>{children}</View>
        </BlurView>
      ) : (
        <View
          style={[
            styles.blurWrap,
            {
              borderRadius,
              borderColor: cfg.borderColor,
              backgroundColor: cfg.overlayBg,
            },
          ]}
        >
          {overlays}
          <View style={[styles.contentLayer, contentStyle]}>{children}</View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  webWrap: {
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  nativeOuter: {
    backgroundColor: 'transparent',
  },
  androidHaloLight: {
    borderWidth: 0.75,
    borderColor: 'rgba(18, 42, 28, 0.08)',
  },
  androidHaloDark: {
    borderWidth: 0.75,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  blurWrap: {
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  topGlare: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 14,
    zIndex: 1,
  },
  innerRim: {
    position: 'absolute',
    top: 1,
    left: 1,
    right: 1,
    bottom: 1,
    borderWidth: 0.75,
    zIndex: 2,
  },
  contentLayer: {
    position: 'relative',
    zIndex: 3,
  },
});

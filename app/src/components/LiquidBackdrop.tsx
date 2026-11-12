import React from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useRoamr } from '../context/RoamrContext';

interface LiquidBackdropProps {
  variant?: 'traveler' | 'business';
}

/**
 * Silky SVG radial aura washes behind screens (Light or Dark mode) so Liquid Glass
 * surfaces visibly refract sage, sky, and gold depth tones.
 */
export function LiquidBackdrop({ variant = 'traveler' }: LiquidBackdropProps) {
  const { isDark } = useRoamr();
  const isBiz = variant === 'business';

  const baseColors: [string, string, string] = isDark
    ? isBiz
      ? ['#0B110D', '#16140D', '#0D1611']
      : ['#0A110D', '#0F1C14', '#0B130F']
    : isBiz
    ? ['#FBF7EC', '#F4EBCD', '#EDF3E8']
    : ['#F9F6EE', '#E9F2EC', '#F7F2E6'];

  const stopFadeTarget = isDark ? '#0B120E' : '#FFFFFF';

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <LinearGradient
        colors={baseColors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <RadialGradient id="topGlow" cx="85%" cy="14%" r="52%">
            <Stop
              offset="0%"
              stopColor={isBiz ? '#DF9F20' : '#257E4E'}
              stopOpacity={isDark ? 0.24 : isBiz ? 0.24 : 0.22}
            />
            <Stop
              offset="55%"
              stopColor={isBiz ? '#DF9F20' : '#257E4E'}
              stopOpacity={0.07}
            />
            <Stop offset="100%" stopColor={stopFadeTarget} stopOpacity={0} />
          </RadialGradient>

          <RadialGradient id="midGlow" cx="12%" cy="52%" r="48%">
            <Stop
              offset="0%"
              stopColor={isBiz ? '#2D8653' : '#248AD1'}
              stopOpacity={isDark ? 0.16 : 0.18}
            />
            <Stop
              offset="55%"
              stopColor={isBiz ? '#2D8653' : '#248AD1'}
              stopOpacity={0.05}
            />
            <Stop offset="100%" stopColor={stopFadeTarget} stopOpacity={0} />
          </RadialGradient>

          <RadialGradient id="bottomGlow" cx="76%" cy="84%" r="46%">
            <Stop offset="0%" stopColor="#DF9F20" stopOpacity={isDark ? 0.14 : 0.18} />
            <Stop offset="55%" stopColor="#DF9F20" stopOpacity={0.05} />
            <Stop offset="100%" stopColor={stopFadeTarget} stopOpacity={0} />
          </RadialGradient>
        </Defs>

        <Rect x="0" y="0" width="100%" height="100%" fill="url(#topGlow)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#midGlow)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#bottomGlow)" />
      </Svg>
    </View>
  );
}

import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { useRoamr } from '../context/RoamrContext';
import { radii, shadows } from '../theme/tokens';
import { GlassSurface, GlassTone } from './GlassSurface';

interface CardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  elevated?: boolean;
  glass?: boolean;
  tone?: GlassTone;
}

export function Card({
  children,
  style,
  elevated = true,
  glass = false,
  tone = 'light',
}: CardProps) {
  const { palette, isDark } = useRoamr();
  const flat = StyleSheet.flatten(style) || {};
  const hasCustomBg = Boolean(flat.backgroundColor);

  if (glass && !hasCustomBg) {
    const {
      padding,
      paddingHorizontal,
      paddingVertical,
      paddingTop,
      paddingBottom,
      paddingLeft,
      paddingRight,
      alignItems,
      justifyContent,
      flexDirection,
      gap,
      rowGap,
      columnGap,
      borderRadius,
      borderColor,
      borderWidth,
      ...outerStyle
    } = flat;

    const innerStyle: ViewStyle = {
      padding: padding ?? 16,
      ...(paddingHorizontal !== undefined ? { paddingHorizontal } : {}),
      ...(paddingVertical !== undefined ? { paddingVertical } : {}),
      ...(paddingTop !== undefined ? { paddingTop } : {}),
      ...(paddingBottom !== undefined ? { paddingBottom } : {}),
      ...(paddingLeft !== undefined ? { paddingLeft } : {}),
      ...(paddingRight !== undefined ? { paddingRight } : {}),
      ...(alignItems !== undefined ? { alignItems } : {}),
      ...(justifyContent !== undefined ? { justifyContent } : {}),
      ...(flexDirection !== undefined ? { flexDirection } : {}),
      ...(gap !== undefined ? { gap } : {}),
      ...(rowGap !== undefined ? { rowGap } : {}),
      ...(columnGap !== undefined ? { columnGap } : {}),
    };

    const resolvedOuter: ViewStyle | undefined =
      Object.keys(outerStyle).length || borderColor || borderWidth
        ? {
            ...outerStyle,
            ...(borderColor ? { borderColor } : {}),
            ...(borderWidth ? { borderWidth } : {}),
          }
        : undefined;

    return (
      <GlassSurface
        borderRadius={typeof borderRadius === 'number' ? borderRadius : radii.lg}
        intensity={68}
        tone={tone}
        style={resolvedOuter}
        contentStyle={innerStyle}
      >
        {children}
      </GlassSurface>
    );
  }

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: isDark ? palette.bgCard : 'rgba(255, 255, 255, 0.96)',
          borderColor: palette.border,
        },
        elevated && shadows.card,
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radii.lg,
    borderWidth: 1,
    padding: 16,
  },
});

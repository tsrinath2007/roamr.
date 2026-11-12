import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { useRoamr } from '../context/RoamrContext';
import { fonts, radii } from '../theme/tokens';

export type PillVariant = 'sage' | 'gold' | 'neutral' | 'paypal' | 'success' | 'danger';

interface PillProps {
  label: string;
  variant?: PillVariant;
  icon?: React.ReactNode;
  style?: ViewStyle;
}

export function Pill({ label, variant = 'sage', icon, style }: PillProps) {
  const { palette } = useRoamr();

  const colorMap: Record<PillVariant, { bg: string; text: string }> = {
    sage: { bg: palette.primarySoft, text: palette.primaryDark },
    gold: { bg: palette.goldSoft, text: palette.goldText },
    neutral: { bg: palette.bgSoft, text: palette.textSecondary },
    paypal: { bg: palette.paypalSoft, text: palette.paypalBlue },
    success: { bg: palette.successSoft, text: palette.success },
    danger: { bg: palette.dangerSoft, text: palette.danger },
  };

  const entry = colorMap[variant];
  return (
    <View style={[styles.pill, { backgroundColor: entry.bg }, style]}>
      {icon ? <View style={styles.icon}>{icon}</View> : null}
      <Text style={[styles.text, { color: entry.text }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.pill,
    alignSelf: 'flex-start',
  },
  icon: {
    marginRight: 5,
  },
  text: {
    fontFamily: fonts.sansSemi,
    fontSize: 12,
  },
});

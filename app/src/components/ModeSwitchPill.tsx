import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRoamr } from '../context/RoamrContext';
import { fonts, radii, shadows } from '../theme/tokens';

interface ModeSwitchPillProps {
  label: string;
  onPress: () => void;
}

/**
 * Airbnb-style solid floating mode switch pill above the bottom tab bar (no glass effect).
 */
export function ModeSwitchPill({ label, onPress }: ModeSwitchPillProps) {
  const { palette } = useRoamr();
  const insets = useSafeAreaInsets();
  const bottomPos = Math.max(
    (insets.bottom > 0 ? insets.bottom : Platform.OS === 'ios' ? 18 : 12) + 78,
    90
  );

  return (
    <View style={[styles.wrap, { bottom: bottomPos }]} pointerEvents="box-none">
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.pill,
          { backgroundColor: palette.switchPillBg },
          pressed && styles.pillPressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        <Ionicons name="swap-vertical" size={16} color={palette.switchPillText} />
        <Text style={[styles.text, { color: palette.switchPillText }]}>{label}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 35,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: radii.pill,
    ...shadows.card,
  },
  pillPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.98 }],
  },
  text: {
    fontFamily: fonts.sansSemi,
    fontSize: 14,
    letterSpacing: 0.1,
  },
});

import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useRoamr } from '../context/RoamrContext';
import { fonts, radii, shadows } from '../theme/tokens';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'paypal';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  trailingIcon,
  loading = false,
  disabled = false,
  style,
}: ButtonProps) {
  const { palette } = useRoamr();
  const isDisabled = disabled || loading;

  const handlePress = () => {
    if (isDisabled) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onPress();
  };

  const variantStyle: ViewStyle =
    variant === 'primary'
      ? { backgroundColor: palette.primary }
      : variant === 'paypal'
      ? { backgroundColor: palette.paypalBlue }
      : variant === 'secondary'
      ? { backgroundColor: palette.primarySoft, shadowOpacity: 0, elevation: 0 }
      : {
          backgroundColor: palette.bgCard,
          borderWidth: 1.5,
          borderColor: palette.border,
          shadowOpacity: 0,
          elevation: 0,
        };

  const textColor =
    variant === 'primary' || variant === 'paypal'
      ? palette.white
      : palette.primaryDark;

  return (
    <Pressable
      onPress={handlePress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        variantStyle,
        isDisabled && styles.disabled,
        style,
        pressed && !isDisabled && styles.pressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={textColor} size="small" />
      ) : (
        <View style={styles.content}>
          {icon ? <View style={styles.iconLeft}>{icon}</View> : null}
          <Text style={[styles.label, { color: textColor }]}>{label}</Text>
          {trailingIcon ? <View style={styles.iconRight}>{trailingIcon}</View> : null}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    height: 52,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    ...shadows.soft,
  },
  disabled: {
    opacity: 0.55,
  },
  pressed: {
    transform: [{ scale: 0.985 }],
    opacity: 0.92,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconLeft: {
    marginRight: 8,
  },
  iconRight: {
    marginLeft: 8,
  },
  label: {
    fontFamily: fonts.sansSemi,
    fontSize: 15.5,
  },
});

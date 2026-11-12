import React from 'react';
import { Image, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

interface PayPalLogoProps {
  size?: number;
  variant?: 'mark' | 'badge';
  style?: StyleProp<ViewStyle>;
}

const PAYPAL_LOGO_SRC = require('../../assets/paypal-logo.png');

export function PayPalLogo({ size = 18, variant = 'mark', style }: PayPalLogoProps) {
  const aspectWidth = Math.round(size * 0.85);

  if (variant === 'badge') {
    const pad = Math.max(4, Math.round(size * 0.28));
    const boxSize = size + pad * 2;
    return (
      <View
        style={[
          styles.badge,
          {
            width: boxSize,
            height: boxSize,
            borderRadius: boxSize / 2,
          },
          style,
        ]}
      >
        <Image
          source={PAYPAL_LOGO_SRC}
          style={{ width: aspectWidth, height: size }}
          resizeMode="contain"
        />
      </View>
    );
  }

  return (
    <View style={[styles.markWrap, style]}>
      <Image
        source={PAYPAL_LOGO_SRC}
        style={{ width: aspectWidth, height: size }}
        resizeMode="contain"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  markWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

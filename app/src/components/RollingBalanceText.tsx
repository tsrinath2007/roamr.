import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { colors, fonts } from '../theme/tokens';

const REEL_HEIGHT = 44;
// Dual 0-9 strip so every reveal smoothly scrolls through a full reel onto the target digit
const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

function DigitReel({
  digit,
  index,
  revealed,
}: {
  digit: number;
  index: number;
  revealed: boolean;
}) {
  const translateY = useSharedValue(0);

  useEffect(() => {
    if (!revealed) {
      translateY.value = 0;
      return;
    }
    translateY.value = 0;
    const targetRow = 10 + Math.max(0, Math.min(9, digit));
    translateY.value = withDelay(
      index * 65,
      withTiming(-targetRow * REEL_HEIGHT, {
        duration: 620 + index * 70,
        easing: Easing.out(Easing.cubic),
      })
    );
  }, [digit, index, revealed, translateY]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <View style={styles.reelViewport}>
      <Animated.View style={animatedStyle}>
        {DIGITS.map((d, i) => (
          <View key={i} style={styles.reelCell}>
            <Text style={styles.digitText}>{d}</Text>
          </View>
        ))}
      </Animated.View>
    </View>
  );
}

interface RollingBalanceTextProps {
  amountUsd: number;
  revealed: boolean;
}

export function RollingBalanceText({ amountUsd, revealed }: RollingBalanceTextProps) {
  if (!revealed) {
    return (
      <View style={styles.row}>
        <Text style={styles.currencySymbol}>$</Text>
        <Text style={styles.maskedDots}>• • •</Text>
        <Text style={styles.currencyCode}>USD</Text>
      </View>
    );
  }

  const formatted = amountUsd.toFixed(2);
  const chars = formatted.split('');
  let digitOrder = 0;

  return (
    <View style={styles.row}>
      <Text style={styles.currencySymbol}>$</Text>
      {chars.map((ch, idx) => {
        if (ch === '.') {
          return (
            <Text key={`dot-${idx}`} style={styles.dotChar}>
              .
            </Text>
          );
        }
        const num = Number(ch);
        const order = digitOrder++;
        return (
          <DigitReel
            key={`d-${idx}-${chars.length}`}
            digit={Number.isFinite(num) ? num : 0}
            index={order}
            revealed={revealed}
          />
        );
      })}
      <Text style={styles.currencyCode}>USD</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    height: REEL_HEIGHT,
    marginTop: 4,
  },
  currencySymbol: {
    fontFamily: fonts.serif,
    fontSize: 34,
    lineHeight: REEL_HEIGHT,
    color: colors.white,
    marginRight: 2,
  },
  maskedDots: {
    fontFamily: fonts.serif,
    fontSize: 32,
    lineHeight: REEL_HEIGHT,
    letterSpacing: 2,
    color: 'rgba(255, 255, 255, 0.92)',
    marginLeft: 4,
  },
  reelViewport: {
    height: REEL_HEIGHT,
    width: 21,
    overflow: 'hidden',
  },
  reelCell: {
    height: REEL_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  digitText: {
    fontFamily: fonts.serif,
    fontSize: 34,
    lineHeight: REEL_HEIGHT,
    color: colors.white,
    fontVariant: ['tabular-nums'],
  },
  dotChar: {
    fontFamily: fonts.serif,
    fontSize: 34,
    lineHeight: REEL_HEIGHT,
    color: colors.white,
    width: 10,
    textAlign: 'center',
  },
  currencyCode: {
    fontFamily: fonts.sansSemi,
    fontSize: 15,
    color: 'rgba(255, 255, 255, 0.85)',
    marginLeft: 8,
    marginTop: 8,
  },
});

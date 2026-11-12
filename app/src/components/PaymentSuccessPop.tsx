import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  SharedValue,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { useRoamr } from '../context/RoamrContext';
import { formatMoney, usdToCents } from '../../lib/currency';
import { PayPalLogo } from './PayPalLogo';
import { Button } from './Button';
import { fonts, radii, shadows } from '../theme/tokens';

const AnimatedPath = Animated.createAnimatedComponent(Path);

const SPARK_OFFSETS = [
  { dx: -52, dy: -36, color: '#7A9F3C', size: 8 },
  { dx: 54, dy: -32, color: '#DF9F20', size: 9 },
  { dx: -58, dy: 24, color: '#36A165', size: 7 },
  { dx: 52, dy: 28, color: '#0070BA', size: 8 },
  { dx: 0, dy: -60, color: '#7A9F3C', size: 7 },
];

export interface PaymentSuccessPopProps {
  title?: string;
  subtitle?: string;
  amountUsd?: number;
  orderId?: string;
  ctaLabel?: string;
  onContinue: () => void;
  autoContinueMs?: number;
}

export function PaymentSuccessPop({
  title = 'Payment Successful!',
  subtitle = 'PayPal Sandbox bill captured. Proceeding to proof capture...',
  amountUsd,
  orderId,
  ctaLabel = 'Continue →',
  onContinue,
  autoContinueMs = 1050,
}: PaymentSuccessPopProps) {
  const { palette, showInr, isDark } = useRoamr();

  const cardScale = useSharedValue(0.84);
  const cardOpacity = useSharedValue(0);
  const badgeScale = useSharedValue(0.25);
  const ringScale = useSharedValue(0.6);
  const ringOpacity = useSharedValue(0.75);
  const tickProgress = useSharedValue(48);
  const sparkBurst = useSharedValue(0);

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});

    cardOpacity.value = withTiming(1, { duration: 180 });
    cardScale.value = withSpring(1, { damping: 14, stiffness: 220, mass: 0.75 });

    badgeScale.value = withDelay(
      60,
      withSequence(
        withSpring(1.14, { damping: 9, stiffness: 280, mass: 0.65 }),
        withSpring(1, { damping: 13, stiffness: 240 })
      )
    );

    ringScale.value = withDelay(
      80,
      withTiming(1.68, { duration: 620, easing: Easing.out(Easing.cubic) })
    );
    ringOpacity.value = withDelay(
      80,
      withTiming(0, { duration: 620, easing: Easing.out(Easing.quad) })
    );

    tickProgress.value = withDelay(
      140,
      withTiming(0, { duration: 300, easing: Easing.out(Easing.cubic) })
    );

    sparkBurst.value = withDelay(
      90,
      withTiming(1, { duration: 540, easing: Easing.out(Easing.cubic) })
    );

    if (autoContinueMs > 0) {
      const timer = setTimeout(onContinue, autoContinueMs);
      return () => clearTimeout(timer);
    }
  }, [
    autoContinueMs,
    badgeScale,
    cardOpacity,
    cardScale,
    onContinue,
    ringOpacity,
    ringScale,
    sparkBurst,
    tickProgress,
  ]);

  const cardAnim = useAnimatedStyle(() => ({
    opacity: cardOpacity.value,
    transform: [{ scale: cardScale.value }],
  }));

  const badgeAnim = useAnimatedStyle(() => ({
    transform: [{ scale: badgeScale.value }],
  }));

  const ringAnim = useAnimatedStyle(() => ({
    opacity: ringOpacity.value,
    transform: [{ scale: ringScale.value }],
  }));

  const tickAnimatedProps = useAnimatedProps(() => ({
    strokeDashoffset: tickProgress.value,
  }));

  const amountCents = typeof amountUsd === 'number' && amountUsd > 0 ? usdToCents(amountUsd) : 0;

  return (
    <Animated.View
      style={[
        styles.card,
        {
          backgroundColor: palette.bgCard,
          borderColor: isDark ? 'rgba(61, 187, 120, 0.38)' : 'rgba(37, 126, 78, 0.24)',
        },
        cardAnim,
      ]}
    >
      <View style={styles.animStage}>
        {SPARK_OFFSETS.map((sp, i) => (
          <SparkDot
            key={i}
            dx={sp.dx}
            dy={sp.dy}
            color={sp.color}
            size={sp.size}
            progress={sparkBurst}
          />
        ))}

        <Animated.View
          style={[
            styles.popRing,
            {
              borderColor: palette.success,
              backgroundColor: isDark ? 'rgba(61, 187, 120, 0.16)' : 'rgba(37, 126, 78, 0.10)',
            },
            ringAnim,
          ]}
        />

        <Animated.View
          style={[
            styles.tickCircle,
            { backgroundColor: palette.success, borderColor: palette.white },
            badgeAnim,
          ]}
        >
          <Svg width={40} height={40} viewBox="0 0 40 40" fill="none">
            <AnimatedPath
              d="M11 20.5 L17.5 27 L29.5 14"
              stroke="#FFFFFF"
              strokeWidth={4}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="48"
              animatedProps={tickAnimatedProps}
            />
          </Svg>
        </Animated.View>
      </View>

      <Text style={[styles.title, { color: palette.textPrimary }]}>{title}</Text>
      <Text style={[styles.subtitle, { color: palette.textSecondary }]}>{subtitle}</Text>

      {amountCents > 0 || orderId ? (
        <View
          style={[
            styles.receiptPill,
            { backgroundColor: palette.paypalSoft, borderColor: palette.paypalBlue },
          ]}
        >
          <PayPalLogo size={14} variant="badge" />
          <Text style={[styles.receiptText, { color: palette.paypalBlue }]}>
            {amountCents > 0 ? formatMoney(amountCents, { showInr }) : 'Verified'}
            {orderId ? ` • #${orderId.slice(-8)}` : ''}
          </Text>
        </View>
      ) : null}

      <Button label={ctaLabel} onPress={onContinue} style={styles.ctaBtn} />
    </Animated.View>
  );
}

function SparkDot({
  dx,
  dy,
  color,
  size,
  progress,
}: {
  dx: number;
  dy: number;
  color: string;
  size: number;
  progress: SharedValue<number>;
}) {
  const anim = useAnimatedStyle(() => {
    const p = progress.value;
    const opacity = p < 0.7 ? 1 : Math.max(0, (1 - p) / 0.3);
    return {
      opacity,
      transform: [
        { translateX: dx * p },
        { translateY: dy * p },
        { scale: 0.4 + p * 0.7 },
      ],
    };
  });

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
        },
        anim,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    maxWidth: 340,
    borderRadius: radii.xl,
    borderWidth: 1.5,
    paddingHorizontal: 24,
    paddingVertical: 28,
    alignItems: 'center',
    gap: 10,
    ...shadows.card,
  },
  animStage: {
    width: 112,
    height: 112,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  popRing: {
    position: 'absolute',
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 2.5,
  },
  tickCircle: {
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.soft,
  },
  title: {
    fontFamily: fonts.serif,
    fontSize: 23,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  receiptPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radii.pill,
    borderWidth: 1,
    marginTop: 2,
  },
  receiptText: {
    fontFamily: fonts.sansSemi,
    fontSize: 12.5,
  },
  ctaBtn: {
    width: '100%',
    marginTop: 8,
  },
});

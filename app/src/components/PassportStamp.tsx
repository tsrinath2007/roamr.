import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Path, Text as SvgText, TextPath, Defs } from 'react-native-svg';
import { useRoamr } from '../context/RoamrContext';
import { colors, fonts, radii } from '../theme/tokens';
import { CategoryIcon } from './CategoryIcon';

interface PassportStampProps {
  businessName: string;
  category: string;
  dateIso: string;
  animate?: boolean;
  compact?: boolean;
}

export function formatStampDate(dateIso: string) {
  const date = new Date(dateIso);
  if (Number.isNaN(date.getTime())) return 'Today';
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function PassportStamp({
  businessName,
  category,
  dateIso,
  animate = true,
  compact = false,
}: PassportStampProps) {
  const { palette, isDark } = useRoamr();
  const scale = useSharedValue(animate ? 2.1 : 1);
  const rotate = useSharedValue(animate ? -24 : -6);
  const opacity = useSharedValue(animate ? 0 : 0.94);

  useEffect(() => {
    if (!animate) return;
    opacity.value = withDelay(180, withTiming(0.94, { duration: 220 }));
    scale.value = withDelay(
      180,
      withSpring(1, { damping: 11, stiffness: 150, mass: 0.9 })
    );
    rotate.value = withDelay(
      180,
      withTiming(-6, { duration: 420, easing: Easing.out(Easing.cubic) })
    );
  }, [animate, opacity, rotate, scale]);

  const stampStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }, { rotate: `${rotate.value}deg` }],
  }));

  const stampSize = compact ? 92 : 122;

  return (
    <View
      style={[
        styles.paperCard,
        {
          backgroundColor: isDark ? palette.bgSoft : '#F7F5EE',
          borderColor: isDark ? palette.border : '#E5E2D6',
        },
        compact && styles.paperCardCompact,
      ]}
    >
      {/* Subtle wavy postmark ink lines */}
      {!compact ? (
        <View style={styles.postmarkWrap} pointerEvents="none">
          <Svg width={120} height={70} viewBox="0 0 120 70">
            {[14, 26, 38, 50].map((y) => (
              <Path
                key={y}
                d={`M0 ${y} Q 20 ${y - 7}, 40 ${y} T 80 ${y} T 120 ${y}`}
                stroke="rgba(31, 93, 58, 0.16)"
                strokeWidth={2}
                fill="none"
              />
            ))}
          </Svg>
        </View>
      ) : null}

      <Animated.View style={[styles.stampWrapper, stampStyle]}>
        <View
          style={[
            styles.stampRing,
            {
              width: stampSize,
              height: stampSize,
              borderRadius: stampSize / 2,
            },
          ]}
        >
          <Svg width={stampSize} height={stampSize} viewBox="0 0 120 120" style={StyleSheet.absoluteFill}>
            <Defs>
              <Path id="topArc" d="M 18,60 A 42,42 0 1,1 102,60" />
              <Path id="bottomArc" d="M 102,60 A 42,42 0 1,1 18,60" />
            </Defs>
            <Circle
              cx={60}
              cy={60}
              r={55}
              stroke={palette.primary}
              strokeWidth={2.5}
              strokeDasharray="6 3"
              fill={isDark ? 'rgba(54, 161, 101, 0.12)' : 'rgba(31, 93, 58, 0.05)'}
            />
            <Circle
              cx={60}
              cy={60}
              r={33}
              stroke={palette.primary}
              strokeWidth={1.6}
              fill="none"
            />
            <SvgText
              fill={palette.primary}
              fontSize="11"
              fontWeight="700"
              letterSpacing="3"
            >
              <TextPath href="#topArc" startOffset="50%" textAnchor="middle">
                ROAMR
              </TextPath>
            </SvgText>
            <SvgText
              fill={palette.primary}
              fontSize="9.5"
              fontWeight="700"
              letterSpacing="1.6"
            >
              <TextPath href="#bottomArc" startOffset="50%" textAnchor="middle">
                EXPLORED
              </TextPath>
            </SvgText>
          </Svg>

          <View style={styles.centerBadge}>
            <CategoryIcon
              category={category}
              size={compact ? 22 : 28}
              color={palette.primary}
            />
          </View>
        </View>
      </Animated.View>

      <Text
        style={[
          styles.businessText,
          { color: palette.textPrimary },
          compact && styles.businessTextCompact,
        ]}
        numberOfLines={2}
      >
        {businessName}
      </Text>
      <Text style={[styles.dateText, { color: palette.textSecondary }]}>
        {formatStampDate(dateIso)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  paperCard: {
    backgroundColor: '#F7F5EE',
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: '#E5E2D6',
    paddingVertical: 18,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  paperCardCompact: {
    paddingVertical: 14,
    paddingHorizontal: 10,
  },
  postmarkWrap: {
    position: 'absolute',
    right: -8,
    top: 32,
    opacity: 0.8,
  },
  stampWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  stampRing: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  businessText: {
    fontFamily: fonts.sansSemi,
    fontSize: 15,
    color: colors.textPrimary,
    marginTop: 10,
    textAlign: 'center',
  },
  businessTextCompact: {
    fontSize: 13,
  },
  dateText: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
});

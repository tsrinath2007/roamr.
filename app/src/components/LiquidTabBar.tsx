import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Tabs } from 'expo-router';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRoamr } from '../context/RoamrContext';
import { GlassSurface, GlassTone } from './GlassSurface';
import { fonts } from '../theme/tokens';

type RouterTabBarProps = Parameters<NonNullable<React.ComponentProps<typeof Tabs>['tabBar']>>[0];

type LiquidTabBarProps = RouterTabBarProps & {
  activeColor: string;
  inactiveColor?: string;
  tone?: GlassTone;
  lensColors?: [string, string];
  navigation?: {
    emit: (event: {
      type: 'tabPress' | 'tabLongPress';
      target: string;
      canPreventDefault?: boolean;
    }) => { defaultPrevented?: boolean };
    navigate: (name: string, params?: object) => void;
  };
};

const ROW_PADDING = 5;

export function LiquidTabBar({
  state,
  descriptors,
  emitter,
  navigateToTab,
  navigation,
  activeColor,
  inactiveColor,
  tone = 'light',
  lensColors,
}: LiquidTabBarProps) {
  const { isDark } = useRoamr();
  const insets = useSafeAreaInsets();
  const resolvedInactive = inactiveColor || (isDark ? '#A6B8AE' : '#2A3D32');
  const resolvedLensColors: [string, string] =
    lensColors ||
    (isDark
      ? ['rgba(255, 255, 255, 0.22)', 'rgba(54, 161, 101, 0.30)']
      : ['rgba(255, 255, 255, 0.82)', 'rgba(226, 244, 234, 0.62)']);
  const bottomOffset = Math.max(
    insets.bottom > 0 ? insets.bottom : Platform.OS === 'ios' ? 18 : 12,
    10
  );

  const [rowWidth, setRowWidth] = useState(0);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const routesCount = Math.max(state.routes.length, 1);
  const innerWidth = Math.max(0, rowWidth - ROW_PADDING * 2);
  const tabWidth = innerWidth / routesCount;

  const pillX = useSharedValue(0);
  const stretch = useSharedValue(0);
  const lastHapticIdx = useRef(state.index);
  const tabWidthRef = useRef(tabWidth);
  tabWidthRef.current = tabWidth;

  const routesRef = useRef(state.routes);
  routesRef.current = state.routes;

  const activeIdxRef = useRef(state.index);
  activeIdxRef.current = state.index;

  const navigateByIndex = (idx: number) => {
    const route = routesRef.current[idx];
    if (!route) return;
    const isFocused = activeIdxRef.current === idx;
    const event = emitter
      ? emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true })
      : navigation?.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });

    if (!isFocused && !event?.defaultPrevented) {
      if (navigateToTab) {
        navigateToTab(route.key);
      } else {
        navigation?.navigate(route.name);
      }
    }
  };

  // Smooth spring glide + liquid droplet stretch whenever active tab changes
  useEffect(() => {
    if (tabWidth <= 0 || draggingIndex !== null) return;
    const targetX = state.index * tabWidth;
    pillX.value = withSpring(targetX, {
      damping: 16,
      stiffness: 220,
      mass: 0.72,
    });
    stretch.value = withSequence(
      withTiming(1, { duration: 110 }),
      withSpring(0, { damping: 12, stiffness: 190 })
    );
  }, [state.index, tabWidth, draggingIndex, pillX, stretch]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gs) =>
          Math.abs(gs.dx) > 6 && Math.abs(gs.dx) > Math.abs(gs.dy),
        onPanResponderGrant: (evt) => {
          const w = tabWidthRef.current;
          if (w <= 0) return;
          const localX = evt.nativeEvent.locationX - ROW_PADDING;
          const idx = Math.max(
            0,
            Math.min(routesRef.current.length - 1, Math.floor(localX / w))
          );
          lastHapticIdx.current = idx;
          setDraggingIndex(idx);
          stretch.value = withTiming(1, { duration: 90 });
        },
        onPanResponderMove: (_, gs) => {
          const w = tabWidthRef.current;
          if (w <= 0) return;
          const maxIdx = routesRef.current.length - 1;
          const startCenter = activeIdxRef.current * w;
          const nextX = Math.max(0, Math.min(maxIdx * w, startCenter + gs.dx));
          pillX.value = nextX;

          const hoverIdx = Math.max(
            0,
            Math.min(maxIdx, Math.round(nextX / w))
          );
          if (hoverIdx !== lastHapticIdx.current) {
            lastHapticIdx.current = hoverIdx;
            setDraggingIndex(hoverIdx);
            Haptics.selectionAsync().catch(() => {});
          }
        },
        onPanResponderRelease: (_, gs) => {
          const w = tabWidthRef.current;
          const maxIdx = routesRef.current.length - 1;
          const targetX = Math.max(
            0,
            Math.min(maxIdx * w, activeIdxRef.current * w + gs.dx)
          );
          const targetIdx = w > 0 ? Math.max(0, Math.min(maxIdx, Math.round(targetX / w))) : 0;

          setDraggingIndex(null);
          pillX.value = withSpring(targetIdx * w, {
            damping: 16,
            stiffness: 220,
            mass: 0.72,
          });
          stretch.value = withSpring(0, { damping: 12, stiffness: 180 });
          navigateByIndex(targetIdx);
        },
        onPanResponderTerminate: () => {
          const w = tabWidthRef.current;
          setDraggingIndex(null);
          pillX.value = withSpring(activeIdxRef.current * w, {
            damping: 16,
            stiffness: 220,
          });
          stretch.value = withSpring(0, { damping: 12, stiffness: 180 });
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const slidingLensStyle = useAnimatedStyle(() => {
    const scaleX = interpolate(stretch.value, [0, 1], [1, 1.13]);
    const scaleY = interpolate(stretch.value, [0, 1], [1, 0.93]);
    return {
      transform: [{ translateX: pillX.value }, { scaleX }, { scaleY }],
    };
  });

  const highlightedIndex = draggingIndex !== null ? draggingIndex : state.index;

  return (
    <View style={[styles.dockWrapper, { bottom: bottomOffset }]} pointerEvents="box-none">
      <GlassSurface
        borderRadius={34}
        intensity={72}
        tone={tone}
        style={[
          styles.dockGlass,
          {
            backgroundColor: isDark
              ? 'rgba(12, 20, 16, 0.62)'
              : 'rgba(255, 255, 255, 0.24)',
          },
        ]}
      >
        <View
          style={styles.tabRow}
          onLayout={(e) => setRowWidth(e.nativeEvent.layout.width)}
          {...panResponder.panHandlers}
        >
          {/* Sliding Morphing Liquid Glass Lens Droplet */}
          {tabWidth > 0 ? (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.lensTrackPos,
                { width: tabWidth },
                slidingLensStyle,
              ]}
            >
              <LinearGradient
                colors={resolvedLensColors}
                start={{ x: 0.15, y: 0 }}
                end={{ x: 0.85, y: 1 }}
                style={[
                  styles.activeLens,
                  {
                    borderColor: isDark
                      ? 'rgba(255, 255, 255, 0.20)'
                      : 'rgba(255, 255, 255, 0.65)',
                  },
                ]}
              >
                <View
                  style={[
                    styles.activeLensInnerRim,
                    {
                      borderColor: isDark
                        ? 'rgba(255, 255, 255, 0.08)'
                        : 'rgba(255, 255, 255, 0.28)',
                    },
                  ]}
                />
              </LinearGradient>
            </Animated.View>
          ) : null}

          {state.routes.map((route, index) => {
            const { options } = descriptors[route.key];
            const isFocused = highlightedIndex === index;

            const label =
              typeof options.tabBarLabel === 'string'
                ? options.tabBarLabel
                : options.title !== undefined
                ? options.title
                : route.name;

            const tint = isFocused ? activeColor : resolvedInactive;
            const icon = options.tabBarIcon
              ? options.tabBarIcon({ focused: isFocused, color: tint, size: 21 })
              : null;

            return (
              <Pressable
                key={route.key}
                accessibilityRole="button"
                accessibilityState={state.index === index ? { selected: true } : {}}
                accessibilityLabel={options.tabBarAccessibilityLabel}
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  navigateByIndex(index);
                }}
                style={styles.tabItem}
              >
                {icon}
                <Text
                  style={[
                    styles.tabLabel,
                    { color: tint, opacity: isFocused ? 1 : 0.86 },
                  ]}
                  numberOfLines={1}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </GlassSurface>
    </View>
  );
}

const styles = StyleSheet.create({
  dockWrapper: {
    position: 'absolute',
    left: 14,
    right: 14,
    zIndex: 40,
  },
  dockGlass: {
    width: '100%',
  },
  tabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: ROW_PADDING,
    height: 66,
    position: 'relative',
  },
  lensTrackPos: {
    position: 'absolute',
    left: ROW_PADDING,
    top: ROW_PADDING,
    bottom: ROW_PADDING,
    zIndex: 1,
  },
  activeLens: {
    flex: 1,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.65)',
    overflow: 'hidden',
  },
  activeLensInnerRim: {
    position: 'absolute',
    top: 1,
    left: 1,
    right: 1,
    bottom: 1,
    borderRadius: 27,
    borderWidth: 0.75,
    borderColor: 'rgba(255, 255, 255, 0.28)',
  },
  tabItem: {
    flex: 1,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 2,
    zIndex: 2,
  },
  tabLabel: {
    fontFamily: fonts.sansSemi,
    fontSize: 10.5,
    letterSpacing: 0.1,
  },
});

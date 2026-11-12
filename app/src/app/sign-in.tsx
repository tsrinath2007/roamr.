import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useRoamr } from '../context/RoamrContext';
import {
  coolDownGoogleAuthBrowser,
  getAuthRedirectUrl,
  isSupabaseConfigured,
  warmUpGoogleAuthBrowser,
} from '../services/supabase';
import { LiquidBackdrop } from '../components/LiquidBackdrop';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { Pill } from '../components/Pill';
import { PayPalLogo } from '../components/PayPalLogo';
import { Wordmark } from '../components/Wordmark';
import { RoamrMark } from '../components/RoamrMark';
import { ResponsiveContainer } from '../components/ResponsiveContainer';
import { colors, fonts, radii, shadows } from '../theme/tokens';

export default function SignInScreen() {
  const { signInWithGoogle, palette, isDark } = useRoamr();
  const insets = useSafeAreaInsets();
  const [sheetVisible, setSheetVisible] = useState(true);
  const [loadingGoogle, setLoadingGoogle] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const supabaseReady = isSupabaseConfigured();
  const redirectUrl = getAuthRedirectUrl();

  const sheetY = useSharedValue(420);
  const backdropOpacity = useSharedValue(0);

  // Pre-warm Chrome Custom Tabs on Android so Google login opens immediately
  useEffect(() => {
    void warmUpGoogleAuthBrowser();
    return () => {
      void coolDownGoogleAuthBrowser();
    };
  }, []);

  useEffect(() => {
    if (sheetVisible) {
      backdropOpacity.value = withTiming(1, { duration: 200 });
      sheetY.value = withSpring(0, { damping: 18, stiffness: 220, mass: 0.8 });
    } else {
      backdropOpacity.value = withTiming(0, { duration: 150 });
      sheetY.value = withTiming(440, { duration: 170 });
    }
  }, [sheetVisible, sheetY, backdropOpacity]);

  const sheetAnimStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: sheetY.value }],
  }));

  const backdropAnimStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

  const handleGoogleSignIn = async () => {
    Haptics.selectionAsync().catch(() => {});
    setErrorMsg(null);
    setLoadingGoogle(true);
    try {
      const prof = await signInWithGoogle();
      router.replace(prof.onboardingDone ? '/(tabs)' : '/onboarding');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Google sign-in failed.');
    } finally {
      setLoadingGoogle(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.bgSage }]}>
      <LiquidBackdrop variant="traveler" />
      <ResponsiveContainer maxWidth={540}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.heroBlock}>
            <Wordmark
              size={46}
              theme={isDark ? 'dark' : 'light'}
              showTagline
              centered
              rightAccessory={<RoamrMark size={42} theme={isDark ? 'dark' : 'light'} />}
            />
          </View>

          <Card style={styles.welcomeCard}>
            <Pill label="Traveler & Local Business Quests" variant="sage" />
            <Text style={[styles.heading, { color: palette.textPrimary }]}>
              Discover places that reward your curiosity
            </Text>
            <Text style={[styles.body, { color: palette.textSecondary }]}>
              Explore neighborhood spots on the 3D globe, verify visits with Vision AI, and earn USD payouts via PayPal.
            </Text>

            <View style={[styles.featuresList, { borderColor: palette.border }]}>
              <View style={styles.featureRow}>
                <Ionicons name="globe-outline" size={18} color={palette.primary} />
                <Text style={[styles.featureText, { color: palette.textPrimary }]}>
                  Interactive 3D Mapbox globe & local quests
                </Text>
              </View>
              <View style={styles.featureRow}>
                <Ionicons name="sparkles-outline" size={18} color={palette.primary} />
                <Text style={[styles.featureText, { color: palette.textPrimary }]}>
                  Instant Vision AI photo & receipt verification
                </Text>
              </View>
              <View style={styles.featureRow}>
                <PayPalLogo size={16} variant="badge" />
                <Text style={[styles.featureText, { color: palette.textPrimary }]}>
                  One account for Traveler & Business modes
                </Text>
              </View>
            </View>

            <Button
              label="Sign In or Get Started"
              onPress={() => setSheetVisible(true)}
              trailingIcon={<Ionicons name="chevron-up" size={18} color={palette.white} />}
            />
          </Card>
        </ScrollView>
      </ResponsiveContainer>

      {/* In-screen animated Slide-Up Bottom Sheet (avoids native Android Modal blocking Custom Tabs return) */}
      <View
        style={styles.sheetLayer}
        pointerEvents={sheetVisible ? 'box-none' : 'none'}
      >
        <Animated.View
          style={[
            styles.backdrop,
            { backgroundColor: palette.sheetScrim },
            backdropAnimStyle,
          ]}
          pointerEvents={sheetVisible ? 'auto' : 'none'}
        >
          <Pressable style={styles.backdropTap} onPress={() => setSheetVisible(false)} />
        </Animated.View>

        <Animated.View
          style={[
            styles.sheet,
            {
              backgroundColor: palette.bgCard,
              borderColor: isDark ? 'rgba(255,255,255,0.16)' : 'rgba(255, 255, 255, 0.96)',
              paddingBottom: Math.max(insets.bottom + 14, 24),
            },
            sheetAnimStyle,
          ]}
        >
          <View
            style={[
              styles.grabber,
              {
                backgroundColor: isDark
                  ? 'rgba(232, 240, 234, 0.24)'
                  : 'rgba(20, 40, 28, 0.16)',
              },
            ]}
          />

          <View style={styles.sheetHeader}>
            <View style={styles.sheetTitleRow}>
              <RoamrMark size={26} theme={isDark ? 'dark' : 'light'} />
              <Text style={[styles.sheetTitle, { color: palette.textPrimary }]}>
                Sign in to roamr
              </Text>
            </View>
            <Pressable
              onPress={() => setSheetVisible(false)}
              style={[styles.closeBtn, { backgroundColor: palette.bgSoft }]}
              hitSlop={10}
            >
              <Ionicons name="close" size={20} color={palette.textSecondary} />
            </Pressable>
          </View>

          <Text style={[styles.sheetSub, { color: palette.textSecondary }]}>
            Choose an account to save your stamps, PayPal rewards, and quests.
          </Text>

          {errorMsg ? (
            <View style={[styles.errorBox, { backgroundColor: palette.dangerSoft }]}>
              <Ionicons name="alert-circle" size={18} color={palette.danger} />
              <Text style={[styles.errorText, { color: palette.danger }]}>{errorMsg}</Text>
            </View>
          ) : null}

          <View style={styles.actionsCol}>
            <Button
              label={loadingGoogle ? 'Signing in with Google...' : 'Continue with Google'}
              loading={loadingGoogle}
              onPress={handleGoogleSignIn}
              icon={<Ionicons name="logo-google" size={18} color={palette.white} />}
            />
          </View>

          <Text style={[styles.configNote, { color: palette.textMuted }]}>
            {supabaseReady
              ? `OAuth Callback: ${redirectUrl}`
              : 'Sign in with your Google account to get started.'}
          </Text>
        </Animated.View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bgSage,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 20,
    gap: 20,
  },
  heroBlock: {
    alignItems: 'center',
    gap: 4,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  brandText: {
    fontFamily: fonts.serif,
    fontSize: 40,
    color: colors.primaryDark,
    letterSpacing: 1,
  },
  compassCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagline: {
    fontFamily: fonts.sansMedium,
    fontSize: 13.5,
    color: colors.textSecondary,
    letterSpacing: 0.4,
  },
  welcomeCard: {
    borderRadius: radii.xl,
    padding: 22,
    gap: 14,
  },
  heading: {
    fontFamily: fonts.serif,
    fontSize: 25,
    lineHeight: 31,
    color: colors.textPrimary,
  },
  body: {
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 21,
    color: colors.textSecondary,
  },
  featuresList: {
    gap: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.65)',
    padding: 14,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  featureText: {
    flex: 1,
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.textPrimary,
  },
  sheetLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'flex-end',
    zIndex: 30,
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(11, 24, 16, 0.36)',
  },
  backdropTap: {
    flex: 1,
  },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 22,
    paddingTop: 10,
    gap: 12,
    borderTopWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.96)',
    ...shadows.card,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4.5,
    borderRadius: 3,
    backgroundColor: 'rgba(20, 40, 28, 0.16)',
    marginBottom: 4,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sheetTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  miniCompass: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetTitle: {
    fontFamily: fonts.serif,
    fontSize: 22,
    color: colors.textPrimary,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.bgCream,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetSub: {
    fontFamily: fonts.sans,
    fontSize: 13.5,
    lineHeight: 19,
    color: colors.textSecondary,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: colors.dangerSoft,
    padding: 12,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: 'rgba(184, 56, 45, 0.25)',
  },
  errorText: {
    flex: 1,
    fontFamily: fonts.sansMedium,
    fontSize: 12.5,
    lineHeight: 18,
    color: colors.danger,
  },
  actionsCol: {
    gap: 10,
    marginTop: 2,
  },
  configNote: {
    fontFamily: fonts.sans,
    fontSize: 11,
    lineHeight: 15,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 2,
  },
});

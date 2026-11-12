import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Stack, SplashScreen, router, useSegments } from 'expo-router';
import { useFonts } from 'expo-font';
import {
  PlayfairDisplay_600SemiBold,
  PlayfairDisplay_700Bold,
} from '@expo-google-fonts/playfair-display';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import { Outfit_700Bold } from '@expo-google-fonts/outfit';
import { StatusBar, setStatusBarStyle } from 'expo-status-bar';
import { RoamrProvider, useRoamr } from '../context/RoamrContext';
import { Wordmark } from '../components/Wordmark';
import { RoamrMark } from '../components/RoamrMark';
import { colors } from '../theme/tokens';

SplashScreen.preventAutoHideAsync().catch(() => {});

function AuthAndModeGate() {
  const { hydrated, userProfile, role, isSuperAdmin, palette, isDark } = useRoamr();
  const segments = useSegments();

  useEffect(() => {
    if (!hydrated) return;
    const first = segments[0];
    const inAuth = first === 'sign-in' || first === 'auth-callback';

    if (!userProfile && !inAuth) {
      router.replace('/sign-in');
      return;
    }

    if (userProfile && inAuth) {
      router.replace(
        role === 'business' && (userProfile.isBusiness || isSuperAdmin) ? '/(business)' : '/(tabs)'
      );
    }
  }, [hydrated, userProfile, role, isSuperAdmin, segments]);

  if (!hydrated) {
    return (
      <View style={[styles.loader, { backgroundColor: palette.bgCream }]}>
        <Wordmark
          size={46}
          theme={isDark ? 'dark' : 'light'}
          showTagline
          centered
          rightAccessory={<RoamrMark size={42} theme={isDark ? 'dark' : 'light'} />}
        />
        <ActivityIndicator
          size="small"
          color={palette.primary}
          style={{ marginTop: 18 }}
        />
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'fade',
        contentStyle: { backgroundColor: palette.bgCream },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
      <Stack.Screen name="(business)" options={{ animation: 'fade' }} />
      <Stack.Screen name="sign-in" options={{ animation: 'fade' }} />
      <Stack.Screen name="business-onboarding" options={{ animation: 'slide_from_bottom' }} />
      <Stack.Screen name="onboarding" options={{ animation: 'fade_from_bottom' }} />
      <Stack.Screen name="quest/[id]" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="quest/submit" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="quest/verify" options={{ animation: 'fade' }} />
      <Stack.Screen name="quest/completed" options={{ animation: 'fade' }} />
      <Stack.Screen name="business/create" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="business/fund" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="settings" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="paypal-return" options={{ animation: 'fade' }} />
    </Stack>
  );
}

function ThemedRoot() {
  const { isDark } = useRoamr();

  useEffect(() => {
    setStatusBarStyle(isDark ? 'light' : 'dark', true);
  }, [isDark]);

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <AuthAndModeGate />
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Outfit_700Bold,
    PlayfairDisplay_600SemiBold,
    PlayfairDisplay_700Bold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <RoamrProvider>
      <ThemedRoot />
    </RoamrProvider>
  );
}

const styles = StyleSheet.create({
  loader: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgCream,
  },
});

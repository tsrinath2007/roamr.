import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useRoamr } from '../context/RoamrContext';
import { colors, fonts } from '../theme/tokens';

export default function AuthCallbackScreen() {
  const { userProfile, palette } = useRoamr();

  useEffect(() => {
    const timer = setTimeout(() => {
      if (userProfile) {
        router.replace('/(tabs)');
      } else {
        router.replace('/sign-in');
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [userProfile]);

  return (
    <View style={[styles.wrap, { backgroundColor: palette.bgCream }]}>
      <ActivityIndicator size="large" color={palette.primary} />
      <Text style={[styles.text, { color: palette.textSecondary }]}>Finishing sign-in...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgCream,
    gap: 12,
  },
  text: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    color: colors.textSecondary,
  },
});

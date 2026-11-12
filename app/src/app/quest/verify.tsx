import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useRoamr } from '../../context/RoamrContext';
import { verifyProofWithApi } from '../../services/api';
import { formatMoney, usdToCents } from '../../../lib/currency';
import { Card } from '../../components/Card';
import { LiquidBackdrop } from '../../components/LiquidBackdrop';
import { Pill } from '../../components/Pill';
import { Button } from '../../components/Button';
import { ResponsiveContainer } from '../../components/ResponsiveContainer';
import { colors, fonts, radii } from '../../theme/tokens';

export default function VerifyScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const {
    quests,
    pendingProof,
    demoMode,
    showInr,
    setLastVerification,
    submitQuestForHumanReview,
    palette,
  } = useRoamr();

  const quest = quests.find((q) => q.id === (id || pendingProof?.questId)) || quests[0];

  const [checking, setChecking] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [result, setResult] = useState<{
    verified: boolean;
    confidence: number;
    reason: string;
    mode: string;
  } | null>(null);

  const pulseScale = useSharedValue(1);

  useEffect(() => {
    pulseScale.value = withRepeat(
      withSequence(
        withTiming(1.12, { duration: 650, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 650, easing: Easing.inOut(Easing.ease) })
      ),
      -1
    );
  }, [pulseScale]);

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseScale.value }],
  }));

  useEffect(() => {
    if (!quest) return;
    let active = true;

    (async () => {
      const started = Date.now();
      let apiRes: {
        verified: boolean;
        confidence: number;
        reason: string;
        mode: string;
      };

      try {
        apiRes = await verifyProofWithApi({
          imageBase64: pendingProof?.base64,
          mimeType: pendingProof?.mimeType,
          quest,
          demoMode,
        });
      } catch {
        // Offline / local fallback if backend isn't reachable
        if (demoMode || (pendingProof?.photoUri && pendingProof.photoUri.length > 0)) {
          apiRes = {
            verified: true,
            confidence: demoMode ? 0.98 : 0.89,
            reason: demoMode
              ? `Demo mode: Confirmed visit to ${quest.businessName}.`
              : `Offline fallback: Photo proof accepted for ${quest.businessName}.`,
            mode: demoMode ? 'demo' : 'offline-fallback',
          };
        } else {
          apiRes = {
            verified: false,
            confidence: 0.15,
            reason: 'No proof image found. Please attach a photo or receipt.',
            mode: 'offline-fallback',
          };
        }
      }

      const elapsed = Date.now() - started;
      if (elapsed < 1350) {
        await new Promise((r) => setTimeout(r, 1350 - elapsed));
      }

      if (!active) return;
      setResult(apiRes);
      setLastVerification({
        ...apiRes,
        questId: quest.id,
        photoUri: pendingProof?.photoUri,
      });
      setChecking(false);

      if (apiRes.verified) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      }
    })();

    return () => {
      active = false;
    };
  }, [quest, pendingProof, demoMode, setLastVerification]);

  const handleClaim = async () => {
    if (!quest || !result || claiming) return;
    setClaiming(true);
    try {
      await submitQuestForHumanReview(quest, result, pendingProof?.photoUri);
      router.replace({
        pathname: '/quest/completed',
        params: { id: quest.id, pending: '1' },
      });
    } finally {
      setClaiming(false);
    }
  };

  if (!quest) return null;

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.bgSage }]}>
      <LiquidBackdrop variant="traveler" />
      <ResponsiveContainer maxWidth={600}>
        <View style={styles.container}>
          {checking ? (
            <Card style={styles.card}>
              <Animated.View
                style={[styles.pulseCircle, { backgroundColor: palette.primarySoft }, pulseStyle]}
              >
                <Ionicons name="sparkles" size={34} color={palette.primary} />
              </Animated.View>
              <Text style={[styles.title, { color: palette.textPrimary }]}>
                Checking your photo...
              </Text>
              <Text style={[styles.subtitle, { color: palette.textSecondary }]}>
                AI Vision is verifying your visit at {quest.businessName}.
              </Text>
              {pendingProof?.photoUri ? (
                <Image
                  source={{ uri: pendingProof.photoUri }}
                  style={[styles.thumb, { backgroundColor: palette.bgSage }]}
                />
              ) : null}
            </Card>
          ) : result?.verified ? (
            <Card style={styles.card}>
              <View style={[styles.statusCircle, { backgroundColor: palette.success }]}>
                <Ionicons name="checkmark" size={34} color={palette.white} />
              </View>
              <Pill
                label={`Verified • ${Math.round(result.confidence * 100)}% confidence`}
                variant="success"
              />
              <Text style={[styles.title, { color: palette.textPrimary }]}>Proof Verified!</Text>
              <Text
                style={[
                  styles.reasonText,
                  { color: palette.textSecondary, backgroundColor: palette.bgSoft },
                ]}
              >
                {result.reason}
              </Text>

              {pendingProof?.photoUri ? (
                <Image
                  source={{ uri: pendingProof.photoUri }}
                  style={[styles.thumb, { backgroundColor: palette.bgSage }]}
                />
              ) : null}

              <Button
                label={
                  claiming
                    ? 'Submitting to Business...'
                    : `Submit for Business Approval (+${formatMoney(
                        quest.rewardCents ?? usdToCents(quest.rewardUsd),
                        { showInr }
                      )})`
                }
                loading={claiming}
                onPress={handleClaim}
                trailingIcon={<Ionicons name="arrow-forward" size={18} color={palette.white} />}
                style={styles.fullBtn}
              />
            </Card>
          ) : (
            <Card style={styles.card}>
              <View style={[styles.statusCircle, { backgroundColor: palette.danger }]}>
                <Ionicons name="close" size={34} color={palette.white} />
              </View>
              <Pill
                label={`Not Verified • ${Math.round((result?.confidence || 0.2) * 100)}%`}
                variant="danger"
              />
              <Text style={[styles.title, { color: palette.textPrimary }]}>Not Verified</Text>
              <Text
                style={[
                  styles.reasonText,
                  { color: palette.textSecondary, backgroundColor: palette.bgSoft },
                ]}
              >
                {result?.reason ||
                  `We couldn't clearly confirm ${quest.businessName} in this photo.`}
              </Text>

              <Button
                label="Try Another Photo"
                onPress={() => router.back()}
                icon={<Ionicons name="camera-outline" size={18} color={palette.white} />}
                style={styles.fullBtn}
              />
              <Button
                label="Back to Map"
                variant="outline"
                onPress={() => router.replace('/(tabs)')}
                style={styles.fullBtn}
              />
            </Card>
          )}
        </View>
      </ResponsiveContainer>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bgSage,
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    alignItems: 'center',
    paddingVertical: 28,
    paddingHorizontal: 22,
    gap: 12,
    borderRadius: radii.xl,
  },
  pulseCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  statusCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  verifiedCircle: {
    backgroundColor: colors.success,
  },
  rejectedCircle: {
    backgroundColor: colors.danger,
  },
  title: {
    fontFamily: fonts.serif,
    fontSize: 26,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  reasonText: {
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 21,
    color: colors.textSecondary,
    textAlign: 'center',
    backgroundColor: colors.bgCream,
    padding: 12,
    borderRadius: radii.md,
    width: '100%',
  },
  thumb: {
    width: '100%',
    height: 160,
    borderRadius: radii.md,
    backgroundColor: colors.bgSage,
  },
  fullBtn: {
    width: '100%',
    marginTop: 4,
  },
});

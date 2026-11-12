import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useRoamr } from '../../context/RoamrContext';
import { reverseGeocodeWithMapbox } from '../../services/api';
import { haversineDistanceKm } from '../../utils/distance';
import { formatMoney, usdToCents } from '../../../lib/currency';
import { Card } from '../../components/Card';
import { LiquidBackdrop } from '../../components/LiquidBackdrop';
import { Pill } from '../../components/Pill';
import { PayPalLogo } from '../../components/PayPalLogo';
import { Button } from '../../components/Button';
import { ResponsiveContainer } from '../../components/ResponsiveContainer';
import { colors, fonts, radii } from '../../theme/tokens';

export default function SubmitProofScreen() {
  const { id, retake } = useLocalSearchParams<{ id: string; retake?: string }>();
  const {
    quests,
    stamps,
    claims,
    demoMode,
    showInr,
    palette,
    checkinOrders,
    submitClaimProof,
  } = useRoamr();

  const quest = quests.find((q) => q.id === id) || quests[0];
  const isFunded = Boolean(
    quest?.funded && (quest?.budget_remaining_usd ?? quest?.budgetUsd ?? 0) > 0
  );
  const cashbackSoldOutMidClaim = Boolean(
    quest && !isFunded && Number(quest.budget_usd ?? quest.budgetUsd ?? 0) > 0
  );
  const questType = isFunded
    ? quest?.quest_type === 'purchase' || quest?.reward?.cashback_percent
      ? 'purchase'
      : 'visit'
    : 'visit';
  const radiusM = quest?.radius_m ?? 150;
  const checkinOrder = isFunded && quest ? checkinOrders[quest.id] : undefined;
  const alreadyCompleted = Boolean(
    quest &&
      (stamps.some((s) => s.questId === quest.id) ||
        claims.some((c) => c.questId === quest.id && c.status === 'paid'))
  );

  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoBase64, setPhotoBase64] = useState<string | undefined>(undefined);
  const [mimeType, setMimeType] = useState<string>('image/jpeg');
  const [textAnswer, setTextAnswer] = useState('');

  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [gpsCoords, setGpsCoords] = useState<{
    latitude: number;
    longitude: number;
    mocked: boolean;
  } | null>(null);
  const [resolvedAddress, setResolvedAddress] = useState<string>('');
  const [distanceMeters, setDistanceMeters] = useState<number | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const loadUrlAsBase64 = async (url: string): Promise<string | undefined> => {
    try {
      const resp = await fetch(url);
      const blob = await resp.blob();
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(String(reader.result || ''));
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch {
      return undefined;
    }
  };

  const captureGpsAndAddress = useCallback(async () => {
    if (!quest) return;
    setGpsError(null);
    setGpsLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        if (demoMode) {
          setGpsCoords({
            latitude: quest.coordinates.latitude,
            longitude: quest.coordinates.longitude,
            mocked: false,
          });
          setDistanceMeters(15);
          setResolvedAddress(
            await reverseGeocodeWithMapbox(quest.coordinates.latitude, quest.coordinates.longitude)
          );
          return;
        }
        setGpsError('Location permission denied. Enable GPS to verify you are within 100 m.');
        return;
      }

      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      const isMocked = Platform.OS === 'android' && Boolean((pos as { mocked?: boolean }).mocked);
      if (isMocked && !demoMode) {
        setGpsCoords({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          mocked: true,
        });
        setGpsError(
          'Mock GPS location detected on Android. Disable mock location apps to submit real proof.'
        );
        return;
      }

      const lat = demoMode ? quest.coordinates.latitude : pos.coords.latitude;
      const lng = demoMode ? quest.coordinates.longitude : pos.coords.longitude;
      const distKm = haversineDistanceKm(
        { latitude: lat, longitude: lng },
        quest.coordinates
      );
      const distM = Math.round(distKm * 1000);

      setGpsCoords({ latitude: lat, longitude: lng, mocked: isMocked });
      setDistanceMeters(demoMode ? Math.min(distM, 18) : distM);

      const address = await reverseGeocodeWithMapbox(lat, lng);
      setResolvedAddress(address);
    } catch (err) {
      if (demoMode) {
        setGpsCoords({
          latitude: quest.coordinates.latitude,
          longitude: quest.coordinates.longitude,
          mocked: false,
        });
        setDistanceMeters(15);
        setResolvedAddress(
          await reverseGeocodeWithMapbox(quest.coordinates.latitude, quest.coordinates.longitude)
        );
      } else {
        setGpsError(
          err instanceof Error ? err.message : 'Unable to read current GPS location.'
        );
      }
    } finally {
      setGpsLoading(false);
    }
  }, [quest, demoMode]);

  useEffect(() => {
    void captureGpsAndAddress();
  }, [captureGpsAndAddress]);

  // Camera-only photo capture (no gallery upload allowed)
  const [cameraBlocked, setCameraBlocked] = useState(false);

  const takeCameraPhoto = async () => {
    setSubmitError(null);
    try {
      let perm = await ImagePicker.getCameraPermissionsAsync();
      if (!perm.granted) {
        if (perm.canAskAgain) {
          perm = await ImagePicker.requestCameraPermissionsAsync();
        }
      }
      if (!perm.granted) {
        setCameraBlocked(true);
        Alert.alert(
          'Camera Permission Required',
          'ROAMR requires live camera capture. Enable Camera permission in Settings and return to snap your photo.',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Open Settings',
              onPress: () => {
                void Linking.openSettings();
              },
            },
          ]
        );
        return;
      }
      setCameraBlocked(false);

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.65,
        base64: true,
        allowsEditing: true,
      });

      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        setPhotoUri(asset.uri);
        setPhotoBase64(asset.base64 || undefined);
        setMimeType(asset.mimeType || 'image/jpeg');
      }
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : 'Unable to open camera right now.'
      );
    }
  };

  // Available strictly in Demo Mode for simulator/headless testing without camera hardware
  const useDemoCameraCapture = async () => {
    if (!demoMode || !quest) return;
    if (quest.image) {
      setPhotoUri(quest.image);
      const b64 = await loadUrlAsBase64(quest.image);
      setPhotoBase64(b64);
      setMimeType('image/jpeg');
      return;
    }
    const demoImgUrl =
      'https://images.unsplash.com/photo-1554118811-1e0d58224f24?auto=format&fit=crop&w=800&q=80';
    setPhotoUri(demoImgUrl);
    const b64 = await loadUrlAsBase64(demoImgUrl);
    setPhotoBase64(
      b64 || '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA='
    );
    setMimeType('image/jpeg');
  };

  if (!quest) return null;

  if (alreadyCompleted) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.bgCream }]}>
        <LiquidBackdrop variant="traveler" />
        <ResponsiveContainer maxWidth={640}>
          <View style={styles.topBar}>
            <Pressable
              onPress={() => router.back()}
              style={[
                styles.backBtn,
                { backgroundColor: palette.bgCard, borderColor: palette.border },
              ]}
            >
              <Ionicons name="chevron-back" size={22} color={palette.textPrimary} />
            </Pressable>
            <Text style={[styles.topTitle, { color: palette.textPrimary }]}>Quest Completed</Text>
            <View style={styles.spacer} />
          </View>
          <View style={{ padding: 20 }}>
            <Card style={{ gap: 12, alignItems: 'center', paddingVertical: 26 }}>
              <Ionicons name="checkmark-circle" size={48} color={palette.success} />
              <Text style={[styles.questTitle, { color: palette.textPrimary, textAlign: 'center' }]}>
                Already Completed & Paid
              </Text>
              <Text style={[styles.placeholderSub, { color: palette.textSecondary }]}>
                You already submitted proof and received your reward for {quest.title}. Each quest can only be claimed once.
              </Text>
              <Button label="Back to Map" onPress={() => router.replace('/(tabs)')} />
            </Card>
          </View>
        </ResponsiveContainer>
      </SafeAreaView>
    );
  }

  const isMockedBlocked = Boolean(gpsCoords?.mocked) && !demoMode;
  const isOutOfRange = !demoMode && typeof distanceMeters === 'number' && distanceMeters > radiusM;
  const needsOrder = isFunded && questType === 'purchase';
  const missingRequiredOrder = needsOrder && !checkinOrder;

  const handleSubmitClaim = async () => {
    setSubmitError(null);
    if (missingRequiredOrder) {
      Alert.alert(
        'Pay Bill First',
        'Photograph your bill and complete PayPal checkout on the Quest Detail page before submitting proof.'
      );
      return;
    }
    if (!photoUri) {
      Alert.alert('Camera Proof Required', 'Take a live photo using the camera.');
      return;
    }
    if (quest.text_answer_prompt && !textAnswer.trim()) {
      Alert.alert('Answer Required', quest.text_answer_prompt);
      return;
    }
    if (isMockedBlocked) {
      Alert.alert('Mock GPS Rejected', 'Disable mock GPS locations on Android before submitting.');
      return;
    }

    setSubmitting(true);
    try {
      const claim = await submitClaimProof({
        quest,
        order: checkinOrder || null,
        photoBase64,
        mimeType,
        photoUri,
        billPhotoBase64: checkinOrder?.billPhotoBase64,
        billInr: checkinOrder?.billInr,
        textAnswer: textAnswer.trim() || undefined,
        gps: gpsCoords || { latitude: null, longitude: null, mocked: false },
        resolvedAddress,
        distanceMeters,
      });

      router.replace({
        pathname: '/quest/completed',
        params: {
          id: quest.id,
          claimId: claim.id,
        },
      });
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : 'Failed to submit claim for verification.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.bgCream }]}>
      <LiquidBackdrop variant="traveler" />
      <ResponsiveContainer maxWidth={640}>
        <View style={styles.topBar}>
          <Pressable
            onPress={() => router.back()}
            style={[
              styles.backBtn,
              { backgroundColor: palette.bgCard, borderColor: palette.border },
            ]}
          >
            <Ionicons name="chevron-back" size={22} color={palette.textPrimary} />
          </Pressable>
          <Text style={[styles.topTitle, { color: palette.textPrimary }]}>Camera Proof & GPS</Text>
          <View style={styles.spacer} />
        </View>

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
          style={{ flex: 1 }}
        >
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: 120 }]}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
        >
          <Card style={[styles.questSummary, { backgroundColor: palette.bgSage }]}>
            <View style={styles.summaryHeader}>
              <Text style={[styles.questTitle, { color: palette.textPrimary }]}>{quest.title}</Text>
              {isFunded ? (
                <Pill
                  label={`Up to $${quest.reward?.max_reward_usd ?? quest.rewardUsd}`}
                  variant="gold"
                  icon={<PayPalLogo size={11} />}
                />
              ) : (
                <Pill label={`${quest.xp} XP`} variant="sage" />
              )}
            </View>
            <Text style={[styles.objectiveText, { color: palette.textSecondary }]}>
              {quest.objective}
            </Text>
          </Card>

          {cashbackSoldOutMidClaim ? (
            <Card style={[styles.gpsCard, { backgroundColor: palette.goldSoft, borderColor: palette.gold }]}>
              <Text style={[styles.sectionTitle, { color: palette.goldText }]}>
                Cashback just ran out, you&apos;ll still earn XP
              </Text>
              <Text style={[styles.metaDesc, { color: palette.textPrimary }]}>
                This quest&apos;s cashback budget just emptied — submit your photo and AI will award +{quest.xp} XP and your passport stamp.
              </Text>
            </Card>
          ) : null}

          {retake === '1' ? (
            <Card style={[styles.gpsCard, { backgroundColor: palette.goldSoft, borderColor: palette.gold }]}>
              <Text style={[styles.sectionTitle, { color: palette.goldText }]}>
                Final Retake Attempt (1 allowed)
              </Text>
              <Text style={[styles.metaDesc, { color: palette.textPrimary }]}>
                Capture a well-lit, uncropped live photo clearly showing the quest objective.
              </Text>
            </Card>
          ) : null}

          {/* PayPal Check-in Order Receipt (Funded Purchase Quests Only) */}
          {needsOrder ? (
            <Card style={styles.gpsCard}>
              <View style={styles.sectionHeaderRow}>
                <View style={styles.inlineRow}>
                  <PayPalLogo size={16} variant="badge" />
                  <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>
                    Bill & PayPal Order
                  </Text>
                </View>
                <Pill
                  label={checkinOrder ? checkinOrder.status : 'Missing'}
                  variant={checkinOrder ? 'success' : 'danger'}
                />
              </View>
              {checkinOrder ? (
                <Text style={[styles.metaDesc, { color: palette.textSecondary }]}>
                  Order {checkinOrder.orderId} • {formatMoney(usdToCents(checkinOrder.amountUsd), { showInr })}
                  {checkinOrder.billInr ? ` (Bill ₹${checkinOrder.billInr})` : ''}
                </Text>
              ) : (
                <Text style={[styles.metaDesc, { color: palette.danger }]}>
                  Go back to Quest Details, photograph your bill, and pay with PayPal first.
                </Text>
              )}
            </Card>
          ) : (
            <Card style={styles.gpsCard}>
              <View style={styles.sectionHeaderRow}>
                <View style={styles.inlineRow}>
                  <Ionicons name="star" size={18} color={palette.primary} />
                  <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>
                    XP-Only Check-In
                  </Text>
                </View>
                <Pill label="No Payment" variant="sage" />
              </View>
            </Card>
          )}

          {quest.text_answer_prompt ? (
            <Card style={styles.gpsCard}>
              <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>
                Quick Question
              </Text>
              <Text style={[styles.metaDesc, { color: palette.textSecondary }]}>
                {quest.text_answer_prompt}
              </Text>
              <TextInput
                value={textAnswer}
                onChangeText={setTextAnswer}
                placeholder="Type your answer..."
                placeholderTextColor={palette.textMuted}
                style={{
                  borderWidth: 1,
                  borderColor: palette.border,
                  backgroundColor: palette.bgSoft,
                  color: palette.textPrimary,
                  borderRadius: radii.md,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  fontFamily: fonts.sans,
                  fontSize: 14,
                }}
              />
            </Card>
          ) : null}

          {/* Live GPS + Mock Detection + Mapbox Reverse-Geocode */}
          <Card style={styles.gpsCard}>
            <View style={styles.sectionHeaderRow}>
              <View style={styles.inlineRow}>
                <Ionicons name="location" size={18} color={palette.primary} />
                <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>
                  GPS & Distance Check
                </Text>
              </View>
              <Pressable onPress={captureGpsAndAddress} hitSlop={8}>
                <Ionicons name="refresh" size={18} color={palette.primary} />
              </Pressable>
            </View>

            {gpsLoading ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator size="small" color={palette.primary} />
                <Text style={[styles.metaDesc, { color: palette.textSecondary }]}>
                  Reading high-accuracy GPS & reverse-geocoding via Mapbox...
                </Text>
              </View>
            ) : gpsError ? (
              <View style={[styles.alertBox, { backgroundColor: palette.dangerSoft }]}>
                <Ionicons name="warning" size={16} color={palette.danger} />
                <Text style={[styles.alertText, { color: palette.danger }]}>{gpsError}</Text>
              </View>
            ) : (
              <View style={styles.gpsDetails}>
                <View style={styles.pillsRow}>
                  <Pill
                    label={
                      demoMode
                        ? `DEMO_MODE • Auto-Pass (${distanceMeters ?? 15} m)`
                        : typeof distanceMeters === 'number'
                        ? `${distanceMeters} m from venue`
                        : 'Distance unknown'
                    }
                    variant={demoMode ? 'gold' : isOutOfRange ? 'danger' : 'success'}
                  />
                  <Pill
                    label={gpsCoords?.mocked ? 'Mocked GPS' : 'Live GPS OK'}
                    variant={isMockedBlocked ? 'danger' : 'sage'}
                  />
                </View>
                <Text style={[styles.addressText, { color: palette.textPrimary }]}>
                  {resolvedAddress || 'Address lookup pending...'}
                </Text>
                {isOutOfRange ? (
                  <Text style={[styles.metaDesc, { color: palette.danger }]}>
                    Server hard check requires distance &lt;= {radiusM} m from venue.
                  </Text>
                ) : null}
              </View>
            )}
          </Card>

          {/* Camera-Only Capture Card (Gallery Disabled) */}
          <Card style={styles.previewCard}>
            {photoUri ? (
              <View style={[styles.previewWrap, { backgroundColor: palette.bgSage }]}>
                <Image source={{ uri: photoUri }} style={styles.previewImage} />
                <Pressable
                  onPress={() => {
                    setPhotoUri(null);
                    setPhotoBase64(undefined);
                  }}
                  style={styles.removeBtn}
                >
                  <Ionicons name="close" size={18} color={palette.white} />
                </Pressable>
              </View>
            ) : (
              <View
                style={[
                  styles.placeholderBox,
                  { backgroundColor: palette.bgSoft, borderColor: palette.border },
                ]}
              >
                <View style={[styles.cameraCircle, { backgroundColor: palette.primarySoft }]}>
                  <Ionicons name="camera" size={30} color={palette.primary} />
                </View>
                <Text style={[styles.placeholderTitle, { color: palette.textPrimary }]}>
                  Live Camera Capture Only
                </Text>
                <Text style={[styles.placeholderSub, { color: palette.textSecondary }]}>
                  Gallery uploads are disabled. Snap a fresh photo at the venue so Gemini AI can verify your claim.
                </Text>
              </View>
            )}

            <Button
              label={photoUri ? 'Retake Camera Photo' : 'Open Camera & Capture'}
              variant="secondary"
              icon={<Ionicons name="camera" size={18} color={palette.primary} />}
              onPress={takeCameraPhoto}
            />

            {cameraBlocked && !photoUri ? (
              <Pressable
                onPress={() => {
                  void Linking.openSettings();
                }}
                style={styles.sampleLink}
              >
                <Ionicons name="settings-outline" size={14} color={palette.danger} />
                <Text style={[styles.sampleLinkText, { color: palette.danger }]}>
                  Camera denied — tap to open App Settings
                </Text>
              </Pressable>
            ) : null}
          </Card>

          {submitError ? (
            <Card style={[styles.alertBox, { backgroundColor: palette.dangerSoft }]}>
              <Ionicons name="alert-circle" size={18} color={palette.danger} />
              <Text style={[styles.alertText, { color: palette.danger }]}>{submitError}</Text>
            </Card>
          ) : null}

          <Button
            label={submitting ? 'Submitting & Running AI Checks...' : 'Submit Claim for Verification'}
            loading={submitting}
            onPress={handleSubmitClaim}
            disabled={!photoUri || missingRequiredOrder || isMockedBlocked || submitting}
            icon={<Ionicons name="shield-checkmark" size={18} color={palette.white} />}
            style={styles.verifyBtn}
          />
        </ScrollView>
        </KeyboardAvoidingView>
      </ResponsiveContainer>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bgCream,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topTitle: {
    fontFamily: fonts.serif,
    fontSize: 20,
    color: colors.textPrimary,
  },
  spacer: {
    width: 38,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 36,
    gap: 14,
  },
  questSummary: {
    gap: 6,
  },
  summaryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  questTitle: {
    flex: 1,
    fontFamily: fonts.serif,
    fontSize: 19,
  },
  objectiveText: {
    fontFamily: fonts.sans,
    fontSize: 13.5,
    lineHeight: 19,
  },
  gpsCard: {
    gap: 8,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  sectionTitle: {
    fontFamily: fonts.serif,
    fontSize: 17,
  },
  metaDesc: {
    fontFamily: fonts.sans,
    fontSize: 12.5,
    lineHeight: 18,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  gpsDetails: {
    gap: 6,
  },
  pillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  addressText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    lineHeight: 18,
  },
  alertBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderRadius: radii.md,
  },
  alertText: {
    flex: 1,
    fontFamily: fonts.sansMedium,
    fontSize: 12.5,
    lineHeight: 17,
  },
  previewCard: {
    gap: 14,
  },
  previewWrap: {
    position: 'relative',
    borderRadius: radii.md,
    overflow: 'hidden',
    height: 250,
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  removeBtn: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(24,37,30,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderBox: {
    height: 205,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    gap: 8,
  },
  cameraCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderTitle: {
    fontFamily: fonts.serif,
    fontSize: 18,
  },
  placeholderSub: {
    fontFamily: fonts.sans,
    fontSize: 12.5,
    textAlign: 'center',
    lineHeight: 18,
  },
  sampleLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 4,
  },
  sampleLinkText: {
    fontFamily: fonts.sansSemi,
    fontSize: 12.5,
  },
  verifyBtn: {
    marginTop: 4,
  },
});

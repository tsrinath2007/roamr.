import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as WebBrowser from 'expo-web-browser';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useRoamr } from '../../context/RoamrContext';
import {
  capturePayPalCheckinOrder,
  createPayPalCheckinOrder,
  readBillOnServer,
} from '../../services/api';
import { getExpoAwareDeepLink } from '../../utils/deepLink';
import { formatRemainingTime } from '../../utils/time';
import { formatMoney, inrToUsd, usdToCents, USD_TO_INR } from '../../../lib/currency';
import { Pill } from '../../components/Pill';
import { PayPalLogo } from '../../components/PayPalLogo';
import { PaymentSuccessPop } from '../../components/PaymentSuccessPop';
import { ClaimStatusTracker } from '../../components/ClaimStatusTracker';
import { Button } from '../../components/Button';
import { CategoryIcon } from '../../components/CategoryIcon';
import { ResponsiveContainer } from '../../components/ResponsiveContainer';
import { colors, fonts, radii, shadows } from '../../theme/tokens';

function parseQueryParams(url: string): Record<string, string> {
  const out: Record<string, string> = {};
  const qIndex = url.indexOf('?');
  if (qIndex === -1) return out;
  const query = url.slice(qIndex + 1).split('#')[0];
  for (const part of query.split('&')) {
    if (!part) continue;
    const [k, v] = part.split('=');
    if (k) out[decodeURIComponent(k)] = decodeURIComponent(v || '');
  }
  return out;
}

export default function QuestDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const {
    quests,
    stamps,
    claims,
    showInr,
    palette,
    demoMode,
    userProfile,
    checkinOrders,
    recordCheckinOrder,
  } = useRoamr();

  const quest = quests.find((q) => q.id === id) || quests[0];
  const isFunded = Boolean(
    quest?.funded && (quest?.budget_remaining_usd ?? quest?.budgetUsd ?? 0) > 0
  );
  const cashbackSoldOut = Boolean(
    quest && !isFunded && Number(quest.budget_usd ?? quest.budgetUsd ?? 0) > 0
  );
  const questType = isFunded
    ? quest?.quest_type === 'purchase' || quest?.reward?.cashback_percent
      ? 'purchase'
      : 'visit'
    : 'visit';
  const isCompleted = stamps.some((s) => s.questId === quest?.id);
  const completedClaim = quest
    ? claims.find((c) => c.questId === quest.id && c.status === 'paid')
    : undefined;
  const alreadyCompleted = isCompleted || Boolean(completedClaim);
  const timerInfo = formatRemainingTime(quest?.expiresAt);
  const rewardCents = quest ? quest.rewardCents ?? usdToCents(quest.rewardUsd) : 0;
  const minBillInr = quest?.reward?.min_bill_inr ?? Math.round((quest?.minCheckinUsd ?? 1.0) * USD_TO_INR);
  const cashbackPercent = quest?.reward?.cashback_percent ?? 15;
  const maxRewardUsd = quest?.reward?.max_reward_usd ?? quest?.rewardUsd ?? 2.0;
  const maxCashbackText = Number.isInteger(maxRewardUsd)
    ? `$${maxRewardUsd}`
    : `$${maxRewardUsd.toFixed(2)}`;
  const existingCheckin = isFunded && !alreadyCompleted && quest ? checkinOrders[quest.id] : undefined;

  const [billPhotoUri, setBillPhotoUri] = useState<string | null>(null);
  const [billPhotoBase64, setBillPhotoBase64] = useState<string | undefined>(undefined);
  const [readingBill, setReadingBill] = useState(false);
  const [billInrDraft, setBillInrDraft] = useState(String(Math.max(minBillInr, 300)));
  const [payingCheckin, setPayingCheckin] = useState(false);
  const [checkinError, setCheckinError] = useState<string | null>(null);
  const [pendingOrderId, setPendingOrderId] = useState<string | null>(null);
  const [successPopData, setSuccessPopData] = useState<{
    orderId: string;
    amountUsd: number;
  } | null>(null);

  const parsedBillInr = Math.round(Number(billInrDraft.replace(/[^0-9.]/g, '')) || 0);
  const enteredBillUsd = inrToUsd(parsedBillInr);
  const enteredBillCents = usdToCents(enteredBillUsd);
  const estimatedCashbackUsd =
    questType === 'purchase'
      ? Math.min(maxRewardUsd, Number(((enteredBillUsd * cashbackPercent) / 100).toFixed(2)))
      : quest?.reward?.fixed_reward_usd ?? quest?.rewardUsd ?? 0.25;
  const estimatedCashbackCents = usdToCents(estimatedCashbackUsd);
  const isBillValid =
    questType === 'visit' ||
    (parsedBillInr >= minBillInr && enteredBillUsd >= 0.5 && (Boolean(billPhotoUri) || demoMode));

  if (!quest) {
    return (
      <SafeAreaView style={[styles.emptyWrap, { backgroundColor: palette.bgCream }]}>
        <Text style={[styles.emptyText, { color: palette.textPrimary }]}>Quest not found.</Text>
        <Button label="Back to Map" onPress={() => router.replace('/(tabs)')} />
      </SafeAreaView>
    );
  }

  const handleShare = async () => {
    try {
      await Share.share({
        message: `Check out "${quest.title}" on ROAMR — earn ${formatMoney(rewardCents, { showInr })} & ${quest.xp} XP!`,
      });
    } catch {
      // Ignore share cancellation
    }
  };

  const handleCaptureBillPhoto = async (useDemoSample = false) => {
    setCheckinError(null);
    if (useDemoSample) {
      setBillPhotoUri('demo-bill-sample');
      setReadingBill(true);
      try {
        const ocr = await readBillOnServer({ demoMode: true });
        if (ocr.bill_total_inr) {
          setBillInrDraft(String(Math.max(minBillInr, ocr.bill_total_inr)));
        }
      } catch {
        setBillInrDraft(String(Math.max(minBillInr, 350)));
      } finally {
        setReadingBill(false);
      }
      return;
    }

    let perm = await ImagePicker.getCameraPermissionsAsync();
    if (!perm.granted && perm.canAskAgain) {
      perm = await ImagePicker.requestCameraPermissionsAsync();
    }
    if (!perm.granted) {
      Alert.alert(
        'Camera Permission Required',
        'Photograph your venue bill with the camera so Gemini can pre-fill and verify the total.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: () => void Linking.openSettings() },
        ]
      );
      return;
    }

    const picked = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.65,
      base64: true,
    });
    if (picked.canceled || !picked.assets[0]) return;

    const asset = picked.assets[0];
    setBillPhotoUri(asset.uri);
    setBillPhotoBase64(asset.base64 || undefined);

    if (asset.base64) {
      setReadingBill(true);
      try {
        const ocr = await readBillOnServer({
          imageBase64: asset.base64,
          mimeType: asset.mimeType || 'image/jpeg',
          demoMode,
        });
        if (typeof ocr.bill_total_inr === 'number' && ocr.bill_total_inr > 0) {
          setBillInrDraft(String(ocr.bill_total_inr));
        }
      } catch {
        // Traveler can confirm or edit bill total manually
      } finally {
        setReadingBill(false);
      }
    }
  };

  const handlePayAndCheckIn = async (simulateOnly = false) => {
    if (parsedBillInr < minBillInr) {
      setCheckinError(`Enter a bill total of at least ₹${minBillInr} INR.`);
      return;
    }
    if (!billPhotoUri && !demoMode) {
      setCheckinError('Photograph your bill with the camera first.');
      return;
    }
    setCheckinError(null);
    setPayingCheckin(true);
    try {
      const order = await createPayPalCheckinOrder({
        questId: quest.id,
        questTitle: quest.title,
        merchantEmail: quest.merchantEmail,
        amountUsd: enteredBillUsd,
        billInr: parsedBillInr,
        payerOverride: {
          name: userProfile?.name || 'Traveler',
          email: userProfile?.email || 'traveler@roamr.app',
        },
        simulate: simulateOnly,
      });

      if (order.approveUrl && !order.simulated) {
        setPendingOrderId(order.orderId);
        const appReturnUrl = getExpoAwareDeepLink('paypal-return');
        const authRes = await WebBrowser.openAuthSessionAsync(order.approveUrl, appReturnUrl);

        if (authRes.type === 'success' && authRes.url) {
          const returned = parseQueryParams(authRes.url);
          if (returned.status === 'captured') {
            const paidOrderId = returned.orderId || order.orderId;
            const paidAmount = Number(returned.amountUsd || order.amountUsd);
            recordCheckinOrder({
              orderId: paidOrderId,
              captureId: returned.captureId || order.orderId,
              questId: quest.id,
              status: 'COMPLETED',
              amountUsd: paidAmount,
              billInr: parsedBillInr,
              billPhotoUri: billPhotoUri || undefined,
              billPhotoBase64,
              payeeEmail: returned.payeeEmail || order.payeeEmail,
              payerName: returned.payerName || userProfile?.name || 'PayPal Buyer',
              payerEmail: returned.payerEmail || userProfile?.email || '',
              payerId: returned.payerId || '',
              simulated: returned.simulated === '1',
            });
            setPendingOrderId(null);
            setSuccessPopData({ orderId: paidOrderId, amountUsd: paidAmount });
            return;
          }
          if (returned.status === 'cancelled') {
            setCheckinError('PayPal check-in checkout was cancelled before approval.');
            return;
          }
          if (returned.status === 'error') {
            setCheckinError(returned.message || 'PayPal capture failed on return.');
            return;
          }
        }
        return;
      }

      const cap = await capturePayPalCheckinOrder({
        questId: quest.id,
        orderId: order.orderId,
        merchantEmail: order.payeeEmail,
        amountUsd: enteredBillUsd,
        billInr: parsedBillInr,
        payerOverride: {
          name: userProfile?.name || 'Traveler',
          email: userProfile?.email || 'traveler@roamr.app',
        },
      });
      recordCheckinOrder({
        ...cap,
        billInr: parsedBillInr,
        billPhotoUri: billPhotoUri || undefined,
        billPhotoBase64,
      });
      setSuccessPopData({ orderId: cap.orderId, amountUsd: cap.amountUsd });
    } catch (err) {
      setCheckinError(
        err instanceof Error ? err.message : 'Unable to complete PayPal check-in order.'
      );
    } finally {
      setPayingCheckin(false);
    }
  };

  const handleCapturePendingOrder = async () => {
    if (!pendingOrderId) return;
    setCheckinError(null);
    setPayingCheckin(true);
    try {
      const cap = await capturePayPalCheckinOrder({
        questId: quest.id,
        orderId: pendingOrderId,
        merchantEmail: quest.merchantEmail,
        amountUsd: enteredBillUsd,
      });
      recordCheckinOrder({
        ...cap,
        billInr: parsedBillInr,
        billPhotoUri: billPhotoUri || undefined,
        billPhotoBase64,
      });
      setPendingOrderId(null);
      setSuccessPopData({ orderId: cap.orderId, amountUsd: cap.amountUsd });
    } catch (err) {
      setCheckinError(
        err instanceof Error ? err.message : 'Order not yet approved in PayPal browser.'
      );
    } finally {
      setPayingCheckin(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={[styles.screen, { backgroundColor: palette.bgCream }]}
    >
      <ResponsiveContainer maxWidth={680} style={{ flex: 1 }}>
        <ScrollView
          bounces={false}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: 40 }]}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
        >
          {/* Hero Photo Header (safe fallback when seed quest has photo_url: null) */}
          <View
            style={[
              styles.heroWrap,
              {
                backgroundColor: palette.bgSage,
                height: quest.image ? 300 : 210,
              },
            ]}
          >
            {quest.image ? (
              <Image source={{ uri: quest.image }} style={styles.heroImage} />
            ) : (
              <View
                style={{
                  flex: 1,
                  alignItems: 'center',
                  justifyContent: 'center',
                  paddingHorizontal: 24,
                  gap: 8,
                }}
              >
                <CategoryIcon category={quest.category} size={44} color={palette.primary} />
                <Text
                  style={{
                    fontFamily: fonts.sansSemi,
                    fontSize: 13,
                    color: palette.primaryDark,
                  }}
                >
                  {quest.place_name || quest.businessName} • {quest.city || 'Bengaluru'}
                </Text>
              </View>
            )}

            <SafeAreaView style={styles.heroOverlayTop} edges={['top']}>
              <Pressable
                onPress={() => router.back()}
                style={[styles.circleBtn, { backgroundColor: palette.floatingPillBg }]}
                accessibilityLabel="Go back"
              >
                <Ionicons name="chevron-back" size={22} color={palette.textPrimary} />
              </Pressable>

              <Pressable
                onPress={handleShare}
                style={[styles.circleBtn, { backgroundColor: palette.floatingPillBg }]}
                accessibilityLabel="Share quest"
              >
                <Ionicons name="share-outline" size={20} color={palette.textPrimary} />
              </Pressable>
            </SafeAreaView>

            <View style={styles.xpFloatingBadge}>
              <Pill
                label={`${quest.xp} XP`}
                variant="gold"
                icon={<Ionicons name="star" size={13} color={palette.gold} />}
              />
            </View>
          </View>

          {/* Overlapping Rounded Sheet */}
          <View style={[styles.sheet, { backgroundColor: palette.bgCream }]}>
            <View style={[styles.dragHandle, { backgroundColor: palette.border }]} />

            <View style={styles.topPillsRow}>
              <Pill
                label={quest.distance}
                variant="sage"
                icon={<Ionicons name="location" size={13} color={palette.primary} />}
              />
              <Pill
                label={quest.difficulty}
                variant="sage"
                icon={<Ionicons name="bar-chart" size={13} color={palette.primary} />}
              />
            </View>

            <Text style={[styles.title, { color: palette.textPrimary }]}>{quest.title}</Text>
            <Text style={[styles.subtitle, { color: palette.textSecondary }]}>
              {quest.description}
            </Text>

            {/* Funded badge vs XP-only badge (no fake sponsor / no PayPal badge for XP-only) */}
            <View style={[styles.fundedRow, { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }]}>
              {isFunded ? (
                <>
                  <Pill
                    label={`Pays up to ${maxCashbackText}`}
                    variant="gold"
                    icon={<PayPalLogo size={12} />}
                  />
                  {quest.fundedBy ? (
                    quest.place_id ? (
                      <Pressable
                        onPress={() =>
                          router.push({
                            pathname: '/place/[id]',
                            params: { id: quest.place_id! },
                          })
                        }
                        style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
                      >
                        <Pill label={`Funded by ${quest.fundedBy} • View quests →`} variant="paypal" />
                      </Pressable>
                    ) : (
                      <Pill label={`Funded by ${quest.fundedBy}`} variant="paypal" />
                    )
                  ) : null}
                </>
              ) : (
                <>
                  <Pill
                    label="XP only"
                    variant="sage"
                    icon={<Ionicons name="star" size={12} color={palette.primary} />}
                  />
                  {cashbackSoldOut ? (
                    <Pill label="Cashback sold out, XP still counts" variant="neutral" />
                  ) : null}
                </>
              )}
              {timerInfo ? (
                <Pill
                  label={timerInfo.label}
                  variant={timerInfo.expired ? 'danger' : 'gold'}
                  icon={
                    <Ionicons
                      name="time-outline"
                      size={13}
                      color={timerInfo.expired ? palette.danger : palette.goldText}
                    />
                  }
                />
              ) : null}
            </View>

            {/* 3-Column Stats Strip */}
            <View style={[styles.statsStrip, { borderColor: palette.border }]}>
              <View style={styles.statCol}>
                <Ionicons name="time-outline" size={20} color={palette.primary} />
                <Text style={[styles.statVal, { color: palette.textPrimary }]}>{quest.estTime}</Text>
                <Text style={[styles.statLbl, { color: palette.textMuted }]}>Est. Time</Text>
              </View>

              <View style={[styles.statDivider, { backgroundColor: palette.border }]} />

              <View style={styles.statCol}>
                <CategoryIcon category={quest.category} size={20} color={palette.primary} />
                <Text style={[styles.statVal, { color: palette.textPrimary }]}>{quest.category}</Text>
                <Text style={[styles.statLbl, { color: palette.textMuted }]}>Category</Text>
              </View>

              <View style={[styles.statDivider, { backgroundColor: palette.border }]} />

              <View style={styles.statCol}>
                <Ionicons
                  name={isFunded ? 'gift-outline' : 'star-outline'}
                  size={20}
                  color={isFunded ? palette.goldText : palette.primary}
                />
                <Text style={[styles.statVal, { color: palette.textPrimary }]}>
                  {isFunded ? `Up to ${maxCashbackText}` : `${quest.xp} XP`}
                </Text>
                <Text style={[styles.statLbl, { color: palette.textMuted }]}>
                  {isFunded ? 'Cashback' : 'Reward'}
                </Text>
              </View>
            </View>

            {/* Quest Objective */}
            <View style={styles.objectiveSection}>
              <Text style={[styles.objectiveHeading, { color: palette.textPrimary }]}>
                Quest Objective
              </Text>
              <View
                style={[
                  styles.objectiveRow,
                  { backgroundColor: palette.bgCard, borderColor: palette.border },
                ]}
              >
                <View
                  style={[
                    styles.checkRing,
                    { borderColor: palette.border },
                    isCompleted && { backgroundColor: palette.primary, borderColor: palette.primary },
                  ]}
                >
                  {isCompleted ? (
                    <Ionicons name="checkmark" size={14} color={palette.white} />
                  ) : null}
                </View>
                <Text style={[styles.objectiveText, { color: palette.textSecondary }]}>
                  {quest.objective}
                </Text>
              </View>
            </View>

            {/* Google Maps link & Night quest notice */}
            {quest.maps_link || quest.night_only ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                {quest.maps_link ? (
                  <Pressable
                    onPress={() => void Linking.openURL(quest.maps_link!)}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 6,
                      paddingHorizontal: 12,
                      paddingVertical: 6,
                      borderRadius: radii.pill,
                      backgroundColor: palette.bgSage,
                    }}
                  >
                    <Ionicons name="map-outline" size={14} color={palette.primaryDark} />
                    <Text style={{ fontFamily: fonts.sansSemi, fontSize: 12, color: palette.primaryDark }}>
                      Open in Google Maps
                    </Text>
                  </Pressable>
                ) : null}
                {quest.night_only ? (
                  <Pill
                    label="Night Quest (18:30–05:00 IST)"
                    variant="gold"
                    icon={<Ionicons name="moon" size={12} color={palette.goldText} />}
                  />
                ) : null}
              </View>
            ) : null}

            {/* Bill-Based PayPal Checkout (Purchase) vs Free Check-In (Visit) */}
            {alreadyCompleted ? (
              <View
                style={[
                  styles.checkinBox,
                  { backgroundColor: palette.successSoft, borderColor: palette.success },
                ]}
              >
                <View style={styles.checkinHeader}>
                  <Ionicons name="checkmark-circle" size={18} color={palette.success} />
                  <Text style={[styles.checkinTitle, { color: palette.success }]}>
                    Quest Completed & Reward Paid
                  </Text>
                </View>
                <Text style={[styles.checkinMeta, { color: palette.textSecondary }]}>
                  {isFunded
                    ? `You already earned ${formatMoney(rewardCents, { showInr })} & +${quest.xp} XP for this venue.`
                    : `You already earned +${quest.xp} XP & the passport stamp for this venue.`}{' '}
                  Each quest can be claimed once.
                </Text>
                {completedClaim ? (
                  <View style={{ marginTop: 8 }}>
                    <ClaimStatusTracker claim={completedClaim} />
                  </View>
                ) : null}
              </View>
            ) : !isFunded || questType === 'visit' ? (
              <View
                style={[
                  styles.billCard,
                  { backgroundColor: palette.bgCard, borderColor: palette.border },
                ]}
              >
                <View style={styles.billTopRow}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Ionicons name="star" size={18} color={palette.primary} />
                    <Text style={[styles.billTitle, { color: palette.textPrimary }]}>
                      {cashbackSoldOut ? 'Cashback Sold Out — XP Mode' : 'XP-Only Exploration Quest'}
                    </Text>
                  </View>
                  <Pill label="XP only" variant="sage" />
                </View>
                <Text style={[styles.billSub, { color: palette.textSecondary }]}>
                  {cashbackSoldOut
                    ? `Cashback sold out, XP still counts. Check in within ${quest.radius_m || 150} m and capture your live photo to earn +${quest.xp} XP and your passport stamp.`
                    : `No bill or PayPal payment required. Check in within ${quest.radius_m || 150} m, capture a live photo, and AI awards +${quest.xp} XP and a passport stamp.`}
                </Text>
                {quest.text_answer_prompt ? (
                  <Text style={[styles.checkinMeta, { color: palette.primaryDark }]}>
                    Includes question: "{quest.text_answer_prompt}"
                  </Text>
                ) : null}
              </View>
            ) : existingCheckin ? (
              <View
                style={[
                  styles.checkinBox,
                  { backgroundColor: palette.paypalSoft, borderColor: palette.paypalBlue },
                ]}
              >
                <View style={styles.checkinHeader}>
                  <PayPalLogo size={16} variant="badge" />
                  <Text style={[styles.checkinTitle, { color: palette.paypalBlue }]}>
                    Bill Paid ({existingCheckin.status})
                  </Text>
                </View>
                <Text style={[styles.checkinMeta, { color: palette.textSecondary }]}>
                  Order {existingCheckin.orderId} • Paid{' '}
                  {formatMoney(usdToCents(existingCheckin.amountUsd), { showInr })} (bill ₹
                  {existingCheckin.billInr || parsedBillInr})
                </Text>
              </View>
            ) : (
              <View
                style={[
                  styles.billCard,
                  { backgroundColor: palette.bgCard, borderColor: palette.border },
                ]}
              >
                <View style={styles.billTopRow}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <PayPalLogo size={16} variant="badge" />
                    <Text style={[styles.billTitle, { color: palette.textPrimary }]}>
                      1. Snap Bill & Confirm Total
                    </Text>
                  </View>
                  <Pill label={`Min ₹${minBillInr}`} variant="sage" />
                </View>
                <Text style={[styles.billSub, { color: palette.textSecondary }]}>
                  {cashbackPercent}% back, up to {maxCashbackText}, on bills over ₹{minBillInr}. Snap your bill photo first so AI reads the total for PayPal checkout.
                </Text>

                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                  <Button
                    label={
                      readingBill
                        ? 'Reading Bill...'
                        : billPhotoUri
                        ? 'Retake Bill Photo'
                        : 'Photograph Bill (Camera)'
                    }
                    variant={billPhotoUri ? 'secondary' : 'outline'}
                    loading={readingBill}
                    icon={<Ionicons name="receipt-outline" size={17} color={palette.primaryDark} />}
                    onPress={() => handleCaptureBillPhoto(false)}
                    style={{ flex: 1 }}
                  />
                </View>

                <View
                  style={[
                    styles.billInputWrap,
                    {
                      backgroundColor: palette.bgSoft,
                      borderColor: parsedBillInr >= minBillInr ? palette.paypalBlue : palette.danger,
                    },
                  ]}
                >
                  <Text style={[styles.billCurrencyPrefix, { color: palette.textPrimary }]}>₹</Text>
                  <TextInput
                    value={billInrDraft}
                    onChangeText={setBillInrDraft}
                    keyboardType="numeric"
                    selectTextOnFocus
                    placeholder={String(minBillInr)}
                    placeholderTextColor={palette.textMuted}
                    style={[styles.billInput, { color: palette.textPrimary }]}
                  />
                  <Text style={[styles.billUsdInrHint, { color: palette.textSecondary }]}>
                    = ${enteredBillUsd.toFixed(2)} USD
                  </Text>
                </View>

                <View style={[styles.billSummaryBox, { backgroundColor: palette.bgSage }]}>
                  <View style={styles.billSummaryRow}>
                    <Text style={[styles.billSummaryLbl, { color: palette.textSecondary }]}>
                      PayPal Charge (1 USD = ₹{USD_TO_INR})
                    </Text>
                    <Text style={[styles.billSummaryVal, { color: palette.textPrimary }]}>
                      ${enteredBillUsd.toFixed(2)} (bill ₹{parsedBillInr})
                    </Text>
                  </View>
                  <View style={styles.billSummaryRow}>
                    <Text style={[styles.billSummaryLbl, { color: palette.primaryDark }]}>
                      {cashbackPercent}% Cashback (up to ${maxRewardUsd.toFixed(2)})
                    </Text>
                    <Text style={[styles.billSummaryVal, { color: palette.primary }]}>
                      +${estimatedCashbackUsd.toFixed(2)} USD • +{quest.xp} XP
                    </Text>
                  </View>
                </View>

                {parsedBillInr < minBillInr ? (
                  <Text style={[styles.billWarn, { color: palette.danger }]}>
                    Minimum bill for this quest is ₹{minBillInr} INR.
                  </Text>
                ) : null}
              </View>
            )}

            {checkinError ? (
              <View style={[styles.checkinBox, { backgroundColor: palette.dangerSoft, borderColor: palette.danger }]}>
                <Text style={[styles.checkinTitle, { color: palette.danger }]}>Check-In Error</Text>
                <Text style={[styles.checkinMeta, { color: palette.danger }]}>{checkinError}</Text>
              </View>
            ) : null}
          </View>
        </ScrollView>

        {/* Bottom Sticky CTA */}
        <SafeAreaView
          edges={['bottom']}
          style={[
            styles.bottomCtaBar,
            { backgroundColor: palette.bgCream, borderTopColor: palette.border },
          ]}
        >
          {alreadyCompleted ? (
            <Button
              label="Quest Completed ✓"
              variant="secondary"
              disabled
              icon={<Ionicons name="checkmark-circle" size={20} color={palette.success} />}
              onPress={() => {}}
            />
          ) : questType === 'visit' ? (
            <Button
              label="Check in →"
              disabled={Boolean(timerInfo?.expired)}
              icon={<Ionicons name="camera" size={20} color={palette.white} />}
              onPress={() =>
                router.push({
                  pathname: '/quest/submit',
                  params: { id: quest.id },
                })
              }
            />
          ) : existingCheckin ? (
            <Button
              label="Capture Camera Proof →"
              disabled={Boolean(timerInfo?.expired)}
              icon={<Ionicons name="camera" size={20} color={palette.white} />}
              onPress={() =>
                router.push({
                  pathname: '/quest/submit',
                  params: { id: quest.id },
                })
              }
            />
          ) : (
            <View style={{ gap: 8 }}>
              {pendingOrderId ? (
                <Button
                  label={payingCheckin ? 'Capturing...' : 'Confirm & Capture Check-In Order'}
                  loading={payingCheckin}
                  onPress={handleCapturePendingOrder}
                />
              ) : null}
              <Button
                label={
                  timerInfo?.expired
                    ? 'Quest Expired'
                    : payingCheckin
                    ? 'Opening PayPal...'
                    : `Pay $${enteredBillUsd.toFixed(2)} (bill ₹${parsedBillInr}) with PayPal`
                }
                variant="paypal"
                loading={payingCheckin}
                disabled={Boolean(timerInfo?.expired) || !isBillValid}
                icon={
                  payingCheckin ? (
                    <ActivityIndicator size="small" color={palette.white} />
                  ) : (
                    <PayPalLogo size={15} variant="badge" />
                  )
                }
                onPress={() => handlePayAndCheckIn(false)}
              />
            </View>
          )}
        </SafeAreaView>
      </ResponsiveContainer>

      <Modal visible={Boolean(successPopData)} transparent animationType="fade">
        <View style={[styles.successModalOverlay, { backgroundColor: palette.sheetScrim }]}>
          {successPopData ? (
            <PaymentSuccessPop
              title="Bill Payment Confirmed!"
              subtitle={`Paid $${successPopData.amountUsd.toFixed(2)} to ${quest.businessName || quest.place_name || 'Merchant'} via PayPal (sandbox)`}
              amountUsd={successPopData.amountUsd}
              orderId={successPopData.orderId}
              ctaLabel="Capture Camera Proof →"
              onContinue={() => {
                setSuccessPopData(null);
                router.push({ pathname: '/quest/submit', params: { id: quest.id } });
              }}
              autoContinueMs={1050}
            />
          ) : null}
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bgCream,
  },
  scrollContent: {
    paddingBottom: 24,
  },
  heroWrap: {
    height: 310,
    width: '100%',
    position: 'relative',
    backgroundColor: colors.bgSage,
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  heroOverlayTop: {
    position: 'absolute',
    top: 8,
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  circleBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.soft,
  },
  xpFloatingBadge: {
    position: 'absolute',
    right: 16,
    bottom: 42,
    ...shadows.soft,
  },
  sheet: {
    backgroundColor: colors.bgCream,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    marginTop: -28,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  dragHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: 14,
  },
  topPillsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    fontFamily: fonts.serif,
    fontSize: 30,
    lineHeight: 36,
    color: colors.textPrimary,
  },
  subtitle: {
    fontFamily: fonts.sans,
    fontSize: 15,
    lineHeight: 22,
    color: colors.textSecondary,
    marginTop: 8,
  },
  fundedRow: {
    marginTop: 12,
  },
  statsStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    marginTop: 18,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  statCol: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  statDivider: {
    width: 1,
    height: 36,
    backgroundColor: colors.border,
  },
  statVal: {
    fontFamily: fonts.sansSemi,
    fontSize: 14,
    color: colors.textPrimary,
    marginTop: 2,
  },
  statLbl: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.textMuted,
  },
  objectiveSection: {
    marginTop: 20,
  },
  objectiveHeading: {
    fontFamily: fonts.serif,
    fontSize: 19,
    color: colors.textPrimary,
    marginBottom: 12,
  },
  objectiveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.white,
    padding: 14,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  checkRing: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkRingDone: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  objectiveText: {
    flex: 1,
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  checkinBox: {
    marginTop: 14,
    padding: 12,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: 5,
  },
  checkinHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  checkinTitle: {
    fontFamily: fonts.sansSemi,
    fontSize: 13,
  },
  checkinMeta: {
    fontFamily: fonts.sans,
    fontSize: 12,
    lineHeight: 17,
  },
  billCard: {
    marginTop: 18,
    padding: 16,
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: 10,
  },
  billTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  billTitle: {
    fontFamily: fonts.serif,
    fontSize: 18,
  },
  billSub: {
    fontFamily: fonts.sans,
    fontSize: 12.5,
    lineHeight: 18,
  },
  billInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.md,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    height: 52,
    gap: 6,
  },
  billCurrencyPrefix: {
    fontFamily: fonts.serif,
    fontSize: 22,
  },
  billInput: {
    flex: 1,
    fontFamily: fonts.sansBold,
    fontSize: 20,
  },
  billUsdInrHint: {
    fontFamily: fonts.sansMedium,
    fontSize: 12.5,
  },
  billPresetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  billPresetChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radii.pill,
    borderWidth: 1,
  },
  billPresetText: {
    fontFamily: fonts.sansSemi,
    fontSize: 12,
  },
  billSummaryBox: {
    padding: 10,
    borderRadius: radii.md,
    gap: 5,
  },
  billSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  billSummaryLbl: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
  },
  billSummaryVal: {
    fontFamily: fonts.sansBold,
    fontSize: 12.5,
  },
  billWarn: {
    fontFamily: fonts.sansSemi,
    fontSize: 12,
  },
  successModalOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  bottomCtaBar: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 12,
    backgroundColor: colors.bgCream,
    borderTopWidth: 1,
    borderTopColor: 'rgba(220,229,221,0.6)',
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  emptyText: {
    fontFamily: fonts.serif,
    fontSize: 20,
    color: colors.textPrimary,
  },
});

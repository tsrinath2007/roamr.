import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';
import { getExpoAwareDeepLink } from '../../utils/deepLink';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useRoamr } from '../../context/RoamrContext';
import {
  capturePayPalFundingOrder,
  createPayPalFundingOrder,
  getApiBaseUrl,
} from '../../services/api';
import { Card } from '../../components/Card';
import { LiquidBackdrop } from '../../components/LiquidBackdrop';
import { Pill } from '../../components/Pill';
import { PayPalLogo } from '../../components/PayPalLogo';
import { PaymentSuccessPop } from '../../components/PaymentSuccessPop';
import { Button } from '../../components/Button';
import { ResponsiveContainer } from '../../components/ResponsiveContainer';
import { formatMoney, usdToCents } from '../../../lib/currency';
import { colors, fonts, radii } from '../../theme/tokens';

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

export default function FundQuestScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { ownerQuests, showInr, markQuestFunded, palette } = useRoamr();

  // Only allow funding quests the signed-in user owns
  const quest = ownerQuests.find((q) => q.id === id) ?? null;
  const budgetCents = quest?.budgetCents ?? usdToCents(quest?.budgetUsd || 50);
  const rewardCents = quest?.rewardCents ?? usdToCents(quest?.rewardUsd || 5);
  const budgetUsd = quest?.budgetUsd || 50;
  const rewardUsd = quest?.rewardUsd || 5;
  const estimatedVisits = Math.floor(budgetUsd / Math.max(1, rewardUsd));

  const [step, setStep] = useState<'ready' | 'awaiting_capture' | 'funded'>(
    quest?.funded ? 'funded' : 'ready'
  );
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [orderInfo, setOrderInfo] = useState<{
    orderId: string;
    approveUrl: string | null;
    simulated: boolean;
    debugId?: string | null;
    message: string;
  } | null>(null);

  useEffect(() => {
    if (quest?.funded) {
      setStep('funded');
    }
  }, [quest?.funded]);

  if (!quest) {
    return (
      <SafeAreaView style={[{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.bgCream }]}>
        <Text style={{ fontFamily: fonts.sans, fontSize: 15, color: palette.danger, textAlign: 'center', paddingHorizontal: 32 }}>
          Quest not found or you don't have permission to fund it.
        </Text>
      </SafeAreaView>
    );
  }

  const handleFundWithPayPal = async (simulateOnly = false) => {
    if (quest.funded) {
      setStep('funded');
      return;
    }
    setErrorMsg(null);
    setLoading(true);
    try {
      const order = await createPayPalFundingOrder({
        questId: quest.id,
        questTitle: quest.title,
        amountUsd: budgetUsd,
        simulate: simulateOnly,
      });

      setOrderInfo({
        orderId: order.orderId,
        approveUrl: order.approveUrl,
        simulated: order.simulated,
        debugId: order.debugId,
        message: order.message,
      });

      if (order.approveUrl && !order.simulated) {
        const appReturnUrl = getExpoAwareDeepLink('paypal-return');
        const authResult = await WebBrowser.openAuthSessionAsync(
          order.approveUrl,
          appReturnUrl
        );

        if (authResult.type === 'success' && authResult.url) {
          const returned = parseQueryParams(authResult.url);
          if (returned.status === 'captured') {
            markQuestFunded(
              quest.id,
              Number(returned.amountUsd || budgetUsd),
              returned.orderId || order.orderId,
              returned.captureId || order.orderId
            );
            setOrderInfo({
              orderId: returned.orderId || order.orderId,
              approveUrl: order.approveUrl,
              simulated: returned.simulated === '1',
              debugId: order.debugId,
              message: 'PayPal Sandbox order approved and captured via server return bridge.',
            });
            setStep('funded');
            return;
          }
          if (returned.status === 'cancelled') {
            setErrorMsg('PayPal checkout was cancelled before approval.');
            setStep('ready');
            return;
          }
          if (returned.status === 'error') {
            setErrorMsg(returned.message || 'PayPal capture failed on return.');
            setStep('awaiting_capture');
            return;
          }
        }

        setStep('awaiting_capture');
      } else {
        const cap = await capturePayPalFundingOrder({
          questId: quest.id,
          orderId: order.orderId,
          amountUsd: budgetUsd,
        });
        markQuestFunded(quest.id, budgetUsd, cap.orderId, cap.captureId);
        setOrderInfo((prev) =>
          prev ? { ...prev, message: cap.message, simulated: cap.simulated } : null
        );
        setStep('funded');
      }
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Unable to connect to PayPal funding endpoint.';
      setErrorMsg(`${msg} (API: ${getApiBaseUrl() || 'EXPO_PUBLIC_API_URL unset'})`);
    } finally {
      setLoading(false);
    }
  };

  const handleCaptureOrder = async () => {
    if (!orderInfo) return;
    setErrorMsg(null);
    setLoading(true);
    try {
      const cap = await capturePayPalFundingOrder({
        questId: quest.id,
        orderId: orderInfo.orderId,
        amountUsd: budgetUsd,
      });
      markQuestFunded(quest.id, budgetUsd, cap.orderId, cap.captureId);
      setOrderInfo((prev) =>
        prev
          ? {
              ...prev,
              message: cap.message,
              simulated: cap.simulated,
              debugId: cap.debugId,
            }
          : null
      );
      setStep('funded');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Capture failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.bgCream }]}>
      <LiquidBackdrop variant="business" />
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
          <Text style={[styles.topTitle, { color: palette.textPrimary }]}>Fund Quest Budget</Text>
          <View style={styles.spacer} />
        </View>

        <ScrollView contentContainerStyle={styles.scrollContent}>
          <Card style={styles.summaryCard}>
            <Pill label="PayPal Orders v2" variant="paypal" icon={<PayPalLogo size={12} />} />
            <Text style={[styles.questTitle, { color: palette.textPrimary }]}>{quest.title}</Text>
            <Text style={[styles.businessName, { color: palette.textSecondary }]}>
              Sponsored by {quest.businessName}
            </Text>

            <View style={[styles.breakdown, { backgroundColor: palette.bgSoft }]}>
              <View style={styles.row}>
                <Text style={[styles.rowLabel, { color: palette.textSecondary }]}>
                  Reward per verified visit
                </Text>
                <Text style={[styles.rowValue, { color: palette.textPrimary }]}>
                  {formatMoney(rewardCents, { showInr })}
                </Text>
              </View>
              <View style={styles.row}>
                <Text style={[styles.rowLabel, { color: palette.textSecondary }]}>
                  Estimated traveler visits
                </Text>
                <Text style={[styles.rowValue, { color: palette.textPrimary }]}>
                  {estimatedVisits} visits
                </Text>
              </View>
              <View style={[styles.divider, { backgroundColor: palette.border }]} />
              <View style={styles.row}>
                <Text style={[styles.totalLabel, { color: palette.textPrimary }]}>
                  Total Escrow Budget
                </Text>
                <Text style={[styles.totalValue, { color: palette.primaryDark }]}>
                  {formatMoney(budgetCents, { showInr })}
                </Text>
              </View>
            </View>
            <Text style={[styles.usdFooterNote, { color: palette.paypalBlue }]}>
              Orders and payouts are processed in USD (PayPal Sandbox).
            </Text>
          </Card>

          {errorMsg ? (
            <Card style={[styles.errorCard, { backgroundColor: palette.dangerSoft }]}>
              <View style={styles.errorHeader}>
                <Ionicons name="alert-circle" size={18} color={palette.danger} />
                <Text style={[styles.errorTitle, { color: palette.danger }]}>PayPal Error</Text>
              </View>
              <Text style={[styles.errorText, { color: palette.danger }]}>{errorMsg}</Text>
            </Card>
          ) : null}

          {orderInfo ? (
            <Card style={[styles.statusCard, { backgroundColor: palette.bgSage }]}>
              <View style={styles.statusHeader}>
                <Pill
                  label={orderInfo.simulated ? 'Simulated Fallback' : 'PayPal Sandbox'}
                  variant={orderInfo.simulated ? 'gold' : 'paypal'}
                />
                <Text style={[styles.orderIdText, { color: palette.textSecondary }]}>
                  Order {orderInfo.orderId}
                </Text>
              </View>
              <Text style={[styles.statusMsg, { color: palette.textPrimary }]}>
                {orderInfo.message}
              </Text>
              {orderInfo.debugId ? (
                <Text style={[styles.debugText, { color: palette.textMuted }]}>
                  PayPal debug_id: {orderInfo.debugId}
                </Text>
              ) : null}
            </Card>
          ) : null}

          {step === 'ready' ? (
            <View style={styles.actionsCol}>
              <Card style={[styles.hintCard, { backgroundColor: palette.paypalSoft }]}>
                <View style={styles.hintHeader}>
                  <PayPalLogo size={15} variant="badge" />
                  <Text style={[styles.hintTitle, { color: palette.paypalBlue }]}>
                    PayPal Sandbox Buyer Login
                  </Text>
                </View>
                <Text style={[styles.hintBody, { color: palette.textSecondary }]}>
                  When PayPal opens, sign in using a Sandbox Personal (Buyer) account from developer.paypal.com → Sandbox → Accounts (not your personal Gmail).
                </Text>
              </Card>
              <Button
                label={
                  loading
                    ? 'Creating PayPal Order...'
                    : `Fund ${formatMoney(budgetCents, { showInr })} with PayPal`
                }
                variant="paypal"
                loading={loading}
                onPress={() => handleFundWithPayPal(false)}
                icon={<PayPalLogo size={15} variant="badge" />}
              />
            </View>
          ) : null}

          {step === 'awaiting_capture' ? (
            <View style={styles.actionsCol}>
              <Button
                label={loading ? 'Capturing Payment...' : 'Confirm & Capture PayPal Order'}
                loading={loading}
                onPress={handleCaptureOrder}
                icon={<Ionicons name="checkmark-circle-outline" size={18} color={palette.white} />}
              />
              {orderInfo?.approveUrl ? (
                <Button
                  label="Re-open PayPal Approval"
                  variant="outline"
                  onPress={() =>
                    WebBrowser.openAuthSessionAsync(
                      orderInfo.approveUrl!,
                      getExpoAwareDeepLink('paypal-return')
                    )
                  }
                />
              ) : null}
            </View>
          ) : null}

          {step === 'funded' ? (
            <View style={{ alignItems: 'center' }}>
              <PaymentSuccessPop
                title="Quest Budget Funded!"
                subtitle={`${quest.title} is now live with ${formatMoney(budgetCents, { showInr })} ready for instant AI rewards.`}
                amountUsd={budgetUsd}
                orderId={orderInfo?.orderId}
                ctaLabel="Back to Business Dashboard"
                onContinue={() => router.replace('/(business)')}
                autoContinueMs={0}
              />
            </View>
          ) : null}
        </ScrollView>
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
    gap: 16,
  },
  summaryCard: {
    gap: 8,
  },
  questTitle: {
    fontFamily: fonts.serif,
    fontSize: 24,
    color: colors.textPrimary,
    marginTop: 4,
  },
  businessName: {
    fontFamily: fonts.sans,
    fontSize: 13.5,
    color: colors.textSecondary,
  },
  breakdown: {
    backgroundColor: colors.bgCream,
    borderRadius: radii.md,
    padding: 14,
    gap: 10,
    marginTop: 8,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rowLabel: {
    fontFamily: fonts.sans,
    fontSize: 13.5,
    color: colors.textSecondary,
  },
  rowValue: {
    fontFamily: fonts.sansSemi,
    fontSize: 14,
    color: colors.textPrimary,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
  },
  totalLabel: {
    fontFamily: fonts.sansSemi,
    fontSize: 14,
    color: colors.textPrimary,
    flexShrink: 1,
  },
  totalValue: {
    fontFamily: fonts.serif,
    fontSize: 20,
    color: colors.primaryDark,
    marginLeft: 8,
  },
  usdFooterNote: {
    fontFamily: fonts.sansSemi,
    fontSize: 12,
    color: colors.paypalBlue,
    marginTop: 6,
  },
  errorCard: {
    backgroundColor: colors.dangerSoft,
    borderColor: 'rgba(184, 56, 45, 0.35)',
    gap: 6,
  },
  errorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  errorTitle: {
    fontFamily: fonts.sansSemi,
    fontSize: 14,
    color: colors.danger,
  },
  errorText: {
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 19,
    color: colors.danger,
  },
  statusCard: {
    backgroundColor: colors.bgSage,
    gap: 8,
  },
  statusHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  orderIdText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.textSecondary,
  },
  statusMsg: {
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textPrimary,
  },
  debugText: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.textMuted,
  },
  actionsCol: {
    gap: 10,
  },
  hintCard: {
    backgroundColor: colors.paypalSoft,
    borderColor: 'rgba(0, 112, 186, 0.25)',
    gap: 4,
  },
  hintHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  hintTitle: {
    fontFamily: fonts.sansSemi,
    fontSize: 13,
    color: colors.paypalBlue,
  },
  hintBody: {
    fontFamily: fonts.sans,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textSecondary,
  },
  successCard: {
    alignItems: 'center',
    gap: 10,
    paddingVertical: 24,
  },
  successTitle: {
    fontFamily: fonts.serif,
    fontSize: 22,
    color: colors.textPrimary,
  },
  successSub: {
    fontFamily: fonts.sans,
    fontSize: 13.5,
    lineHeight: 20,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  fullBtn: {
    width: '100%',
    marginTop: 8,
  },
});

import React, { useCallback, useEffect, useRef } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useRoamr } from '../context/RoamrContext';
import { PayPalLogo } from '../components/PayPalLogo';
import { PaymentSuccessPop } from '../components/PaymentSuccessPop';
import { LiquidBackdrop } from '../components/LiquidBackdrop';
import { colors, fonts } from '../theme/tokens';

export default function PayPalReturnScreen() {
  const params = useLocalSearchParams<{
    status?: string;
    checkin?: string;
    questId?: string;
    orderId?: string;
    captureId?: string;
    amountUsd?: string;
    payeeEmail?: string;
    payerName?: string;
    payerEmail?: string;
    payerId?: string;
    simulated?: string;
    message?: string;
  }>();

  const {
    palette,
    userProfile,
    selectedQuestId,
    recordCheckinOrder,
    markQuestFunded,
  } = useRoamr();

  const recordedRef = useRef(false);
  const navigatedRef = useRef(false);

  const isCaptured = params.status === 'captured';
  const isCheckin = params.checkin === '1';
  const resolvedQuestId = params.questId || selectedQuestId || '';
  const parsedAmount = Number(params.amountUsd || 0);

  // Immediately persist the captured payment receipt/funding when returning via deep link
  useEffect(() => {
    if (!isCaptured || recordedRef.current) return;
    recordedRef.current = true;

    if (isCheckin && resolvedQuestId) {
      recordCheckinOrder({
        orderId: params.orderId || `ORD-${Date.now()}`,
        captureId: params.captureId || params.orderId || `CAP-${Date.now()}`,
        questId: resolvedQuestId,
        status: 'COMPLETED',
        amountUsd: parsedAmount > 0 ? parsedAmount : 1,
        payeeEmail: params.payeeEmail || 'sb-merchant@business.example.com',
        payerName: params.payerName || userProfile?.name || 'PayPal Buyer',
        payerEmail: params.payerEmail || userProfile?.email || '',
        payerId: params.payerId || '',
        simulated: params.simulated === '1',
      });
    } else if (resolvedQuestId) {
      markQuestFunded(
        resolvedQuestId,
        parsedAmount > 0 ? parsedAmount : 50,
        params.orderId,
        params.captureId
      );
    }
  }, [
    isCaptured,
    isCheckin,
    markQuestFunded,
    params.captureId,
    params.orderId,
    params.payeeEmail,
    params.payerEmail,
    params.payerId,
    params.payerName,
    params.simulated,
    parsedAmount,
    recordCheckinOrder,
    resolvedQuestId,
    userProfile?.email,
    userProfile?.name,
  ]);

  const finishNavigation = useCallback(() => {
    if (navigatedRef.current) return;
    navigatedRef.current = true;

    if (isCaptured && isCheckin && resolvedQuestId) {
      router.replace({ pathname: '/quest/submit', params: { id: resolvedQuestId } });
      return;
    }
    if (isCaptured && !isCheckin) {
      router.replace('/(business)/funding');
      return;
    }
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)');
    }
  }, [isCaptured, isCheckin, resolvedQuestId]);

  useEffect(() => {
    if (isCaptured) return;
    const timer = setTimeout(finishNavigation, 450);
    return () => clearTimeout(timer);
  }, [finishNavigation, isCaptured]);

  if (isCaptured) {
    return (
      <View style={[styles.wrap, { backgroundColor: palette.bgCream }]}>
        <LiquidBackdrop variant={isCheckin ? 'traveler' : 'business'} />
        <PaymentSuccessPop
          title={isCheckin ? 'Bill Payment Confirmed!' : 'Quest Budget Funded!'}
          subtitle={
            isCheckin
              ? 'PayPal Sandbox captured your bill. Next step: snap live proof at the venue.'
              : 'Your PayPal Sandbox escrow budget is live for travelers.'
          }
          amountUsd={parsedAmount > 0 ? parsedAmount : undefined}
          orderId={params.orderId}
          ctaLabel={isCheckin ? 'Capture Camera Proof →' : 'View Funding Ledger →'}
          onContinue={finishNavigation}
          autoContinueMs={1150}
        />
      </View>
    );
  }

  return (
    <View style={[styles.wrap, { backgroundColor: palette.bgCream }]}>
      <PayPalLogo size={40} variant="badge" />
      <ActivityIndicator size="large" color={palette.paypalBlue} />
      <Text style={[styles.text, { color: palette.textSecondary }]}>
        {params.status === 'cancelled'
          ? 'PayPal checkout cancelled. Returning...'
          : params.status === 'error'
          ? params.message || 'PayPal checkout error. Returning...'
          : 'Returning from PayPal Sandbox...'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgCream,
    padding: 20,
    gap: 12,
  },
  text: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRoamr } from '../context/RoamrContext';
import { ClaimRecord, ClaimStatus } from '../types/roamr';
import { fonts, radii } from '../theme/tokens';

type TrackerStepKey = 'submitted' | 'checked' | 'outcome';

function buildSteps(status: ClaimStatus): { key: TrackerStepKey; label: string }[] {
  const outcomeLabel =
    status === 'retake' ? 'Retake' : status === 'rejected' ? 'Rejected' : 'Paid';
  return [
    { key: 'submitted', label: 'Submitted' },
    { key: 'checked', label: 'Checked' },
    { key: 'outcome', label: outcomeLabel },
  ];
}

function getStepIndex(claim: ClaimRecord): number {
  switch (claim.status) {
    case 'submitted':
      return 0;
    case 'retake':
      return 2;
    case 'paid':
      return 2;
    case 'rejected':
      return claim.aiReviewedAt ? 2 : 1;
    default:
      return 0;
  }
}

export function ClaimStatusTracker({ claim }: { claim: ClaimRecord }) {
  const { palette, isDark } = useRoamr();
  const isRejected = claim.status === 'rejected';
  const isRetake = claim.status === 'retake';
  const steps = buildSteps(claim.status);
  const activeIndex = getStepIndex(claim);

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {steps.map((step, idx) => {
          const isCurrent = idx === activeIndex;
          const isOutcomeIdx = steps.length - 1;
          const isCompleted = !isRejected && !isRetake
            ? idx < activeIndex || (idx === isOutcomeIdx && claim.status === 'paid')
            : idx < activeIndex;
          const isFailedStep = isRejected && isCurrent;
          const isRetakeStep = isRetake && isCurrent;

          const circleBg = isFailedStep
            ? palette.danger
            : isRetakeStep
            ? palette.gold
            : isCompleted || isCurrent
            ? idx === isOutcomeIdx
              ? palette.paypalBlue
              : palette.primary
            : isDark
            ? 'rgba(255,255,255,0.08)'
            : palette.bgSage;

          const lineActive = (!isRejected && !isRetake && idx < activeIndex) || (isRetake && idx < 2);

          return (
            <React.Fragment key={step.key}>
              <View style={styles.stepCol}>
                <View
                  style={[
                    styles.dot,
                    { backgroundColor: circleBg },
                    isCurrent && !isFailedStep && !isRetakeStep && { borderWidth: 2, borderColor: palette.gold },
                  ]}
                >
                  {isFailedStep ? (
                    <Ionicons name="close" size={12} color={palette.white} />
                  ) : isRetakeStep ? (
                    <Ionicons name="refresh" size={12} color={palette.white} />
                  ) : isCompleted ? (
                    <Ionicons name="checkmark" size={12} color={palette.white} />
                  ) : (
                    <Text
                      style={[
                        styles.numText,
                        { color: isCurrent ? palette.white : palette.textMuted },
                      ]}
                    >
                      {idx + 1}
                    </Text>
                  )}
                </View>
                <Text
                  style={[
                    styles.stepLabel,
                    {
                      color: isFailedStep
                        ? palette.danger
                        : isRetakeStep
                        ? palette.goldText
                        : isCurrent || isCompleted
                        ? palette.textPrimary
                        : palette.textMuted,
                    },
                    isCurrent && styles.stepLabelActive,
                  ]}
                  numberOfLines={2}
                >
                  {step.label}
                </Text>
              </View>
              {idx < steps.length - 1 ? (
                <View
                  style={[
                    styles.connector,
                    { backgroundColor: lineActive ? palette.primary : palette.border },
                  ]}
                />
              ) : null}
            </React.Fragment>
          );
        })}
      </View>

      {isRejected && claim.reviewNote ? (
        <View style={[styles.noteBox, { backgroundColor: palette.dangerSoft }]}>
          <Ionicons name="alert-circle-outline" size={15} color={palette.danger} />
          <Text style={[styles.noteText, { color: palette.danger }]}>{claim.reviewNote}</Text>
        </View>
      ) : claim.aiVerdict ? (
        <View
          style={[
            styles.noteBox,
            {
              backgroundColor:
                claim.aiVerdict.verdict === 'pass' ? palette.primarySoft : palette.goldSoft,
            },
          ]}
        >
          <Ionicons
            name="sparkles"
            size={14}
            color={claim.aiVerdict.verdict === 'pass' ? palette.primaryDark : palette.goldText}
          />
          <Text
            style={[
              styles.noteText,
              {
                color:
                  claim.aiVerdict.verdict === 'pass' ? palette.primaryDark : palette.goldText,
              },
            ]}
          >
            AI: {claim.aiVerdict.verdict.toUpperCase()} ({Math.round(claim.aiVerdict.confidence * 100)}%) •{' '}
            {claim.aiVerdict.reasons?.[0] || 'Reviewed'}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  stepCol: {
    width: 52,
    alignItems: 'center',
    gap: 5,
  },
  dot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numText: {
    fontFamily: fonts.sansBold,
    fontSize: 11,
  },
  stepLabel: {
    fontFamily: fonts.sans,
    fontSize: 10,
    lineHeight: 13,
    textAlign: 'center',
  },
  stepLabelActive: {
    fontFamily: fonts.sansBold,
  },
  connector: {
    flex: 1,
    height: 2,
    marginTop: 11,
    borderRadius: 1,
  },
  noteBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: radii.sm,
  },
  noteText: {
    flex: 1,
    fontFamily: fonts.sansMedium,
    fontSize: 11.5,
    lineHeight: 16,
  },
});

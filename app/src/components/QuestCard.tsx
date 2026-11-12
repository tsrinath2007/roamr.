import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Quest } from '../types/roamr';
import { useRoamr } from '../context/RoamrContext';
import { formatRemainingTime } from '../utils/time';
import { formatMoney, usdToCents } from '../../lib/currency';
import { colors, fonts, radii, shadows } from '../theme/tokens';
import { Pill } from './Pill';
import { PayPalLogo } from './PayPalLogo';
import { Button } from './Button';
import { CategoryIcon } from './CategoryIcon';

interface QuestCardProps {
  quest: Quest;
  bookmarked?: boolean;
  onToggleBookmark?: () => void;
  onDismiss?: () => void;
  onStartQuest: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
}

export function QuestCard({
  quest,
  bookmarked = false,
  onToggleBookmark,
  onDismiss,
  onStartQuest,
  secondaryActionLabel,
  onSecondaryAction,
}: QuestCardProps) {
  const { showInr, palette } = useRoamr();
  const timerInfo = formatRemainingTime(quest.expiresAt);
  const rewardCents = quest.rewardCents ?? usdToCents(quest.rewardUsd);
  const isFunded = Boolean(
    quest.funded && (quest.budget_remaining_usd ?? quest.budgetUsd ?? 0) > 0
  );
  const maxCashback = quest.reward?.max_reward_usd ?? quest.rewardUsd ?? 2;
  const maxCashbackText = Number.isInteger(maxCashback)
    ? `$${maxCashback}`
    : `$${maxCashback.toFixed(2)}`;
  const soldOut = !isFunded && Number(quest.budget_usd ?? quest.budgetUsd ?? 0) > 0;
  const rewardLabel = isFunded ? `Pays up to ${maxCashbackText}` : 'XP only';

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: palette.bgCard, borderColor: palette.border },
      ]}
    >
      <View style={styles.cardInner}>
        <View style={styles.topRow}>
          {quest.image ? (
            <Image
              source={{ uri: quest.image }}
              style={[styles.thumbnail, { backgroundColor: palette.bgSage }]}
            />
          ) : (
            <View
              style={[
                styles.thumbnail,
                {
                  backgroundColor: palette.bgSage,
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 6,
                  gap: 4,
                },
              ]}
            >
              <CategoryIcon category={quest.category} size={26} color={palette.primary} />
              <Text
                style={{
                  fontFamily: fonts.sansSemi,
                  fontSize: 10,
                  color: palette.primaryDark,
                  textAlign: 'center',
                }}
                numberOfLines={2}
              >
                {quest.place_name || quest.category}
              </Text>
            </View>
          )}

          <View style={styles.infoCol}>
            <View style={styles.badgeRow}>
              <View style={styles.pillsLeft}>
                <Pill
                  label={quest.distance}
                  variant="sage"
                  icon={<Ionicons name="location" size={12} color={palette.primary} />}
                />
                <Pill
                  label={`${quest.xp} XP`}
                  variant="gold"
                  icon={<Ionicons name="star" size={12} color={palette.gold} />}
                />
              </View>
              {onToggleBookmark ? (
                <Pressable onPress={onToggleBookmark} hitSlop={10} style={styles.heartBtn}>
                  <Ionicons
                    name={bookmarked ? 'heart' : 'heart-outline'}
                    size={20}
                    color={bookmarked ? palette.primary : palette.textMuted}
                  />
                </Pressable>
              ) : null}
            </View>

            <Text style={[styles.title, { color: palette.textPrimary }]} numberOfLines={2}>
              {quest.title}
            </Text>
            <Text style={[styles.description, { color: palette.textSecondary }]} numberOfLines={2}>
              {quest.description}
            </Text>

            <View style={styles.metaPills}>
              <Pill
                label={quest.category}
                variant="neutral"
                icon={<CategoryIcon category={quest.category} size={12} color={palette.primary} />}
              />
              <Pill
                label={quest.difficulty}
                variant="neutral"
                icon={<Ionicons name="bar-chart" size={12} color={palette.primary} />}
              />
              <Pill
                label={rewardLabel}
                variant={isFunded ? 'gold' : 'sage'}
                icon={
                  isFunded ? (
                    <PayPalLogo size={11} />
                  ) : (
                    <Ionicons name="star" size={11} color={palette.primary} />
                  )
                }
              />
              {soldOut ? (
                <Pill label="Cashback sold out, XP still counts" variant="neutral" />
              ) : null}
              {quest.night_only ? (
                <Pill
                  label="Night 18:30-05:00"
                  variant="gold"
                  icon={<Ionicons name="moon" size={11} color={palette.goldText} />}
                />
              ) : null}
              {timerInfo ? (
                <Pill
                  label={timerInfo.label}
                  variant={timerInfo.expired ? 'danger' : 'gold'}
                  icon={
                    <Ionicons
                      name="time-outline"
                      size={11}
                      color={timerInfo.expired ? palette.danger : palette.goldText}
                    />
                  }
                />
              ) : null}
            </View>
          </View>
        </View>

        <View style={styles.ctaRow}>
          <Button
            label="Start Quest"
            onPress={onStartQuest}
            trailingIcon={<Ionicons name="arrow-forward" size={18} color={palette.white} />}
            style={styles.cta}
          />
          {onSecondaryAction ? (
            <Button
              label={secondaryActionLabel || 'All Quests'}
              variant="outline"
              onPress={onSecondaryAction}
              style={{ paddingHorizontal: 14 }}
            />
          ) : null}
          {onDismiss ? (
            <Pressable
              onPress={onDismiss}
              style={[
                styles.dismissBtn,
                { backgroundColor: palette.bgSoft, borderColor: palette.border },
              ]}
              accessibilityLabel="Close quest card"
              hitSlop={6}
            >
              <Ionicons name="close" size={22} color={palette.textPrimary} />
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  cardInner: {
    padding: 14,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 12,
  },
  thumbnail: {
    width: 108,
    minHeight: 118,
    borderRadius: radii.md,
    backgroundColor: colors.bgSage,
  },
  infoCol: {
    flex: 1,
    justifyContent: 'space-between',
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pillsLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  heartBtn: {
    padding: 2,
  },
  title: {
    fontFamily: fonts.serif,
    fontSize: 19,
    lineHeight: 23,
    color: colors.textPrimary,
    marginTop: 6,
  },
  description: {
    fontFamily: fonts.sans,
    fontSize: 12.5,
    lineHeight: 17,
    color: colors.textSecondary,
    marginTop: 4,
  },
  metaPills: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    flexWrap: 'wrap',
  },
  ctaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 14,
  },
  cta: {
    flex: 1,
    height: 48,
  },
  dismissBtn: {
    width: 48,
    height: 48,
    borderRadius: radii.pill,
    backgroundColor: colors.bgCream,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

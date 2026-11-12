import React, { useRef } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useRoamr } from '../context/RoamrContext';
import { Wordmark } from './Wordmark';
import { RoamrMark } from './RoamrMark';
import { fonts, radii, shadows } from '../theme/tokens';

interface TopHeaderProps {
  floating?: boolean;
}

export function TopHeader({ floating = false }: TopHeaderProps) {
  const { role, userProfile, isSuperAdmin, palette, isDark } = useRoamr();
  const isBusinessMode = role === 'business';
  const wordmarkTheme = isDark ? 'dark' : 'light';

  return (
    <View style={styles.container}>
      {floating ? (
        <View
          style={[
            styles.floatingBrandPill,
            {
              backgroundColor: palette.floatingPillBg,
              borderColor: palette.floatingPillBorder,
            },
          ]}
        >
          <Wordmark
            size={23}
            theme={wordmarkTheme}
            showTagline={false}
            rightAccessory={
              <>
                <RoamrMark size={24} theme={wordmarkTheme} />
                {isBusinessMode ? (
                  <View style={[styles.compassBadge, { backgroundColor: palette.gold }]}>
                    <Ionicons name="storefront" size={11} color={palette.white} />
                  </View>
                ) : null}
              </>
            }
          />
        </View>
      ) : (
        <View style={styles.brandBlock}>
          <Wordmark
            size={29}
            theme={wordmarkTheme}
            showTagline
            tagline={
              isBusinessMode
                ? isSuperAdmin
                  ? 'Superadmin Console'
                  : 'Business Hosting'
                : 'Explore • Quest • Earn'
            }
            rightAccessory={
              <>
                <RoamrMark size={28} theme={wordmarkTheme} />
                {isBusinessMode ? (
                  <View style={[styles.compassBadge, { backgroundColor: palette.gold }]}>
                    <Ionicons name="storefront" size={11} color={palette.white} />
                  </View>
                ) : null}
              </>
            }
          />
        </View>
      )}

      <Pressable
        onPress={() =>
          router.push(isBusinessMode ? '/(business)/profile' : '/(tabs)/profile')
        }
        style={[
          floating ? styles.floatingAvatarBtn : styles.avatarBtn,
          {
            backgroundColor: isBusinessMode
              ? palette.goldSoft
              : floating
              ? palette.floatingPillBg
              : palette.bgCard,
            borderColor: isBusinessMode
              ? 'rgba(223, 159, 32, 0.65)'
              : floating
              ? palette.floatingPillBorder
              : palette.border,
          },
        ]}
        accessibilityLabel="Open profile"
      >
        {userProfile?.avatar ? (
          <Image source={{ uri: userProfile.avatar }} style={styles.avatarImg} />
        ) : (
          <Ionicons
            name="person"
            size={18}
            color={isBusinessMode ? palette.goldText : palette.primary}
          />
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 8,
  },
  brandBlock: {
    justifyContent: 'center',
  },
  floatingBrandPill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radii.pill,
    borderWidth: 1,
    ...shadows.soft,
  },
  floatingBrandText: {
    fontFamily: fonts.serif,
    fontSize: 20,
    letterSpacing: 0.6,
  },
  brandTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  brandText: {
    fontFamily: fonts.serif,
    fontSize: 26,
    letterSpacing: 0.6,
  },
  compassBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  demoTag: {
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  demoTagText: {
    fontFamily: fonts.sansBold,
    fontSize: 9,
  },
  tagline: {
    fontFamily: fonts.sans,
    fontSize: 11.5,
    marginTop: -2,
  },
  avatarBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    overflow: 'hidden',
    ...shadows.soft,
  },
  floatingAvatarBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    overflow: 'hidden',
    ...shadows.soft,
  },
  avatarImg: {
    width: 40,
    height: 40,
  },
});

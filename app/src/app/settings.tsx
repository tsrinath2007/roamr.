import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useRoamr } from '../context/RoamrContext';
import {
  checkPayPalHealth,
  checkServerHealth,
  fetchDevPayPalOrder,
  getApiBaseUrl,
  testZapierWebhookOnServer,
} from '../services/api';
import { USD_TO_INR } from '../../lib/currency';
import { LiquidBackdrop } from '../components/LiquidBackdrop';
import { Card } from '../components/Card';
import { Pill } from '../components/Pill';
import { PayPalLogo } from '../components/PayPalLogo';
import { Button } from '../components/Button';
import { ResponsiveContainer } from '../components/ResponsiveContainer';
import { colors, fonts, radii } from '../theme/tokens';

const APP_VERSION = '1.0.0';

export default function SettingsScreen() {
  const {
    userProfile,
    role,
    palette,
    isDark,
    setThemeMode,
    paypalEmail,
    setPaypalEmail,
    showInr,
    setShowInr,
    lightPreset,
    setLightPreset,
    mapProjection,
    setMapProjection,
    enable3D,
    setEnable3D,
    demoMode,
    toggleDemoMode,
    resetDemoData,
    signOut,
    checkinOrders,
    claims,
  } = useRoamr();

  const [emailDraft, setEmailDraft] = useState(paypalEmail);
  useEffect(() => {
    setEmailDraft(paypalEmail);
  }, [paypalEmail]);
  const [paypalDebugInfo, setPaypalDebugInfo] = useState<string | null>(null);
  const [fetchingPayPalDebug, setFetchingPayPalDebug] = useState(false);
  const [notifNearby, setNotifNearby] = useState(true);
  const [notifPayout, setNotifPayout] = useState(true);
  const [notifStreak, setNotifStreak] = useState(false);

  // Developer & testing tools shown by default for app testing; triple-tap About -> Version to hide/show
  const [devUnlocked, setDevUnlocked] = useState(true);
  const [serverStatus, setServerStatus] = useState<string | null>(null);
  const [checkingServer, setCheckingServer] = useState(false);
  const [testingZapier, setTestingZapier] = useState(false);
  const tapCountRef = useRef(0);
  const lastTapRef = useRef(0);

  const isBusiness = role === 'business';
  const emailConnected = Boolean(paypalEmail && paypalEmail.includes('@'));

  const handleSaveEmail = () => {
    const next = emailDraft.trim() || 'sb-traveler@personal.example.com';
    setPaypalEmail(next);
    setEmailDraft(next);
    Alert.alert('Saved', 'PayPal Sandbox payout email updated.');
  };

  const handleVersionTap = () => {
    const now = Date.now();
    if (now - lastTapRef.current < 700) {
      tapCountRef.current += 1;
    } else {
      tapCountRef.current = 1;
    }
    lastTapRef.current = now;
    if (tapCountRef.current >= 3) {
      tapCountRef.current = 0;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setDevUnlocked((v) => !v);
    }
  };

  const handleCheckServer = async () => {
    setCheckingServer(true);
    try {
      const [health, ppHealth] = await Promise.all([
        checkServerHealth(),
        checkPayPalHealth().catch((err) => ({
          ok: false,
          status: 500,
          error: err instanceof Error ? err.message : 'PayPal health check failed',
          debugId: null,
        })),
      ]);
      setServerStatus(
        `Server OK (${getApiBaseUrl()}) • AI: ${
          (
            health.integrations.aiProvider ||
            (health.integrations.geminiConfigured ? 'gemini' : 'mock')
          ).toUpperCase()
        } • PayPal OAuth: ${
          ppHealth.ok
            ? `OK (debug_id: ${ppHealth.debugId || 'none'})`
            : `Failed (${ppHealth.error})`
        }`
      );
    } catch (err) {
      setServerStatus(
        err instanceof Error
          ? err.message
          : 'Could not reach Express backend. Check EXPO_PUBLIC_API_URL.'
      );
    } finally {
      setCheckingServer(false);
    }
  };

  const handleTestZapier = async () => {
    setTestingZapier(true);
    try {
      const res = await testZapierWebhookOnServer(userProfile?.email);
      if (res.skipped) {
        setServerStatus(
          `Zapier webhook not configured in server/.env (sample claim_paid payload tested for ${res.claimId})`
        );
      } else {
        setServerStatus(
          `Zapier HTTP ${res.status ?? 'ERR'} • ok=${res.ok} • claim=${res.claimId}`
        );
      }
    } catch (err) {
      setServerStatus(
        err instanceof Error ? err.message : 'Zapier test request failed.'
      );
    } finally {
      setTestingZapier(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.bgCream }]} edges={['top']}>
      <LiquidBackdrop variant={isBusiness ? 'business' : 'traveler'} />
      <ResponsiveContainer maxWidth={760}>
        <View style={styles.topBar}>
          <Pressable
            onPress={() => router.back()}
            style={[styles.backBtn, { backgroundColor: palette.bgCard, borderColor: palette.border }]}
            accessibilityLabel="Back"
          >
            <Ionicons name="chevron-back" size={22} color={palette.textPrimary} />
          </Pressable>
          <Text style={[styles.topTitle, { color: palette.textPrimary }]}>Settings</Text>
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
          {/* Payments */}
          <Card style={styles.sectionCard}>
            <View style={styles.sectionHeaderRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <PayPalLogo size={17} variant="badge" />
                <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>Payments</Text>
              </View>
              <Pill
                label={emailConnected ? 'Connected • Sandbox' : 'Not Connected'}
                variant={emailConnected ? 'success' : 'gold'}
              />
            </View>
            <Text style={[styles.cardDesc, { color: palette.textSecondary }]}>
              PayPal Sandbox receiver email used for verified quest payouts.
            </Text>
            <TextInput
              value={emailDraft}
              onChangeText={setEmailDraft}
              autoCapitalize="none"
              keyboardType="email-address"
              placeholder="sb-traveler@personal.example.com"
              placeholderTextColor={palette.textMuted}
              style={[
                styles.input,
                {
                  backgroundColor: palette.bgSoft,
                  borderColor: palette.border,
                  color: palette.textPrimary,
                },
              ]}
            />
            <Text style={[styles.usdNote, { color: palette.paypalBlue }]}>
              Payouts are made in USD (PayPal Sandbox)
            </Text>
            <Button
              label="Save PayPal Email"
              variant="outline"
              icon={<PayPalLogo size={14} />}
              onPress={handleSaveEmail}
              style={styles.inlineBtn}
            />
          </Card>

          {/* Display */}
          <Card style={styles.sectionCard}>
            <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>Display</Text>

            <View style={styles.switchRow}>
              <View style={styles.switchTextCol}>
                <Text style={[styles.rowLabel, { color: palette.textPrimary }]}>Dark Mode</Text>
                <Text style={[styles.cardDesc, { color: palette.textSecondary }]}>
                  Switches every screen, card, and Liquid Glass dock to dark mode.
                </Text>
              </View>
              <Switch
                value={isDark}
                onValueChange={(v) => setThemeMode(v ? 'dark' : 'light')}
                trackColor={{ false: palette.border, true: palette.primary }}
                thumbColor={palette.white}
              />
            </View>

            <View style={[styles.divider, { backgroundColor: palette.border }]} />

            <View style={styles.switchRow}>
              <View style={styles.switchTextCol}>
                <Text style={[styles.rowLabel, { color: palette.textPrimary }]}>Show amounts in</Text>
                <Text style={[styles.cardDesc, { color: palette.textSecondary }]}>
                  Display-only currency (approx. 1 USD ≈ ₹{USD_TO_INR}). PayPal Sandbox always settles in USD.
                </Text>
              </View>
              <View
                style={[
                  styles.currencyToggle,
                  { backgroundColor: palette.bgSoft, borderColor: palette.border },
                ]}
              >
                <Pressable
                  onPress={() => setShowInr(false)}
                  style={[
                    styles.currencyOption,
                    !showInr && { backgroundColor: palette.primary },
                  ]}
                >
                  <Text
                    style={[
                      styles.currencyOptionText,
                      { color: !showInr ? palette.white : palette.textSecondary },
                    ]}
                  >
                    USD
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setShowInr(true)}
                  style={[
                    styles.currencyOption,
                    showInr && { backgroundColor: palette.primary },
                  ]}
                >
                  <Text
                    style={[
                      styles.currencyOptionText,
                      { color: showInr ? palette.white : palette.textSecondary },
                    ]}
                  >
                    INR
                  </Text>
                </Pressable>
              </View>
            </View>

            <View style={[styles.divider, { backgroundColor: palette.border }]} />

            <View style={styles.switchRow}>
              <View style={styles.switchTextCol}>
                <Text style={[styles.rowLabel, { color: palette.textPrimary }]}>
                  Mapbox Lighting (Dusk Mode)
                </Text>
                <Text style={[styles.cardDesc, { color: palette.textSecondary }]}>
                  Switch Mapbox Standard lighting between Day and Dusk.
                </Text>
              </View>
              <Switch
                value={lightPreset === 'dusk'}
                onValueChange={(v) => setLightPreset(v ? 'dusk' : 'day')}
                trackColor={{ false: palette.border, true: palette.primary }}
                thumbColor={palette.white}
              />
            </View>

            <View style={[styles.divider, { backgroundColor: palette.border }]} />

            <View style={styles.switchRow}>
              <View style={styles.switchTextCol}>
                <Text style={[styles.rowLabel, { color: palette.textPrimary }]}>
                  Map Style (Mapbox)
                </Text>
                <Text style={[styles.cardDesc, { color: palette.textSecondary }]}>
                  Choose between the 3D Earth Globe or Flat Map view.
                </Text>
              </View>
              <View
                style={[
                  styles.currencyToggle,
                  { backgroundColor: palette.bgSoft, borderColor: palette.border },
                ]}
              >
                <Pressable
                  onPress={() => setMapProjection('globe')}
                  style={[
                    styles.currencyOption,
                    mapProjection === 'globe' && { backgroundColor: palette.primary },
                  ]}
                >
                  <Text
                    style={[
                      styles.currencyOptionText,
                      {
                        color: mapProjection === 'globe' ? palette.white : palette.textSecondary,
                      },
                    ]}
                  >
                    Globe
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setMapProjection('mercator')}
                  style={[
                    styles.currencyOption,
                    mapProjection === 'mercator' && { backgroundColor: palette.primary },
                  ]}
                >
                  <Text
                    style={[
                      styles.currencyOptionText,
                      {
                        color:
                          mapProjection === 'mercator' ? palette.white : palette.textSecondary,
                      },
                    ]}
                  >
                    Flat Map
                  </Text>
                </Pressable>
              </View>
            </View>

            <View style={[styles.divider, { backgroundColor: palette.border }]} />

            <View style={styles.switchRow}>
              <View style={styles.switchTextCol}>
                <Text style={[styles.rowLabel, { color: palette.textPrimary }]}>
                  3D View & Buildings
                </Text>
                <Text style={[styles.cardDesc, { color: palette.textSecondary }]}>
                  Toggle tilted 3D camera pitch and extruded Mapbox 3D landmarks on or off.
                </Text>
              </View>
              <Switch
                value={enable3D}
                onValueChange={setEnable3D}
                trackColor={{ false: palette.border, true: palette.primary }}
                thumbColor={palette.white}
              />
            </View>
          </Card>

          {/* Notifications */}
          <Card style={styles.sectionCard}>
            <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>Notifications</Text>

            <View style={styles.switchRow}>
              <View style={styles.switchTextCol}>
                <Text style={[styles.rowLabel, { color: palette.textPrimary }]}>Nearby quests</Text>
                <Text style={[styles.cardDesc, { color: palette.textSecondary }]}>
                  Alert when funded quests open near you.
                </Text>
              </View>
              <Switch
                value={notifNearby}
                onValueChange={setNotifNearby}
                trackColor={{ false: palette.border, true: palette.primary }}
                thumbColor={palette.white}
              />
            </View>

            <View style={[styles.divider, { backgroundColor: palette.border }]} />

            <View style={styles.switchRow}>
              <View style={styles.switchTextCol}>
                <Text style={[styles.rowLabel, { color: palette.textPrimary }]}>
                  Payout received
                </Text>
                <Text style={[styles.cardDesc, { color: palette.textSecondary }]}>
                  Confirm when a PayPal reward is released.
                </Text>
              </View>
              <Switch
                value={notifPayout}
                onValueChange={setNotifPayout}
                trackColor={{ false: palette.border, true: palette.primary }}
                thumbColor={palette.white}
              />
            </View>

            <View style={[styles.divider, { backgroundColor: palette.border }]} />

            <View style={styles.switchRow}>
              <View style={styles.switchTextCol}>
                <Text style={[styles.rowLabel, { color: palette.textPrimary }]}>
                  Streak reminders
                </Text>
                <Text style={[styles.cardDesc, { color: palette.textSecondary }]}>
                  Gentle weekly nudge to keep exploring.
                </Text>
              </View>
              <Switch
                value={notifStreak}
                onValueChange={setNotifStreak}
                trackColor={{ false: palette.border, true: palette.primary }}
                thumbColor={palette.white}
              />
            </View>
          </Card>

          {/* Business Details when hosting */}
          {userProfile?.isBusiness ? (
            <Card style={styles.sectionCard}>
              <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>
                Business Hosting
              </Text>
              <Text style={[styles.rowLabel, { color: palette.textPrimary }]}>
                {userProfile.businessName || 'Your Business'} •{' '}
                {userProfile.businessCategory || 'Local Partner'}
              </Text>
              <Text style={[styles.cardDesc, { color: palette.textSecondary }]}>
                {userProfile.businessPaypalEmail || userProfile.email || 'Global Host'}
              </Text>
              <Button
                label="Edit Host Name & PayPal Email"
                variant="outline"
                onPress={() => router.push('/business-onboarding')}
                style={styles.inlineBtn}
              />
            </Card>
          ) : null}

          {/* Account */}
          <Card style={styles.sectionCard}>
            <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>Account</Text>
            <View style={styles.accountRow}>
              <Ionicons name="mail-outline" size={16} color={palette.textSecondary} />
              <Text style={[styles.accountEmail, { color: palette.textPrimary }]}>
                {userProfile?.isDemo ? 'demo@roamr.app (Demo)' : userProfile?.email || 'Not signed in'}
              </Text>
            </View>
            <Button
              label="Edit Profile, PayPal & Interests"
              variant="secondary"
              onPress={() => router.push('/onboarding')}
              style={styles.inlineBtn}
            />
            <Button
              label="Sign Out"
              variant="outline"
              onPress={async () => {
                await signOut();
                router.replace('/sign-in');
              }}
              icon={<Ionicons name="log-out-outline" size={18} color={palette.primaryDark} />}
              style={styles.inlineBtn}
            />
          </Card>

          {/* About */}
          <Card style={styles.sectionCard}>
            <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>About</Text>
            <Pressable onPress={handleVersionTap} style={styles.aboutRow}>
              <Text style={[styles.rowLabel, { color: palette.textPrimary }]}>Version</Text>
              <Text style={[styles.cardDesc, { color: palette.textSecondary }]}>{APP_VERSION}</Text>
            </Pressable>
            <View style={[styles.divider, { backgroundColor: palette.border }]} />
            <Text style={[styles.cardDesc, { color: palette.textSecondary }]}>
              Privacy: Location and submitted proof photos are only used for nearby quest matching and AI visit verification.
            </Text>
            <Pill
              label="Built for the PayPal AI Hackathon"
              variant="paypal"
              icon={<PayPalLogo size={12} />}
            />
          </Card>

          {/* Hidden Developer Section (unlocked by triple-tapping Version above) */}
          {devUnlocked ? (
            <Card
              style={[
                styles.devCard,
                {
                  backgroundColor: isDark ? palette.bgSage : '#FFFDF7',
                  borderColor: 'rgba(223, 159, 32, 0.5)',
                },
              ]}
            >
              <View style={styles.sectionHeaderRow}>
                <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>
                  System & Integration Diagnostics
                </Text>
              </View>

              <Text style={[styles.rowLabel, { color: palette.textPrimary }]}>
                Backend, PayPal & Mapbox Status
              </Text>
              <Text style={[styles.cardDesc, { color: palette.textSecondary }]}>
                Server: {getApiBaseUrl() || 'Not set (set EXPO_PUBLIC_API_URL in app/.env)'}
              </Text>
              <Text style={[styles.cardDesc, { color: palette.textSecondary }]}>
                Mapbox:{' '}
                {(() => {
                  const tok = (process.env.EXPO_PUBLIC_MAPBOX_TOKEN || '').trim();
                  return tok.startsWith('pk.') && !tok.includes('xxxxx') && tok.length > 20
                    ? `Configured (3D Globe • mapbox/standard • ${lightPreset})`
                    : 'Missing valid pk. token — add EXPO_PUBLIC_MAPBOX_TOKEN in app/.env';
                })()}
              </Text>
              {serverStatus ? (
                <Text
                  style={[
                    styles.statusNote,
                    { backgroundColor: palette.primarySoft, color: palette.primaryDark },
                  ]}
                >
                  {serverStatus}
                </Text>
              ) : null}

              <Button
                label={checkingServer ? 'Checking Server & PayPal...' : 'Test Server & PayPal OAuth'}
                variant="outline"
                icon={<PayPalLogo size={14} />}
                loading={checkingServer}
                onPress={handleCheckServer}
                style={styles.inlineBtn}
              />
              <View style={[styles.divider, { backgroundColor: palette.border }]} />
              <Text style={[styles.rowLabel, { color: palette.textPrimary }]}>PayPal debug</Text>
              {(() => {
                const latestOrder =
                  Object.values(checkinOrders || {})[0] ||
                  claims.find((c) => c.order?.orderId)?.order ||
                  null;
                const lastOrderId = latestOrder?.orderId || 'None yet';
                const lastStatus = latestOrder?.status || '—';
                const lastPayee = latestOrder?.payeeEmail || '—';
                return (
                  <View style={{ marginBottom: 8 }}>
                    <Text style={[styles.cardDesc, { color: palette.textSecondary }]}>
                      Last Order ID: {lastOrderId} • Status: {lastStatus} • Payee: {lastPayee}
                    </Text>
                    {paypalDebugInfo ? (
                      <Text style={[styles.cardDesc, { color: palette.primaryDark, marginTop: 4 }]}>
                        {paypalDebugInfo}
                      </Text>
                    ) : null}
                    {latestOrder?.orderId ? (
                      <Button
                        label={fetchingPayPalDebug ? 'Inspecting PayPal Order...' : 'Inspect Last Order via PayPal'}
                        variant="outline"
                        loading={fetchingPayPalDebug}
                        onPress={async () => {
                          setFetchingPayPalDebug(true);
                          try {
                            const res = await fetchDevPayPalOrder(latestOrder.orderId);
                            const capStatus = res.captures?.[0]?.status || 'NONE';
                            setPaypalDebugInfo(
                              `PayPal Live -> Order: ${res.orderId} | Status: ${res.status} | Capture: ${capStatus} | Payee: ${res.payeeEmail || 'REST App Account'}`
                            );
                          } catch (err) {
                            setPaypalDebugInfo(
                              `PayPal Lookup Error: ${err instanceof Error ? err.message : 'Failed'}`
                            );
                          } finally {
                            setFetchingPayPalDebug(false);
                          }
                        }}
                        style={styles.inlineBtn}
                      />
                    ) : null}
                  </View>
                );
              })()}
              <Button
                label={testingZapier ? 'Testing Zapier Webhook...' : 'Test Zapier Webhook'}
                variant="outline"
                loading={testingZapier}
                onPress={handleTestZapier}
                style={styles.inlineBtn}
              />
            </Card>
          ) : null}
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
    fontSize: 22,
    color: colors.textPrimary,
  },
  spacer: {
    width: 38,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
    gap: 14,
  },
  sectionCard: {
    gap: 10,
  },
  devCard: {
    gap: 10,
    borderColor: 'rgba(223, 159, 32, 0.5)',
    backgroundColor: '#FFFDF7',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  sectionTitle: {
    fontFamily: fonts.serif,
    fontSize: 18,
    color: colors.textPrimary,
  },
  rowLabel: {
    fontFamily: fonts.sansSemi,
    fontSize: 14,
    color: colors.textPrimary,
  },
  cardDesc: {
    fontFamily: fonts.sans,
    fontSize: 12.5,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  usdNote: {
    fontFamily: fonts.sansSemi,
    fontSize: 12,
    color: colors.paypalBlue,
  },
  input: {
    backgroundColor: colors.bgCream,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    height: 44,
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.textPrimary,
  },
  inlineBtn: {
    height: 44,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  switchTextCol: {
    flex: 1,
    gap: 2,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 2,
  },
  currencyToggle: {
    flexDirection: 'row',
    backgroundColor: colors.bgCream,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 3,
  },
  currencyOption: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radii.pill,
  },
  currencyOptionActive: {
    backgroundColor: colors.primary,
  },
  currencyOptionText: {
    fontFamily: fonts.sansSemi,
    fontSize: 12,
    color: colors.textSecondary,
  },
  currencyOptionTextActive: {
    color: colors.white,
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  accountEmail: {
    fontFamily: fonts.sansMedium,
    fontSize: 13.5,
    color: colors.textPrimary,
  },
  aboutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  statusNote: {
    fontFamily: fonts.sansMedium,
    fontSize: 12.5,
    color: colors.primaryDark,
    backgroundColor: colors.primarySoft,
    padding: 10,
    borderRadius: radii.sm,
  },
});

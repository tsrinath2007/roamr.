import React from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useRoamr } from '../../context/RoamrContext';
import { LiquidTabBar } from '../../components/LiquidTabBar';

export default function BusinessTabsLayout() {
  const { palette, isDark } = useRoamr();

  return (
    <Tabs
      tabBar={(props) => (
        <LiquidTabBar
          {...props}
          activeColor={palette.goldText}
          tone="gold"
          lensColors={
            isDark
              ? ['rgba(240, 180, 58, 0.28)', 'rgba(240, 180, 58, 0.14)']
              : ['rgba(255, 255, 255, 0.94)', 'rgba(253, 240, 200, 0.78)']
          }
        />
      )}
      screenOptions={{
        headerShown: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'stats-chart' : 'stats-chart-outline'} size={21} color={color as string} />
          ),
        }}
      />
      <Tabs.Screen
        name="quests"
        options={{
          title: 'Quests',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'flag' : 'flag-outline'} size={21} color={color as string} />
          ),
        }}
      />
      <Tabs.Screen
        name="review"
        options={{
          title: 'Audit',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'shield-checkmark' : 'shield-checkmark-outline'}
              size={21}
              color={color as string}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="funding"
        options={{
          title: 'Funding',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'card' : 'card-outline'} size={21} color={color as string} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'storefront' : 'storefront-outline'} size={21} color={color as string} />
          ),
        }}
      />
    </Tabs>
  );
}

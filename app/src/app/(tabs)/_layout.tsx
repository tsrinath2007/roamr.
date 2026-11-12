import React from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useRoamr } from '../../context/RoamrContext';
import { LiquidTabBar } from '../../components/LiquidTabBar';

export default function TabsLayout() {
  const { palette } = useRoamr();

  return (
    <Tabs
      tabBar={(props) => (
        <LiquidTabBar
          {...props}
          activeColor={palette.primaryDark}
          tone="light"
        />
      )}
      screenOptions={{
        headerShown: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Map',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'location' : 'location-outline'} size={21} color={color as string} />
          ),
        }}
      />
      <Tabs.Screen
        name="collection"
        options={{
          title: 'Collection',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'trophy' : 'trophy-outline'} size={21} color={color as string} />
          ),
        }}
      />
      <Tabs.Screen
        name="wallet"
        options={{
          title: 'Wallet',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'wallet' : 'wallet-outline'} size={21} color={color as string} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'person' : 'person-outline'} size={21} color={color as string} />
          ),
        }}
      />
    </Tabs>
  );
}

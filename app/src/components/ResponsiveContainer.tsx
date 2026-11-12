import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';

export function ResponsiveContainer({
  children,
  maxWidth = 620,
  style,
}: {
  children: React.ReactNode;
  maxWidth?: number;
  style?: ViewStyle;
}) {
  return (
    <View style={[styles.outer, style]}>
      <View style={[styles.inner, { maxWidth }]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
  },
  inner: {
    flex: 1,
    width: '100%',
  },
});

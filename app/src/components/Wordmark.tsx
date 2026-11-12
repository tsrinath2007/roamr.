import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { fonts } from '../theme/tokens';

export interface WordmarkProps {
  size?: number;
  theme?: 'light' | 'dark';
  showTagline?: boolean;
  tagline?: string;
  centered?: boolean;
  rightAccessory?: React.ReactNode;
}

const LIGHT_LETTERS_COLOR = '#164A2E';
const DARK_LETTERS_COLOR = '#F7F5EC';
const DOT_COLOR = '#7A9F3C';
const LIGHT_TAGLINE_COLOR = '#58675D';
const DARK_TAGLINE_COLOR = '#C6D4CC';

export function Wordmark({
  size = 26,
  theme = 'light',
  showTagline = false,
  tagline = 'Explore • Quest • Earn',
  centered = false,
  rightAccessory,
}: WordmarkProps) {
  const lettersColor = theme === 'dark' ? DARK_LETTERS_COLOR : LIGHT_LETTERS_COLOR;
  const taglineColor = theme === 'dark' ? DARK_TAGLINE_COLOR : LIGHT_TAGLINE_COLOR;
  const letterSpacing = Math.max(-2, Math.min(-1, -size * 0.045));
  const dotSize = Math.round(size * 1.12);
  const taglineSize = Math.max(10.5, Math.min(14.5, Math.round(size * 0.34)));
  const opticalLineHeight = Math.round(size * 1.06);
  const accessoryOffset = Math.max(1, Math.round(size * 0.08));

  return (
    <View style={[styles.wrap, centered && styles.wrapCentered]}>
      <View style={[styles.row, centered && styles.rowCentered]}>
        <Text
          allowFontScaling={false}
          style={[
            styles.letters,
            {
              fontSize: size,
              lineHeight: opticalLineHeight,
              color: lettersColor,
              letterSpacing,
            },
          ]}
        >
          roamr
          <Text
            allowFontScaling={false}
            style={[
              styles.dot,
              {
                fontSize: dotSize,
                lineHeight: opticalLineHeight,
                color: DOT_COLOR,
              },
            ]}
          >
            .
          </Text>
        </Text>
        {rightAccessory ? (
          <View style={[styles.accessory, { marginTop: accessoryOffset }]}>
            {rightAccessory}
          </View>
        ) : null}
      </View>

      {showTagline ? (
        <Text
          style={[
            styles.tagline,
            {
              fontSize: taglineSize,
              color: taglineColor,
              textAlign: centered ? 'center' : 'left',
            },
          ]}
        >
          {tagline}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'flex-start',
  },
  wrapCentered: {
    alignItems: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  rowCentered: {
    justifyContent: 'center',
  },
  letters: {
    fontFamily: fonts.wordmark,
    includeFontPadding: false,
  },
  dot: {
    fontFamily: fonts.wordmark,
    letterSpacing: 0,
    includeFontPadding: false,
  },
  accessory: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tagline: {
    fontFamily: fonts.sansMedium,
    letterSpacing: 0.3,
    marginTop: 2,
  },
});

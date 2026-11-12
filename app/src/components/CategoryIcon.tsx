import React from 'react';
import { Ionicons } from '@expo/vector-icons';

export function getCategoryIconName(category: string): keyof typeof Ionicons.glyphMap {
  const c = String(category || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (/cafe|coffee|bakery/.test(c)) return 'cafe';
  if (/restaurant|pizz|burger|biryani|dessert|food/.test(c)) return 'restaurant';
  if (/park|lake|garden|nature|viewpoint/.test(c)) return 'leaf';
  if (/market|bookstore|shop|arcade|bowling/.test(c)) return 'bag-handle';
  if (/photo/.test(c)) return 'camera';
  if (/museum|gallery|landmark|heritage|cathedral|history/.test(c)) return 'business';
  if (/night/.test(c)) return 'moon';
  return 'compass';
}

export function CategoryIcon({
  category,
  size = 16,
  color = '#FFFFFF',
}: {
  category: string;
  size?: number;
  color?: string;
}) {
  return <Ionicons name={getCategoryIconName(category)} size={size} color={color} />;
}

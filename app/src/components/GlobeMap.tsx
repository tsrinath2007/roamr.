import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Place, Quest } from '../types/roamr';
import { useRoamr } from '../context/RoamrContext';
import { formatMoney, usdToCents } from '../../lib/currency';
import { colors, fonts, radii, shadows } from '../theme/tokens';
import { LatLng } from '../utils/distance';

export type LightPreset = 'day' | 'dusk';
export type MapProjection = 'globe' | 'mercator';

export type AppToGlobeMessage =
  | { type: 'selectQuest'; id: string }
  | { type: 'syncSelectedQuest'; id: string | null }
  | { type: 'flyToCity'; city: string }
  | { type: 'flyToUser'; coords: LatLng }
  | { type: 'updateUserCoords'; coords: LatLng }
  | { type: 'setLightPreset'; value: LightPreset }
  | { type: 'setDarkTheme'; value: boolean }
  | { type: 'setProjection'; value: MapProjection }
  | { type: 'set3D'; value: boolean }
  | { type: 'backToGlobe' };

export type GlobeToAppMessage =
  | { type: 'questSelected'; id: string }
  | { type: 'questDeselected' }
  | { type: 'citySelected'; city: string }
  | { type: 'zoomMode'; isCityView: boolean }
  | { type: 'mapError'; message: string };

export interface GlobeMapHandle {
  postMessage: (msg: AppToGlobeMessage) => void;
}

export interface GlobeMapProps {
  places?: Place[];
  quests: Quest[];
  selectedQuestId: string | null;
  userCoords: LatLng | null;
  lightPreset: LightPreset;
  projection?: MapProjection;
  enable3D?: boolean;
  onToggleLightPreset: () => void;
  onLocateMe?: () => void;
  onPlaceSelected?: (placeId: string) => void;
  onQuestSelected: (id: string) => void;
  onQuestDeselected?: () => void;
  onCitySelected: (city: string) => void;
  onZoomModeChange?: (isCityView: boolean) => void;
  onBackToGlobe?: () => void;
  topControlsOffset?: number;
}

interface WebViewLike {
  injectJavaScript: (script: string) => void;
}

function getMapboxToken(): string {
  return (process.env.EXPO_PUBLIC_MAPBOX_TOKEN || '').trim();
}

function isValidPublicToken(token: string): boolean {
  return token.startsWith('pk.') && !token.includes('xxxxx') && token.length > 20;
}

function serializeMapPins(places?: Place[], quests: Quest[] = []) {
  if (places && places.length > 0) {
    return places.slice(0, 60).map((p) => {
      const maxUsd = Number(p.max_reward_usd || 0);
      const isFunded = Boolean((p.has_funded_quests || p.funded) && maxUsd > 0);
      const maxText = Number.isInteger(maxUsd) ? `$${maxUsd}` : `$${maxUsd.toFixed(2)}`;
      return {
        id: p.id,
        title: p.name,
        category: p.category || 'Explore',
        city: p.city || 'Bengaluru',
        isFunded,
        rewardLabel: isFunded ? `Pays up to ${maxText}` : `${p.max_xp || 50} XP`,
        isRecommended: false,
        lat: p.coordinates.latitude,
        lng: p.coordinates.longitude,
      };
    });
  }
  return quests.slice(0, 60).map((q) => {
    const maxUsd = Number(q.reward?.max_reward_usd ?? q.reward?.fixed_reward_usd ?? q.rewardUsd ?? 0);
    const isFunded = Boolean(
      q.funded && (q.budget_remaining_usd ?? q.budgetUsd ?? 0) > 0 && maxUsd > 0
    );
    const maxText = Number.isInteger(maxUsd) ? `$${maxUsd}` : `$${maxUsd.toFixed(2)}`;
    return {
      id: q.id,
      title: q.title,
      category: q.category,
      city: q.city || 'Bengaluru',
      isFunded,
      rewardLabel: isFunded ? `Pays up to ${maxText}` : `${q.xp} XP`,
      isRecommended: Boolean(q.isRecommended),
      lat: q.coordinates.latitude,
      lng: q.coordinates.longitude,
    };
  });
}

function buildGlobeHtml(params: {
  token: string;
  places?: Place[];
  quests: Quest[];
  selectedQuestId: string | null;
  userCoords: LatLng | null;
  lightPreset: LightPreset;
  isDark: boolean;
  showInr: boolean;
  projection: MapProjection;
  enable3D: boolean;
}): string {
  const safeQuests = serializeMapPins(params.places, params.quests);

  const payload = JSON.stringify({
    token: params.token,
    quests: safeQuests,
    selectedQuestId: params.selectedQuestId,
    userCoords: params.userCoords,
    lightPreset: params.lightPreset,
    isDark: params.isDark,
    projection: params.projection,
    enable3D: params.enable3D,
  }).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link href="https://api.mapbox.com/mapbox-gl-js/v3.9.4/mapbox-gl.css" rel="stylesheet" />
  <script src="https://api.mapbox.com/mapbox-gl-js/v3.9.4/mapbox-gl.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body, #map {
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: #08100E;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }

    /* Mapbox Marker Root (MUST stay position: absolute from .mapboxgl-marker!) */
    .roamr-marker-host {
      background: transparent;
      border: none;
      padding: 0;
      margin: 0;
      width: auto;
      height: auto;
    }

    /* City Cluster Markers (Globe & Regional views) */
    .city-pin {
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(247, 245, 236, 0.94);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      color: #164A2E;
      border: 1.5px solid rgba(255, 255, 255, 0.96);
      border-radius: 999px;
      padding: 3px 9px 3px 3px;
      cursor: pointer;
      box-shadow: 0 6px 16px rgba(10, 26, 17, 0.28), 0 2px 5px rgba(10, 26, 17, 0.14);
      white-space: nowrap;
      -webkit-tap-highlight-color: transparent;
      transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.2s ease, padding 0.18s ease;
    }
    .city-pin:active { transform: scale(0.95); }
    .city-pin.is-globe-compact {
      padding: 2px;
      gap: 0;
      box-shadow: 0 3px 10px rgba(0, 0, 0, 0.35);
    }
    .city-pin.is-globe-compact .city-meta {
      display: none;
    }
    .city-pin.is-globe-compact .city-dot {
      width: 22px;
      height: 22px;
      font-size: 10.5px;
    }
    .city-pin.is-occluded {
      opacity: 0;
      transform: scale(0.5);
      pointer-events: none;
    }
    body.theme-dark .city-pin {
      background: rgba(18, 30, 23, 0.90);
      color: #F7F5EC;
      border-color: rgba(255, 255, 255, 0.24);
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45);
    }
    .city-dot {
      position: relative;
      width: 22px;
      height: 22px;
      border-radius: 11px;
      background: linear-gradient(135deg, #7A9F3C 0%, #5F822A 100%);
      color: #FFFFFF;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 10.5px;
      font-weight: 800;
      box-shadow: 0 2px 5px rgba(122, 159, 60, 0.38);
      flex-shrink: 0;
    }
    .city-meta {
      display: flex;
      align-items: center;
      gap: 4px;
      line-height: 1;
    }
    .city-name {
      font-size: 11.5px;
      font-weight: 750;
      letter-spacing: -0.15px;
    }
    .city-sub {
      display: none;
    }

    /* Quest Place Markers (City Street view) */
    .quest-marker {
      position: relative;
      border: none;
      background: transparent;
      padding: 0;
      margin: 0;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      align-items: center;
      outline: none;
      -webkit-tap-highlight-color: transparent;
      user-select: none;
    }
    .quest-title-chip {
      position: absolute;
      bottom: calc(100% + 6px);
      left: 50%;
      opacity: 0;
      transform: translate(-50%, 5px) scale(0.92);
      pointer-events: none;
      padding: 3px 10px;
      border-radius: 999px;
      background: rgba(16, 29, 21, 0.90);
      color: #F7F5EC;
      border: 1px solid rgba(255, 255, 255, 0.20);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: -0.1px;
      max-width: 175px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.28);
      transition: opacity 0.2s ease, transform 0.24s cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    .quest-marker.is-selected .quest-title-chip {
      opacity: 1;
      transform: translate(-50%, 0) scale(1);
    }

    .quest-pill {
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 9px 3px 3px;
      border-radius: 999px;
      background: rgba(247, 245, 236, 0.96);
      border: 1.5px solid rgba(22, 74, 46, 0.22);
      color: #164A2E;
      box-shadow: 0 6px 16px rgba(13, 31, 20, 0.24), 0 1px 3px rgba(13, 31, 20, 0.14);
      transition: transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1),
                  background 0.2s ease,
                  border-color 0.2s ease,
                  box-shadow 0.2s ease;
    }
    body.theme-dark .quest-pill {
      background: rgba(19, 32, 24, 0.94);
      border-color: rgba(255, 255, 255, 0.24);
      color: #F7F5EC;
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45);
    }

    .quest-marker:active .quest-pill {
      transform: scale(0.94);
    }
    .quest-marker.is-funded .quest-pill {
      border: 2px solid #DF9F20;
      box-shadow: 0 6px 18px rgba(223, 159, 32, 0.28), 0 0 0 3px rgba(223, 159, 32, 0.22);
    }
    .quest-marker.is-funded .quest-reward {
      color: #9A6700;
    }
    body.theme-dark .quest-marker.is-funded .quest-reward {
      color: #F4C44E;
    }
    .quest-marker.is-funded .quest-anchor-ring {
      border-color: #DF9F20;
      background: rgba(223, 159, 32, 0.22);
    }
    .quest-marker.is-funded .quest-anchor-dot {
      background: #DF9F20;
    }
    .quest-marker.is-xp-only .quest-pill {
      border-color: rgba(31, 93, 58, 0.28);
    }
    .quest-marker.is-selected .quest-pill {
      background: linear-gradient(135deg, #246A43 0%, #164A2E 100%);
      border: 2px solid #F7F5EC;
      color: #F7F5EC;
      transform: scale(1.08) translateY(-2px);
      box-shadow: 0 10px 24px rgba(18, 59, 36, 0.45), 0 0 0 3px rgba(122, 159, 60, 0.28);
    }

    .quest-icon-badge {
      width: 26px;
      height: 26px;
      border-radius: 13px;
      background: #164A2E;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: background 0.2s ease;
    }
    body.theme-dark .quest-icon-badge {
      background: #2E7D50;
    }
    .quest-marker.is-selected .quest-icon-badge {
      background: #7A9F3C;
    }

    .quest-reward {
      font-size: 12px;
      font-weight: 800;
      letter-spacing: -0.2px;
      white-space: nowrap;
      line-height: 1;
    }

    .quest-star {
      width: 6px;
      height: 6px;
      border-radius: 3px;
      background: #DF9F20;
      flex-shrink: 0;
      box-shadow: 0 0 0 2px rgba(223, 159, 32, 0.22);
    }
    .quest-marker.is-selected .quest-star {
      background: #F4C44E;
      box-shadow: 0 0 0 2px rgba(244, 196, 78, 0.3);
    }

    .quest-stem {
      width: 2px;
      height: 5px;
      border-radius: 1px;
      background: #164A2E;
      opacity: 0.75;
      margin-top: -1px;
    }
    body.theme-dark .quest-stem {
      background: #F7F5EC;
    }
    .quest-marker.is-selected .quest-stem {
      background: #F7F5EC;
      opacity: 1;
      height: 6px;
    }

    .quest-anchor-wrap {
      position: relative;
      width: 10px;
      height: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-top: -2px;
    }
    .quest-anchor-dot {
      width: 7px;
      height: 7px;
      border-radius: 4px;
      background: #164A2E;
      border: 1.5px solid #FFFFFF;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
      z-index: 2;
    }
    body.theme-dark .quest-anchor-dot {
      background: #7A9F3C;
    }
    .quest-marker.is-selected .quest-anchor-dot {
      width: 9px;
      height: 9px;
      border-radius: 5px;
      background: #7A9F3C;
      border-color: #FFFFFF;
    }
    .quest-anchor-ring {
      position: absolute;
      width: 10px;
      height: 10px;
      border-radius: 999px;
      background: rgba(122, 159, 60, 0.38);
      opacity: 0;
      pointer-events: none;
    }
    .quest-marker.is-selected .quest-anchor-ring {
      animation: pinPulse 1.9s ease-out infinite;
    }
    @keyframes pinPulse {
      0% { transform: scale(1); opacity: 0.75; }
      100% { transform: scale(3.4); opacity: 0; }
    }

    /* User GPS Marker */
    .user-gps-wrap {
      position: relative;
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .user-gps-halo {
      position: absolute;
      width: 18px;
      height: 18px;
      border-radius: 9px;
      background: rgba(0, 112, 186, 0.35);
      animation: gpsPulse 2.2s ease-out infinite;
    }
    .user-gps-dot {
      width: 14px;
      height: 14px;
      border-radius: 7px;
      background: #0070BA;
      border: 2.5px solid #FFFFFF;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
      z-index: 2;
    }
    @keyframes gpsPulse {
      0% { transform: scale(0.9); opacity: 0.75; }
      100% { transform: scale(2.6); opacity: 0; }
    }

    .mapboxgl-ctrl-logo, .mapboxgl-ctrl-attrib { opacity: 0.45; font-size: 9px; }
  </style>
</head>
<body class="${params.isDark || params.lightPreset === 'dusk' ? 'theme-dark' : ''}">
  <div id="map"></div>
  <script>
    const INITIAL = ${payload};
    let quests = INITIAL.quests || [];
    let selectedQuestId = INITIAL.selectedQuestId || null;
    let lightPreset = INITIAL.lightPreset || 'day';
    let appDarkTheme = Boolean(INITIAL.isDark);
    let currentProjection = INITIAL.projection === 'mercator' ? 'mercator' : 'globe';
    let currentEnable3D = INITIAL.enable3D !== false;
    let userInteracting = false;
    let spinEnabled = currentProjection === 'globe';
    let idleTimer = null;
    let isCityView = false;
    let styleReady = false;
    let cityMarkers = [];
    let questMarkers = [];
    let questMarkerMode = null;
    let userMarker = null;

    function escapeHtml(str) {
      return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function syncBodyThemeClass() {
      if (appDarkTheme || lightPreset === 'dusk') {
        document.body.classList.add('theme-dark');
      } else {
        document.body.classList.remove('theme-dark');
      }
    }

    function postToApp(msg) {
      const str = JSON.stringify(msg);
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(str);
      } else if (window.parent && window.parent !== window) {
        window.parent.postMessage(str, '*');
      }
    }

    function categorySvg(category) {
      const c = String(category || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
      if (/cafe|coffee|bakery/.test(c)) {
        return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 8h1a4 4 0 1 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/></svg>';
      }
      if (/park|lake|garden|nature|viewpoint/.test(c)) {
        return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/></svg>';
      }
      if (/photo/.test(c)) {
        return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>';
      }
      if (/museum|gallery|landmark|heritage|cathedral|history/.test(c)) {
        return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 22h18"/><path d="M6 18v-7"/><path d="M10 18v-7"/><path d="M14 18v-7"/><path d="M18 18v-7"/><polygon points="12 2 20 7 4 7"/></svg>';
      }
      if (/market|bookstore|shop|arcade|bowling/.test(c)) {
        return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>';
      }
      if (/night/.test(c)) {
        return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
      }
      return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/></svg>';
    }

    if (typeof mapboxgl === 'undefined') {
      postToApp({ type: 'mapError', message: 'Failed to load Mapbox GL JS v3 library. Check your internet connection.' });
    } else {
      mapboxgl.accessToken = INITIAL.token;

      const map = new mapboxgl.Map({
        container: 'map',
        style: 'mapbox://styles/mapbox/standard',
        projection: currentProjection,
        center: [-40, 24],
        zoom: 1.65,
        pitch: currentEnable3D ? (currentProjection === 'globe' ? 15 : 0) : 0,
        maxPitch: currentEnable3D ? 75 : 0,
        pitchWithRotate: currentEnable3D,
        bearing: 0,
        antialias: false
      });

      function applyAtmosphereAndLight(preset) {
        lightPreset = preset === 'dusk' ? 'dusk' : 'day';
        syncBodyThemeClass();
        if (!styleReady) return;
        try {
          map.setConfigProperty('basemap', 'lightPreset', lightPreset);
        } catch (e) {}
        try {
          const isDusk = lightPreset === 'dusk';
          map.setFog({
            'color': isDusk ? 'rgb(20, 62, 92)' : 'rgb(168, 216, 234)',
            'high-color': isDusk ? 'rgb(9, 20, 38)' : 'rgb(36, 98, 158)',
            'horizon-blend': isDusk ? 0.022 : 0.025,
            'space-color': 'rgb(6, 12, 10)',
            'star-intensity': isDusk ? 0.65 : 0.50
          });
        } catch (e) {}
      }

      function applyMapMode(proj, is3d) {
        currentProjection = proj === 'mercator' ? 'mercator' : 'globe';
        currentEnable3D = Boolean(is3d);
        if (!styleReady) return;
        try {
          map.setProjection(currentProjection);
        } catch (e) {}
        try {
          map.setConfigProperty('basemap', 'show3dObjects', currentEnable3D);
        } catch (e) {}
        try {
          map.setMaxPitch(currentEnable3D ? 75 : 0);
          if (currentEnable3D) {
            map.dragRotate.enable();
            map.touchPitch.enable();
          } else {
            map.dragRotate.disable();
            map.touchPitch.disable();
          }
        } catch (e) {}
        if (currentProjection === 'mercator') {
          spinEnabled = false;
        } else if (map.getZoom() < 5) {
          spinEnabled = true;
          spinGlobe();
        }
        const z = map.getZoom();
        if (!currentEnable3D) {
          map.easeTo({ pitch: 0, bearing: 0, duration: 500 });
        } else if (z >= 8.5) {
          map.easeTo({ pitch: 58, duration: 600 });
        } else if (currentProjection === 'globe') {
          map.easeTo({ pitch: 15, duration: 600 });
        }
      }

      function computeCities() {
        const groups = {};
        quests.forEach((q) => {
          const key = (q.city || 'San Francisco').trim();
          if (!groups[key]) {
            groups[key] = { city: key, latSum: 0, lngSum: 0, count: 0 };
          }
          groups[key].latSum += q.lat;
          groups[key].lngSum += q.lng;
          groups[key].count += 1;
        });
        return Object.values(groups).map((g) => ({
          city: g.city,
          lat: g.latSum / g.count,
          lng: g.lngSum / g.count,
          count: g.count,
        }));
      }

      function clearMarkers(list) {
        list.forEach((m) => m.remove());
        list.length = 0;
      }

      function flyToCity(cityName) {
        const cities = computeCities();
        const match = cities.find((c) => c.city.toLowerCase() === String(cityName || '').toLowerCase()) || cities[0];
        if (!match) return;
        spinEnabled = false;
        if (idleTimer) clearTimeout(idleTimer);
        map.flyTo({
          center: [match.lng, match.lat],
          zoom: 13.4,
          pitch: currentEnable3D ? 55 : 0,
          bearing: currentEnable3D ? -10 : 0,
          duration: 1600,
          essential: true,
        });
      }

      function backToGlobe() {
        selectedQuestId = null;
        spinEnabled = currentProjection === 'globe';
        userInteracting = false;
        if (idleTimer) clearTimeout(idleTimer);
        renderMarkers();
        map.flyTo({
          center: [-40, 24],
          zoom: 1.65,
          pitch: currentEnable3D && currentProjection === 'globe' ? 15 : 0,
          bearing: 0,
          duration: 1800,
          essential: true,
        });
      }

      function updateSelectionClasses() {
        questMarkers.forEach((entry) => {
          const active = entry.id === selectedQuestId;
          entry.el.classList.toggle('is-selected', active);
          try {
            entry.marker.getElement().style.zIndex = active ? '50' : '10';
          } catch (e) {}
        });
      }

      function clearCityMarkerList() {
        cityMarkers.forEach((entry) => entry.marker.remove());
        cityMarkers.length = 0;
      }

      function clearQuestMarkerList() {
        questMarkers.forEach((entry) => entry.marker.remove());
        questMarkers.length = 0;
        questMarkerMode = null;
      }

      const QUEST_REVEAL_ZOOM = 9.5;

      function updateViewportMarkerVisibility() {
        const zoom = map.getZoom();
        if (userMarker) {
          try {
            const uEl = userMarker.getElement();
            uEl.style.opacity = zoom >= 4.5 ? '1' : '0';
            uEl.style.pointerEvents = zoom >= 4.5 ? 'auto' : 'none';
          } catch (e) {}
        }

        if (questMarkers.length === 0 || zoom < QUEST_REVEAL_ZOOM) return;
        const bounds = map.getBounds();
        questMarkers.forEach((entry) => {
          const inView = bounds ? bounds.contains([entry.lng, entry.lat]) : true;
          entry.el.style.opacity = inView ? '1' : '0';
          entry.el.style.pointerEvents = inView ? 'auto' : 'none';
        });
      }

      function renderMarkers(forceRebuildQuests) {
        const zoom = map.getZoom();
        const showCityQuests = zoom >= QUEST_REVEAL_ZOOM;

        clearCityMarkerList();

        if (!showCityQuests) {
          clearQuestMarkerList();
        } else {
          if (forceRebuildQuests || questMarkerMode !== 'city' || questMarkers.length === 0) {
            clearQuestMarkerList();
            quests.slice(0, 50).forEach((q) => {
              if (typeof q.lat !== 'number' || typeof q.lng !== 'number') return;
              const isSelected = q.id === selectedQuestId;
              const host = document.createElement('div');
              host.className = 'roamr-marker-host';
              const btn = document.createElement('button');
              btn.type = 'button';
              btn.className =
                'quest-marker ' +
                (q.isFunded ? 'is-funded' : 'is-xp-only') +
                (isSelected ? ' is-selected' : '');
              btn.setAttribute('aria-label', q.title);
              btn.innerHTML =
                '<span class="quest-title-chip">' + escapeHtml(q.title) + '</span>' +
                '<span class="quest-pill">' +
                  '<span class="quest-icon-badge">' + categorySvg(q.category) + '</span>' +
                  '<span class="quest-reward">' + escapeHtml(q.rewardLabel || '$0.50') + '</span>' +
                  (q.isRecommended ? '<span class="quest-star"></span>' : '') +
                '</span>' +
                '<span class="quest-stem"></span>' +
                '<span class="quest-anchor-wrap">' +
                  '<span class="quest-anchor-ring"></span>' +
                  '<span class="quest-anchor-dot"></span>' +
                '</span>';

              btn.addEventListener('click', (e) => {
                e.stopPropagation();
                selectedQuestId = q.id;
                updateSelectionClasses();
                map.flyTo({
                  center: [q.lng, q.lat],
                  zoom: Math.max(map.getZoom(), 15.2),
                  pitch: currentEnable3D ? 60 : 0,
                  duration: 750,
                });
                postToApp({ type: 'questSelected', id: q.id });
              });
              host.appendChild(btn);
              const m = new mapboxgl.Marker({ element: host, anchor: 'bottom', offset: [0, 5] })
                .setLngLat([q.lng, q.lat])
                .addTo(map);
              try {
                m.getElement().style.zIndex = isSelected ? '50' : '10';
              } catch (e) {}
              questMarkers.push({ id: q.id, el: btn, lat: q.lat, lng: q.lng, marker: m });
            });
            questMarkerMode = 'city';
          } else {
            updateSelectionClasses();
          }
        }

        updateViewportMarkerVisibility();

        if (showCityQuests !== isCityView) {
          isCityView = showCityQuests;
          postToApp({ type: 'zoomMode', isCityView: isCityView });
        }
      }

      function spinGlobe() {
        const zoom = map.getZoom();
        if (spinEnabled && currentProjection === 'globe' && !userInteracting && zoom < 5) {
          const center = map.getCenter();
          center.lng -= 1.8;
          map.easeTo({ center, duration: 1000, easing: (n) => n });
        }
      }

      function pauseSpinAndScheduleResume() {
        userInteracting = true;
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          userInteracting = false;
          if (currentProjection === 'globe' && map.getZoom() < 5) {
            spinEnabled = true;
            spinGlobe();
          }
        }, 5000);
      }

      function updateUserDot(coords) {
        if (!coords || typeof coords.latitude !== 'number' || typeof coords.longitude !== 'number') return;
        if (!userMarker) {
          const host = document.createElement('div');
          host.className = 'roamr-marker-host';
          const wrap = document.createElement('div');
          wrap.className = 'user-gps-wrap';
          wrap.innerHTML = '<span class="user-gps-halo"></span><span class="user-gps-dot"></span>';
          host.appendChild(wrap);
          userMarker = new mapboxgl.Marker({ element: host, anchor: 'center' })
            .setLngLat([coords.longitude, coords.latitude])
            .addTo(map);
        } else {
          userMarker.setLngLat([coords.longitude, coords.latitude]);
        }
      }

      map.on('style.load', () => {
        styleReady = true;
        applyAtmosphereAndLight(lightPreset);
        applyMapMode(currentProjection, currentEnable3D);
        if (INITIAL.userCoords) updateUserDot(INITIAL.userCoords);
        renderMarkers(false);
        spinGlobe();
      });

      map.on('error', (e) => {
        const msg = e && e.error && e.error.message ? e.error.message : 'Mapbox failed to load tiles or style.';
        postToApp({ type: 'mapError', message: msg });
      });

      map.on('click', () => {
        if (selectedQuestId) {
          selectedQuestId = null;
          updateSelectionClasses();
          postToApp({ type: 'questDeselected' });
        }
      });

      map.on('mousedown', pauseSpinAndScheduleResume);
      map.on('touchstart', pauseSpinAndScheduleResume);
      map.on('dragstart', pauseSpinAndScheduleResume);
      map.on('wheel', pauseSpinAndScheduleResume);
      map.on('move', updateViewportMarkerVisibility);
      map.on('zoomend', () => renderMarkers(false));
      map.on('moveend', () => {
        renderMarkers(false);
        spinGlobe();
      });

      window.ROAMR_BRIDGE = function(msg) {
        if (!msg || !msg.type) return;
        if (msg.type === 'setLightPreset') {
          applyAtmosphereAndLight(msg.value);
        } else if (msg.type === 'setDarkTheme') {
          appDarkTheme = Boolean(msg.value);
          syncBodyThemeClass();
        } else if (msg.type === 'setProjection') {
          applyMapMode(msg.value, currentEnable3D);
        } else if (msg.type === 'set3D') {
          applyMapMode(currentProjection, msg.value);
        } else if (msg.type === 'flyToCity') {
          flyToCity(msg.city);
        } else if (msg.type === 'backToGlobe') {
          backToGlobe();
        } else if (msg.type === 'syncSelectedQuest') {
          selectedQuestId = msg.id || null;
          updateSelectionClasses();
        } else if (msg.type === 'selectQuest') {
          selectedQuestId = msg.id;
          const target = quests.find((q) => q.id === msg.id);
          if (target) {
            spinEnabled = false;
            if (idleTimer) clearTimeout(idleTimer);
            map.flyTo({
              center: [target.lng, target.lat],
              zoom: 15.2,
              pitch: currentEnable3D ? 60 : 0,
              bearing: currentEnable3D ? -15 : 0,
              duration: 1400,
              essential: true,
            });
          }
          renderMarkers(false);
        } else if (msg.type === 'updateQuests' && Array.isArray(msg.quests)) {
          quests = msg.quests.slice(0, 50);
          clearCityMarkerList();
          renderMarkers(true);
        } else if (msg.type === 'updateUserCoords' && msg.coords) {
          updateUserDot(msg.coords);
        } else if (msg.type === 'flyToUser' && msg.coords) {
          updateUserDot(msg.coords);
          spinEnabled = false;
          if (idleTimer) clearTimeout(idleTimer);
          map.flyTo({
            center: [msg.coords.longitude, msg.coords.latitude],
            zoom: 14.5,
            pitch: currentEnable3D ? 55 : 0,
            bearing: 0,
            duration: 1700,
            essential: true,
          });
          setTimeout(() => renderMarkers(false), 800);
        }
      };

      window.addEventListener('message', (ev) => {
        try {
          const data = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data;
          if (data && data.type && window.ROAMR_BRIDGE) window.ROAMR_BRIDGE(data);
        } catch (e) {}
      });
    }
  </script>
</body>
</html>`;
}

export const GlobeMap = forwardRef<GlobeMapHandle, GlobeMapProps>(function GlobeMap(
  {
    places,
    quests,
    selectedQuestId,
    userCoords,
    lightPreset,
    projection = 'globe',
    enable3D = true,
    onToggleLightPreset,
    onLocateMe,
    onPlaceSelected,
    onQuestSelected,
    onQuestDeselected,
    onCitySelected,
    onZoomModeChange,
    onBackToGlobe,
    topControlsOffset = 14,
  },
  ref
) {
  const { palette, isDark, showInr } = useRoamr();
  const token = getMapboxToken();
  const hasToken = isValidPublicToken(token);
  const [mapError, setMapError] = useState<string | null>(null);
  const [isCityView, setIsCityView] = useState(false);
  const webViewRef = useRef<WebViewLike | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const initialHtml = useMemo(
    () =>
      buildGlobeHtml({
        token: token || 'missing',
        places,
        quests,
        selectedQuestId,
        userCoords,
        lightPreset,
        isDark,
        showInr,
        projection,
        enable3D,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [token]
  );

  const postToWebView = useCallback((msg: AppToGlobeMessage | { type: 'updateQuests'; quests: unknown[] }) => {
    if (Platform.OS === 'web') {
      iframeRef.current?.contentWindow?.postMessage(JSON.stringify(msg), '*');
      return;
    }
    if (webViewRef.current) {
      const json = JSON.stringify(msg);
      webViewRef.current.injectJavaScript(`window.ROAMR_BRIDGE && window.ROAMR_BRIDGE(${json}); true;`);
    }
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      postMessage: (msg: AppToGlobeMessage) => postToWebView(msg),
    }),
    [postToWebView]
  );

  // Sync lightPreset & theme changes
  useEffect(() => {
    postToWebView({ type: 'setLightPreset', value: lightPreset });
  }, [lightPreset, postToWebView]);

  useEffect(() => {
    postToWebView({ type: 'setDarkTheme', value: isDark });
  }, [isDark, postToWebView]);

  useEffect(() => {
    postToWebView({ type: 'syncSelectedQuest', id: selectedQuestId });
  }, [selectedQuestId, postToWebView]);

  // Sync map projection (Globe vs Flat Map) & 3D toggle
  useEffect(() => {
    postToWebView({ type: 'setProjection', value: projection });
  }, [projection, postToWebView]);

  useEffect(() => {
    postToWebView({ type: 'set3D', value: enable3D });
  }, [enable3D, postToWebView]);

  // Sync userCoords GPS dot
  useEffect(() => {
    if (userCoords) {
      postToWebView({ type: 'updateUserCoords', coords: userCoords });
    }
  }, [userCoords, postToWebView]);

  // Sync places/quests list & currency display updates
  useEffect(() => {
    postToWebView({
      type: 'updateQuests',
      quests: serializeMapPins(places, quests),
    });
  }, [places, quests, showInr, postToWebView]);

  const handleIncomingMessage = useCallback(
    (raw: unknown) => {
      try {
        const msg = (typeof raw === 'string' ? JSON.parse(raw) : raw) as GlobeToAppMessage;
        if (!msg || !msg.type) return;
        if (msg.type === 'questSelected') {
          if (places && places.length > 0 && onPlaceSelected) {
            onPlaceSelected(msg.id);
          } else {
            onQuestSelected(msg.id);
          }
        } else if (msg.type === 'questDeselected') {
          onQuestDeselected?.();
        } else if (msg.type === 'citySelected') {
          setIsCityView(true);
          onCitySelected(msg.city);
        } else if (msg.type === 'zoomMode') {
          const next = Boolean(msg.isCityView);
          setIsCityView(next);
          onZoomModeChange?.(next);
        } else if (msg.type === 'mapError') {
          setMapError(msg.message || 'Unable to load Mapbox 3D globe.');
        }
      } catch {
        // Ignore malformed postMessage payloads
      }
    },
    [places, onPlaceSelected, onCitySelected, onQuestDeselected, onQuestSelected, onZoomModeChange]
  );

  // Web iframe listener
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const listener = (ev: MessageEvent) => handleIncomingMessage(ev.data);
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [handleIncomingMessage]);

  const handleBackToGlobePress = () => {
    setIsCityView(false);
    postToWebView({ type: 'backToGlobe' });
    onBackToGlobe?.();
  };

  if (!hasToken || mapError) {
    return (
      <View style={[styles.errorContainer, { backgroundColor: palette.bgSage }]}>
        <View style={[styles.errorCard, { backgroundColor: palette.bgCard, borderColor: palette.border }]}>
          <Ionicons name="globe-outline" size={38} color={palette.primary} />
          <Text style={[styles.errorTitle, { color: palette.textPrimary }]}>
            {!hasToken ? 'Mapbox Public Token Needed' : '3D Globe Unavailable'}
          </Text>
          <Text style={[styles.errorBody, { color: palette.textSecondary }]}>
            {!hasToken
              ? 'Add EXPO_PUBLIC_MAPBOX_TOKEN=pk.eyJ... to app/.env and restart Expo to render the Mapbox 3D Globe.'
              : mapError}
          </Text>
          {mapError ? (
            <Pressable
              onPress={() => setMapError(null)}
              style={[styles.retryBtn, { backgroundColor: palette.primary }]}
            >
              <Text style={[styles.retryBtnText, { color: palette.white }]}>Retry Mapbox Globe</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    );
  }

  // Lazy-require react-native-webview on native so Expo Web never evaluates native WebView imports
  const NativeWebView =
    Platform.OS === 'web'
      ? null
      : (require('react-native-webview').WebView as React.ComponentType<Record<string, unknown>>);

  return (
    <View style={styles.container}>
      {Platform.OS === 'web' ? (
        <iframe
          ref={iframeRef}
          srcDoc={initialHtml}
          title="ROAMR 3D Globe"
          style={{ width: '100%', height: '100%', border: 'none', backgroundColor: '#08100E' }}
        />
      ) : NativeWebView ? (
        <NativeWebView
          ref={webViewRef}
          source={{ html: initialHtml, baseUrl: 'https://roamr.app' }}
          onMessage={(e: { nativeEvent: { data: string } }) =>
            handleIncomingMessage(e.nativeEvent.data)
          }
          onError={() =>
            setMapError('WebView could not load Mapbox GL JS. Check your network connection.')
          }
          javaScriptEnabled
          domStorageEnabled
          mixedContentMode="compatibility"
          originWhitelist={['*']}
          style={styles.webview}
        />
      ) : null}

      {/* Compact Top-Right Globe Control Capsule */}
      <View style={[styles.controlsCol, { top: topControlsOffset }]}>
        <View
          style={[
            styles.capsuleCard,
            {
              backgroundColor: palette.floatingPillBg,
              borderColor: palette.floatingPillBorder,
            },
          ]}
        >
          <View style={styles.capsuleStack}>
            <Pressable
              onPress={onToggleLightPreset}
              style={styles.iconActionBtn}
              accessibilityLabel="Toggle globe lighting between day and dusk"
            >
              <Ionicons
                name={lightPreset === 'day' ? 'sunny' : 'moon'}
                size={18}
                color={palette.primaryDark}
              />
            </Pressable>

            {onLocateMe ? (
              <>
                <View style={[styles.capsuleDivider, { backgroundColor: palette.border }]} />
                <Pressable
                  onPress={onLocateMe}
                  style={styles.iconActionBtn}
                  accessibilityLabel="Locate me on the globe"
                >
                  <Ionicons name="navigate" size={18} color={palette.primary} />
                </Pressable>
              </>
            ) : null}

            {isCityView || selectedQuestId ? (
              <>
                <View style={[styles.capsuleDivider, { backgroundColor: palette.border }]} />
                <Pressable
                  onPress={handleBackToGlobePress}
                  style={styles.iconActionBtn}
                  accessibilityLabel={projection === 'globe' ? 'Back to globe' : 'Back to world map'}
                >
                  <Ionicons
                    name={projection === 'globe' ? 'globe-outline' : 'map-outline'}
                    size={19}
                    color={palette.primaryDark}
                  />
                </Pressable>
              </>
            ) : null}
          </View>
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#08100E',
    position: 'relative',
  },
  webview: {
    flex: 1,
    backgroundColor: '#08100E',
  },
  controlsCol: {
    position: 'absolute',
    right: 14,
    top: 14,
    alignItems: 'center',
  },
  capsuleCard: {
    backgroundColor: 'rgba(248, 250, 247, 0.82)',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.88)',
    ...shadows.soft,
  },
  capsuleStack: {
    alignItems: 'center',
    width: 44,
  },
  iconActionBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  capsuleDivider: {
    width: 24,
    height: 1,
    backgroundColor: colors.border,
  },
  errorContainer: {
    flex: 1,
    backgroundColor: colors.bgSage,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  errorCard: {
    backgroundColor: colors.white,
    borderRadius: radii.xl,
    padding: 24,
    alignItems: 'center',
    gap: 10,
    maxWidth: 360,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  errorTitle: {
    fontFamily: fonts.serif,
    fontSize: 20,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  errorBody: {
    fontFamily: fonts.sans,
    fontSize: 13.5,
    lineHeight: 20,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: 6,
    backgroundColor: colors.primary,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: radii.pill,
  },
  retryBtnText: {
    fontFamily: fonts.sansSemi,
    fontSize: 13,
    color: colors.white,
  },
});

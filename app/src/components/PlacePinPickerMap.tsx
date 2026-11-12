import React, { useMemo } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { useRoamr } from '../context/RoamrContext';
import { fonts, radii } from '../theme/tokens';

interface PlacePinPickerMapProps {
  latitude: number;
  longitude: number;
  radiusMeters: number;
  onChangeCoords: (coords: { latitude: number; longitude: number }) => void;
}

export function PlacePinPickerMap({
  latitude,
  longitude,
  radiusMeters,
  onChangeCoords,
}: PlacePinPickerMapProps) {
  const { palette, isDark } = useRoamr();
  const token = (process.env.EXPO_PUBLIC_MAPBOX_TOKEN || '').trim();
  const hasMapbox = Boolean(token && token.startsWith('pk.'));

  const html = useMemo(() => {
    const safeStyle = isDark
      ? 'mapbox://styles/mapbox/dark-v11'
      : 'mapbox://styles/mapbox/streets-v12';
    return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="initial-scale=1,maximum-scale=1,user-scalable=no" />
<link href="https://api.mapbox.com/mapbox-gl-js/v3.7.0/mapbox-gl.css" rel="stylesheet" />
<script src="https://api.mapbox.com/mapbox-gl-js/v3.7.0/mapbox-gl.js"></script>
<style>
  html, body, #map { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; }
  .hint {
    position: absolute; top: 8px; left: 8px; right: 8px; z-index: 5;
    background: rgba(18, 30, 22, 0.78); color: #fff; font-family: -apple-system, sans-serif;
    font-size: 11px; padding: 5px 10px; border-radius: 999px; text-align: center; pointer-events: none;
  }
</style>
</head>
<body>
<div class="hint">Drag pin or tap map to set exact quest spot (${Math.round(radiusMeters)}m radius)</div>
<div id="map"></div>
<script>
  mapboxgl.accessToken = ${JSON.stringify(token)};
  const initLat = ${Number(latitude || 12.9716)};
  const initLng = ${Number(longitude || 77.5946)};
  const map = new mapboxgl.Map({
    container: 'map',
    style: ${JSON.stringify(safeStyle)},
    center: [initLng, initLat],
    zoom: 15.2,
    attributionControl: false
  });
  const marker = new mapboxgl.Marker({ color: '#1F5D3A', draggable: true })
    .setLngLat([initLng, initLat])
    .addTo(map);

  function sendCoords(lngLat) {
    const msg = JSON.stringify({ latitude: Number(lngLat.lat.toFixed(6)), longitude: Number(lngLat.lng.toFixed(6)) });
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(msg);
    } else if (window.parent) {
      window.parent.postMessage(msg, '*');
    }
  }

  marker.on('dragend', () => sendCoords(marker.getLngLat()));
  map.on('click', (e) => {
    marker.setLngLat(e.lngLat);
    sendCoords(e.lngLat);
  });
</script>
</body>
</html>`;
  }, [token, isDark, latitude, longitude, radiusMeters]);

  if (!hasMapbox) {
    return (
      <View
        style={[
          styles.fallback,
          { backgroundColor: palette.bgSage, borderColor: palette.border },
        ]}
      >
        <Ionicons name="pin" size={22} color={palette.primary} />
        <Text style={[styles.fallbackTitle, { color: palette.textPrimary }]}>
          Pinned Coordinates: {latitude.toFixed(5)}, {longitude.toFixed(5)}
        </Text>
        <Text style={[styles.fallbackSub, { color: palette.textSecondary }]}>
          Add EXPO_PUBLIC_MAPBOX_TOKEN in app/.env to enable interactive draggable Mapbox preview.
        </Text>
      </View>
    );
  }

  if (Platform.OS === 'web') {
    return (
      <View style={[styles.wrap, { borderColor: palette.border }]}>
        <iframe
          title="Place Pin Picker"
          srcDoc={html}
          style={{ width: '100%', height: '100%', border: '0' } as any}
        />
      </View>
    );
  }

  return (
    <View style={[styles.wrap, { borderColor: palette.border }]}>
      <WebView
        source={{ html }}
        style={styles.webview}
        scrollEnabled={false}
        nestedScrollEnabled
        javaScriptEnabled
        domStorageEnabled
        onMessage={(event) => {
          try {
            const parsed = JSON.parse(event.nativeEvent.data);
            if (
              typeof parsed?.latitude === 'number' &&
              typeof parsed?.longitude === 'number'
            ) {
              onChangeCoords({
                latitude: parsed.latitude,
                longitude: parsed.longitude,
              });
            }
          } catch {
            // ignore malformed message
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    height: 210,
    borderRadius: radii.md,
    borderWidth: 1,
    overflow: 'hidden',
  },
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  fallback: {
    width: '100%',
    minHeight: 110,
    borderRadius: radii.md,
    borderWidth: 1,
    padding: 14,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  fallbackTitle: {
    fontFamily: fonts.sansSemi,
    fontSize: 13,
  },
  fallbackSub: {
    fontFamily: fonts.sans,
    fontSize: 11.5,
    textAlign: 'center',
  },
});

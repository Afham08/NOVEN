import { SymbolView } from 'expo-symbols';
import { StyleSheet, Text, View } from 'react-native';

import { Radius, Spacing, Type } from '@/constants/theme';

/**
 * CAMERA PLACEHOLDER — no camera, no pose estimation, no MediaPipe.
 *
 * This is a deliberate stand-in so the session flow can be built and tested.
 * Swap this component for a real camera view once that work begins.
 */
export function CameraPlaceholder() {
  return (
    <View style={styles.frame}>
      <View style={styles.inner}>
        <SymbolView
          name={{ ios: 'camera.viewfinder', android: 'camera', web: 'camera' }}
          size={40}
          tintColor="rgba(250, 249, 246, 0.85)"
        />
        <Text style={styles.title}>Camera placeholder</Text>
        <Text style={styles.subtitle}>
          No camera or pose tracking is used in this demo session.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    height: 260,
    backgroundColor: '#202522',
    borderRadius: Radius.card,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: 'rgba(250, 249, 246, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  inner: {
    alignItems: 'center',
    gap: Spacing.three,
  },
  title: {
    ...Type.label,
    color: '#FAF9F6',
    fontSize: 18,
    lineHeight: 26,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  subtitle: {
    ...Type.label,
    color: 'rgba(250, 249, 246, 0.7)',
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
  },
});
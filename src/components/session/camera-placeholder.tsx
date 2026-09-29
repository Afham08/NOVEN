import { SymbolView } from 'expo-symbols';
import { StyleSheet, Text, View } from 'react-native';

import { Radius, Spacing, Type } from '@/constants/theme';

/**
 * Shown only when the camera is unavailable — permission not granted yet or
 * denied, or on a platform with no native pose tracker. The session screen
 * swaps in the real CameraX + MediaPipe PoseTrackerView as soon as camera
 * permission is granted, so this is the no-camera fallback, not the session UI.
 *
 * `optional` changes the wording and nothing else. It exists for meditation,
 * where the camera is a convenience for the opening posture rather than the
 * thing the session is made of. The default wording tells the user camera
 * access "is needed", which is true of a rep-counting exercise and false of a
 * meditation that carries on regardless — so an optional camera must not imply
 * the session is blocked.
 */
export function CameraPlaceholder({ optional = false }: { optional?: boolean }) {
  return (
    <View style={styles.frame}>
      <View style={styles.inner}>
        <SymbolView
          name={{ ios: 'camera.viewfinder', android: 'camera', web: 'camera' }}
          size={40}
          tintColor="rgba(250, 249, 246, 0.85)"
        />
        <Text style={styles.title}>Camera unavailable</Text>
        <Text style={styles.subtitle}>
          {optional
            ? 'You can carry on without the camera. Allow camera access in Settings if you would like a posture reminder.'
            : 'Camera access is needed to track your movement. Allow it in Settings, then reopen this session.'}
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
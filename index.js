import { LogBox } from 'react-native';

// Must run before the router/reanimated graph is required: Reanimated emits a
// dev-only warning when the device has reduced motion enabled (an accessibility
// preference, not a bug). Silencing it here keeps the LogBox banner from
// covering in-session controls during development.
LogBox.ignoreLogs(['[Reanimated] Reduced motion setting is enabled']);

require('expo-router/entry');
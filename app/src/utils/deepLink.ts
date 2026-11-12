import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Linking from 'expo-linking';

/**
 * Generates an OAuth / payment return URL that actually routes back into the
 * running host app: `exp://<hostUri>/--/<path>` inside Expo Go, or the custom
 * `roamr://` scheme in standalone builds.
 */
export function getExpoAwareDeepLink(path: string): string {
  const cleanPath = path.replace(/^\/+/, '');
  if (Platform.OS === 'web') {
    return Linking.createURL(cleanPath);
  }

  const extraConstants = Constants as unknown as {
    appOwnership?: string;
    expoGoConfig?: { debuggerHost?: string };
    manifest2?: { extra?: { expoGo?: { debuggerHost?: string }; expoClient?: { hostUri?: string } } };
  };

  const isExpoGo =
    Constants.executionEnvironment === ExecutionEnvironment.StoreClient ||
    extraConstants.appOwnership === 'expo' ||
    Boolean(extraConstants.expoGoConfig) ||
    Boolean(extraConstants.manifest2?.extra?.expoGo);

  const hostUri =
    Constants.expoConfig?.hostUri ||
    extraConstants.expoGoConfig?.debuggerHost ||
    extraConstants.manifest2?.extra?.expoGo?.debuggerHost ||
    extraConstants.manifest2?.extra?.expoClient?.hostUri;

  if (isExpoGo && hostUri) {
    return `exp://${hostUri}/--/${cleanPath}`;
  }

  return Linking.createURL(cleanPath);
}

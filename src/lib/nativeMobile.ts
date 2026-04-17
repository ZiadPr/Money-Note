import {
  checkAndroidNotificationPermission,
  getNativePlatform,
  isNativeAndroidBridgeAvailable,
  prepareAndroidAppShell,
  requestAndroidNotificationPermission,
} from './androidBridge';

export async function prepareNativeAppShell(isDarkMode: boolean) {
  document.documentElement.dataset.platform = isNativeAndroidBridgeAvailable() ? getNativePlatform() : 'web';
  document.documentElement.style.colorScheme = isDarkMode ? 'dark' : 'light';

  if (!isNativeAndroidBridgeAvailable()) {
    return;
  }

  prepareAndroidAppShell(isDarkMode);
}

export async function requestNotificationPermissions() {
  if (!isNativeAndroidBridgeAvailable()) {
    return { display: 'granted' as const };
  }

  const current = checkAndroidNotificationPermission();
  if (current.display === 'granted') {
    return current;
  }

  return requestAndroidNotificationPermission();
}

import {
  checkAndroidBiometricAvailability,
  isNativeAndroidBridgeAvailable,
  requestAndroidBiometricAuth,
} from './androidBridge';

export function isNativeAndroidSecurityAvailable() {
  return isNativeAndroidBridgeAvailable();
}

export async function isNativeBiometricAvailable() {
  if (!isNativeAndroidSecurityAvailable()) {
    return false;
  }

  try {
    const result = checkAndroidBiometricAvailability();
    return result.available;
  } catch (error) {
    console.error('Failed to check native biometric availability', error);
    return false;
  }
}

export async function authenticateWithNativeBiometrics(options?: {
  title?: string;
  subtitle?: string;
  reason?: string;
}) {
  if (!isNativeAndroidSecurityAvailable()) {
    return false;
  }

  try {
    const result = await requestAndroidBiometricAuth(options);
    return result.success;
  } catch (error) {
    console.error('Native biometric authentication failed', error);
    return false;
  }
}

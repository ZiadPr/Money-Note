import {
  addAndroidSmsListener,
  checkAndroidSmsPermission,
  getPendingAndroidSmsEvent,
  isNativeAndroidBridgeAvailable,
  requestAndroidSmsPermission,
} from './androidBridge';

export type SmsRiskStatus = 'VERIFIED' | 'SUSPICIOUS' | 'FRAUD' | 'UNKNOWN';
export type SmsTransactionType = 'income' | 'expense';
export type SmsPermissionState = 'prompt' | 'prompt-with-rationale' | 'granted' | 'denied';

export interface SmsMonitorEvent {
  id: string;
  sender: string;
  body: string;
  amount: number;
  type: SmsTransactionType;
  status: SmsRiskStatus;
  reason: string;
  timestamp: number;
  notificationTitle: string;
  notificationBody: string;
}

export interface PluginListenerHandle {
  remove: () => Promise<void> | void;
}

export const SmsMonitor = {
  async checkPermissions() {
    if (!isNativeAndroidBridgeAvailable()) {
      return { sms: 'prompt' as SmsPermissionState };
    }

    const result = checkAndroidSmsPermission();
    return { sms: result.sms as SmsPermissionState };
  },

  async requestPermissions() {
    if (!isNativeAndroidBridgeAvailable()) {
      return { sms: 'prompt' as SmsPermissionState };
    }

    const result = await requestAndroidSmsPermission();
    return {
      sms:
        result.sms === 'granted'
          ? ('granted' as SmsPermissionState)
          : ('denied' as SmsPermissionState),
    };
  },

  async getPendingSmsEvent() {
    if (!isNativeAndroidBridgeAvailable()) {
      return { event: null as SmsMonitorEvent | null };
    }

    return getPendingAndroidSmsEvent<SmsMonitorEvent>();
  },

  async addListener(
    eventName: 'smsReceived',
    listenerFunc: (event: SmsMonitorEvent) => void,
  ): Promise<PluginListenerHandle> {
    if (eventName !== 'smsReceived' || !isNativeAndroidBridgeAvailable()) {
      return {
        remove: () => undefined,
      };
    }

    return addAndroidSmsListener(listenerFunc);
  },
};

export function isNativeAndroidApp() {
  return isNativeAndroidBridgeAvailable();
}

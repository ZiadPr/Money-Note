const SMS_EVENT_NAME = 'money-note:sms';

type PendingResolver = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
};

type AndroidBridgeHost = {
  isNativeApp?: () => boolean;
  getPlatform?: () => string;
  prepareAppShell?: (isDarkMode: boolean) => void;
  checkNotificationPermission?: () => string;
  requestNotificationPermission?: (requestId: string) => void;
  checkSmsPermission?: () => string;
  requestSmsPermission?: (requestId: string) => void;
  getPendingSmsEvent?: () => string;
  isBiometricAvailable?: () => string;
  authenticate?: (requestId: string, optionsJson: string) => void;
};

declare global {
  interface Window {
    AndroidBridge?: AndroidBridgeHost;
    __moneyNoteBridgeResolve?: (requestId: string, ok: boolean, payload: string) => void;
    __moneyNoteBridgeDispatchSmsEvent?: (eventJson: string) => void;
  }
}

const pendingResolvers = new Map<string, PendingResolver>();

const createRequestId = () =>
  `native-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const parseJson = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch (error) {
    console.error('Failed to parse Android bridge payload', error);
    return fallback;
  }
};

const getBridge = () => (typeof window === 'undefined' ? undefined : window.AndroidBridge);

const ensureGlobalBridgeHandlers = () => {
  if (typeof window === 'undefined') {
    return;
  }

  if (!window.__moneyNoteBridgeResolve) {
    window.__moneyNoteBridgeResolve = (requestId, ok, payload) => {
      const resolver = pendingResolvers.get(requestId);
      if (!resolver) {
        return;
      }

      pendingResolvers.delete(requestId);

      if (ok) {
        resolver.resolve(parseJson(payload, null));
        return;
      }

      resolver.reject(payload || 'Native bridge request failed.');
    };
  }

  if (!window.__moneyNoteBridgeDispatchSmsEvent) {
    window.__moneyNoteBridgeDispatchSmsEvent = (eventJson) => {
      const detail = parseJson(eventJson, null);
      if (!detail) {
        return;
      }

      window.dispatchEvent(new CustomEvent(SMS_EVENT_NAME, { detail }));
    };
  }
};

const invokeSyncJson = <T>(methodName: keyof AndroidBridgeHost, fallback: T): T => {
  ensureGlobalBridgeHandlers();
  const bridge = getBridge();
  const method = bridge?.[methodName];

  if (typeof method !== 'function') {
    return fallback;
  }

  try {
    const result = (method as () => string)();
    return typeof result === 'string' ? parseJson(result, fallback) : fallback;
  } catch (error) {
    console.error(`Android bridge method "${String(methodName)}" failed`, error);
    return fallback;
  }
};

const invokeAsyncJson = <T>(
  methodName: keyof AndroidBridgeHost,
  ...args: string[]
): Promise<T> => {
  ensureGlobalBridgeHandlers();
  const bridge = getBridge();
  const method = bridge?.[methodName];

  if (typeof method !== 'function') {
    return Promise.reject(new Error(`Android bridge method "${String(methodName)}" is unavailable.`));
  }

  return new Promise<T>((resolve, reject) => {
    const requestId = createRequestId();
    pendingResolvers.set(requestId, { resolve, reject });

    try {
      (method as (requestId: string, ...methodArgs: string[]) => void)(requestId, ...args);
    } catch (error) {
      pendingResolvers.delete(requestId);
      reject(error);
    }
  });
};

export function isNativeAndroidBridgeAvailable() {
  ensureGlobalBridgeHandlers();
  const bridge = getBridge();

  if (!bridge || typeof bridge.isNativeApp !== 'function') {
    return false;
  }

  try {
    return Boolean(bridge.isNativeApp());
  } catch (error) {
    console.error('Failed to query Android bridge availability', error);
    return false;
  }
}

export function getNativePlatform() {
  const bridge = getBridge();
  if (!bridge || typeof bridge.getPlatform !== 'function') {
    return 'web';
  }

  try {
    return bridge.getPlatform() || 'android';
  } catch (error) {
    console.error('Failed to read Android platform name', error);
    return 'android';
  }
}

export function prepareAndroidAppShell(isDarkMode: boolean) {
  ensureGlobalBridgeHandlers();
  const bridge = getBridge();

  if (!bridge || typeof bridge.prepareAppShell !== 'function') {
    return;
  }

  try {
    bridge.prepareAppShell(isDarkMode);
  } catch (error) {
    console.error('Failed to prepare Android app shell', error);
  }
}

export function checkAndroidNotificationPermission() {
  return invokeSyncJson('checkNotificationPermission', { display: 'granted' as const });
}

export function requestAndroidNotificationPermission() {
  return invokeAsyncJson<{ display: 'prompt' | 'granted' | 'denied' }>('requestNotificationPermission');
}

export function checkAndroidSmsPermission() {
  return invokeSyncJson('checkSmsPermission', { sms: 'prompt' as const });
}

export function requestAndroidSmsPermission() {
  return invokeAsyncJson<{ sms: 'prompt' | 'granted' | 'denied' }>('requestSmsPermission');
}

export function getPendingAndroidSmsEvent<T>() {
  return invokeSyncJson<{ event?: T | null }>('getPendingSmsEvent', { event: null });
}

export function addAndroidSmsListener<T>(listener: (event: T) => void) {
  ensureGlobalBridgeHandlers();

  if (typeof window === 'undefined') {
    return {
      remove: () => undefined,
    };
  }

  const handleEvent = (event: Event) => {
    const customEvent = event as CustomEvent<T>;
    listener(customEvent.detail);
  };

  window.addEventListener(SMS_EVENT_NAME, handleEvent as EventListener);

  return {
    remove: () => window.removeEventListener(SMS_EVENT_NAME, handleEvent as EventListener),
  };
}

export function checkAndroidBiometricAvailability() {
  return invokeSyncJson('isBiometricAvailable', { available: false });
}

export function requestAndroidBiometricAuth(options?: {
  title?: string;
  subtitle?: string;
  reason?: string;
}) {
  return invokeAsyncJson<{ success: boolean }>('authenticate', JSON.stringify(options || {}));
}

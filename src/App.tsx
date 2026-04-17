import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Plus, Trash2, Edit2, Check, X, AlertCircle, PieChart, Target, 
  Settings, Download, Upload, CreditCard, ArrowDownRight, ArrowUpRight, 
  RefreshCw, Eye, EyeOff, Calendar, Wallet, TrendingUp, Activity, 
  Landmark, Smartphone, Palette, Globe, AlertTriangle, ChevronRight,
  Bitcoin, Banknote, CreditCard as CardIcon, ChevronLeft, Lock, Fingerprint, ShieldCheck, User,
  MessageSquare, Users, Shield, WifiOff, Sparkles, Home, ChevronRight as ChevronRightIcon,
  Moon, Sun, Info
} from 'lucide-react';
import { 
  PieChart as RechartsPieChart, Pie, Cell, ResponsiveContainer, 
  Tooltip as RechartsTooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid 
} from 'recharts';
import { motion, AnimatePresence } from 'motion/react';
import Gam3eyaTab from './components/Gam3eyaTab';
import AppLogo from './components/AppLogo';
import { authenticateWithNativeBiometrics, isNativeBiometricAvailable } from './lib/deviceSecurity';
import { dict } from './lib/i18n';
import { analyzeSMS, extractTransactionData, getSmsReasonLabel, getSmsStatusLabel, inferSenderFromBody } from './lib/smsParser';
import { prepareNativeAppShell, requestNotificationPermissions } from './lib/nativeMobile';
import {
  AutoLockSetting,
  SECURITY_QUESTION_OPTIONS,
  fromBase64Url,
  getAutoLockMs,
  hashSecret,
  normalizeSecurityAnswer,
  toBase64Url,
} from './lib/security';
import { isNativeAndroidApp, SmsMonitor, type SmsMonitorEvent } from './lib/smsMonitor';

// --- Types ---
type TransactionType = 'income' | 'expense' | 'debt';
type Language = 'en' | 'ar';
type Theme = 'frosted' | 'midnight' | 'emerald' | 'sunset' | 'programmer' | 'girly' | 'business' | 'gamer';
type PinLength = 4 | 6;
type LockScreenMode = 'pin' | 'question' | 'reset';
type TransactionOrigin = 'manual' | 'sms' | 'gam3eya';
type WalletKind = 'cash' | 'bank' | 'card' | 'mobile_wallet';
type AppNoticeTone = 'success' | 'error' | 'warning' | 'info';

interface WalletType {
  id: string;
  name: string;
  icon: string;
  kind?: WalletKind;
  provider?: string;
  accountRef?: string;
}

interface Transaction {
  id: string;
  name: string;
  amount: number;
  type: TransactionType;
  date: string;
  walletId?: string;
  origin?: TransactionOrigin;
  sender?: string;
  details?: string;
  recurring?: 'none' | 'daily' | 'weekly' | 'monthly';
  lastSpawnedDate?: string;
}

interface Gam3eyaMember {
  id: string;
  name: string;
  isPaid: boolean;
  payoutMonth: number;
}

interface Gam3eya {
  id: string;
  name: string;
  monthlyAmount: number;
  totalMonths: number;
  currentMonth: number;
  startDate: string;
  members: Gam3eyaMember[];
  isCompleted?: boolean;
  payoutReceived?: boolean;
}

interface AppNotice {
  id: string;
  tone: AppNoticeTone;
  message: string;
}

interface ConfirmDialogState {
  title: string;
  message: string;
  confirmLabel: string;
  tone?: 'danger' | 'accent';
  onConfirm: () => void;
}

const CURRENCIES = [
  { code: 'USD', symbol: '$', label: 'US Dollar' },
  { code: 'EUR', symbol: 'EUR', label: 'Euro' },
  { code: 'GBP', symbol: 'GBP', label: 'British Pound' },
  { code: 'EGP', symbol: 'EGP', label: 'Egyptian Pound' },
  { code: 'SAR', symbol: 'SR', label: 'Saudi Riyal' },
  { code: 'AED', symbol: 'AED', label: 'UAE Dirham' },
];

const WALLET_KIND_OPTIONS: { value: WalletKind; icon: string; label: { en: string; ar: string } }[] = [
  { value: 'cash', icon: 'cash', label: { en: 'Cash', ar: 'كاش' } },
  { value: 'bank', icon: 'bank', label: { en: 'Bank account', ar: 'حساب بنكي' } },
  { value: 'card', icon: 'card', label: { en: 'Card', ar: 'بطاقة / فيزا' } },
  { value: 'mobile_wallet', icon: 'mobile', label: { en: 'Mobile wallet', ar: 'محفظة إلكترونية' } },
];

const DEFAULT_WALLETS: WalletType[] = [
  { id: '1', name: 'Cash / كاش', icon: 'cash', kind: 'cash', provider: 'Cash', accountRef: 'cash' },
  { id: '2', name: 'Main Bank / البنك الرئيسي', icon: 'bank', kind: 'bank', provider: 'Bank', accountRef: '**** 2451' },
  { id: '3', name: 'Vodafone Cash', icon: 'mobile', kind: 'mobile_wallet', provider: 'Vodafone', accountRef: '0100' },
];

const getTheme = (themeName: Theme, isDark: boolean) => {
  return {
    bg: 'bg-bg-primary',
    card: 'bg-glass-bg border-glass-border',
    accent: 'text-accent-primary',
    btn: 'bg-accent-primary text-text-on-accent hover:opacity-90',
    shadow: '',
    gradient: 'none',
    text: 'text-text-primary'
  };
};

// --- Custom SVGs for Wallets ---
const WALLET_ICONS: Record<string, React.ReactNode> = {
  cash: <Banknote className="w-5 h-5" />,
  bank: <Landmark className="w-5 h-5" />,
  mobile: <Smartphone className="w-5 h-5" />,
  card: <CardIcon className="w-5 h-5" />,
  crypto: <Bitcoin className="w-5 h-5" />,
  wallet: <Wallet className="w-5 h-5" />
};

const normalizeDigits = (value = '') => value.replace(/\D/g, '');

const inferWalletKind = (wallet: Partial<WalletType>): WalletKind => {
  if (wallet.kind) {
    return wallet.kind;
  }

  if (wallet.icon === 'mobile') {
    return 'mobile_wallet';
  }

  if (wallet.icon === 'bank') {
    return 'bank';
  }

  if (wallet.icon === 'card') {
    return 'card';
  }

  const name = wallet.name?.toLowerCase() ?? '';

  if (/vodafone|orange|etisalat|we|instapay|fawry|محفظة|فودافون|اورنج|اتصالات/.test(name)) {
    return 'mobile_wallet';
  }

  if (/visa|master|card|بطاقة|فيزا/.test(name)) {
    return 'card';
  }

  if (/bank|بنك|حساب/.test(name)) {
    return 'bank';
  }

  return 'cash';
};

const getDefaultWalletIcon = (kind: WalletKind) => {
  return WALLET_KIND_OPTIONS.find((option) => option.value === kind)?.icon ?? 'wallet';
};

const getFallbackWalletName = (kind: WalletKind, lang: Language = 'en') => {
  const option = WALLET_KIND_OPTIONS.find((entry) => entry.value === kind);
  return option?.label[lang] ?? (lang === 'ar' ? 'حساب' : 'Account');
};

const normalizeWallet = (wallet: Partial<WalletType>, index: number): WalletType => {
  const kind = inferWalletKind(wallet);
  return {
    id: wallet.id || `wallet-${index + 1}`,
    name: wallet.name?.trim() || getFallbackWalletName(kind),
    icon: wallet.icon || getDefaultWalletIcon(kind),
    kind,
    provider: wallet.provider?.trim() || '',
    accountRef: wallet.accountRef?.trim() || '',
  };
};

const normalizeWalletCollection = (wallets: Partial<WalletType>[]) => {
  if (!wallets.length) {
    return DEFAULT_WALLETS;
  }

  return wallets.map((wallet, index) => normalizeWallet(wallet, index));
};

const getWalletKindLabel = (wallet: Partial<WalletType>, lang: Language) => {
  const kind = inferWalletKind(wallet);
  return WALLET_KIND_OPTIONS.find((option) => option.value === kind)?.label[lang] ?? (lang === 'ar' ? 'حساب' : 'Account');
};

const getWalletSubtitle = (wallet: Partial<WalletType>, lang: Language) => {
  const details = [wallet.provider?.trim(), wallet.accountRef?.trim()].filter(Boolean);
  if (details.length) {
    return details.join(' • ');
  }

  return getWalletKindLabel(wallet, lang);
};

const normalizeGam3eyaCollection = (gam3eyat: Partial<Gam3eya>[]) => {
  return gam3eyat.map((gam3eya, index) => {
    const totalMonths = Math.max(2, Number(gam3eya.totalMonths) || gam3eya.members?.length || 5);
    const normalizedMembers =
      gam3eya.members?.length
        ? gam3eya.members.map((member, memberIndex) => ({
            id: member.id || `gam3eya-${index + 1}-member-${memberIndex + 1}`,
            name: member.name || `Month ${memberIndex + 1}`,
            isPaid: Boolean(member.isPaid),
            payoutMonth: Number(member.payoutMonth) || memberIndex + 1,
          }))
        : Array.from({ length: totalMonths }, (_, memberIndex) => ({
            id: `gam3eya-${index + 1}-member-${memberIndex + 1}`,
            name: `Month ${memberIndex + 1}`,
            isPaid: false,
            payoutMonth: memberIndex + 1,
          }));

    const paidMonths = normalizedMembers.filter((member) => member.isPaid).length;
    const isCompleted = Boolean(gam3eya.isCompleted) || (paidMonths > 0 && paidMonths >= totalMonths);

    return {
      id: gam3eya.id || `gam3eya-${index + 1}`,
      name: gam3eya.name?.trim() || `Pool ${index + 1}`,
      monthlyAmount: Math.max(0, Number(gam3eya.monthlyAmount) || 0),
      totalMonths,
      currentMonth: Math.min(totalMonths, Math.max(1, paidMonths + (isCompleted ? 0 : 1))),
      startDate: gam3eya.startDate || new Date().toISOString().split('T')[0],
      members: normalizedMembers,
      isCompleted,
      payoutReceived: typeof gam3eya.payoutReceived === 'boolean' ? gam3eya.payoutReceived : isCompleted,
    };
  });
};

// --- Custom Hooks ---
function useLocalStorage<T>(key: string, initialValue: T) {
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      console.error(error);
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(storedValue));
    } catch (error) {
      console.error(error);
    }
  }, [key, storedValue]);

  return [storedValue, setStoredValue] as const;
}

// --- Helper Functions ---
const generateId = () => crypto.randomUUID ? crypto.randomUUID() : Date.now().toString();

const formatCurrency = (amount: number, currencyCode: string, lang: Language, showDecimals = true) => {
  return new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-US', {
    style: 'currency',
    currency: currencyCode,
    minimumFractionDigits: showDecimals ? 2 : 0,
    maximumFractionDigits: showDecimals ? 2 : 0,
  }).format(amount);
};

const formatDate = (dateString: string, lang: Language) => {
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG' : 'en-US', {
    year: 'numeric', month: 'short', day: 'numeric'
  }).format(new Date(dateString));
};

const getDaysInCurrentMonth = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
};

const NOTICE_ACCENTS: Record<AppNoticeTone, string> = {
  success: 'border-success/30 bg-success/12 text-success',
  error: 'border-danger/30 bg-danger/12 text-danger',
  warning: 'border-warning/30 bg-warning/12 text-warning',
  info: 'border-accent-primary/30 bg-accent-primary/12 text-accent-primary',
};

const getNoticeIcon = (tone: AppNoticeTone) => {
  switch (tone) {
    case 'success':
      return <Check className="h-4 w-4" />;
    case 'error':
      return <AlertCircle className="h-4 w-4" />;
    case 'warning':
      return <AlertTriangle className="h-4 w-4" />;
    default:
      return <Info className="h-4 w-4" />;
  }
};

const isThisMonth = (dateString: string) => {
  const date = new Date(dateString);
  const now = new Date();
  return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
};

const isToday = (dateString: string) => {
  const date = new Date(dateString);
  const now = new Date();
  return date.getDate() === now.getDate() && date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
};

const isYesterday = (dateString: string) => {
  const date = new Date(dateString);
  const now = new Date();
  now.setDate(now.getDate() - 1);
  return date.getDate() === now.getDate() && date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
};

// --- Components ---

export default function App() {
  // State
  const [isSplashVisible, setIsSplashVisible] = useState(true);
  const [hasSeenOnboarding, setHasSeenOnboarding] = useLocalStorage<boolean>('budget_seen_onboarding', false);
  const [isSetupComplete, setIsSetupComplete] = useLocalStorage<boolean>('budget_setup_complete', false);
  const [isLocked, setIsLocked] = useState(true);
  const [pinInput, setPinInput] = useState('');
  const [pinErrorMessage, setPinErrorMessage] = useState('');
  const [lockScreenMode, setLockScreenMode] = useState<LockScreenMode>('pin');
  const [securityAnswerInput, setSecurityAnswerInput] = useState('');
  const [resetPinValue, setResetPinValue] = useState('');
  const [resetPinConfirm, setResetPinConfirm] = useState('');
  const [resetPinLength, setResetPinLength] = useState<PinLength>(4);
  const [securityResetError, setSecurityResetError] = useState('');
  const [lockScreenTick, setLockScreenTick] = useState(Date.now());
  const [isPrivacyMode, setIsPrivacyMode] = useState(false);
  const [biometricSupported, setBiometricSupported] = useState(false);
  const [biometricBusy, setBiometricBusy] = useState(false);
  const [activeTab, setActiveTab] = useState<'home' | 'gam3eya' | 'transactions'>('home');
  
  // User Profile
  const [userName, setUserName] = useLocalStorage<string>('budget_user_name', '');
  const [pinHash, setPinHash] = useLocalStorage<string>('budget_pin_hash', '');
  const [pinLength, setPinLength] = useLocalStorage<PinLength>('budget_pin_length', 4);
  const [failedPinAttempts, setFailedPinAttempts] = useLocalStorage<number>('budget_pin_failed_attempts', 0);
  const [pinLockUntil, setPinLockUntil] = useLocalStorage<number>('budget_pin_lock_until', 0);
  const [securityQuestionId, setSecurityQuestionId] = useLocalStorage<string>('budget_security_question_id', SECURITY_QUESTION_OPTIONS[0].id);
  const [securityAnswerHash, setSecurityAnswerHash] = useLocalStorage<string>('budget_security_answer_hash', '');
  const [useBiometrics, setUseBiometrics] = useLocalStorage<boolean>('budget_use_biometrics', false);
  const [biometricCredentialId, setBiometricCredentialId] = useLocalStorage<string>('budget_biometric_credential_id', '');
  const [autoLockPreference, setAutoLockPreference] = useLocalStorage<AutoLockSetting>('budget_auto_lock_preference', '5');

  const [transactions, setTransactions] = useLocalStorage<Transaction[]>('budget_transactions', []);
  const [gam3eyat, setGam3eyat] = useLocalStorage<Gam3eya[]>('budget_gam3eyat', []);
  const [wallets, setWallets] = useLocalStorage<WalletType[]>('budget_wallets', DEFAULT_WALLETS);
  const [currency, setCurrency] = useLocalStorage<string>('budget_currency', 'USD');
  const [savingsGoal, setSavingsGoal] = useLocalStorage<number>('budget_savings_goal', 0);
  const [lang, setLang] = useLocalStorage<Language>('budget_language', 'en');
  const [theme, setTheme] = useLocalStorage<Theme>('app_theme', 'midnight');
  const [fakeBalanceMode, setFakeBalanceMode] = useLocalStorage<boolean>('budget_fake_balance_enabled', false);
  const [fakeBalanceAmount, setFakeBalanceAmount] = useLocalStorage<number>('budget_fake_balance_amount', 0);
  
  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showAnalyticsModal, setShowAnalyticsModal] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showWalletManager, setShowWalletManager] = useState(false);
  const [showAboutModal, setShowAboutModal] = useState(false);

  // Add/Edit Transaction Form State
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<Partial<Transaction>>({
    type: 'expense',
    date: new Date().toISOString().split('T')[0],
    walletId: wallets[0]?.id
  });
  const [formError, setFormError] = useState<string | null>(null);

  // Wallet Manager State
  const [editingWalletId, setEditingWalletId] = useState<string | null>(null);
  const [walletFormData, setWalletFormData] = useState<Partial<WalletType>>({
    icon: 'cash',
    kind: 'cash',
    name: '',
    provider: '',
    accountRef: '',
  });
  const [showAddGam3eyaModal, setShowAddGam3eyaModal] = useState(false);
  const [showSmsParser, setShowSmsParser] = useState(false);
  const [smsText, setSmsText] = useState('');
  const [smsSenderId, setSmsSenderId] = useState('');
  const [smsAlert, setSmsAlert] = useState<SmsMonitorEvent | null>(null);
  const [smsReviewWalletId, setSmsReviewWalletId] = useState('');
  const [selectedWalletFilter, setSelectedWalletFilter] = useState<string>('all');
  const [appNotice, setAppNotice] = useState<AppNotice | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [isDarkMode, setIsDarkMode] = useLocalStorage<boolean>('budget_dark_mode', true);
  const [setupPinValue, setSetupPinValue] = useState('');
  const [setupPinLength, setSetupPinLength] = useState<PinLength>(4);
  const [setupSecurityQuestionId, setSetupSecurityQuestionId] = useState<string>(SECURITY_QUESTION_OPTIONS[0].id);
  const [setupSecurityAnswer, setSetupSecurityAnswer] = useState('');
  const [setupError, setSetupError] = useState<string | null>(null);
  const [settingsPinDraft, setSettingsPinDraft] = useState('');
  const [settingsPinConfirmDraft, setSettingsPinConfirmDraft] = useState('');
  const [settingsPinLengthDraft, setSettingsPinLengthDraft] = useState<PinLength>(4);
  const [settingsSecurityQuestionId, setSettingsSecurityQuestionId] = useState<string>(SECURITY_QUESTION_OPTIONS[0].id);
  const [settingsSecurityAnswer, setSettingsSecurityAnswer] = useState('');
  const [settingsSecurityError, setSettingsSecurityError] = useState<string | null>(null);
  const [settingsSecuritySuccess, setSettingsSecuritySuccess] = useState<string | null>(null);
  const [fakeBalanceInput, setFakeBalanceInput] = useState('');

  const lockTimerRef = useRef<number | null>(null);
  const lastInteractionAtRef = useRef(Date.now());
  const hiddenAtRef = useRef<number | null>(null);
  const hasInitializedSecurityRef = useRef(false);
  const viewportBaseHeightRef = useRef(0);
  
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    const normalized = normalizeWalletCollection(wallets);
    if (JSON.stringify(normalized) !== JSON.stringify(wallets)) {
      setWallets(normalized);
    }
  }, [wallets, setWallets]);

  useEffect(() => {
    const normalized = normalizeGam3eyaCollection(gam3eyat);
    if (JSON.stringify(normalized) !== JSON.stringify(gam3eyat)) {
      setGam3eyat(normalized);
    }
  }, [gam3eyat, setGam3eyat]);
  
  const [gam3eyaFormData, setGam3eyaFormData] = useState<Partial<Gam3eya>>({
    name: '',
    monthlyAmount: 0,
    totalMonths: 5,
    currentMonth: 1,
    startDate: new Date().toISOString().split('T')[0],
    members: []
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const t = dict[lang];
  const currentTheme = getTheme(theme, isDarkMode);
  const pinEnabled = pinHash.length > 0;
  const isPinTemporarilyLocked = pinLockUntil > lockScreenTick;
  const lockCountdownSeconds = Math.max(0, Math.ceil((pinLockUntil - lockScreenTick) / 1000));
  const securityQuestionLabel = SECURITY_QUESTION_OPTIONS.find((option) => option.id === securityQuestionId)?.label[lang] ?? SECURITY_QUESTION_OPTIONS[0].label[lang];
  const canUseBiometricsOnLockScreen = biometricSupported && useBiometrics && (isNativeAndroidApp() || Boolean(biometricCredentialId));
  const showNotice = (message: string, tone: AppNoticeTone = 'info') => {
    setAppNotice({ id: generateId(), message, tone });
  };
  const openConfirmDialog = (dialog: ConfirmDialogState) => {
    setConfirmDialog(dialog);
  };
  const closeConfirmDialog = () => {
    setConfirmDialog(null);
  };

  useEffect(() => {
    setResetPinLength(pinLength);
    setSettingsPinLengthDraft(pinLength);
    setSettingsSecurityQuestionId(securityQuestionId);
    setFakeBalanceInput(fakeBalanceAmount ? String(fakeBalanceAmount) : '');
  }, [pinLength, securityQuestionId, fakeBalanceAmount]);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  }, [lang]);

  useEffect(() => {
    const root = document.documentElement;

    const updateViewportMetrics = () => {
      const visualViewport = window.visualViewport;
      const viewportHeight = Math.round(visualViewport?.height ?? window.innerHeight);
      const viewportOffsetTop = Math.max(0, Math.round(visualViewport?.offsetTop ?? 0));
      const visibleHeight = viewportHeight + viewportOffsetTop;

      if (viewportBaseHeightRef.current === 0 || visibleHeight >= viewportBaseHeightRef.current - 96) {
        viewportBaseHeightRef.current = Math.max(viewportBaseHeightRef.current, visibleHeight);
      }

      const keyboardInset = Math.max(0, viewportBaseHeightRef.current - visibleHeight);

      root.style.setProperty('--app-height', `${viewportHeight}px`);
      root.style.setProperty('--keyboard-inset', `${keyboardInset}px`);
      root.classList.toggle('keyboard-open', keyboardInset > 120);
    };

    const resetViewportMetrics = () => {
      viewportBaseHeightRef.current = 0;
      window.requestAnimationFrame(updateViewportMetrics);
    };

    updateViewportMetrics();

    const visualViewport = window.visualViewport;
    visualViewport?.addEventListener('resize', updateViewportMetrics);
    visualViewport?.addEventListener('scroll', updateViewportMetrics);
    window.addEventListener('resize', updateViewportMetrics);
    window.addEventListener('orientationchange', resetViewportMetrics);

    return () => {
      visualViewport?.removeEventListener('resize', updateViewportMetrics);
      visualViewport?.removeEventListener('scroll', updateViewportMetrics);
      window.removeEventListener('resize', updateViewportMetrics);
      window.removeEventListener('orientationchange', resetViewportMetrics);
      root.classList.remove('keyboard-open');
      root.style.removeProperty('--app-height');
      root.style.removeProperty('--keyboard-inset');
    };
  }, []);

  useEffect(() => {
    if (!wallets.length) {
      setSmsReviewWalletId('');
      return;
    }

    setSmsReviewWalletId((current) => (current && wallets.some((wallet) => wallet.id === current) ? current : wallets[0].id));
  }, [wallets]);

  useEffect(() => {
    if (selectedWalletFilter !== 'all' && !wallets.some((wallet) => wallet.id === selectedWalletFilter)) {
      setSelectedWalletFilter('all');
    }
  }, [selectedWalletFilter, wallets]);

  useEffect(() => {
    if (pinLockUntil <= Date.now()) {
      setLockScreenTick(Date.now());
      return;
    }

    const interval = window.setInterval(() => {
      setLockScreenTick(Date.now());
    }, 1000);

    return () => window.clearInterval(interval);
  }, [pinLockUntil]);

  // Process Recurring Transactions on Load
  useEffect(() => {
    if (transactions.length === 0) return;
    const today = new Date().toISOString().split('T')[0];
    const newTransactions: Transaction[] = [];
    
    let modified = false;
    const currentTx = [...transactions];

    for (let i = 0; i < currentTx.length; i++) {
      const t = currentTx[i];
      if (t.recurring && t.recurring !== 'none') {
        const lastDate = t.lastSpawnedDate || t.date;
        if (lastDate >= today) continue;

        let d = new Date(lastDate);
        const tToday = new Date(today);
        
        while(true) {
          if (t.recurring === 'daily') {
            d.setDate(d.getDate() + 1);
          } else if (t.recurring === 'weekly') {
            d.setDate(d.getDate() + 7);
          } else if (t.recurring === 'monthly') {
            d.setMonth(d.getMonth() + 1);
          }

          if (d > tToday) break;

          const spawnDateStr = d.toISOString().split('T')[0];
          newTransactions.push({
            ...t,
            id: generateId(),
            date: spawnDateStr,
            recurring: 'none', // Spawned instances don't recurr
            name: `${t.name} (Auto)`
          });
          currentTx[i] = { ...currentTx[i], lastSpawnedDate: spawnDateStr };
          modified = true;
        }
      }
    }

    if (modified) {
      setTransactions([...newTransactions, ...currentTx].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
    }
  }, [transactions]); // Wait, if I put transactions in deps, it will re-run infinitely.

  useEffect(() => {
    let cancelled = false;

    const migrateLegacySecurity = async () => {
      try {
        const legacyPinRaw = window.localStorage.getItem('budget_user_pin');
        if (!pinHash && legacyPinRaw) {
          const parsedPin = JSON.parse(legacyPinRaw);
          if (typeof parsedPin === 'string' && /^\d{4,6}$/.test(parsedPin)) {
            const migratedHash = await hashSecret(parsedPin);
            if (cancelled) return;
            setPinHash(migratedHash);
            setPinLength(parsedPin.length === 6 ? 6 : 4);
          }
          window.localStorage.removeItem('budget_user_pin');
        }

        const legacyFakeModeRaw = window.localStorage.getItem('budget_fake_balance');
        if (legacyFakeModeRaw) {
          const parsedFakeMode = JSON.parse(legacyFakeModeRaw);
          if (!cancelled && typeof parsedFakeMode === 'boolean') {
            setFakeBalanceMode(parsedFakeMode);
          }
          window.localStorage.removeItem('budget_fake_balance');
        }

        window.localStorage.removeItem('budget_show_balances');
      } catch (error) {
        console.error('Failed to migrate legacy security settings', error);
      }
    };

    migrateLegacySecurity();

    return () => {
      cancelled = true;
    };
  }, [pinHash, setPinHash, setPinLength, setFakeBalanceMode]);

  useEffect(() => {
    let cancelled = false;

    const detectBiometricSupport = async () => {
      if (isNativeAndroidApp()) {
        const isAvailable = await isNativeBiometricAvailable();
        if (!cancelled) {
          setBiometricSupported(isAvailable);
        }
        return;
      }

      if (
        !window.isSecureContext ||
        !window.PublicKeyCredential ||
        !navigator.credentials ||
        typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable !== 'function'
      ) {
        if (!cancelled) {
          setBiometricSupported(false);
        }
        return;
      }

      try {
        const isAvailable = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
        if (!cancelled) {
          setBiometricSupported(isAvailable);
        }
      } catch (error) {
        console.error('Failed to detect biometric support', error);
        if (!cancelled) {
          setBiometricSupported(false);
        }
      }
    };

    detectBiometricSupport();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hasSeenOnboarding || !isSetupComplete) {
      setIsLocked(false);
      hasInitializedSecurityRef.current = false;
      return;
    }

    if (!hasInitializedSecurityRef.current) {
      setIsLocked(pinEnabled);
      hasInitializedSecurityRef.current = true;
      return;
    }

    if (!pinEnabled) {
      setIsLocked(false);
    }
  }, [hasSeenOnboarding, isSetupComplete, pinEnabled]);

  useEffect(() => {
    if (pinEnabled && isSetupComplete && hasSeenOnboarding) {
      setIsSplashVisible(false);
      return;
    }

    const timer = window.setTimeout(() => {
      setIsSplashVisible(false);
      if (!pinEnabled || !isSetupComplete || !hasSeenOnboarding) {
        setIsLocked(false);
      }
    }, 1600);

    return () => window.clearTimeout(timer);
  }, [pinEnabled, isSetupComplete, hasSeenOnboarding]);

  const clearAutoLockTimer = () => {
    if (lockTimerRef.current !== null) {
      window.clearTimeout(lockTimerRef.current);
      lockTimerRef.current = null;
    }
  };

  const scheduleAutoLock = () => {
    clearAutoLockTimer();

    const autoLockMs = getAutoLockMs(autoLockPreference);
    if (!pinEnabled || !hasSeenOnboarding || !isSetupComplete || isLocked || autoLockMs === null) {
      return;
    }

    lockTimerRef.current = window.setTimeout(() => {
      lockApp();
    }, autoLockMs);
  };

  const markUserInteraction = () => {
    lastInteractionAtRef.current = Date.now();
    scheduleAutoLock();
  };

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        hiddenAtRef.current = Date.now();
        clearAutoLockTimer();

        if (pinEnabled && hasSeenOnboarding && isSetupComplete) {
          lockApp();
        }

        return;
      }

      const hiddenFor = hiddenAtRef.current ? Date.now() - hiddenAtRef.current : 0;
      const autoLockMs = getAutoLockMs(autoLockPreference);
      hiddenAtRef.current = null;

      if (
        pinEnabled &&
        hasSeenOnboarding &&
        isSetupComplete &&
        autoLockMs !== null &&
        hiddenFor >= autoLockMs
      ) {
        lockApp();
        return;
      }

      markUserInteraction();
    };

    const handleActivity = () => {
      if (!document.hidden) {
        markUserInteraction();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pointerdown', handleActivity);
    window.addEventListener('keydown', handleActivity);
    window.addEventListener('touchstart', handleActivity);
    window.addEventListener('scroll', handleActivity, { passive: true });

    handleActivity();

    return () => {
      clearAutoLockTimer();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pointerdown', handleActivity);
      window.removeEventListener('keydown', handleActivity);
      window.removeEventListener('touchstart', handleActivity);
      window.removeEventListener('scroll', handleActivity);
    };
  }, [autoLockPreference, pinEnabled, hasSeenOnboarding, isSetupComplete, isLocked]);

  const resetLockScreenState = () => {
    setPinInput('');
    setPinErrorMessage('');
    setLockScreenMode('pin');
    setSecurityAnswerInput('');
    setResetPinValue('');
    setResetPinConfirm('');
    setSecurityResetError('');
    setLockScreenTick(Date.now());
  };

  const lockApp = (mode: LockScreenMode = 'pin') => {
    setIsLocked(true);
    setPinInput('');
    setPinErrorMessage('');
    setLockScreenMode(mode);
    setSecurityAnswerInput('');
    setResetPinValue('');
    setResetPinConfirm('');
    setSecurityResetError('');
    setLockScreenTick(Date.now());
    clearAutoLockTimer();
  };

  const unlockApp = () => {
    setIsLocked(false);
    setFailedPinAttempts(0);
    setPinLockUntil(0);
    resetLockScreenState();
    markUserInteraction();
  };

  const handleBiometricAuth = async () => {
    if (isNativeAndroidApp()) {
      if (!biometricSupported || !useBiometrics) {
        return false;
      }

      const isAuthenticated = await authenticateWithNativeBiometrics({
        title: t.biometricAuth,
        subtitle: t.brand,
        reason: lang === 'ar' ? 'أكد هويتك لفتح التطبيق' : 'Confirm your identity to unlock the app',
      });

      if (isAuthenticated) {
        unlockApp();
        return true;
      }

      setPinErrorMessage(
        lang === 'ar'
          ? 'فشل التحقق بالبصمة. استخدم رمز PIN.'
          : 'Biometric unlock failed. Use your PIN instead.',
      );
      return false;
    }

    if (!biometricSupported || !biometricCredentialId || !useBiometrics || !navigator.credentials) {
      return false;
    }

    try {
      setBiometricBusy(true);

      const credential = await navigator.credentials.get({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          allowCredentials: [
            {
              id: fromBase64Url(biometricCredentialId),
              type: 'public-key',
            },
          ],
          timeout: 60000,
          userVerification: 'preferred',
        },
      });

      if (credential) {
        unlockApp();
        return true;
      }
    } catch (error) {
      console.error('Biometric authentication failed', error);
      setPinErrorMessage(lang === 'ar' ? 'فشل التحقق بالبصمة. استخدم رمز PIN.' : 'Biometric unlock failed. Use your PIN instead.');
    } finally {
      setBiometricBusy(false);
    }

    return false;
  };

  const handleRegisterBiometric = async () => {
    if (!pinEnabled) {
      setSettingsSecurityError(lang === 'ar' ? 'فعّل رمز PIN أولًا قبل تشغيل البصمة.' : 'Enable a PIN first before turning on biometrics.');
      setSettingsSecuritySuccess(null);
      return false;
    }

    if (isNativeAndroidApp()) {
      if (!biometricSupported) {
        setSettingsSecurityError(
          lang === 'ar'
            ? 'هذا الجهاز لا يدعم البصمة أو قفل الجهاز غير مُفعّل.'
            : 'Biometric unlock is unavailable on this device.',
        );
        setSettingsSecuritySuccess(null);
        return false;
      }

      setBiometricBusy(true);
      setSettingsSecurityError(null);
      setSettingsSecuritySuccess(null);

      const isAuthenticated = await authenticateWithNativeBiometrics({
        title: t.biometricAuth,
        subtitle: t.brand,
        reason: lang === 'ar' ? 'أكد هويتك لتفعيل البصمة داخل التطبيق' : 'Confirm your identity to enable biometric unlock',
      });

      setBiometricBusy(false);

      if (!isAuthenticated) {
        setSettingsSecurityError(
          lang === 'ar' ? 'تعذر تفعيل البصمة على هذا الجهاز.' : 'Biometric registration failed on this device.',
        );
        return false;
      }

      setBiometricCredentialId('native-android');
      setUseBiometrics(true);
      setSettingsSecuritySuccess(
        lang === 'ar' ? 'تم تفعيل البصمة بنجاح.' : 'Biometric unlock enabled successfully.',
      );
      return true;
    }

    if (!biometricSupported || !navigator.credentials) {
      return false;
    }

    try {
      setBiometricBusy(true);
      setSettingsSecurityError(null);
      setSettingsSecuritySuccess(null);

      const created = await navigator.credentials.create({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          rp: {
            name: t.brand,
          },
          user: {
            id: crypto.getRandomValues(new Uint8Array(32)),
            name: `${userName || 'money-planner'}@local.device`,
            displayName: userName || t.brand,
          },
          pubKeyCredParams: [
            { type: 'public-key', alg: -7 },
            { type: 'public-key', alg: -257 },
          ],
          authenticatorSelection: {
            authenticatorAttachment: 'platform',
            residentKey: 'preferred',
            userVerification: 'preferred',
          },
          attestation: 'none',
          timeout: 60000,
          ...(biometricCredentialId
            ? {
                excludeCredentials: [
                  {
                    id: fromBase64Url(biometricCredentialId),
                    type: 'public-key' as const,
                  },
                ],
              }
            : {}),
        },
      });

      if (created instanceof PublicKeyCredential) {
        const credentialId = toBase64Url(new Uint8Array(created.rawId));
        setBiometricCredentialId(credentialId);
        setUseBiometrics(true);
        setSettingsSecuritySuccess(lang === 'ar' ? 'تم تسجيل البصمة بنجاح.' : 'Biometric unlock registered successfully.');
        return true;
      }
    } catch (error) {
      console.error('Biometric registration failed', error);
      setSettingsSecurityError(
        lang === 'ar'
          ? 'تعذر تسجيل البصمة على هذا الجهاز.'
          : 'Biometric registration failed on this device.'
      );
    } finally {
      setBiometricBusy(false);
    }

    return false;
  };

  const handleToggleBiometric = async () => {
    if (useBiometrics) {
      setUseBiometrics(false);
      setSettingsSecuritySuccess(lang === 'ar' ? 'تم إيقاف البصمة.' : 'Biometric unlock disabled.');
      return;
    }

    if (!biometricCredentialId) {
      const registered = await handleRegisterBiometric();
      if (!registered) {
        return;
      }
    }

    setUseBiometrics(true);
    setSettingsSecuritySuccess(lang === 'ar' ? 'تم تفعيل البصمة.' : 'Biometric unlock enabled.');
  };

  const verifyPinCandidate = async (candidate: string) => {
    if (!pinEnabled) {
      unlockApp();
      return true;
    }

    if (isPinTemporarilyLocked) {
      setPinErrorMessage(
        lang === 'ar'
          ? `تم قفل المحاولات مؤقتًا. حاول بعد ${lockCountdownSeconds} ثانية.`
          : `Too many attempts. Try again in ${lockCountdownSeconds} seconds.`
      );
      return false;
    }

    const hashedCandidate = await hashSecret(candidate);
    if (hashedCandidate === pinHash) {
      unlockApp();
      return true;
    }

    const nextAttempts = failedPinAttempts + 1;
    setFailedPinAttempts(nextAttempts);
    setPinInput('');

    if (nextAttempts >= 10) {
      setLockScreenMode('question');
      setPinErrorMessage(
        lang === 'ar'
          ? 'تم تجاوز عدد المحاولات المسموح. أجب عن سؤال الأمان لإعادة تعيين الرمز.'
          : 'Too many failed attempts. Answer your security question to reset the PIN.'
      );
      return false;
    }

    if (nextAttempts >= 5) {
      setPinLockUntil(Date.now() + 60_000);
      setPinErrorMessage(
        lang === 'ar'
          ? 'تم قفل المحاولات لمدة 60 ثانية.'
          : 'The PIN is locked for 60 seconds.'
      );
      return false;
    }

    setPinErrorMessage(t.wrongPin);
    return false;
  };

  useEffect(() => {
    if (!isLocked || lockScreenMode !== 'pin' || pinInput.length !== pinLength) {
      return;
    }

    void verifyPinCandidate(pinInput);
  }, [isLocked, lockScreenMode, pinInput, pinLength]);

  useEffect(() => {
    if (!isLocked || lockScreenMode !== 'pin') {
      return;
    }

    const handleLockScreenKeyboard = (event: KeyboardEvent) => {
      if (/^\d$/.test(event.key) && !isPinTemporarilyLocked) {
        setPinErrorMessage('');
        setPinInput((current) => (current.length < pinLength ? `${current}${event.key}` : current));
        return;
      }

      if (event.key === 'Backspace') {
        setPinInput((current) => current.slice(0, -1));
        return;
      }

      if (event.key === 'Escape') {
        setLockScreenMode('pin');
        setPinErrorMessage('');
        setSecurityResetError('');
      }
    };

    window.addEventListener('keydown', handleLockScreenKeyboard);
    return () => window.removeEventListener('keydown', handleLockScreenKeyboard);
  }, [isLocked, lockScreenMode, pinLength, isPinTemporarilyLocked]);

  const handleToggleBalance = () => {
    setIsPrivacyMode((current) => !current);
  };

  const handlePinDigit = (digit: string) => {
    if (!isLocked || lockScreenMode !== 'pin' || isPinTemporarilyLocked) {
      return;
    }

    setPinErrorMessage('');
    setPinInput((current) => (current.length < pinLength ? `${current}${digit}` : current));
  };

  const handlePinBackspace = () => {
    setPinInput((current) => current.slice(0, -1));
    setPinErrorMessage('');
  };

  const handleForgotPin = () => {
    setLockScreenMode('question');
    setPinErrorMessage('');
    setSecurityResetError('');
    setSecurityAnswerInput('');
  };

  const handleColorModeToggle = () => {
    const nextIsDarkMode = !isDarkMode;
    setIsDarkMode(nextIsDarkMode);

    const darkThemes: Theme[] = ['midnight', 'sunset', 'emerald', 'girly', 'programmer', 'gamer'];
    const lightThemes: Theme[] = ['frosted', 'business'];

    if (nextIsDarkMode && !darkThemes.includes(theme)) {
      setTheme('midnight');
    }

    if (!nextIsDarkMode && !lightThemes.includes(theme)) {
      setTheme('business');
    }
  };

  const handleSaveSecuritySettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSettingsSecurityError(null);
    setSettingsSecuritySuccess(null);

    const trimmedPin = settingsPinDraft.trim();
    const trimmedConfirm = settingsPinConfirmDraft.trim();
    const trimmedSecurityAnswer = settingsSecurityAnswer.trim();

    if (!/^-?\d*(\.\d+)?$/.test(fakeBalanceInput.trim()) && fakeBalanceInput.trim()) {
      setSettingsSecurityError(lang === 'ar' ? 'أدخل رصيدًا وهميًا صالحًا.' : 'Enter a valid fake balance amount.');
      return;
    }

    const parsedFakeBalance = fakeBalanceInput.trim() ? Number(fakeBalanceInput) : 0;
    if (Number.isNaN(parsedFakeBalance) || parsedFakeBalance < 0) {
      setSettingsSecurityError(lang === 'ar' ? 'قيمة الرصيد الوهمي يجب أن تكون صفرًا أو أكثر.' : 'Fake balance must be zero or greater.');
      return;
    }

    if (fakeBalanceMode && parsedFakeBalance <= 0) {
      setSettingsSecurityError(lang === 'ar' ? 'أدخل رصيدًا وهميًا أكبر من صفر لتفعيل هذا الوضع.' : 'Enter a fake balance greater than zero to enable this mode.');
      return;
    }

    setFakeBalanceAmount(parsedFakeBalance);

    if (!trimmedPin && !pinEnabled) {
      setAutoLockPreference(autoLockPreference);
      setSettingsPinDraft('');
      setSettingsPinConfirmDraft('');
      setSettingsSecurityAnswer('');
      setSettingsSecuritySuccess(lang === 'ar' ? 'تم حفظ إعدادات الخصوصية.' : 'Privacy settings saved.');
      return;
    }

    if (!trimmedPin && pinEnabled) {
      return;
    }

    if (!/^\d+$/.test(trimmedPin) || trimmedPin.length !== settingsPinLengthDraft) {
      setSettingsSecurityError(
        lang === 'ar'
          ? `أدخل رمز PIN مكوّنًا من ${settingsPinLengthDraft} أرقام.`
          : `Enter a ${settingsPinLengthDraft}-digit PIN.`
      );
      return;
    }

    if (trimmedPin !== trimmedConfirm) {
      setSettingsSecurityError(lang === 'ar' ? 'رمزا PIN غير متطابقين.' : 'PIN values do not match.');
      return;
    }

    const answerToSave = trimmedSecurityAnswer || '';
    if (!answerToSave && !securityAnswerHash) {
      setSettingsSecurityError(
        lang === 'ar'
          ? 'أدخل إجابة سؤال الأمان للاحتفاظ بخيار استعادة PIN.'
          : 'Add a security answer to keep PIN recovery available.'
      );
      return;
    }

    const hashedPin = await hashSecret(trimmedPin);
    setPinHash(hashedPin);
    setPinLength(settingsPinLengthDraft);
    setSecurityQuestionId(settingsSecurityQuestionId);

    if (answerToSave) {
      const hashedAnswer = await hashSecret(normalizeSecurityAnswer(answerToSave));
      setSecurityAnswerHash(hashedAnswer);
    }

    setFailedPinAttempts(0);
    setPinLockUntil(0);
    setSettingsPinDraft('');
    setSettingsPinConfirmDraft('');
    setSettingsSecurityAnswer('');
    setSettingsSecuritySuccess(lang === 'ar' ? 'تم حفظ إعدادات الأمان.' : 'Security settings saved.');
  };

  const handleDisablePin = () => {
    openConfirmDialog({
      title: lang === 'ar' ? 'تعطيل قفل التطبيق؟' : 'Disable app lock?',
      message:
        lang === 'ar'
          ? 'سيتم إيقاف PIN والبصمة لهذا الجهاز. يمكنك تفعيلهما لاحقًا من الإعدادات.'
          : 'This will turn off PIN and biometric unlock for this device. You can enable them again from settings.',
      confirmLabel: lang === 'ar' ? 'تعطيل القفل' : 'Disable lock',
      tone: 'danger',
      onConfirm: () => {
        setPinHash('');
        setPinLength(4);
        setUseBiometrics(false);
        setBiometricCredentialId('');
        setSecurityAnswerHash('');
        setFailedPinAttempts(0);
        setPinLockUntil(0);
        setSettingsPinDraft('');
        setSettingsPinConfirmDraft('');
        setSettingsSecurityAnswer('');
        setSettingsSecurityError(null);
        setSettingsSecuritySuccess(lang === 'ar' ? 'تم تعطيل PIN والبصمة.' : 'PIN and biometric unlock disabled.');
        setIsLocked(false);
      },
    });
  };

  const handleSecurityQuestionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!securityAnswerHash) {
      setSecurityResetError(
        lang === 'ar'
          ? 'لا يوجد سؤال أمان محفوظ لهذا التطبيق.'
          : 'No backup security question is configured for this app.'
      );
      return;
    }

    const hashedAnswer = await hashSecret(normalizeSecurityAnswer(securityAnswerInput));
    if (hashedAnswer !== securityAnswerHash) {
      setSecurityResetError(
        lang === 'ar'
          ? 'إجابة سؤال الأمان غير صحيحة.'
          : 'Incorrect answer to the security question.'
      );
      return;
    }

    setFailedPinAttempts(0);
    setPinLockUntil(0);
    setSecurityAnswerInput('');
    setSecurityResetError('');
    setPinErrorMessage('');
    setLockScreenMode('reset');
  };

  const handleResetPinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!/^\d+$/.test(resetPinValue) || resetPinValue.length !== resetPinLength) {
      setSecurityResetError(
        lang === 'ar'
          ? `أدخل رمز PIN مكوّنًا من ${resetPinLength} أرقام.`
          : `Enter a ${resetPinLength}-digit PIN.`
      );
      return;
    }

    if (resetPinValue !== resetPinConfirm) {
      setSecurityResetError(lang === 'ar' ? 'رمزا PIN غير متطابقين.' : 'PIN values do not match.');
      return;
    }

    const hashedPin = await hashSecret(resetPinValue);
    setPinHash(hashedPin);
    setPinLength(resetPinLength);
    setFailedPinAttempts(0);
    setPinLockUntil(0);
    setSecurityResetError('');
    setIsLocked(false);
    resetLockScreenState();
    markUserInteraction();
  };

  const handleCompleteSetup = async (e: React.FormEvent) => {
    e.preventDefault();

    setSetupError(null);
    if (!userName.trim()) return;

    if (setupPinValue) {
      if (!/^\d+$/.test(setupPinValue) || setupPinValue.length !== setupPinLength) {
        setSetupError(
          lang === 'ar'
            ? `أدخل رمز PIN مكوّنًا من ${setupPinLength} أرقام.`
            : `Enter a ${setupPinLength}-digit PIN.`
        );
        return;
      }

      if (!setupSecurityAnswer.trim()) {
        setSetupError(
          lang === 'ar'
            ? 'أدخل إجابة سؤال الأمان لاستخدام خيار نسيت الرمز.'
            : 'Add a backup security answer to enable PIN recovery.'
        );
        return;
      }

      const hashedPin = await hashSecret(setupPinValue);
      const hashedAnswer = await hashSecret(normalizeSecurityAnswer(setupSecurityAnswer));
      setPinHash(hashedPin);
      setPinLength(setupPinLength);
      setSecurityQuestionId(setupSecurityQuestionId);
      setSecurityAnswerHash(hashedAnswer);
      setFailedPinAttempts(0);
      setPinLockUntil(0);
      setUseBiometrics(false);
      setBiometricCredentialId('');
    } else {
      setPinHash('');
      setSecurityAnswerHash('');
      setFailedPinAttempts(0);
      setPinLockUntil(0);
      setUseBiometrics(false);
    }

    setIsSetupComplete(true);
    setHasSeenOnboarding(true);
    setIsLocked(false);
    setSetupPinValue('');
    setSetupSecurityAnswer('');
  };

  const handleSaveGam3eya = (e: React.FormEvent) => {
    e.preventDefault();
    if (!gam3eyaFormData.name || !gam3eyaFormData.monthlyAmount) return;
    
    // Auto-generate members if empty
    const members = [...(gam3eyaFormData.members || [])];
    if (members.length === 0) {
      for (let i = 1; i <= (gam3eyaFormData.totalMonths || 5); i++) {
        members.push({
          id: generateId() + i,
          name: lang === 'ar' ? `الشهر ${i}` : `Month ${i}`,
          isPaid: false,
          payoutMonth: i,
        });
      }
    }

    const newGam3eya: Gam3eya = {
      id: generateId(),
      name: gam3eyaFormData.name,
      monthlyAmount: Number(gam3eyaFormData.monthlyAmount),
      totalMonths: Number(gam3eyaFormData.totalMonths) || 5,
      currentMonth: Number(gam3eyaFormData.currentMonth) || 1,
      startDate: gam3eyaFormData.startDate || new Date().toISOString().split('T')[0],
      members,
      isCompleted: false,
      payoutReceived: false,
    };

    setGam3eyat([...gam3eyat, newGam3eya]);
    setShowAddGam3eyaModal(false);
    setGam3eyaFormData({ name: '', monthlyAmount: 0, totalMonths: 5, currentMonth: 1, startDate: new Date().toISOString().split('T')[0], members: [] });
  };
  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setSmsText(text);
      }
    } catch (err) {
      console.error('Failed to read clipboard contents: ', err);
      // Fallback: user can still manually paste
    }
  };

  const buildSmsDraft = () => {
    if (!smsText.trim()) {
      return null;
    }

    let sender = smsSenderId.trim();

    if (!sender) {
      sender = inferSenderFromBody(smsText);
    }

    const verificationResult = analyzeSMS(sender, smsText);
    const { amount, type } = extractTransactionData(smsText);
    const guessedWalletId = smsReviewWalletId || guessWalletIdFromMessage(sender, smsText) || wallets[0]?.id;

    let finalName = type === 'income' ? (lang === 'ar' ? 'إيداع بنكي' : 'Bank Deposit') : (lang === 'ar' ? 'مدفوعات بنكية' : 'Bank Payment');

    if (verificationResult.status === 'VERIFIED' && sender !== 'Unknown') {
      finalName += ` (${sender})`;
    }

    return {
      sender,
      amount,
      type: type as TransactionType,
      verificationResult,
      walletId: guessedWalletId,
      finalName,
    };
  };

  const handleParseSms = () => {
    const smsDraft = buildSmsDraft();
    if (!smsDraft) {
      return;
    }

    setFormData({
      ...formData,
      amount: smsDraft.amount || undefined,
      type: smsDraft.type,
      name: smsDraft.finalName,
      date: new Date().toISOString().split('T')[0],
      walletId: smsDraft.walletId,
      origin: 'sms',
      sender: smsDraft.sender,
      details: smsText,
    });

    if (smsDraft.verificationResult.status === 'FRAUD' || smsDraft.verificationResult.status === 'SUSPICIOUS') {
      showNotice(
        `${lang === 'ar' ? 'تحذير أمني' : 'Security warning'}: ${getSmsReasonLabel(smsDraft.verificationResult.reason, lang)}`,
        'warning',
      );
    }

    setShowSmsParser(false);
    setShowAddModal(true);
    setSmsText('');
    setSmsSenderId('');
  };

  const handleSaveSmsTransaction = () => {
    const smsDraft = buildSmsDraft();
    if (!smsDraft) {
      return;
    }

    if (!smsDraft.amount || smsDraft.amount <= 0) {
      showNotice(t.messageNeedsAmount, 'error');
      return;
    }

    appendTransaction({
      name: smsDraft.finalName,
      amount: smsDraft.amount,
      type: smsDraft.type,
      date: new Date().toISOString().split('T')[0],
      walletId: smsDraft.walletId,
      origin: 'sms',
      sender: smsDraft.sender,
      details: smsText,
      recurring: 'none',
    });

    setShowSmsParser(false);
    setSmsAlert(null);
    setSmsText('');
    setSmsSenderId('');
    showNotice(t.messageSaved, 'success');
  };

  // Calculations
  const { totalIncome, totalExpenses, totalDebts, todayExpenses, monthExpenses } = useMemo(() => {
    return transactions.reduce((acc, curr) => {
      if (curr.type === 'income') acc.totalIncome += curr.amount;
      if (curr.type === 'expense') {
        acc.totalExpenses += curr.amount;
        if (isThisMonth(curr.date)) acc.monthExpenses += curr.amount;
        if (isToday(curr.date)) acc.todayExpenses += curr.amount;
      }
      if (curr.type === 'debt') acc.totalDebts += curr.amount;
      return acc;
    }, { totalIncome: 0, totalExpenses: 0, totalDebts: 0, todayExpenses: 0, monthExpenses: 0 });
  }, [transactions]);
  
  const totalObligations = totalExpenses + totalDebts;
  const remainingBalance = totalIncome - totalObligations;
  
  const daysInMonth = getDaysInCurrentMonth();
  const dailyAllowance = remainingBalance > 0 ? remainingBalance / daysInMonth : 0;
  const fakeBalanceActive = fakeBalanceMode && fakeBalanceAmount > 0;
  const displayedDashboardBalance = fakeBalanceActive ? fakeBalanceAmount : remainingBalance;
  const displayedDailyAllowance = fakeBalanceActive
    ? Math.max(fakeBalanceAmount / daysInMonth, 0)
    : dailyAllowance;

  // Warnings Logic
  const isDailyLimitExceeded = todayExpenses > dailyAllowance && dailyAllowance > 0;
  const isMonthlyLimitExceeded = monthExpenses > totalIncome && totalIncome > 0;

  const sortTransactionsByDate = (items: Transaction[]) =>
    [...items].sort((first, second) => new Date(second.date).getTime() - new Date(first.date).getTime());

  // Group Transactions by Date
  const groupedTransactions = useMemo(() => {
    const groups: Record<string, Transaction[]> = {};
    transactions.forEach(t => {
      if (!groups[t.date]) groups[t.date] = [];
      groups[t.date].push(t);
    });
    return Object.entries(groups).sort((a, b) => new Date(b[0]).getTime() - new Date(a[0]).getTime());
  }, [transactions]);

  const visibleTransactions = useMemo(() => {
    if (selectedWalletFilter === 'all') {
      return transactions;
    }

    return transactions.filter((transaction) => transaction.walletId === selectedWalletFilter);
  }, [selectedWalletFilter, transactions]);

  const groupedVisibleTransactions = useMemo(() => {
    const groups: Record<string, Transaction[]> = {};
    visibleTransactions.forEach((transaction) => {
      if (!groups[transaction.date]) {
        groups[transaction.date] = [];
      }
      groups[transaction.date].push(transaction);
    });
    return Object.entries(groups).sort((a, b) => new Date(b[0]).getTime() - new Date(a[0]).getTime());
  }, [visibleTransactions]);

  const guessWalletIdFromMessage = (sender: string, body: string) => {
    const messageText = `${sender} ${body}`.toLowerCase();
    const messageDigits = normalizeDigits(`${sender} ${body}`);

    const exactReferenceMatch = wallets.find((wallet) => {
      const referenceDigits = normalizeDigits(wallet.accountRef);
      return referenceDigits.length >= 4 && messageDigits.includes(referenceDigits);
    });

    if (exactReferenceMatch) {
      return exactReferenceMatch.id;
    }

    const providerMatch = wallets.find((wallet) => {
      const terms = [wallet.name, wallet.provider, wallet.accountRef]
        .flatMap((value) => (value || '').split(/[\/|\-]/))
        .map((value) => value.trim().toLowerCase())
        .filter((value) => value.length >= 3);

      return terms.some((term) => messageText.includes(term));
    });

    return providerMatch?.id;
  };

  const appendTransaction = (transaction: Omit<Transaction, 'id'>) => {
    const newTransaction: Transaction = {
      id: generateId(),
      ...transaction,
    };

    setTransactions((currentTransactions) => sortTransactionsByDate([newTransaction, ...currentTransactions]));
    return newTransaction;
  };

  const addTransactionDirectly = (
    name: string,
    amount: number,
    type: TransactionType,
    options?: Partial<Pick<Transaction, 'walletId' | 'origin' | 'sender' | 'details'>>,
  ) => {
    const newTransaction = {
      name,
      amount,
      type,
      date: new Date().toISOString().split('T')[0],
      walletId: options?.walletId || wallets[0]?.id,
      origin: options?.origin || 'manual',
      sender: options?.sender,
      details: options?.details,
    };
    appendTransaction(newTransaction);
  };

  // Handlers
  const handleSaveTransaction = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name?.trim()) return setFormError(t.errorName);
    if (!formData.amount || isNaN(Number(formData.amount)) || Number(formData.amount) <= 0) return setFormError(t.errorAmount);
    if (!formData.date) return setFormError(t.errorDate);
    if (!formData.walletId || !wallets.some((wallet) => wallet.id === formData.walletId)) {
      return setFormError(lang === 'ar' ? 'اختر حساباً صالحاً قبل الحفظ.' : 'Select a valid account before saving.');
    }

    const newTransaction: Transaction = {
      id: editingId || generateId(),
      name: formData.name.trim(),
      amount: Number(formData.amount),
      type: formData.type as TransactionType,
      date: formData.date,
      walletId: formData.walletId,
      origin: (formData.origin as TransactionOrigin) || 'manual',
      sender: formData.sender,
      details: formData.details,
      recurring: formData.recurring || 'none'
    };

    if (editingId) {
      setTransactions(transactions.map(t => t.id === editingId ? newTransaction : t));
    } else {
      setTransactions(sortTransactionsByDate([newTransaction, ...transactions]));
    }
    closeAddModal();
  };

  const openAddModal = (type: TransactionType = 'expense', walletId?: string) => {
    const preferredWalletId =
      walletId ||
      (selectedWalletFilter !== 'all' ? selectedWalletFilter : '') ||
      wallets[0]?.id;

    setFormData({
      type,
      date: new Date().toISOString().split('T')[0],
      name: '',
      amount: undefined,
      walletId: preferredWalletId,
      recurring: 'none',
    });
    setEditingId(null);
    setFormError(null);
    setShowAddModal(true);
  };

  const openEditModal = (transaction: Transaction) => {
    setFormData({ ...transaction });
    setEditingId(transaction.id);
    setFormError(null);
    setShowAddModal(true);
  };

  const closeAddModal = () => {
    setShowAddModal(false);
    setEditingId(null);
  };

  const closeSettingsPanel = () => {
    setShowWalletManager(false);
    setEditingWalletId(null);
    setShowSettingsModal(false);
  };

  const handleBackdropDismiss = (
    event: React.MouseEvent<HTMLDivElement>,
    onClose: () => void
  ) => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  const handleDelete = (id: string) => {
    openConfirmDialog({
      title: lang === 'ar' ? 'حذف المعاملة؟' : 'Delete transaction?',
      message:
        lang === 'ar'
          ? 'سيتم حذف هذه المعاملة نهائيًا من السجل.'
          : 'This transaction will be permanently removed from your history.',
      confirmLabel: lang === 'ar' ? 'حذف المعاملة' : 'Delete transaction',
      tone: 'danger',
      onConfirm: () => {
        setTransactions((current) => current.filter((transaction) => transaction.id !== id));
        showNotice(lang === 'ar' ? 'تم حذف المعاملة.' : 'Transaction deleted.', 'success');
        if (editingId === id) {
          closeAddModal();
        }
      },
    });
  };

  const handleReset = () => {
    setTransactions([]);
    setGam3eyat([]);
    setWallets(DEFAULT_WALLETS);
    setSavingsGoal(0);
    setShowResetConfirm(false);
    setShowSettingsModal(false);
  };

  const handleExport = () => {
    const data = {
      transactions,
      gam3eyat,
      wallets,
      currency,
      savingsGoal,
      lang,
      theme,
      fakeBalanceMode,
      fakeBalanceAmount,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `money-planner-backup-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target?.result as string);
        if (Array.isArray(data.transactions)) setTransactions(data.transactions);
        if (Array.isArray(data.gam3eyat)) setGam3eyat(normalizeGam3eyaCollection(data.gam3eyat));
        if (Array.isArray(data.wallets)) setWallets(normalizeWalletCollection(data.wallets));
        if (typeof data.currency === 'string') setCurrency(data.currency);
        if (typeof data.savingsGoal === 'number') setSavingsGoal(data.savingsGoal);
        if (data.lang === 'en' || data.lang === 'ar') setLang(data.lang);
        if (typeof data.theme === 'string') setTheme(data.theme);
        if (typeof data.fakeBalanceMode === 'boolean') setFakeBalanceMode(data.fakeBalanceMode);
        if (typeof data.fakeBalanceAmount === 'number') setFakeBalanceAmount(data.fakeBalanceAmount);
        setShowSettingsModal(false);
        showNotice(lang === 'ar' ? 'تم استيراد النسخة الاحتياطية.' : 'Backup imported successfully.', 'success');
      } catch (error) {
        showNotice(lang === 'ar' ? 'ملف النسخة الاحتياطية غير صالح.' : 'Invalid backup file.', 'error');
      }
    };
    reader.readAsText(file);
  };

  // Wallet Management Handlers
  const handleSaveWallet = (e: React.FormEvent) => {
    e.preventDefault();
    if (!walletFormData.name?.trim()) return;
    const kind = inferWalletKind(walletFormData);
    
    const newWallet: WalletType = {
      id: editingWalletId || generateId(),
      name: walletFormData.name.trim(),
      icon: walletFormData.icon || getDefaultWalletIcon(kind),
      kind,
      provider: walletFormData.provider?.trim() || '',
      accountRef: walletFormData.accountRef?.trim() || '',
    };

    if (editingWalletId) {
      setWallets(wallets.map(w => w.id === editingWalletId ? newWallet : w));
    } else {
      setWallets([...wallets, newWallet]);
    }
    setEditingWalletId(null);
    setWalletFormData({ icon: 'cash', kind: 'cash', name: '', provider: '', accountRef: '' });
  };

  const handleDeleteWallet = (id: string) => {
    if (wallets.length <= 1) {
      showNotice(
        lang === 'ar' ? 'يجب أن يبقى حساب واحد على الأقل داخل التطبيق.' : 'At least one account must remain in the app.',
        'error',
      );
      return;
    }

    openConfirmDialog({
      title: lang === 'ar' ? 'حذف الحساب؟' : 'Delete account?',
      message:
        lang === 'ar'
          ? 'سيتم حذف هذا الحساب وإزالة ربطه من المعاملات الحالية.'
          : 'This will delete the account and detach it from existing transactions.',
      confirmLabel: lang === 'ar' ? 'حذف الحساب' : 'Delete account',
      tone: 'danger',
      onConfirm: () => {
        setWallets((current) => current.filter((wallet) => wallet.id !== id));
        setTransactions((current) =>
          current.map((transaction) => (transaction.walletId === id ? { ...transaction, walletId: undefined } : transaction)),
        );
        if (editingWalletId === id) {
          setEditingWalletId(null);
          setWalletFormData({ icon: 'cash', kind: 'cash', name: '', provider: '', accountRef: '' });
        }
        showNotice(lang === 'ar' ? 'تم حذف الحساب.' : 'Account deleted.', 'success');
      },
    });
  };


  const currentCurrencySymbol = CURRENCIES.find(c => c.code === currency)?.symbol || '$';
  const walletSnapshots = wallets.map((wallet) => {
    const relatedTransactions = transactions.filter((transaction) => transaction.walletId === wallet.id);
    const income = relatedTransactions
      .filter((transaction) => transaction.type === 'income')
      .reduce((sum, transaction) => sum + transaction.amount, 0);
    const outflow = relatedTransactions
      .filter((transaction) => transaction.type === 'expense' || transaction.type === 'debt')
      .reduce((sum, transaction) => sum + transaction.amount, 0);

    return {
      ...wallet,
      income,
      outflow,
      balance: income - outflow,
      count: relatedTransactions.length,
    };
  });
  const selectedFormWallet = wallets.find((wallet) => wallet.id === formData.walletId);
  const analyticsHasData = totalIncome > 0 || totalExpenses > 0 || totalDebts > 0;
  const walletTransactionStats = wallets.map((wallet) => ({
    ...wallet,
    count: transactions.filter((transaction) => transaction.walletId === wallet.id).length,
  }));
  const cashFlowChartData = [
    { name: t.income, amount: totalIncome, fill: '#34d399' },
    { name: t.expense, amount: totalExpenses, fill: '#fb7185' },
    { name: t.debt, amount: totalDebts, fill: '#a78bfa' },
  ];
  const distributionChartData = [
    { name: t.expense, value: totalExpenses, color: '#fb7185' },
    { name: t.debt, value: totalDebts, color: '#a78bfa' },
  ].filter((item) => item.value > 0);
  const smsDraftPreview = buildSmsDraft();

  // Render Helpers
  const SensitiveText = ({
    children,
    className = "",
    mask: _mask = '****',
  }: {
    children: React.ReactNode,
    className?: string,
    mask?: string
  }) => (
    <span
      className={`inline-block align-middle transition-[filter,opacity] duration-300 ${isPrivacyMode ? 'select-none blur-[7px] opacity-80' : 'blur-0 opacity-100'} ${className}`}
      aria-label={isPrivacyMode ? (lang === 'ar' ? 'قيمة مخفية' : 'Hidden value') : undefined}
    >
      {children}
    </span>
  );

  const getTypeColor = (type: TransactionType) => {
    switch (type) {
      case 'income': return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
      case 'expense': return 'text-rose-400 bg-rose-500/10 border-rose-500/20';
      case 'debt': return 'text-violet-400 bg-violet-500/10 border-violet-500/20';
    }
  };

  const getTypeIcon = (type: TransactionType) => {
    switch (type) {
      case 'income': return <ArrowDownRight className="w-5 h-5" />;
      case 'expense': return <ArrowUpRight className="w-5 h-5" />;
      case 'debt': return <RefreshCw className="w-5 h-5" />;
    }
  };

  const getDateLabel = (dateString: string) => {
    if (isToday(dateString)) return t.today;
    if (isYesterday(dateString)) return t.yesterday;
    return formatDate(dateString, lang);
  };

  const getSmsAlertAccent = (status: SmsMonitorEvent['status']) => {
    switch (status) {
      case 'VERIFIED':
        return 'border-emerald-500/30 bg-emerald-500/12 text-emerald-300';
      case 'SUSPICIOUS':
        return 'border-amber-500/30 bg-amber-500/12 text-amber-300';
      case 'FRAUD':
        return 'border-rose-500/30 bg-rose-500/14 text-rose-300';
      default:
        return 'border-sky-500/30 bg-sky-500/12 text-sky-300';
    }
  };

  const getSmsAlertIcon = (status: SmsMonitorEvent['status']) => {
    switch (status) {
      case 'VERIFIED':
        return <ShieldCheck className="h-5 w-5" />;
      case 'SUSPICIOUS':
      case 'FRAUD':
        return <AlertTriangle className="h-5 w-5" />;
      default:
        return <AlertCircle className="h-5 w-5" />;
    }
  };

  const createSmsMonitorEvent = (sender: string, body: string): SmsMonitorEvent => {
    const analysis = analyzeSMS(sender, body);
    const { amount, type } = extractTransactionData(body);
    const statusLabel = getSmsStatusLabel(analysis.status, lang);
    const senderLabel = sender || (lang === 'ar' ? 'مرسل غير معروف' : 'Unknown sender');
    const amountLabel = amount > 0 ? formatCurrency(amount, currency, lang, false) : (lang === 'ar' ? 'بدون مبلغ واضح' : 'No clear amount');

    return {
      id: `sms-${Date.now()}`,
      sender: senderLabel,
      body,
      amount,
      type: type as SmsMonitorEvent['type'],
      status: analysis.status,
      reason: analysis.reason,
      timestamp: Date.now(),
      notificationTitle: `${lang === 'ar' ? 'رسالة مالية جديدة' : 'New money SMS'} • ${statusLabel}`,
      notificationBody: `${senderLabel} • ${amountLabel}`,
    };
  };

  const handleIncomingSmsEvent = (event: SmsMonitorEvent) => {
    setSmsText(event.body);
    setSmsSenderId(event.sender);
    setSmsReviewWalletId(guessWalletIdFromMessage(event.sender, event.body) || wallets[0]?.id || '');
    setSmsAlert(event);
  };

  useEffect(() => {
    void prepareNativeAppShell(isDarkMode);
  }, [isDarkMode]);

  useEffect(() => {
    let isCancelled = false;
    let smsListener: { remove: () => Promise<void> | void } | null = null;

    const setupNativeSmsBridge = async () => {
      if (!isNativeAndroidApp()) {
        return;
      }

      try {
        smsListener = await SmsMonitor.addListener('smsReceived', (event) => {
          handleIncomingSmsEvent(event);
        });

        const pending = await SmsMonitor.getPendingSmsEvent();
        if (!isCancelled && pending.event) {
          handleIncomingSmsEvent(pending.event);
        }
      } catch (error) {
        console.error('Failed to initialize native SMS bridge', error);
      }
    };

    void setupNativeSmsBridge();

    return () => {
      isCancelled = true;
      smsListener?.remove?.();
    };
  }, []);

  // --- Android SMS Integration ---
  useEffect(() => {
    (window as any).receiveSMS = (smsBody: string, senderId?: string) => {
      if (!smsBody) {
        return;
      }

      console.log('Received SMS from Android:', smsBody);
      handleIncomingSmsEvent(createSmsMonitorEvent(senderId || '', smsBody));
    };

    return () => {
      delete (window as any).receiveSMS;
    };
  }, [lang, currency]);

  useEffect(() => {
    if (!smsAlert) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setSmsAlert((current) => (current?.id === smsAlert.id ? null : current));
    }, 8000);

    return () => window.clearTimeout(timeout);
  }, [smsAlert]);

  useEffect(() => {
    if (!appNotice) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setAppNotice((current) => (current?.id === appNotice.id ? null : current));
    }, 4500);

    return () => window.clearTimeout(timeout);
  }, [appNotice]);

  const requestSmsPermission = async () => {
    if (isNativeAndroidApp()) {
      try {
        const [smsPermission, notificationPermission] = await Promise.all([
          SmsMonitor.requestPermissions(),
          requestNotificationPermissions(),
        ]);

        const isSmsGranted = smsPermission.sms === 'granted';
        const isNotificationGranted = notificationPermission.display === 'granted';

        showNotice(
          isSmsGranted && isNotificationGranted
            ? (lang === 'ar' ? 'تم تفعيل قراءة الرسائل والإشعارات على أندرويد.' : 'SMS reading and notifications are enabled on Android.')
            : (lang === 'ar' ? 'يجب السماح بالرسائل والإشعارات ليعمل الاستقبال التلقائي.' : 'Allow both SMS and notifications for auto-receive to work.'),
          isSmsGranted && isNotificationGranted ? 'success' : 'warning',
        );
        return;
      } catch (error) {
        console.error('Failed to request SMS permissions', error);
      }
    }

    if ((window as any).AndroidBridge && (window as any).AndroidBridge.requestSmsPermission) {
      (window as any).AndroidBridge.requestSmsPermission();
      return;
    }

    showNotice(
      lang === 'ar' ? 'هذه الميزة تتطلب نسخة Android الأصلية.' : 'This feature requires the native Android build.',
      'info',
    );
  };

  useEffect(() => {
    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;

      if (showSmsParser) {
        setShowSmsParser(false);
        return;
      }

      if (showAboutModal) {
        setShowAboutModal(false);
        return;
      }

      if (showResetConfirm) {
        setShowResetConfirm(false);
        return;
      }

      if (confirmDialog) {
        closeConfirmDialog();
        return;
      }

      if (showAddGam3eyaModal) {
        setShowAddGam3eyaModal(false);
        return;
      }

      if (showAddModal) {
        closeAddModal();
        return;
      }

      if (showAnalyticsModal) {
        setShowAnalyticsModal(false);
        return;
      }

      if (showWalletManager) {
        setShowWalletManager(false);
        setEditingWalletId(null);
        return;
      }

      if (showSettingsModal) {
        closeSettingsPanel();
      }
    };

    window.addEventListener('keydown', handleEscapeKey);
    return () => window.removeEventListener('keydown', handleEscapeKey);
  }, [
    showSmsParser,
    showAboutModal,
    showResetConfirm,
    confirmDialog,
    showAddGam3eyaModal,
    showAddModal,
    showAnalyticsModal,
    showWalletManager,
    showSettingsModal,
  ]);

  // --- Splash Screen ---
  if (isSplashVisible) {
    return (
      <motion.div 
        initial={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 z-[100] flex flex-col items-center justify-center bg-[#f5f7fb] px-6 text-center"
      >
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: 'easeOut' }}
          className="flex flex-col items-center"
        >
          <div className="flex h-28 w-28 items-center justify-center rounded-[2rem] bg-white shadow-[0_28px_60px_rgba(27,116,228,0.16)] ring-1 ring-slate-200/80"
          >
            <AppLogo size={74} />
          </div>

          <motion.h1
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.45 }}
            className="mt-8 text-[2rem] font-extrabold tracking-tight text-slate-900"
          >
            {t.brand}
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.18, duration: 0.45 }}
            className="mt-2 text-sm font-semibold text-slate-500"
          >
            {lang === 'ar' ? 'بواسطة زياد يحيى' : 'By Ziad Yehia'}
          </motion.p>

          <motion.div
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ delay: 0.25, duration: 0.6, ease: 'easeOut' }}
            className="mt-8 h-1 w-20 rounded-full bg-gradient-to-r from-[#8bbdff] via-[#1b74e4] to-[#8bbdff]"
          />
        </motion.div>
      </motion.div>
    );
  }

  // --- Onboarding Screen ---
  if (!hasSeenOnboarding) {
    return (
      <div dir={lang === 'ar' ? 'rtl' : 'ltr'} className={`absolute inset-0 z-[100] flex flex-col items-center justify-center p-6 ${currentTheme.bg}`} style={{ backgroundImage: currentTheme.gradient }}>
        <div className="absolute top-6 end-6">
          <select value={lang} onChange={(e) => setLang(e.target.value as Language)} className="bg-white/5 border border-white/10 rounded-xl px-3 py-1.5 text-sm text-slate-300 focus:outline-none">
            <option value="en" className="bg-slate-900">EN</option>
            <option value="ar" className="bg-slate-900">AR</option>
          </select>
        </div>

        <AnimatePresence mode="wait">
            <motion.div key="setup" initial={{ opacity: 0, y: 50 }} animate={{ opacity: 1, y: 0 }} className={`w-full max-w-md p-8 rounded-[2.5rem] bg-gradient-to-br ${currentTheme.card} border border-white/10 shadow-2xl backdrop-blur-xl`}>
              <h2 className={`text-3xl font-bold mb-2 ${currentTheme.text || 'text-white'}`}>{t.setupWelcome}</h2>
              <p className="text-slate-400 text-sm mb-8">{t.setupDesc}</p>

              <form onSubmit={handleCompleteSetup} className="space-y-6">
                <div>
                  <label className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2 block">{t.setupName}</label>
                  <div className="relative">
                    <User className="absolute inset-y-0 start-4 my-auto w-5 h-5 text-slate-500" />
                    <input 
                      type="text" required value={userName} onChange={(e) => setUserName(e.target.value)}
                      className={`w-full bg-white/5 border border-white/10 rounded-2xl py-4 ps-12 pe-4 focus:outline-none focus:border-sky-500/50 ${currentTheme.text || 'text-white'}`}
                      placeholder={lang === 'ar' ? 'مثال: أحمد' : 'e.g. Alex'}
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2 block">{t.setupCurrency}</label>
                  <select 
                    value={currency} onChange={(e) => setCurrency(e.target.value)}
                    className={`w-full bg-white/5 border border-white/10 rounded-2xl p-4 focus:outline-none focus:border-sky-500/50 appearance-none ${currentTheme.text || 'text-white'}`}
                  >
                    {CURRENCIES.map(c => <option key={c.code} value={c.code} className="bg-slate-900">{c.label} ({c.symbol})</option>)}
                  </select>
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <label className="text-xs font-medium text-slate-400 uppercase tracking-wider block">
                      {lang === 'ar' ? 'PIN اختياري' : 'Optional PIN'}
                    </label>
                    <div className="flex rounded-full border border-white/10 bg-white/5 p-1 text-xs font-semibold">
                      {[4, 6].map((lengthOption) => (
                        <button
                          key={lengthOption}
                          type="button"
                          onClick={() => setSetupPinLength(lengthOption as PinLength)}
                          className={`min-h-9 min-w-11 rounded-full px-3 transition-colors ${setupPinLength === lengthOption ? 'bg-accent-primary text-text-on-accent' : 'text-text-secondary'}`}
                        >
                          {lengthOption}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="relative">
                    <Lock className="absolute inset-y-0 start-4 my-auto w-5 h-5 text-slate-500" />
                    <input 
                      type="password"
                      inputMode="numeric"
                      maxLength={setupPinLength}
                      value={setupPinValue}
                      onChange={(e) => setSetupPinValue(e.target.value.replace(/\D/g, '').slice(0, setupPinLength))}
                      className={`w-full bg-white/5 border border-white/10 rounded-2xl py-4 ps-12 pe-4 tracking-[0.5em] focus:outline-none focus:border-sky-500/50 ${currentTheme.text || 'text-white'}`}
                      placeholder={setupPinLength === 6 ? '000000' : t.setupPinPlaceholder}
                    />
                  </div>
                  <p className="mt-2 text-xs text-text-secondary">
                    {lang === 'ar'
                      ? 'إذا أضفت PIN فستحتاج أيضًا إلى سؤال أمان لاستعادة الوصول.'
                      : 'If you add a PIN, a backup security question is required for recovery.'}
                  </p>
                </div>

                {setupPinValue && (
                  <>
                    <div>
                      <label className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2 block">
                        {lang === 'ar' ? 'سؤال الأمان' : 'Security question'}
                      </label>
                      <select
                        value={setupSecurityQuestionId}
                        onChange={(e) => setSetupSecurityQuestionId(e.target.value)}
                        className={`w-full bg-white/5 border border-white/10 rounded-2xl p-4 focus:outline-none focus:border-sky-500/50 appearance-none ${currentTheme.text || 'text-white'}`}
                      >
                        {SECURITY_QUESTION_OPTIONS.map((option) => (
                          <option key={option.id} value={option.id} className="bg-slate-900">
                            {option.label[lang]}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2 block">
                        {lang === 'ar' ? 'الإجابة الاحتياطية' : 'Backup answer'}
                      </label>
                      <input
                        type="text"
                        value={setupSecurityAnswer}
                        onChange={(e) => setSetupSecurityAnswer(e.target.value)}
                        className={`w-full bg-white/5 border border-white/10 rounded-2xl py-4 px-4 focus:outline-none focus:border-sky-500/50 ${currentTheme.text || 'text-white'}`}
                        placeholder={lang === 'ar' ? 'أدخل إجابة تتذكرها لاحقًا' : 'Enter an answer you can remember later'}
                      />
                    </div>
                  </>
                )}

                {setupError && (
                  <p className="rounded-2xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
                    {setupError}
                  </p>
                )}

                <button type="submit" disabled={!userName.trim()} className={`w-full py-4 rounded-2xl font-bold text-white transition-colors mt-4 disabled:opacity-50 ${currentTheme.btn}`}>
                  {t.setupStart}
                </button>
              </form>
            </motion.div>
        </AnimatePresence>
      </div>
    );
  }

  return (
    <div 
      dir={lang === 'ar' ? 'rtl' : 'ltr'} 
      className={`app-container selection:bg-sky-500/30 selection:text-sky-100 transition-colors duration-500 font-sans ${currentTheme.bg} ${currentTheme.text || 'text-slate-50'}`}
      style={{ backgroundImage: currentTheme.gradient }}
    >
      <AnimatePresence>
        {appNotice && (
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            className="absolute inset-x-0 top-0 z-[66] px-4"
            style={{
              paddingTop: `calc(env(safe-area-inset-top) + ${smsAlert ? '88px' : '10px'})`,
            }}
          >
            <div className={`mx-auto flex max-w-[390px] items-start gap-3 rounded-[1.5rem] border px-4 py-4 shadow-2xl backdrop-blur-xl ${NOTICE_ACCENTS[appNotice.tone]}`}>
              <div className="mt-0.5 shrink-0">{getNoticeIcon(appNotice.tone)}</div>
              <p className="min-w-0 flex-1 text-sm leading-6 text-text-primary">{appNotice.message}</p>
              <button
                type="button"
                onClick={() => setAppNotice(null)}
                className="shrink-0 rounded-full bg-white/10 p-2 text-current transition-colors hover:bg-white/20"
                aria-label={lang === 'ar' ? 'إغلاق التنبيه' : 'Dismiss notice'}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </motion.div>
        )}

        {smsAlert && (
          <motion.div
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            className="absolute inset-x-0 top-0 z-[65] px-4"
            style={{
              paddingTop: 'calc(env(safe-area-inset-top) + 10px)',
            }}
          >
            <div className={`mx-auto flex max-w-[390px] items-start gap-3 rounded-[1.5rem] border px-4 py-4 shadow-2xl backdrop-blur-xl ${getSmsAlertAccent(smsAlert.status)}`}>
              <div className="mt-0.5 shrink-0">{getSmsAlertIcon(smsAlert.status)}</div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-text-primary">
                  {smsAlert.notificationTitle}
                </p>
                <p className="mt-1 text-xs leading-5 text-text-secondary">
                  {smsAlert.amount > 0 ? formatCurrency(smsAlert.amount, currency, lang, false) : (lang === 'ar' ? 'مبلغ غير واضح' : 'Amount unclear')}
                  {' • '}
                  {getSmsStatusLabel(smsAlert.status, lang)}
                  {' • '}
                  {getSmsReasonLabel(smsAlert.reason, lang)}
                </p>
                <p className="mt-1 truncate text-xs text-text-secondary">{smsAlert.sender}</p>
                <div className="mt-3 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setShowSmsParser(true);
                      setSmsAlert(null);
                    }}
                    className="min-h-11 rounded-full bg-white/10 px-4 text-xs font-bold text-text-primary"
                  >
                    {lang === 'ar' ? 'مراجعة الرسالة' : 'Review SMS'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSmsAlert(null)}
                    className="min-h-11 text-xs font-semibold text-text-secondary"
                  >
                    {lang === 'ar' ? 'إخفاء' : 'Dismiss'}
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className={`mobile-main transition-[filter,transform,opacity] duration-300 ${isLocked ? 'pointer-events-none scale-[0.985] blur-sm' : ''}`}>
      {activeTab === 'home' && (
      <header className="mb-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-2">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/15 bg-white/10 shadow-lg">
              <AppLogo size={30} />
            </div>
            <div className="space-y-1">
              <p className="text-[0.75rem] leading-5 text-text-secondary">{t.tagline}</p>
              <h1 className={`text-[1.75rem] font-extrabold leading-none tracking-tight ${currentTheme.text || 'text-slate-50'}`}>
                {t.hello}, {userName || t.brand}
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label={isDarkMode ? 'Use light theme' : 'Use dark theme'}
              onClick={handleColorModeToggle}
              className="touch-icon-button border border-white/10 bg-white/5 text-slate-300"
            >
              {isDarkMode ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </button>
            <button
              type="button"
              aria-label={isPrivacyMode ? 'Show amounts' : 'Hide amounts'}
              onClick={handleToggleBalance}
              className="touch-icon-button border border-white/10 bg-white/5 text-slate-300"
            >
              {isPrivacyMode ? <Eye className="h-5 w-5" /> : <EyeOff className="h-5 w-5" />}
            </button>
            <button
              type="button"
              aria-label={lang === 'ar' ? 'فتح التحليلات' : 'Open analytics'}
              onClick={() => setShowAnalyticsModal(true)}
              className="touch-icon-button border border-white/10 bg-white/5 text-slate-300"
            >
              <PieChart className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>
      )}

      <div className="space-y-4 flex min-h-full flex-col">
        {activeTab === 'home' ? (
          <>
            {/* Warnings */}
            <AnimatePresence>
              {isMonthlyLimitExceeded && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                  <div className="mobile-card flex items-start gap-3 border border-rose-500/50 bg-rose-500/20 p-4 text-rose-100">
                    <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                    <p className="text-sm font-medium">{t.monthlyLimitWarning}</p>
                  </div>
                </motion.div>
              )}
              {isDailyLimitExceeded && !isMonthlyLimitExceeded && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                  <div className="mobile-card flex items-start gap-3 border border-orange-500/50 bg-orange-500/20 p-4 text-orange-100">
                    <AlertTriangle className="w-5 h-5 text-orange-400 shrink-0 mt-0.5" />
                    <p className="text-sm font-medium">{t.dailyLimitWarning}</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Main Wallet Card */}
            <motion.div 
              initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.5 }}
              className="mobile-card relative overflow-hidden border border-glass-border bg-glass-bg p-5 shadow-2xl backdrop-blur-xl"
            >
              <div className="absolute top-0 right-0 -mr-16 -mt-16 w-64 h-64 rounded-full bg-white/5 blur-3xl pointer-events-none"></div>
              {fakeBalanceActive && (
                <div className="absolute end-4 top-4 z-20 flex h-6 w-6 items-center justify-center rounded-full border border-accent-primary/30 bg-accent-primary/12 text-accent-primary">
                  <Lock className="h-3.5 w-3.5" />
                </div>
              )}
              
              <div className="relative z-10 flex flex-col gap-5">
                <div className="flex flex-col gap-4">
                  <div className="w-full">
                    <p className="mb-1 text-[0.75rem] font-medium uppercase tracking-[0.24em] text-text-secondary">{t.availableBalance}</p>
                    <SensitiveText className="flex items-baseline gap-2 break-words text-[1.75rem] font-extrabold leading-none tracking-tight text-text-primary">
                      {formatCurrency(displayedDashboardBalance, currency, lang, true)}
                    </SensitiveText>
                  </div>
                  <div className="mobile-card flex items-center justify-between border border-glass-border bg-white/5 p-4 shadow-inner">
                    <div>
                      <p className="text-[0.625rem] font-bold uppercase tracking-[0.24em] text-accent-primary">{t.dailyAllowance}</p>
                      <p className="mt-1 text-[0.75rem] text-text-secondary">{lang === 'ar' ? 'المتاح لليوم' : 'Available for today'}</p>
                    </div>
                    <SensitiveText className="text-[1.25rem] font-bold text-text-primary">
                      {formatCurrency(displayedDailyAllowance, currency, lang, true)}
                    </SensitiveText>
                  </div>
                </div>

                {/* Quick Stats Row */}
                <div className="grid grid-cols-3 gap-2 border-t border-glass-border pt-4">
                  <div className="mobile-card bg-white/5 p-3">
                    <p className="mb-1 flex items-center gap-1 truncate text-[0.625rem] uppercase text-text-secondary"><ArrowDownRight className="h-3 w-3 shrink-0 text-success"/> <span className="truncate">{t.income}</span></p>
                    <SensitiveText className="block truncate text-[0.875rem] font-bold text-text-primary">{formatCurrency(totalIncome, currency, lang, false)}</SensitiveText>
                  </div>
                  <div className="mobile-card bg-white/5 p-3">
                    <p className="mb-1 flex items-center gap-1 truncate text-[0.625rem] uppercase text-text-secondary"><ArrowUpRight className="h-3 w-3 shrink-0 text-danger"/> <span className="truncate">{t.expense}</span></p>
                    <SensitiveText className="block truncate text-[0.875rem] font-bold text-text-primary">{formatCurrency(totalExpenses, currency, lang, false)}</SensitiveText>
                  </div>
                  <div className="mobile-card bg-white/5 p-3">
                    <p className="mb-1 flex items-center gap-1 truncate text-[0.625rem] uppercase text-text-secondary"><RefreshCw className="h-3 w-3 shrink-0 text-warning"/> <span className="truncate">{t.debt}</span></p>
                    <SensitiveText className="block truncate text-[0.875rem] font-bold text-text-primary">{formatCurrency(totalDebts, currency, lang, false)}</SensitiveText>
                  </div>
                </div>
              </div>
            </motion.div>

            <section className="space-y-3">
              <div className="flex items-end justify-between gap-3 px-1">
                <div>
                  <p className="text-[0.75rem] text-text-secondary">{lang === 'ar' ? 'مربوط بكل حساب' : 'Linked to every account'}</p>
                  <h2 className={`text-[1.15rem] font-bold ${currentTheme.text || 'text-slate-50'}`}>
                    {lang === 'ar' ? 'حساباتي' : 'My Accounts'}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowSettingsModal(true);
                    setShowWalletManager(true);
                  }}
                  className="min-h-11 rounded-full border border-white/10 bg-white/5 px-4 text-[0.72rem] font-semibold text-text-primary"
                >
                  {lang === 'ar' ? 'إدارة الحسابات' : 'Manage accounts'}
                </button>
              </div>

              <div className="flex gap-3 overflow-x-auto pb-1">
                {walletSnapshots.map((wallet) => (
                  <div
                    key={wallet.id}
                    className={`mobile-card min-w-[240px] flex-1 border p-4 backdrop-blur-xl ${
                      selectedWalletFilter === wallet.id
                        ? 'border-accent-primary/40 bg-accent-primary/12'
                        : 'border-white/10 bg-white/[0.04]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedWalletFilter(wallet.id)}
                      className="w-full text-start"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-text-primary">
                            <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/8">
                              {WALLET_ICONS[wallet.icon] || WALLET_ICONS.wallet}
                            </span>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-bold">{wallet.name}</p>
                              <p className="truncate text-[0.72rem] text-text-secondary">{getWalletSubtitle(wallet, lang)}</p>
                            </div>
                          </div>
                        </div>
                        <span className="rounded-full border border-white/10 bg-white/6 px-2 py-1 text-[0.62rem] font-bold text-text-secondary">
                          {wallet.count} {lang === 'ar' ? 'عمليات' : 'ops'}
                        </span>
                      </div>

                      <SensitiveText className="mt-4 block text-[1.1rem] font-extrabold text-text-primary">
                        {formatCurrency(wallet.balance, currency, lang, false)}
                      </SensitiveText>

                      <div className="mt-3 grid grid-cols-2 gap-2 text-[0.72rem]">
                        <div className="rounded-2xl border border-white/8 bg-white/5 p-3">
                          <p className="text-text-secondary">{lang === 'ar' ? 'دخل' : 'Income'}</p>
                          <SensitiveText className="mt-1 block font-bold text-emerald-400">
                            +{formatCurrency(wallet.income, currency, lang, false)}
                          </SensitiveText>
                        </div>
                        <div className="rounded-2xl border border-white/8 bg-white/5 p-3">
                          <p className="text-text-secondary">{lang === 'ar' ? 'مصروف' : 'Outflow'}</p>
                          <SensitiveText className="mt-1 block font-bold text-rose-400">
                            -{formatCurrency(wallet.outflow, currency, lang, false)}
                          </SensitiveText>
                        </div>
                      </div>
                    </button>

                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => openAddModal('income', wallet.id)}
                        className="min-h-11 rounded-2xl border border-emerald-500/25 bg-emerald-500/12 px-3 text-xs font-bold text-emerald-300"
                      >
                        {lang === 'ar' ? 'إضافة دخل' : 'Add income'}
                      </button>
                      <button
                        type="button"
                        onClick={() => openAddModal('expense', wallet.id)}
                        className="min-h-11 rounded-2xl border border-white/10 bg-white/7 px-3 text-xs font-bold text-text-primary"
                      >
                        {lang === 'ar' ? 'تسجيل مصروف' : 'Record spend'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Transactions List */}
            <div className="flex flex-1 flex-col gap-3">
              <div className="flex items-end justify-between gap-3 px-1">
                <div>
                  <p className="text-[0.75rem] text-text-secondary">{t.latestActivity}</p>
                  <h2 className={`text-[1.25rem] font-bold ${currentTheme.text || 'text-slate-50'}`}>{t.recentTransactions}</h2>
                </div>
                {transactions.length > 1 && (
                  <button 
                    onClick={() => setActiveTab('transactions')}
                    className={`min-h-11 rounded-full border border-white/10 bg-white/5 px-4 text-[0.75rem] font-medium ${currentTheme.text || 'text-slate-300'}`}
                  >
                    {t.showAll}
                  </button>
                )}
              </div>

              {transactions.length === 0 ? (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mobile-card flex h-56 flex-col items-center justify-center gap-4 border border-white/5 bg-white/[0.02] p-8 text-center text-slate-500">
                  <Activity className="h-10 w-10 opacity-30" />
                  <div className="space-y-1">
                    <p className="text-sm font-medium">{t.noTransactions}</p>
                    <p className="text-xs text-text-secondary">{lang === 'ar' ? 'ابدأ بإضافة أول معاملة.' : 'Add your first transaction to start tracking.'}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => openAddModal()}
                    className={`min-h-11 rounded-full px-5 text-sm font-bold ${currentTheme.btn}`}
                  >
                    {t.addTransaction}
                  </button>
                </motion.div>
              ) : (
                <div className="space-y-4">
                  {groupedTransactions.slice(0, 1).map(([date, txs]) => [date, txs.slice(0, 1)] as [string, Transaction[]]).map(([date, dayTransactions]) => (
                    <div key={date} className="space-y-2">
                      <div className="sticky top-0 z-10 flex justify-center py-2">
                        <span className={`text-[10px] font-bold uppercase tracking-widest px-4 py-1.5 rounded-full backdrop-blur-md border ${currentTheme.text ? 'bg-white/80 border-slate-200 text-slate-500' : 'bg-slate-900/80 border-white/10 text-slate-400'}`}>
                          {getDateLabel(date)}
                        </span>
                      </div>
                      <div className="mobile-card space-y-1 border border-white/10 bg-white/[0.03] p-2 shadow-sm">
                        {dayTransactions.map((item) => {
                          const wallet = wallets.find(w => w.id === item.walletId);
                          return (
                            <motion.div 
                              layoutId={item.id}
                              key={item.id} 
                              className="mobile-card flex cursor-pointer items-center justify-between p-3" 
                              onClick={() => setActiveTab('transactions')}
                            >
                              <div className="flex items-center gap-3">
                                <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border ${getTypeColor(item.type)}`}>
                                  {getTypeIcon(item.type)}
                                </div>
                                <div className="min-w-0">
                                  <p className={`truncate text-sm font-semibold ${currentTheme.text || 'text-slate-100'}`}>{item.name}</p>
                                  {wallet && (
                                    <div className={`mt-0.5 flex items-center gap-1 text-[0.75rem] ${currentTheme.text ? 'text-slate-500' : 'text-slate-500'}`}>
                                      {WALLET_ICONS[wallet.icon] || WALLET_ICONS['wallet']}
                                      <span className="truncate">{wallet.name}</span>
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div className="text-end shrink-0 ms-2">
                                <SensitiveText mask="***" className={`text-sm font-bold ${item.type === 'income' ? 'text-emerald-400' : (currentTheme.text || 'text-slate-100')}`}>
                                  {item.type === 'income' ? '+' : '-'}{formatCurrency(item.amount, currency, lang, false)}
                                </SensitiveText>
                                <p className={`mt-0.5 text-[0.625rem] uppercase ${currentTheme.text ? 'text-slate-500' : 'text-slate-500'}`}>{t[item.type]}</p>
                              </div>
                            </motion.div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : activeTab === 'transactions' ? (
          <div className="flex flex-1 flex-col gap-3">
            <div className="flex items-end justify-between gap-3 px-1">
              <h2 className={`text-2xl font-bold ${currentTheme.text || 'text-slate-50'}`}>{t.allTransactions}</h2>
            </div>
            {transactions.length === 0 ? (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mobile-card flex h-56 flex-col items-center justify-center gap-4 border border-white/5 bg-white/[0.02] p-8 text-center text-slate-500">
                <Activity className="h-10 w-10 opacity-30" />
                <div className="space-y-1">
                  <p className="text-sm font-medium">{t.noTransactions}</p>
                  <p className="text-xs text-text-secondary">{lang === 'ar' ? 'أضف أول معاملة من زر الإضافة السفلي.' : 'Use the center add button to create your first transaction.'}</p>
                </div>
                <button
                  type="button"
                  onClick={() => openAddModal()}
                  className={`min-h-11 rounded-full px-5 text-sm font-bold ${currentTheme.btn}`}
                >
                  {t.addTransaction}
                </button>
              </motion.div>
            ) : (
              <div className="space-y-4">
                <div className="flex gap-2 overflow-x-auto pb-1">
                  <button
                    type="button"
                    onClick={() => setSelectedWalletFilter('all')}
                    className={`min-h-10 rounded-full border px-4 text-xs font-bold transition-colors ${selectedWalletFilter === 'all' ? 'border-accent-primary/40 bg-accent-primary/15 text-accent-primary' : 'border-white/10 bg-white/5 text-text-secondary'}`}
                  >
                    {t.allWallets}
                  </button>
                  {walletTransactionStats.map((wallet) => (
                    <button
                      key={wallet.id}
                      type="button"
                      onClick={() => setSelectedWalletFilter(wallet.id)}
                      className={`min-h-10 rounded-full border px-4 text-xs font-bold transition-colors ${selectedWalletFilter === wallet.id ? 'border-accent-primary/40 bg-accent-primary/15 text-accent-primary' : 'border-white/10 bg-white/5 text-text-secondary'}`}
                    >
                      {wallet.name} ({wallet.count})
                    </button>
                  ))}
                </div>

                {visibleTransactions.length === 0 ? (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mobile-card flex h-44 flex-col items-center justify-center gap-3 border border-white/5 bg-white/[0.02] p-6 text-center text-slate-500">
                    <Activity className="h-8 w-8 opacity-30" />
                    <p className="text-sm font-medium">{t.noWalletTransactions}</p>
                  </motion.div>
                ) : groupedVisibleTransactions.map(([date, dayTransactions]) => (
                  <div key={date} className="space-y-2">
                    <div className="sticky top-0 z-10 flex justify-center py-2">
                      <span className={`text-[10px] font-bold uppercase tracking-widest px-4 py-1.5 rounded-full backdrop-blur-md border ${currentTheme.text ? 'bg-white/80 border-slate-200 text-slate-500' : 'bg-slate-900/80 border-white/10 text-slate-400'}`}>
                        {getDateLabel(date)}
                      </span>
                    </div>
                    <div className="mobile-card space-y-1 border border-white/10 bg-white/[0.03] p-2 shadow-sm">
                      {dayTransactions.map((item) => {
                        const wallet = wallets.find(w => w.id === item.walletId);
                        return (
                          <motion.div 
                            layoutId={item.id}
                            key={item.id} 
                            className="mobile-card flex cursor-pointer items-center justify-between p-3" 
                            onClick={() => openEditModal(item)}
                          >
                            <div className="flex items-center gap-3">
                              <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border ${getTypeColor(item.type)}`}>
                                {getTypeIcon(item.type)}
                              </div>
                              <div className="min-w-0">
                                <p className={`truncate text-sm font-semibold ${currentTheme.text || 'text-slate-100'}`}>{item.name}</p>
                                <div className={`mt-0.5 flex items-center gap-1 text-[0.75rem] ${currentTheme.text ? 'text-slate-500' : 'text-slate-500'}`}>
                                  {wallet ? WALLET_ICONS[wallet.icon] || WALLET_ICONS['wallet'] : WALLET_ICONS.wallet}
                                  <span className="truncate">{wallet?.name || t.allWallets}</span>
                                  {item.origin === 'sms' && <span className="rounded-full bg-accent-primary/10 px-2 py-0.5 text-[0.6rem] font-bold text-accent-primary">SMS</span>}
                                </div>
                                {item.sender && <p className="mt-0.5 truncate text-[0.7rem] text-text-secondary">{item.sender}</p>}
                              </div>
                            </div>
                            <div className="text-end shrink-0 ms-2">
                              <SensitiveText mask="***" className={`text-sm font-bold ${item.type === 'income' ? 'text-emerald-400' : (currentTheme.text || 'text-slate-100')}`}>
                                {item.type === 'income' ? '+' : '-'}{formatCurrency(item.amount, currency, lang, false)}
                              </SensitiveText>
                              <p className={`mt-0.5 text-[0.625rem] uppercase ${currentTheme.text ? 'text-slate-500' : 'text-slate-500'}`}>{t[item.type]}</p>
                            </div>
                          </motion.div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <Gam3eyaTab 
            gam3eyat={gam3eyat} 
            setGam3eyat={setGam3eyat} 
            setShowAddGam3eyaModal={setShowAddGam3eyaModal}
            t={t}
            currentTheme={currentTheme}
            formatCurrency={formatCurrency}
            currency={currency}
            lang={lang}
            addTransactionDirectly={addTransactionDirectly}
            requestConfirmation={openConfirmDialog}
          />
        )}
      </div>

      {/* Bottom Navigation */}
      <nav className="bottom-nav" aria-label="Primary">
        <div className="bottom-nav-inner mobile-card border border-white/10 bg-white/6 px-2 shadow-[0_-10px_40px_rgba(0,0,0,0.18)] backdrop-blur-2xl">
          <button 
            onClick={() => setActiveTab('home')}
            className={`bottom-nav-button rounded-2xl px-1 text-[0.625rem] font-bold transition-all ${activeTab === 'home' ? currentTheme.accent : 'text-slate-500'}`}
          >
            <span className={`touch-icon-button rounded-2xl transition-all ${activeTab === 'home' ? 'bg-white/10' : 'bg-transparent'}`}>
              <Home className="w-5 h-5" />
            </span>
            <span className="truncate">{t.home}</span>
          </button>
          
          <button 
            onClick={() => setActiveTab('transactions')}
            className={`bottom-nav-button rounded-2xl px-1 text-[0.625rem] font-bold transition-all ${activeTab === 'transactions' ? currentTheme.accent : 'text-slate-500'}`}
          >
            <span className={`touch-icon-button rounded-2xl transition-all ${activeTab === 'transactions' ? 'bg-white/10' : 'bg-transparent'}`}>
              <Activity className="w-5 h-5" />
            </span>
            <span className="text-[10px] font-bold">{t.transactions}</span>
          </button>

          <div className="fab-slot">
            <div className="fab-lift">
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={() => openAddModal()}
                aria-label={t.addTransaction}
                className={`fab-button flex items-center justify-center text-white shadow-2xl ring-4 ring-slate-950/60 ${currentTheme.btn}`}
              >
                <Plus className="w-6 h-6" />
              </motion.button>
            </div>
          </div>

          <button 
            onClick={() => setActiveTab('gam3eya')}
            className={`bottom-nav-button rounded-2xl px-1 text-[0.625rem] font-bold transition-all ${activeTab === 'gam3eya' ? currentTheme.accent : 'text-slate-500'}`}
          >
            <span className={`touch-icon-button rounded-2xl transition-all ${activeTab === 'gam3eya' ? 'bg-white/10' : 'bg-transparent'}`}>
              <Users className="w-5 h-5" />
            </span>
            <span className="truncate">{t.gam3eya}</span>
          </button>

          <button 
            onClick={() => {
              setShowWalletManager(false);
              setEditingWalletId(null);
              setShowSettingsModal(true);
            }}
            className={`bottom-nav-button rounded-2xl px-1 text-[0.625rem] font-bold transition-all ${showSettingsModal ? currentTheme.accent : 'text-slate-500'}`}
          >
            <span className={`touch-icon-button rounded-2xl transition-all ${showSettingsModal ? 'bg-white/10' : 'bg-transparent'}`}>
              <Settings className="w-5 h-5" />
            </span>
            <span className="text-[10px] font-bold">{t.settings}</span>
          </button>
        </div>
      </nav>
      </div>

      {/* Add Gam3eya Modal */}
      <AnimatePresence>
        {showAddGam3eyaModal && (
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 26, stiffness: 320 }}
            className="mobile-subpage z-[60]"
          >
            <div className="mobile-subpage-header">
              <button
                type="button"
                aria-label={t.cancel}
                onClick={() => setShowAddGam3eyaModal(false)}
                className="touch-icon-button border border-glass-border bg-bg-tertiary text-text-secondary"
              >
                <ChevronLeft className="h-5 w-5 rtl:rotate-180" />
              </button>
              <div className="min-w-0">
                <p className="text-[0.75rem] text-text-secondary">{t.gam3eya}</p>
                <h3 className="truncate text-[1.25rem] font-bold text-text-primary">{t.addGam3eya}</h3>
              </div>
            </div>

            <div className="mobile-subpage-body">
              <form onSubmit={handleSaveGam3eya} className="space-y-5">
                <div>
                  <label className={`text-xs font-medium uppercase tracking-wider mb-2 block text-text-secondary`}>{t.name}</label>
                  <input
                    type="text" required value={gam3eyaFormData.name || ''} onChange={(e) => setGam3eyaFormData({ ...gam3eyaFormData, name: e.target.value })}
                    placeholder={lang === 'ar' ? 'مثال: جمعية العائلة' : 'e.g. Family Pool'}
                    className={`w-full bg-bg-tertiary border border-glass-border rounded-2xl p-4 focus:outline-none focus:border-accent-primary/50 text-start transition-colors text-text-primary`}
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={`text-xs font-medium uppercase tracking-wider mb-2 block text-text-secondary`}>{t.monthlyAmount}</label>
                    <input
                      type="number" required min="1" value={gam3eyaFormData.monthlyAmount || ''} onChange={(e) => setGam3eyaFormData({ ...gam3eyaFormData, monthlyAmount: Number(e.target.value) })}
                      className={`w-full bg-bg-tertiary border border-glass-border rounded-2xl p-4 focus:outline-none focus:border-accent-primary/50 text-start transition-colors text-text-primary`}
                    />
                  </div>
                  <div>
                    <label className={`text-xs font-medium uppercase tracking-wider mb-2 block text-text-secondary`}>Total Months</label>
                    <input
                      type="number" required min="2" max="24" value={gam3eyaFormData.totalMonths || ''} onChange={(e) => setGam3eyaFormData({ ...gam3eyaFormData, totalMonths: Number(e.target.value) })}
                      className={`w-full bg-bg-tertiary border border-glass-border rounded-2xl p-4 focus:outline-none focus:border-accent-primary/50 text-start transition-colors text-text-primary`}
                    />
                  </div>
                </div>

                <button type="submit" className={`w-full py-4 rounded-2xl font-bold bg-accent-primary text-text-on-accent transition-opacity hover:opacity-90 mt-4`}>
                  {t.save}
                </button>
              </form>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Add/Edit Transaction Modal */}
      <AnimatePresence>
        {showAddModal && (
          <motion.div 
            initial={{ x: '100%' }} 
            animate={{ x: 0 }} 
            exit={{ x: '100%' }} 
            transition={{ type: 'spring', damping: 26, stiffness: 320 }}
            className="mobile-subpage"
          >
            <div className="mobile-subpage-header">
              <button
                type="button"
                aria-label={t.cancel}
                onClick={closeAddModal}
                className="touch-icon-button border border-glass-border bg-bg-tertiary text-text-secondary"
              >
                <ChevronLeft className="h-5 w-5 rtl:rotate-180" />
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-[0.75rem] text-text-secondary">{editingId ? t.edit : t.addTransaction}</p>
                <h3 className="truncate text-[1.25rem] font-bold text-text-primary">
                  {editingId ? t.edit : t.addTransaction}
                </h3>
              </div>
              {!editingId && (
                <button
                  type="button"
                  onClick={() => setShowSmsParser(true)}
                  className="relative flex min-h-11 items-center gap-2 rounded-full border border-glass-border bg-bg-tertiary px-4 text-[0.75rem] font-bold text-accent-primary"
                >
                  <MessageSquare className="h-4 w-4" />
                  <span>{t.smartPaste}</span>
                  <span className="absolute -top-2 -right-1 rounded-full bg-danger px-1.5 py-0.5 text-[0.5rem] font-bold text-white">BETA</span>
                </button>
              )}
            </div>

            <div className="mobile-subpage-body">
              <form onSubmit={handleSaveTransaction} className="space-y-5">
                {/* Type Selector */}
                <div className="grid grid-cols-3 gap-2 p-1 bg-bg-tertiary rounded-2xl border border-glass-border">
                  {(['income', 'expense', 'debt'] as TransactionType[]).map((type) => (
                    <button
                      key={type} type="button" onClick={() => setFormData({ ...formData, type })}
                      className={`py-2.5 rounded-xl text-sm font-medium transition-all ${
                        formData.type === type 
                          ? 'bg-accent-primary text-text-on-accent shadow-md' 
                          : 'text-text-secondary hover:text-text-primary'
                      }`}
                    >
                      {t[type]}
                    </button>
                  ))}
                </div>

                {/* Amount */}
                <div>
                  <label className={`text-xs font-medium uppercase tracking-wider mb-2 block text-text-secondary`}>{t.amount}</label>
                  <div className="relative">
                    <span className="absolute inset-y-0 start-0 flex items-center ps-4 text-text-secondary text-lg">
                      {currentCurrencySymbol}
                    </span>
                    <input
                      type="number" value={formData.amount || ''} onChange={(e) => setFormData({ ...formData, amount: Number(e.target.value) })}
                      placeholder="0.00" min="0" step="0.01" autoFocus
                      className={`w-full bg-bg-tertiary border border-glass-border rounded-2xl py-4 ps-12 pe-4 text-2xl font-bold focus:outline-none focus:border-accent-primary/50 text-start transition-colors text-text-primary`}
                    />
                  </div>
                </div>

                {/* Name */}
                <div>
                  <label className={`text-xs font-medium uppercase tracking-wider mb-2 block text-text-secondary`}>{t.name}</label>
                  <input
                    type="text" value={formData.name || ''} onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder={
                      formData.type === 'income'
                        ? (lang === 'ar' ? 'مثال: راتب، تحويل وارد...' : 'Example: Salary, incoming transfer...')
                        : formData.type === 'debt'
                          ? (lang === 'ar' ? 'مثال: قسط، ادخار...' : 'Example: Installment, saving...')
                          : (lang === 'ar' ? 'مثال: مشتريات، فاتورة...' : 'Example: Groceries, bill...')
                    }
                    className={`w-full bg-bg-tertiary border border-glass-border rounded-2xl p-4 focus:outline-none focus:border-accent-primary/50 text-start transition-colors text-text-primary`}
                  />
                </div>

                <div>
                  <label className={`text-xs font-medium uppercase tracking-wider mb-2 block text-text-secondary`}>
                    {formData.type === 'income'
                      ? (lang === 'ar' ? 'إضافة المبلغ إلى' : 'Receive into')
                      : (lang === 'ar' ? 'تسجيل المعاملة على' : 'Use account')}
                  </label>
                  <div className="grid grid-cols-1 gap-3">
                    {walletSnapshots.map((wallet) => (
                      <button
                        key={wallet.id}
                        type="button"
                        onClick={() => setFormData({ ...formData, walletId: wallet.id })}
                        className={`rounded-[1.25rem] border p-4 text-start transition-colors ${
                          formData.walletId === wallet.id
                            ? 'border-accent-primary/45 bg-accent-primary/12'
                            : 'border-glass-border bg-bg-tertiary'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/8 text-text-primary">
                              {WALLET_ICONS[wallet.icon] || WALLET_ICONS.wallet}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-bold text-text-primary">{wallet.name}</p>
                              <p className="truncate text-[0.72rem] text-text-secondary">{getWalletSubtitle(wallet, lang)}</p>
                            </div>
                          </div>
                          {formData.walletId === wallet.id && (
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-primary text-text-on-accent">
                              <Check className="h-4 w-4" />
                            </span>
                          )}
                        </div>
                        <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-white/5 px-3 py-2 text-[0.72rem]">
                          <span className="text-text-secondary">{lang === 'ar' ? 'الرصيد الحالي' : 'Current balance'}</span>
                          <SensitiveText className="font-bold text-text-primary">
                            {formatCurrency(wallet.balance, currency, lang, false)}
                          </SensitiveText>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className={`text-xs font-medium uppercase tracking-wider mb-2 block text-text-secondary`}>{t.date}</label>
                  <input
                    type="date" value={formData.date || ''} onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                    className={`w-full bg-bg-tertiary border border-glass-border rounded-2xl p-4 focus:outline-none focus:border-accent-primary/50 text-start transition-colors [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:opacity-50 text-text-primary`}
                  />
                </div>

                {selectedFormWallet && (
                  <div className="rounded-2xl border border-accent-primary/20 bg-accent-primary/8 p-4">
                    <p className="text-[0.7rem] font-medium uppercase tracking-[0.22em] text-accent-primary">
                      {lang === 'ar' ? 'الحساب المحدد' : 'Selected account'}
                    </p>
                    <div className="mt-2 flex items-center gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/8 text-text-primary">
                        {WALLET_ICONS[selectedFormWallet.icon] || WALLET_ICONS.wallet}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-text-primary">{selectedFormWallet.name}</p>
                        <p className="truncate text-[0.75rem] text-text-secondary">
                          {getWalletSubtitle(selectedFormWallet, lang)}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Recurring Options */}
                <div>
                  <label className={`text-xs font-medium uppercase tracking-wider mb-2 block text-text-secondary`}>{lang === 'ar' ? 'تكرار' : 'Recurring'}</label>
                  <div className="relative">
                    <select
                      value={formData.recurring || 'none'} onChange={(e) => setFormData({ ...formData, recurring: e.target.value as any })}
                      className={`w-full bg-bg-tertiary border border-glass-border rounded-2xl p-4 focus:outline-none focus:border-accent-primary/50 text-start transition-colors appearance-none text-text-primary`}
                    >
                      <option value="none" className="bg-[#0f172a] text-white">{lang === 'ar' ? 'لا يتكرر' : 'None'}</option>
                      <option value="daily" className="bg-[#0f172a] text-white">{lang === 'ar' ? 'يوميًا' : 'Daily'}</option>
                      <option value="weekly" className="bg-[#0f172a] text-white">{lang === 'ar' ? 'أسبوعيًا' : 'Weekly'}</option>
                      <option value="monthly" className="bg-[#0f172a] text-white">{lang === 'ar' ? 'شهريًا' : 'Monthly'}</option>
                    </select>
                    <div className="absolute inset-y-0 end-4 flex items-center pointer-events-none text-text-secondary">
                      <ChevronRight className="w-4 h-4 rotate-90" />
                    </div>
                  </div>
                  {formData.recurring && formData.recurring !== 'none' && (
                    <p className={`text-xs mt-2 text-accent-primary`}>
                      {lang === 'ar' ? 'سوف تتم إضافة المعاملة تلقائيًا في هذا الموعد.' : 'Transaction will be automatically generated.'}
                    </p>
                  )}
                </div>

                {formError && <div className="text-danger text-sm bg-danger/10 p-3 rounded-xl border border-danger/20">{formError}</div>}

                <div className="flex gap-3 pt-2 pb-6 sm:pb-0">
                  {editingId && (
                    <button
                      type="button" onClick={() => handleDelete(editingId)}
                      className="p-4 rounded-2xl bg-danger/10 text-danger hover:bg-danger/20 border border-danger/20 transition-colors"
                    >
                      <Trash2 className="w-6 h-6" />
                    </button>
                  )}
                  <button type="submit" className={`flex-1 text-text-on-accent bg-accent-primary rounded-2xl font-bold text-lg py-4 transition-colors hover:opacity-90 shadow-lg`}>
                    {t.save}
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Reset Confirmation Modal */}
      <AnimatePresence>
        {confirmDialog && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[61] flex items-center justify-center bg-black/80 p-4 backdrop-blur-md"
            onClick={(event) => handleBackdropDismiss(event, closeConfirmDialog)}
          >
            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              className="w-full max-w-sm rounded-3xl border border-glass-border bg-glass-bg p-6 text-center shadow-2xl backdrop-blur-xl"
            >
              <div className={`mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full ${confirmDialog.tone === 'danger' ? 'bg-danger/20 text-danger' : 'bg-accent-primary/15 text-accent-primary'}`}>
                {confirmDialog.tone === 'danger' ? <AlertTriangle className="h-8 w-8" /> : <Info className="h-8 w-8" />}
              </div>
              <h3 className="mb-2 text-xl font-bold text-text-primary">{confirmDialog.title}</h3>
              <p className="mb-6 text-sm leading-6 text-text-secondary">{confirmDialog.message}</p>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={closeConfirmDialog}
                  className="flex-1 rounded-xl border border-glass-border bg-bg-tertiary py-3 font-bold text-text-primary transition-colors hover:opacity-80"
                >
                  {t.cancel}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const onConfirm = confirmDialog.onConfirm;
                    closeConfirmDialog();
                    onConfirm();
                  }}
                  className={`flex-1 rounded-xl py-3 font-bold text-white transition-colors ${confirmDialog.tone === 'danger' ? 'bg-danger hover:opacity-90' : 'bg-accent-primary hover:opacity-90'}`}
                >
                  {confirmDialog.confirmLabel}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {showResetConfirm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} className={`bg-glass-bg border border-glass-border rounded-3xl shadow-2xl max-w-sm w-full p-6 text-center backdrop-blur-xl`}>
              <div className="w-16 h-16 mx-auto bg-danger/20 rounded-full flex items-center justify-center mb-4">
                <AlertTriangle className="w-8 h-8 text-danger" />
              </div>
              <h3 className={`text-xl font-bold mb-2 text-text-primary`}>
                {lang === 'ar' ? 'حذف جميع البيانات؟' : 'Reset All Data?'}
              </h3>
              <p className="text-text-secondary text-sm mb-6">
                {lang === 'ar' 
                  ? 'سيتم حذف كل المعاملات ووسائل الدفع والجمعيات نهائيًا. لا يمكن التراجع عن هذا الإجراء.' 
                  : 'This action will permanently delete all your transactions, wallets, and gam3eyat. This cannot be undone.'}
              </p>
              
              <div className="flex gap-3">
                <button onClick={() => setShowResetConfirm(false)} className={`flex-1 py-3 rounded-xl font-bold text-text-primary bg-bg-tertiary hover:opacity-80 border border-glass-border transition-colors`}>
                  {t.cancel}
                </button>
                <button onClick={handleReset} className={`flex-1 py-3 rounded-xl font-bold text-white transition-colors bg-danger hover:opacity-90`}>
                  {lang === 'ar' ? 'نعم، حذف' : 'Yes, Delete'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* SMS Parser Modal */}
      <AnimatePresence>
        {showSmsParser && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} className={`bg-glass-bg border border-glass-border rounded-3xl shadow-2xl w-full max-w-md p-6 relative overflow-hidden backdrop-blur-xl`}>
              <div className="flex justify-between items-center mb-6">
                <h3 className={`text-xl font-bold flex items-center gap-2 text-text-primary`}>
                  <MessageSquare className={`w-6 h-6 text-accent-primary`} />
                  {t.smartPaste}
                </h3>
                <button onClick={() => setShowSmsParser(false)} className="text-text-secondary hover:text-text-primary bg-bg-tertiary p-2 rounded-full border border-glass-border">
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="space-y-4">
                <div className="bg-accent-primary/10 border border-accent-primary/20 rounded-xl p-3 flex items-start gap-3">
                  <ShieldCheck className="w-5 h-5 text-accent-primary shrink-0 mt-0.5" />
                  <p className="text-xs text-text-secondary leading-relaxed">
                    {lang === 'ar' 
                      ? 'داخل نسخة Android الأصلية يستطيع التطبيق استقبال الرسائل تلقائيًا بعد منح الصلاحية. داخل المتصفح استخدم اللصق اليدوي أو القراءة من الحافظة.' 
                      : 'In the native Android build the app can receive SMS automatically after permission is granted. In the browser, use manual paste or the clipboard button.'}
                  </p>
                </div>
                
                <button 
                  onClick={requestSmsPermission}
                  className="w-full py-3 rounded-xl bg-success/10 hover:bg-success/20 border border-success/20 text-success transition-colors text-sm font-bold flex items-center justify-center gap-2"
                >
                  <Smartphone className="w-4 h-4" />
                  {lang === 'ar' ? 'تفعيل القراءة التلقائية (أندرويد فقط)' : 'Enable Auto-Read (Android Only)'}
                </button>

                <div className="relative space-y-3">
                  <input
                    type="text"
                    placeholder={lang === 'ar' ? 'اسم المرسل (Sender ID)' : 'Sender ID'}
                    value={smsSenderId}
                    onChange={(e) => setSmsSenderId(e.target.value)}
                    className={`w-full bg-bg-tertiary border border-glass-border rounded-2xl p-4 focus:outline-none focus:border-accent-primary/50 transition-colors text-text-primary`}
                  />
                  <textarea
                    value={smsText}
                    onChange={(e) => setSmsText(e.target.value)}
                    placeholder={t.pasteSmsHere}
                    className={`w-full h-32 bg-bg-tertiary border border-glass-border rounded-2xl p-4 focus:outline-none focus:border-accent-primary/50 resize-none text-text-primary`}
                  />
                  <button 
                    onClick={handlePasteFromClipboard}
                    className="absolute bottom-3 right-3 p-2 bg-glass-bg border border-glass-border hover:bg-bg-tertiary rounded-xl text-text-primary transition-colors flex items-center gap-2 text-xs font-medium backdrop-blur-md"
                  >
                    <Upload className="w-4 h-4" />
                    {lang === 'ar' ? 'لصق من الحافظة' : 'Paste from Clipboard'}
                  </button>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-text-secondary">{t.messageAccount}</label>
                  <select
                    value={smsReviewWalletId}
                    onChange={(e) => setSmsReviewWalletId(e.target.value)}
                    className="w-full rounded-2xl border border-glass-border bg-bg-tertiary p-4 text-text-primary focus:border-accent-primary/50 focus:outline-none"
                  >
                    {wallets.map((wallet) => (
                      <option key={wallet.id} value={wallet.id}>
                        {wallet.accountRef ? `${wallet.name} • ${wallet.accountRef}` : wallet.name}
                      </option>
                    ))}
                  </select>
                </div>

                {smsDraftPreview && (
                  <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-medium text-text-secondary">{t.messageDetails}</p>
                        <p className="mt-1 text-sm font-bold text-text-primary">{smsDraftPreview.finalName}</p>
                      </div>
                      <span className={`rounded-full border px-3 py-1 text-[0.65rem] font-bold ${getSmsAlertAccent(smsDraftPreview.verificationResult.status)}`}>
                        {getSmsStatusLabel(smsDraftPreview.verificationResult.status, lang)}
                      </span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-xs text-text-secondary">{t.messageSender}</p>
                        <p className="mt-1 font-medium text-text-primary">{smsDraftPreview.sender}</p>
                      </div>
                      <div>
                        <p className="text-xs text-text-secondary">{t.amount}</p>
                        <p className="mt-1 font-medium text-text-primary">
                          {smsDraftPreview.amount > 0 ? formatCurrency(smsDraftPreview.amount, currency, lang, false) : (lang === 'ar' ? 'غير واضح' : 'Unclear')}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <button 
                    onClick={handleParseSms}
                    disabled={!smsText.trim()}
                    className="w-full rounded-2xl border border-white/10 bg-white/5 py-4 font-bold text-text-primary transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {t.editBeforeSave}
                  </button>
                  <button 
                    onClick={handleSaveSmsTransaction}
                    disabled={!smsText.trim()}
                    className="w-full rounded-2xl bg-accent-primary py-4 font-bold text-text-on-accent transition-opacity hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    <Sparkles className="w-5 h-5" />
                    {t.saveFromMessage}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* About Modal */}
      <AnimatePresence>
        {showAboutModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-[70] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} className={`bg-gradient-to-br ${currentTheme.card} border border-white/10 rounded-3xl shadow-2xl w-full max-w-sm p-6 relative overflow-hidden text-center`}>
              <button onClick={() => setShowAboutModal(false)} className="absolute top-4 right-4 text-slate-400 hover:text-slate-200 bg-white/5 p-2 rounded-full">
                <X className="w-5 h-5" />
              </button>
              
              <div className="w-20 h-20 mx-auto bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl flex items-center justify-center mb-4 shadow-lg">
                <AppLogo size={56} />
              </div>
              
              <h2 className={`text-2xl font-bold mb-1 ${currentTheme.text || 'text-white'}`}>{t.brand}</h2>
              <p className="text-sky-400 text-sm font-bold mb-6">Version 1.0.0</p>
              
              <div className="space-y-4 text-sm text-start">
                <div className="bg-white/5 rounded-xl p-3 border border-white/5">
                  <p className="text-slate-400 text-xs mb-1">{lang === 'ar' ? 'المطور' : 'Developer'}</p>
                  <p className={`font-bold ${currentTheme.text || 'text-white'}`}>{lang === 'ar' ? 'زياد يحيى زكريا أحمد' : 'Ziad Yehia Zakaria Ahmed'}</p>
                </div>
                
                <div className="bg-white/5 rounded-xl p-3 border border-white/5 flex items-center justify-between">
                  <span className="text-slate-400">{lang === 'ar' ? 'الهاتف' : 'Phone'}</span>
                  <a href="tel:+201124148723" className="font-bold text-sky-400" dir="ltr">+20 112 414 8723</a>
                </div>
                
                <div className="bg-white/5 rounded-xl p-3 border border-white/5 flex items-center justify-between">
                  <span className="text-slate-400">Instagram</span>
                  <a href="https://instagram.com/ziadworkout" target="_blank" rel="noreferrer" className="font-bold text-pink-400" dir="ltr">@ziadworkout</a>
                </div>
                
                <div className="bg-white/5 rounded-xl p-3 border border-white/5 flex items-center justify-between">
                  <span className="text-slate-400">Facebook</span>
                  <a href="https://facebook.com/zidpy" target="_blank" rel="noreferrer" className="font-bold text-blue-400" dir="ltr">@zidpy</a>
                </div>
              </div>
              
              <p className="text-xs text-slate-500 mt-6">
                © {new Date().getFullYear()} {t.brand}. {lang === 'ar' ? 'جميع الحقوق محفوظة.' : 'All rights reserved.'}
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettingsModal && (
          <motion.div 
            initial={{ x: '100%' }} 
            animate={{ x: 0 }} 
            exit={{ x: '100%' }} 
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="mobile-subpage z-50"
            style={{ backgroundImage: currentTheme.gradient }}
          >
            <div className="flex-1 overflow-y-auto">
              
              <AnimatePresence mode="wait">
                {!showWalletManager ? (
                  <motion.div key="main-settings" initial={{ x: -20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -20, opacity: 0 }}>
                    <div className="mobile-subpage-header">
                      <button onClick={closeSettingsPanel} className="touch-icon-button border border-glass-border bg-bg-tertiary text-text-secondary">
                        <ChevronLeft className="w-5 h-5 rtl:rotate-180" />
                      </button>
                      <div className="min-w-0">
                        <p className="text-[0.75rem] text-text-secondary">{t.security}</p>
                        <h3 className="truncate text-[1.25rem] font-bold text-text-primary">{t.settings}</h3>
                      </div>
                    </div>

                    <div className="mobile-subpage-body pt-2 space-y-6">

                    {/* Security & Profile Entry */}
                    <div className="space-y-2">
                      <label className={`text-sm font-medium flex items-center gap-2 text-text-secondary`}><ShieldCheck className="w-4 h-4"/> {t.security}</label>
                      <form onSubmit={handleSaveSecuritySettings} className="bg-bg-tertiary border border-glass-border rounded-2xl p-4 space-y-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-text-primary">
                              {pinEnabled
                                ? (lang === 'ar' ? `قفل PIN مفعّل (${pinLength} أرقام)` : `PIN lock enabled (${pinLength} digits)`)
                                : (lang === 'ar' ? 'قفل PIN غير مفعّل' : 'PIN lock is off')}
                            </p>
                            <p className="mt-1 text-[0.75rem] text-text-secondary">
                              {lang === 'ar'
                                ? 'القفل يظهر مباشرة عند فتح التطبيق أو عند العودة من الخلفية.'
                                : 'The app locks on open, on backgrounding, and after inactivity.'}
                            </p>
                          </div>
                          {pinEnabled && (
                            <button
                              type="button"
                              onClick={handleDisablePin}
                              className="min-h-11 rounded-full border border-danger/25 bg-danger/10 px-4 text-[0.75rem] font-bold text-danger"
                            >
                              {lang === 'ar' ? 'تعطيل' : 'Disable'}
                            </button>
                          )}
                        </div>

                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-wider text-text-secondary">
                            {lang === 'ar' ? 'طول رمز PIN' : 'PIN length'}
                          </label>
                          <div className="grid grid-cols-2 gap-2">
                            {[4, 6].map((lengthOption) => (
                              <button
                                key={lengthOption}
                                type="button"
                                onClick={() => setSettingsPinLengthDraft(lengthOption as PinLength)}
                                className={`min-h-11 rounded-2xl border text-sm font-semibold transition-colors ${settingsPinLengthDraft === lengthOption ? 'border-accent-primary/50 bg-accent-primary/15 text-accent-primary' : 'border-glass-border bg-white/5 text-text-secondary'}`}
                              >
                                {lengthOption} {lang === 'ar' ? 'أرقام' : 'digits'}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-3">
                          <div>
                            <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-text-secondary">
                              {pinEnabled ? (lang === 'ar' ? 'PIN جديد' : 'New PIN') : (lang === 'ar' ? 'تفعيل PIN' : 'Enable PIN')}
                            </label>
                            <input
                              type="password"
                              inputMode="numeric"
                              maxLength={settingsPinLengthDraft}
                              value={settingsPinDraft}
                              onChange={(e) => setSettingsPinDraft(e.target.value.replace(/\D/g, '').slice(0, settingsPinLengthDraft))}
                              className="w-full rounded-2xl border border-glass-border bg-white/5 px-4 py-4 tracking-[0.4em] text-text-primary focus:border-accent-primary/50 focus:outline-none"
                              placeholder={settingsPinLengthDraft === 6 ? '000000' : '0000'}
                            />
                          </div>
                          <div>
                            <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-text-secondary">
                              {lang === 'ar' ? 'تأكيد PIN' : 'Confirm PIN'}
                            </label>
                            <input
                              type="password"
                              inputMode="numeric"
                              maxLength={settingsPinLengthDraft}
                              value={settingsPinConfirmDraft}
                              onChange={(e) => setSettingsPinConfirmDraft(e.target.value.replace(/\D/g, '').slice(0, settingsPinLengthDraft))}
                              className="w-full rounded-2xl border border-glass-border bg-white/5 px-4 py-4 tracking-[0.4em] text-text-primary focus:border-accent-primary/50 focus:outline-none"
                              placeholder={settingsPinLengthDraft === 6 ? '000000' : '0000'}
                            />
                          </div>
                        </div>

                        <div className="space-y-3 border-t border-glass-border pt-4">
                          <div>
                            <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-text-secondary">
                              {lang === 'ar' ? 'سؤال الأمان' : 'Security question'}
                            </label>
                            <select
                              value={settingsSecurityQuestionId}
                              onChange={(e) => setSettingsSecurityQuestionId(e.target.value)}
                              className="w-full rounded-2xl border border-glass-border bg-white/5 px-4 py-4 text-sm text-text-primary focus:border-accent-primary/50 focus:outline-none"
                            >
                              {SECURITY_QUESTION_OPTIONS.map((option) => (
                                <option key={option.id} value={option.id}>
                                  {option.label[lang]}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-text-secondary">
                              {lang === 'ar' ? 'إجابة الاستعادة' : 'Recovery answer'}
                            </label>
                            <input
                              type="text"
                              value={settingsSecurityAnswer}
                              onChange={(e) => setSettingsSecurityAnswer(e.target.value)}
                              className="w-full rounded-2xl border border-glass-border bg-white/5 px-4 py-4 text-text-primary focus:border-accent-primary/50 focus:outline-none"
                              placeholder={securityAnswerHash ? (lang === 'ar' ? 'اتركه فارغًا للاحتفاظ بالإجابة الحالية' : 'Leave blank to keep the current answer') : (lang === 'ar' ? 'إجابة مطلوبة لاسترجاع PIN' : 'Required for PIN recovery')}
                            />
                          </div>
                        </div>

                        <div className="space-y-3 border-t border-glass-border pt-4">
                          <div>
                            <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-text-secondary">
                              {lang === 'ar' ? 'القفل التلقائي' : 'Auto-lock'}
                            </label>
                            <select
                              value={autoLockPreference}
                              onChange={(e) => setAutoLockPreference(e.target.value as AutoLockSetting)}
                              className="w-full rounded-2xl border border-glass-border bg-white/5 px-4 py-4 text-sm text-text-primary focus:border-accent-primary/50 focus:outline-none"
                            >
                              <option value="1">{lang === 'ar' ? 'دقيقة واحدة' : '1 minute'}</option>
                              <option value="5">{lang === 'ar' ? '5 دقائق' : '5 minutes'}</option>
                              <option value="10">{lang === 'ar' ? '10 دقائق' : '10 minutes'}</option>
                              <option value="30">{lang === 'ar' ? '30 دقيقة' : '30 minutes'}</option>
                              <option value="never">{lang === 'ar' ? 'أبدًا' : 'Never'}</option>
                            </select>
                          </div>

                          {biometricSupported && pinEnabled && (
                            <div className="flex items-center justify-between gap-3 rounded-2xl border border-glass-border bg-white/5 px-4 py-3">
                              <div>
                                <p className="text-sm font-semibold text-text-primary">{t.biometricAuth}</p>
                                <p className="text-[0.75rem] text-text-secondary">
                                  {biometricCredentialId
                                    ? (useBiometrics ? (lang === 'ar' ? 'البصمة مفعّلة على شاشة القفل.' : 'Biometric unlock is enabled on the lock screen.') : (lang === 'ar' ? 'تم تسجيل البصمة لكنها غير مفعّلة.' : 'Biometric is registered but currently disabled.'))
                                    : (lang === 'ar' ? 'سجّل بصمة أو وجه لهذا الجهاز.' : 'Register this device for fingerprint or face unlock.')}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={handleToggleBiometric}
                                disabled={biometricBusy}
                                className={`min-h-11 rounded-full px-4 text-sm font-bold ${biometricBusy ? 'bg-white/10 text-text-secondary' : currentTheme.btn}`}
                              >
                                {biometricBusy
                                  ? (lang === 'ar' ? 'جارٍ...' : 'Working...')
                                  : useBiometrics
                                    ? (lang === 'ar' ? 'إيقاف' : 'Disable')
                                    : biometricCredentialId
                                      ? (lang === 'ar' ? 'تفعيل' : 'Enable')
                                      : (lang === 'ar' ? 'تسجيل' : 'Register')}
                              </button>
                            </div>
                          )}
                        </div>

                        <div className="space-y-3 border-t border-glass-border pt-4">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <span className={`text-sm block text-text-primary`}>{t.fakeBalance}</span>
                              <span className="text-[10px] text-text-secondary">{t.fakeBalanceDesc}</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => setFakeBalanceMode((current) => !current)}
                              className={`relative h-6 w-12 rounded-full transition-colors ${fakeBalanceMode ? 'bg-accent-primary' : 'bg-text-secondary'}`}
                            >
                              <div className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-all ${fakeBalanceMode ? 'start-7' : 'start-1'}`}></div>
                            </button>
                          </div>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={fakeBalanceInput}
                            onChange={(e) => setFakeBalanceInput(e.target.value)}
                            className="w-full rounded-2xl border border-glass-border bg-white/5 px-4 py-4 text-text-primary focus:border-accent-primary/50 focus:outline-none"
                            placeholder={lang === 'ar' ? 'مثال: 25000' : 'Example: 25000'}
                          />
                        </div>

                        {settingsSecurityError && (
                          <p className="rounded-2xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
                            {settingsSecurityError}
                          </p>
                        )}

                        {settingsSecuritySuccess && (
                          <p className="rounded-2xl border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
                            {settingsSecuritySuccess}
                          </p>
                        )}

                        <button type="submit" className={`w-full min-h-11 rounded-2xl text-sm font-bold ${currentTheme.btn}`}>
                          {lang === 'ar' ? 'حفظ إعدادات الأمان' : 'Save Security Settings'}
                        </button>
                      </form>
                    </div>

                    {/* Wallets Manager Entry */}
                    <button 
                      onClick={() => setShowWalletManager(true)}
                      className="w-full flex items-center justify-between p-4 bg-bg-tertiary hover:bg-glass-bg border border-glass-border rounded-2xl transition-colors"
                    >
                      <div className={`flex items-center gap-3 text-text-primary`}>
                        <Wallet className={`w-5 h-5 text-accent-primary`} />
                        <span className="font-medium">{t.wallets}</span>
                      </div>
                      <ChevronRight className="w-5 h-5 text-text-secondary rtl:rotate-180" />
                    </button>

                    {/* Theme */}
                    <div className="space-y-2">
                      <label className={`text-sm font-medium flex items-center gap-2 text-text-secondary`}><Palette className="w-4 h-4"/> {t.theme}</label>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {(['midnight', 'frosted', 'sunset', 'emerald', 'girly', 'programmer', 'gamer', 'business'] as Theme[]).map(th => (
                          <button key={th} onClick={() => {
                            setTheme(th);
                            localStorage.setItem('app_theme', `${th}`);
                            document.documentElement.setAttribute('data-theme', th);
                          }} className={`py-2.5 rounded-xl text-xs sm:text-sm font-medium transition-colors border capitalize ${theme === th ? 'bg-accent-primary/20 border-accent-primary/50 text-accent-primary' : 'bg-bg-tertiary border-glass-border text-text-secondary hover:bg-glass-bg'}`}>
                            {th}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Language & Currency */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className={`text-sm font-medium text-text-secondary`}>{t.language}</label>
                        <select value={lang} onChange={(e) => setLang(e.target.value as Language)} className={`w-full bg-bg-tertiary border border-glass-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-accent-primary/50 [&>option]:bg-bg-primary text-text-primary`}>
                          <option value="en">English</option>
                          <option value="ar">العربية</option>
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label className={`text-sm font-medium text-text-secondary`}>{t.currency}</label>
                        <select value={currency} onChange={(e) => setCurrency(e.target.value)} className={`w-full bg-bg-tertiary border border-glass-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-accent-primary/50 [&>option]:bg-bg-primary text-text-primary`}>
                          {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.code}</option>)}
                        </select>
                      </div>
                    </div>

                    <hr className="border-glass-border" />

                    {/* Data Management */}
                    <div className="grid grid-cols-1 gap-3">
                      <button onClick={handleExport} className="flex items-center justify-center gap-2 py-3 rounded-xl bg-bg-tertiary hover:bg-glass-bg border border-glass-border text-text-primary transition-colors text-sm font-medium">
                        <Download className="w-4 h-4" /> {t.exportData}
                      </button>
                      <button onClick={() => fileInputRef.current?.click()} className="flex items-center justify-center gap-2 py-3 rounded-xl bg-bg-tertiary hover:bg-glass-bg border border-glass-border text-text-primary transition-colors text-sm font-medium">
                        <Upload className="w-4 h-4" /> {t.importData}
                      </button>
                      <input type="file" accept=".json" ref={fileInputRef} onChange={handleImport} className="hidden" />
                    </div>

                    <div className="grid grid-cols-1 gap-3">
                      <button onClick={() => setShowResetConfirm(true)} className="w-full py-3 rounded-xl bg-danger/10 hover:bg-danger/20 border border-danger/20 text-danger transition-colors text-sm font-medium flex items-center justify-center gap-2">
                        <Trash2 className="w-4 h-4" /> {t.resetData}
                      </button>
                      <button onClick={() => { setShowSettingsModal(false); setShowAboutModal(true); }} className="w-full py-3 rounded-xl bg-accent-primary/10 hover:bg-accent-primary/20 border border-accent-primary/20 text-accent-primary transition-colors text-sm font-medium flex items-center justify-center gap-2">
                        <Info className="w-4 h-4" /> {lang === 'ar' ? 'عن التطبيق' : 'About App'}
                      </button>
                    </div>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div key="wallet-manager" initial={{ x: 20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 20, opacity: 0 }}>
                    <div className="mobile-subpage-header">
                      <button
                        onClick={() => {
                          setShowWalletManager(false);
                          setEditingWalletId(null);
                          setWalletFormData({ icon: 'cash', kind: 'cash', name: '', provider: '', accountRef: '' });
                        }}
                        className="touch-icon-button border border-glass-border bg-bg-tertiary text-text-secondary"
                      >
                        <ChevronLeft className="w-5 h-5 rtl:rotate-180" />
                      </button>
                      <div className="min-w-0">
                        <p className="text-[0.75rem] text-text-secondary">{t.settings}</p>
                        <h3 className="truncate text-[1.25rem] font-bold text-text-primary">{t.wallets}</h3>
                      </div>
                    </div>

                    <div className="mobile-subpage-body pt-2 space-y-6">
                    <div className="space-y-3 max-h-[42vh] overflow-y-auto pe-2 scrollbar-custom">
                      {wallets.map(w => (
                        <div key={w.id} className="flex items-center justify-between gap-3 p-3 bg-bg-tertiary rounded-xl border border-glass-border">
                          <div className={`min-w-0 flex items-center gap-3 text-text-primary`}>
                            <div className="p-2 bg-glass-bg rounded-lg">{WALLET_ICONS[w.icon] || WALLET_ICONS['wallet']}</div>
                            <div className="min-w-0">
                              <p className="truncate font-medium">{w.name}</p>
                              <p className="truncate text-[0.72rem] text-text-secondary">{getWalletSubtitle(w, lang)}</p>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => {
                                setEditingWalletId(w.id);
                                setWalletFormData({
                                  name: w.name,
                                  icon: w.icon,
                                  kind: inferWalletKind(w),
                                  provider: w.provider || '',
                                  accountRef: w.accountRef || '',
                                });
                              }}
                              className="p-2 text-text-secondary hover:text-accent-primary"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button onClick={() => handleDeleteWallet(w.id)} className="p-2 text-text-secondary hover:text-danger"><Trash2 className="w-4 h-4" /></button>
                          </div>
                        </div>
                      ))}
                    </div>

                    <form onSubmit={handleSaveWallet} className="bg-white/5 p-4 rounded-2xl border border-white/10 space-y-4">
                      <h4 className={`text-sm font-bold ${currentTheme.text || 'text-slate-300'}`}>{editingWalletId ? t.editWallet : t.addWallet}</h4>
                      
                      <div>
                        <label className={`text-xs mb-2 block ${currentTheme.text ? 'text-slate-600' : 'text-slate-400'}`}>
                          {lang === 'ar' ? 'نوع الحساب' : 'Account type'}
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                          {WALLET_KIND_OPTIONS.map((option) => (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() => setWalletFormData({ ...walletFormData, kind: option.value, icon: option.icon })}
                              className={`rounded-xl border px-3 py-3 text-xs font-bold transition-colors ${
                                inferWalletKind(walletFormData) === option.value
                                  ? 'border-accent-primary/40 bg-accent-primary/12 text-accent-primary'
                                  : 'border-white/10 bg-white/5 text-text-secondary'
                              }`}
                            >
                              <span className="mb-1 flex items-center justify-center">
                                {WALLET_ICONS[option.icon] || WALLET_ICONS.wallet}
                              </span>
                              <span>{option.label[lang]}</span>
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <label className={`text-xs mb-2 block ${currentTheme.text ? 'text-slate-600' : 'text-slate-400'}`}>{t.selectIcon}</label>
                        <div className="flex gap-2 flex-wrap">
                          {Object.keys(WALLET_ICONS).map(iconKey => (
                            <button 
                              key={iconKey} type="button" 
                              onClick={() => setWalletFormData({ ...walletFormData, icon: iconKey })}
                              className={`p-3 rounded-xl border transition-colors ${walletFormData.icon === iconKey ? 'bg-sky-500/20 border-sky-500/50 text-sky-400' : 'bg-white/10 border-white/10 text-slate-400 hover:bg-white/20'}`}
                            >
                              {WALLET_ICONS[iconKey]}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <label className={`text-xs mb-2 block ${currentTheme.text ? 'text-slate-600' : 'text-slate-400'}`}>{t.walletName}</label>
                        <input 
                          type="text" value={walletFormData.name || ''} onChange={(e) => setWalletFormData({ ...walletFormData, name: e.target.value })}
                          className={`w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:outline-none focus:border-sky-500/50 ${currentTheme.text || 'text-slate-50'}`}
                          placeholder={lang === 'ar' ? 'مثال: فودافون كاش الشخصي' : 'Example: Personal Vodafone Cash'}
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className={`text-xs mb-2 block ${currentTheme.text ? 'text-slate-600' : 'text-slate-400'}`}>
                            {lang === 'ar' ? 'المزوّد / الجهة' : 'Provider'}
                          </label>
                          <input
                            type="text"
                            value={walletFormData.provider || ''}
                            onChange={(e) => setWalletFormData({ ...walletFormData, provider: e.target.value })}
                            className={`w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:outline-none focus:border-sky-500/50 ${currentTheme.text || 'text-slate-50'}`}
                            placeholder={lang === 'ar' ? 'Vodafone / CIB' : 'Vodafone / CIB'}
                          />
                        </div>
                        <div>
                          <label className={`text-xs mb-2 block ${currentTheme.text ? 'text-slate-600' : 'text-slate-400'}`}>
                            {lang === 'ar' ? 'رقم أو مرجع الحساب' : 'Account reference'}
                          </label>
                          <input
                            type="text"
                            value={walletFormData.accountRef || ''}
                            onChange={(e) => setWalletFormData({ ...walletFormData, accountRef: e.target.value })}
                            className={`w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:outline-none focus:border-sky-500/50 ${currentTheme.text || 'text-slate-50'}`}
                            placeholder={lang === 'ar' ? 'آخر 4 أرقام أو رقم المحفظة' : 'Last 4 digits or wallet number'}
                          />
                        </div>
                      </div>

                      <div className="flex gap-2">
                        {editingWalletId && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingWalletId(null);
                              setWalletFormData({ icon: 'cash', kind: 'cash', name: '', provider: '', accountRef: '' });
                            }}
                            className="flex-1 py-2 rounded-xl bg-white/5 text-slate-300"
                          >
                            {t.cancel}
                          </button>
                        )}
                        <button type="submit" disabled={!walletFormData.name?.trim()} className="flex-1 py-2 rounded-xl bg-sky-500 text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed">
                          {t.save}
                        </button>
                      </div>
                    </form>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Analytics Modal */}
      <AnimatePresence>
        {showAnalyticsModal && (
          <motion.div 
            initial={{ x: '100%' }} 
            animate={{ x: 0 }} 
            exit={{ x: '100%' }} 
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="mobile-subpage z-50"
            style={{ backgroundImage: currentTheme.gradient }}
          >
            <div className="mobile-subpage-header">
              <button onClick={() => setShowAnalyticsModal(false)} className="touch-icon-button border border-white/10 bg-white/5 text-slate-300">
                <ChevronLeft className="w-5 h-5 rtl:rotate-180" />
              </button>
              <div className="min-w-0">
                <p className="text-[0.75rem] text-text-secondary">{lang === 'ar' ? 'ملخص بصري لوضعك الحالي' : 'A quick visual snapshot of your budget'}</p>
                <h3 className={`truncate text-[1.25rem] font-bold ${currentTheme.text || 'text-slate-50'}`}>
                  {t.financialBreakdown}
                </h3>
              </div>
            </div>

            <div className="mobile-subpage-body pt-2">
              <div className="grid grid-cols-2 gap-3 mb-4 relative z-10">
                <div className="bg-white/5 rounded-2xl p-4 border border-white/5">
                  <p className="text-xs text-slate-400 font-bold uppercase tracking-wider mb-1">{t.income}</p>
                  <SensitiveText mask="***" className={`text-lg font-bold text-emerald-400 truncate`}>{formatCurrency(totalIncome, currency, lang, false)}</SensitiveText>
                </div>
                <div className="bg-white/5 rounded-2xl p-4 border border-white/5">
                  <p className="text-xs text-slate-400 font-bold uppercase tracking-wider mb-1">{t.expense}</p>
                  <SensitiveText mask="***" className={`text-lg font-bold text-rose-400 truncate`}>{formatCurrency(totalExpenses, currency, lang, false)}</SensitiveText>
                </div>
                <div className="bg-white/5 rounded-2xl p-4 border border-white/5">
                  <p className="text-xs text-slate-400 font-bold uppercase tracking-wider mb-1">{t.debt}</p>
                  <SensitiveText mask="***" className={`text-lg font-bold text-purple-400 truncate`}>{formatCurrency(totalDebts, currency, lang, false)}</SensitiveText>
                </div>
                <div className="bg-white/5 rounded-2xl p-4 border border-white/5">
                  <p className="text-xs text-slate-400 font-bold uppercase tracking-wider mb-1">{t.balance}</p>
                  <SensitiveText mask="***" className={`text-lg font-bold ${remainingBalance >= 0 ? 'text-emerald-400' : 'text-rose-400'} truncate`}>{formatCurrency(remainingBalance, currency, lang, false)}</SensitiveText>
                </div>
              </div>

              {analyticsHasData ? (
              <div className="grid grid-cols-1 gap-4 relative z-10">
                <div className={`bg-white/5 rounded-2xl p-5 border border-white/5 ${isPrivacyMode ? 'pointer-events-none select-none blur-md' : ''}`}>
                  <h4 className={`text-sm font-bold mb-4 ${currentTheme.text || 'text-slate-300'}`}>{t.cashFlow}</h4>
                  <div className="h-48 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={cashFlowChartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                        <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                        <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(val) => String(val)} />
                        <RechartsTooltip cursor={{ fill: '#ffffff05' }} contentStyle={{ backgroundColor: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', color: '#fff' }} formatter={(value: number) => formatCurrency(value, currency, lang)} />
                        <Bar dataKey="amount" radius={[4, 4, 0, 0]} fill="#3b82f6" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div className={`bg-white/5 rounded-2xl p-5 border border-white/5 flex flex-col min-h-[280px] ${isPrivacyMode ? 'pointer-events-none select-none blur-md' : ''}`}>
                  <h4 className={`text-sm font-bold mb-4 ${currentTheme.text || 'text-slate-300'}`}>{t.distribution}</h4>
                  <div className="flex-grow w-full relative min-h-[192px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <RechartsPieChart>
                        <Pie data={distributionChartData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value" stroke="none">
                          {distributionChartData.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.color} />)}
                        </Pie>
                        <RechartsTooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', color: '#fff' }} formatter={(value: number) => formatCurrency(value, currency, lang)} />
                      </RechartsPieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
              ) : (
              <div className="mobile-card flex min-h-[320px] flex-col items-center justify-center gap-4 border border-white/5 bg-white/[0.03] p-8 text-center">
                <PieChart className="h-10 w-10 text-text-secondary/60" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-text-primary">{lang === 'ar' ? 'لا توجد بيانات كافية للتحليل' : 'Not enough data for analytics yet'}</p>
                  <p className="text-xs text-text-secondary">{lang === 'ar' ? 'أضف أول معاملة ليظهر التدفق النقدي والتوزيع.' : 'Add your first transaction to unlock charts and breakdowns.'}</p>
                </div>
                <button
                  type="button"
                  onClick={() => { setShowAnalyticsModal(false); openAddModal(); }}
                  className={`min-h-11 rounded-full px-5 text-sm font-bold ${currentTheme.btn}`}
                >
                  {t.addTransaction}
                </button>
              </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isLocked && isSetupComplete && hasSeenOnboarding && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-[90] bg-[rgba(5,10,20,0.96)] backdrop-blur-2xl"
          >
            <div
              className="flex h-full flex-col items-center justify-center px-6 text-center"
              style={{
                paddingTop: 'calc(env(safe-area-inset-top) + 16px)',
                paddingBottom: 'calc(env(safe-area-inset-bottom) + 24px)',
                paddingLeft: 'calc(env(safe-area-inset-left) + 16px)',
                paddingRight: 'calc(env(safe-area-inset-right) + 16px)',
              }}
            >
              <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-[2rem] border border-white/10 bg-white/6 shadow-2xl">
                <AppLogo size={64} />
              </div>
              <h2 className="text-[1.75rem] font-extrabold tracking-tight text-text-primary">{t.brand}</h2>
              <p className="mt-2 max-w-xs text-sm leading-6 text-text-secondary">
                {lockScreenMode === 'pin'
                  ? (lang === 'ar' ? 'أدخل رمز PIN للمتابعة.' : 'Enter your PIN to continue.')
                  : lockScreenMode === 'question'
                    ? (lang === 'ar' ? 'أجب عن سؤال الأمان لاستعادة الوصول.' : 'Answer your security question to recover access.')
                    : (lang === 'ar' ? 'أنشئ رمز PIN جديدًا للمتابعة.' : 'Create a new PIN to continue.')}
              </p>

              {lockScreenMode === 'pin' ? (
                <div className="mt-8 w-full max-w-xs">
                  <div className="mb-5 flex items-center justify-center gap-3">
                    {Array.from({ length: pinLength }).map((_, index) => (
                      <span
                        key={index}
                        className={`h-4 w-4 rounded-full border transition-all ${pinInput.length > index ? 'border-accent-primary bg-accent-primary shadow-[0_0_20px_rgba(59,130,246,0.35)]' : 'border-white/20 bg-white/5'}`}
                      />
                    ))}
                  </div>

                  {pinErrorMessage && (
                    <p className="mb-3 rounded-2xl border border-danger/25 bg-danger/10 px-4 py-3 text-sm text-danger">
                      {pinErrorMessage}
                    </p>
                  )}

                  {isPinTemporarilyLocked && (
                    <p className="mb-4 text-sm font-medium text-warning">
                      {lang === 'ar' ? `القفل مؤقت لمدة ${lockCountdownSeconds}ث` : `Locked for ${lockCountdownSeconds}s`}
                    </p>
                  )}

                  <div className="grid grid-cols-3 justify-items-center gap-4">
                    {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
                      <button
                        key={digit}
                        type="button"
                        disabled={isPinTemporarilyLocked}
                        onClick={() => handlePinDigit(digit)}
                        className="flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-full border border-white/10 bg-white/6 text-xl font-bold text-text-primary shadow-lg transition-transform active:scale-95 disabled:opacity-40"
                      >
                        {digit}
                      </button>
                    ))}

                    {canUseBiometricsOnLockScreen ? (
                      <button
                        type="button"
                        onClick={() => void handleBiometricAuth()}
                        disabled={biometricBusy}
                        className="flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-full border border-accent-primary/25 bg-accent-primary/12 text-accent-primary shadow-lg transition-transform active:scale-95 disabled:opacity-40"
                        aria-label={t.biometricAuth}
                      >
                        <Fingerprint className="h-7 w-7" />
                      </button>
                    ) : (
                      <div className="h-[4.5rem] w-[4.5rem]" />
                    )}

                    <button
                      type="button"
                      disabled={isPinTemporarilyLocked}
                      onClick={() => handlePinDigit('0')}
                      className="flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-full border border-white/10 bg-white/6 text-xl font-bold text-text-primary shadow-lg transition-transform active:scale-95 disabled:opacity-40"
                    >
                      0
                    </button>

                    <button
                      type="button"
                      disabled={!pinInput.length}
                      onClick={handlePinBackspace}
                      className="flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-full border border-white/10 bg-white/6 text-text-primary shadow-lg transition-transform active:scale-95 disabled:opacity-40"
                      aria-label={lang === 'ar' ? 'حذف رقم' : 'Delete digit'}
                    >
                      <ChevronLeft className="h-7 w-7 rtl:rotate-180" />
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={handleForgotPin}
                    className="mt-5 min-h-11 text-sm font-semibold text-accent-primary"
                  >
                    {lang === 'ar' ? 'نسيت رمز PIN؟' : 'Forgot PIN?'}
                  </button>
                </div>
              ) : lockScreenMode === 'question' ? (
                <form onSubmit={handleSecurityQuestionSubmit} className="mt-8 w-full max-w-sm space-y-4 text-start">
                  <div className="rounded-[1.5rem] border border-white/10 bg-white/6 p-4 text-sm text-text-primary">
                    {securityQuestionLabel}
                  </div>
                  <input
                    type="text"
                    value={securityAnswerInput}
                    onChange={(e) => setSecurityAnswerInput(e.target.value)}
                    className="w-full rounded-[1.5rem] border border-white/10 bg-white/6 px-4 py-4 text-text-primary focus:border-accent-primary/50 focus:outline-none"
                    placeholder={lang === 'ar' ? 'إجابة السؤال' : 'Your answer'}
                    autoFocus
                  />
                  {securityResetError && (
                    <p className="rounded-2xl border border-danger/25 bg-danger/10 px-4 py-3 text-sm text-danger">
                      {securityResetError}
                    </p>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setLockScreenMode('pin');
                        setSecurityResetError('');
                      }}
                      className="min-h-11 rounded-2xl border border-white/10 bg-white/6 px-4 text-sm font-bold text-text-primary"
                    >
                      {lang === 'ar' ? 'رجوع' : 'Back'}
                    </button>
                    <button type="submit" className={`min-h-11 rounded-2xl px-4 text-sm font-bold ${currentTheme.btn}`}>
                      {lang === 'ar' ? 'تحقق' : 'Verify'}
                    </button>
                  </div>
                </form>
              ) : (
                <form onSubmit={handleResetPinSubmit} className="mt-8 w-full max-w-sm space-y-4 text-start">
                  <div className="grid grid-cols-2 gap-2">
                    {[4, 6].map((lengthOption) => (
                      <button
                        key={lengthOption}
                      type="button"
                      onClick={() => setResetPinLength(lengthOption as PinLength)}
                      className={`min-h-11 rounded-2xl border text-sm font-semibold transition-colors ${resetPinLength === lengthOption ? 'border-accent-primary/50 bg-accent-primary/15 text-accent-primary' : 'border-white/10 bg-white/6 text-text-secondary'}`}
                    >
                        {lengthOption} {lang === 'ar' ? 'أرقام' : 'digits'}
                      </button>
                    ))}
                  </div>
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={resetPinLength}
                    value={resetPinValue}
                    onChange={(e) => setResetPinValue(e.target.value.replace(/\D/g, '').slice(0, resetPinLength))}
                    className="w-full rounded-[1.5rem] border border-white/10 bg-white/6 px-4 py-4 tracking-[0.4em] text-text-primary focus:border-accent-primary/50 focus:outline-none"
                    placeholder={resetPinLength === 6 ? '000000' : '0000'}
                    autoFocus
                  />
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={resetPinLength}
                    value={resetPinConfirm}
                    onChange={(e) => setResetPinConfirm(e.target.value.replace(/\D/g, '').slice(0, resetPinLength))}
                    className="w-full rounded-[1.5rem] border border-white/10 bg-white/6 px-4 py-4 tracking-[0.4em] text-text-primary focus:border-accent-primary/50 focus:outline-none"
                    placeholder={lang === 'ar' ? 'تأكيد الرمز' : 'Confirm PIN'}
                  />
                  {securityResetError && (
                    <p className="rounded-2xl border border-danger/25 bg-danger/10 px-4 py-3 text-sm text-danger">
                      {securityResetError}
                    </p>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setLockScreenMode('question');
                        setSecurityResetError('');
                      }}
                      className="min-h-11 rounded-2xl border border-white/10 bg-white/6 px-4 text-sm font-bold text-text-primary"
                    >
                      {lang === 'ar' ? 'رجوع' : 'Back'}
                    </button>
                    <button type="submit" className={`min-h-11 rounded-2xl px-4 text-sm font-bold ${currentTheme.btn}`}>
                      {lang === 'ar' ? 'حفظ PIN' : 'Save PIN'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}


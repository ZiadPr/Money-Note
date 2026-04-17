export type AutoLockSetting = '1' | '5' | '10' | '30' | 'never';

export interface SecurityQuestionOption {
  id: string;
  label: {
    en: string;
    ar: string;
  };
}

export const SECURITY_QUESTION_OPTIONS: SecurityQuestionOption[] = [
  {
    id: 'pet',
    label: {
      en: 'What was the name of your first pet?',
      ar: 'ما اسم أول حيوان أليف لديك؟',
    },
  },
  {
    id: 'teacher',
    label: {
      en: 'Who was your favorite school teacher?',
      ar: 'من كان معلمك المفضل في المدرسة؟',
    },
  },
  {
    id: 'street',
    label: {
      en: 'What street did you grow up on?',
      ar: 'ما اسم الشارع الذي نشأت فيه؟',
    },
  },
  {
    id: 'city',
    label: {
      en: 'In which city were you born?',
      ar: 'في أي مدينة وُلدت؟',
    },
  },
];

export async function hashSecret(secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(secret));
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function normalizeSecurityAnswer(answer: string): string {
  return answer.trim().toLowerCase();
}

export function getAutoLockMs(setting: AutoLockSetting): number | null {
  if (setting === 'never') {
    return null;
  }

  return Number(setting) * 60 * 1000;
}

export function toBase64Url(bytes: Uint8Array): string {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

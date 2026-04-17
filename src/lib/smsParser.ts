export type SmsVerificationStatus = 'VERIFIED' | 'SUSPICIOUS' | 'FRAUD' | 'UNKNOWN';

export interface SmsAnalysisResult {
  status: SmsVerificationStatus;
  reason: string;
}

const LETTER_PATTERN = /[A-Za-z\u0600-\u06FF]/;
const NUMERIC_SENDER_PATTERN = /^\+?\d{4,15}$/;
const UNKNOWN_SENDER_PATTERN = /^(unknown|unknown sender|مرسل غير معروف)$/i;
const AMOUNT_PATTERN = /\b\d+(?:[.,]\d+)?\b/;
const AMOUNT_WITH_CURRENCY_PATTERN =
  /(?:EGP|USD|SAR|AED|EUR|GBP|جنيه|ج\.?م|دولار|ريال|درهم|\$|€|£)\s*([\d,]+(?:[.]\d+)?)|([\d,]+(?:[.]\d+)?)\s*(?:EGP|USD|SAR|AED|EUR|GBP|جنيه|ج\.?م|دولار|ريال|درهم|\$|€|£)/i;
const MONEY_CONTEXT_PATTERN =
  /بنك|حساب|رصيد|بطاقة|فيزا|محفظة|تحويل|إيداع|سحب|خصم|دفع|فاتورة|instapay|fawry|cash|bank|account|balance|card|visa|wallet|transfer|deposit|withdrawal|payment|purchase/i;
const URL_PATTERN = /https?:\/\/|www\.|bit\.ly|tinyurl|t\.me|wa\.me/i;
const TRUSTED_PROVIDER_PATTERN =
  /vodafone(?:\s*cash)?|orange(?:\s*cash)?|etisalat(?:\s*cash)?|we\s*pay|telecom egypt|instapay|fawry|meeza|aman|masary|sadad|bank misr|banque misr|cib|nbe|qnb|alexbank|hsbc|adib|fabmisr|egbank|bank of alexandria|bm online|الأهلي|الاهلي|بنك مصر|بنك القاهرة|بنك الإسكندرية|بنك الاسكندرية|فودافون(?:\s*كاش)?|أورنج(?:\s*كاش)?|اورنج(?:\s*كاش)?|اتصالات(?:\s*كاش)?|وي(?:\s*باي)?|انستاباي|فوري|ميزة|أمان|المصرف المتحد|أبوظبي الإسلامي/i;
const TRUSTED_LINK_PATTERN =
  /(vodafone\.com\.eg|orange\.eg|etisalat\.eg|te\.eg|we\.com\.eg|instapay\.eg|ipn\.eg|fawry\.com|meeza\.digital|cibeg\.com|nbe\.com\.eg|banquemisr\.com|qnbalahli\.com|alexbank\.com|hsbc\.com\.eg|adib\.ae|fabmisr\.com\.eg|egbank\.com\.eg)/i;
const URGENCY_PATTERN =
  /محظور|موقوف|عاجل|فوري|تحقق الآن|آخر فرصة|استجابة فورية|urgent|blocked|suspended|verify now|immediately|final notice/i;
const CREDENTIAL_PATTERN =
  /pin|otp|password|passcode|cvv|one[-\s]?time password|كلمة السر|الرقم السري|رمز التحقق|رمز التأكيد|بيانات البطاقة/i;
const INCOME_PATTERN =
  /إيداع|راتب|استلام|إضافة|تحويل وارد|تم إضافة|تم استلام|deposit|salary|received|credit|added|incoming transfer/i;
const EXPENSE_PATTERN =
  /خصم|سحب|دفع|شراء|فاتورة|تحويل صادر|تم خصم|تم دفع|withdrawal|payment|purchase|paid|spent|debited|outgoing transfer/i;

function normalizeSender(sender: string) {
  return sender.trim();
}

function normalizeNumericSender(sender: string) {
  return sender.replace(/[\s()-]+/g, '');
}

function parseAmount(rawAmount: string | undefined) {
  if (!rawAmount) {
    return 0;
  }

  const amount = parseFloat(rawAmount.replace(/,/g, '.'));
  return Number.isFinite(amount) ? amount : 0;
}

function isTrustedProvider(text: string) {
  return TRUSTED_PROVIDER_PATTERN.test(text);
}

function hasTrustedLink(body: string) {
  return TRUSTED_LINK_PATTERN.test(body);
}

export function isCarrierVerifiedSenderId(sender: string) {
  const normalized = normalizeSender(sender);
  if (!normalized || UNKNOWN_SENDER_PATTERN.test(normalized)) {
    return false;
  }

  return LETTER_PATTERN.test(normalized) && !NUMERIC_SENDER_PATTERN.test(normalizeNumericSender(normalized));
}

export function isNumericSenderId(sender: string) {
  const normalized = normalizeSender(sender);
  if (!normalized || UNKNOWN_SENDER_PATTERN.test(normalized)) {
    return false;
  }

  return NUMERIC_SENDER_PATTERN.test(normalizeNumericSender(normalized));
}

export function inferSenderFromBody(body: string) {
  const firstLine = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  if (!firstLine) {
    return 'Unknown';
  }

  const prefixedSender = firstLine.match(/^([A-Za-z\u0600-\u06FF][A-Za-z0-9_\-\u0600-\u06FF]{1,20})[:\-]/);
  return prefixedSender?.[1] ?? 'Unknown';
}

export function analyzeSMS(sender: string, body: string): SmsAnalysisResult {
  const normalizedBody = body.trim();
  const combinedText = `${sender} ${normalizedBody}`;
  const carrierVerified = isCarrierVerifiedSenderId(sender);
  const numericSender = isNumericSenderId(sender);
  const hasUrl = URL_PATTERN.test(normalizedBody);
  const trustedLink = hasTrustedLink(normalizedBody);
  const hasUrgency = URGENCY_PATTERN.test(normalizedBody);
  const hasCredentialRequest = CREDENTIAL_PATTERN.test(normalizedBody);
  const mentionsMoneyContext = MONEY_CONTEXT_PATTERN.test(combinedText);
  const trustedProvider = isTrustedProvider(combinedText);

  if (carrierVerified || (trustedProvider && mentionsMoneyContext)) {
    if (hasCredentialRequest) {
      return { status: 'SUSPICIOUS', reason: 'carrier_verified_sensitive_request' };
    }

    if (hasUrl && !trustedLink) {
      return { status: 'SUSPICIOUS', reason: 'carrier_verified_link' };
    }

    if (hasUrgency && mentionsMoneyContext && !trustedProvider) {
      return { status: 'SUSPICIOUS', reason: 'urgent_language' };
    }

    return {
      status: 'VERIFIED',
      reason: trustedProvider && !carrierVerified ? 'trusted_provider_sender' : 'carrier_verified_sender',
    };
  }

  if (numericSender) {
    if (hasCredentialRequest) {
      return { status: 'SUSPICIOUS', reason: 'unknown_sender_sensitive_request' };
    }

    if (hasUrl && !trustedLink) {
      return { status: 'SUSPICIOUS', reason: 'suspicious_link' };
    }

    if (trustedProvider && mentionsMoneyContext) {
      return { status: 'VERIFIED', reason: 'trusted_numeric_provider' };
    }

    if (mentionsMoneyContext) {
      return { status: 'SUSPICIOUS', reason: 'numeric_sender_financial_review' };
    }

    if (hasUrgency) {
      return { status: 'SUSPICIOUS', reason: 'urgent_language' };
    }

    return { status: 'UNKNOWN', reason: 'numeric_sender_unverified' };
  }

  if (hasCredentialRequest) {
    return { status: 'SUSPICIOUS', reason: 'unknown_sender_sensitive_request' };
  }

  if (hasUrl && mentionsMoneyContext && !trustedLink) {
    return { status: 'SUSPICIOUS', reason: 'suspicious_link' };
  }

  if (hasUrgency) {
    return { status: 'SUSPICIOUS', reason: 'urgent_language' };
  }

  return { status: 'UNKNOWN', reason: 'unknown_sender_format' };
}

export function extractTransactionData(body: string) {
  const currencyMatch = body.match(AMOUNT_WITH_CURRENCY_PATTERN);
  const amountToken = currencyMatch ? currencyMatch[1] ?? currencyMatch[2] : body.match(AMOUNT_PATTERN)?.[0];
  const amount = parseAmount(amountToken);
  const type = INCOME_PATTERN.test(body) ? 'income' : EXPENSE_PATTERN.test(body) ? 'expense' : 'expense';

  return { amount, type };
}

export function getSmsStatusLabel(status: SmsVerificationStatus, lang: 'en' | 'ar') {
  const labels = {
    VERIFIED: { en: 'Carrier verified', ar: 'موثّق' },
    SUSPICIOUS: { en: 'Needs review', ar: 'يحتاج مراجعة' },
    FRAUD: { en: 'High fraud risk', ar: 'خطر احتيال مرتفع' },
    UNKNOWN: { en: 'Unknown trust', ar: 'ثقة غير محسومة' },
  } as const;

  return labels[status][lang];
}

export function getSmsReasonLabel(reason: string, lang: 'en' | 'ar') {
  const labels: Record<string, { en: string; ar: string }> = {
    carrier_verified_sender: {
      en: 'Sent from an alphanumeric sender ID that passed carrier registration.',
      ar: 'الرسالة صادرة من اسم مرسل حرفي اجتاز تسجيل شركة الاتصالات.',
    },
    trusted_provider_sender: {
      en: 'The sender or message matches a trusted financial provider known to the app.',
      ar: 'تم التعرف على المرسل أو محتوى الرسالة كمزوّد خدمة مالي موثوق.',
    },
    trusted_numeric_provider: {
      en: 'A trusted provider was detected even though the message came from a numeric sender.',
      ar: 'تم التعرف على مزود خدمة موثوق رغم أن المرسل رقمي.',
    },
    carrier_verified_link: {
      en: 'The sender looks carrier-verified, but the message includes a link that still needs review.',
      ar: 'اسم المرسل يبدو موثّقًا، لكن الرسالة تحتوي على رابط يحتاج مراجعة.',
    },
    carrier_verified_sensitive_request: {
      en: 'The sender looks carrier-verified, but the message asks for sensitive credentials.',
      ar: 'اسم المرسل يبدو موثّقًا، لكن الرسالة تطلب بيانات حساسة لا يجب مشاركتها.',
    },
    numeric_sender_financial_review: {
      en: 'Financial content came from an unrecognized numeric sender, so a quick review is safer.',
      ar: 'المحتوى المالي وصل من مرسل رقمي غير معروف، لذا المراجعة السريعة أكثر أمانًا.',
    },
    numeric_sender_unverified: {
      en: 'Numeric senders are not treated as carrier-verified by this rule.',
      ar: 'المرسل الرقمي لا يُعامل كمرسل موثّق في هذا المنطق.',
    },
    unknown_sender_sensitive_request: {
      en: 'Unknown sender format with a request for sensitive data.',
      ar: 'تنسيق المرسل غير واضح والرسالة تطلب بيانات حساسة.',
    },
    suspicious_link: {
      en: 'The message contains a link that should be verified before opening.',
      ar: 'الرسالة تحتوي على رابط يجب التحقق منه قبل فتحه.',
    },
    urgent_language: {
      en: 'Urgent or pressure-based wording was detected.',
      ar: 'تم رصد أسلوب ضغط أو استعجال داخل الرسالة.',
    },
    unknown_sender_format: {
      en: 'The sender format does not clearly indicate trust.',
      ar: 'تنسيق المرسل لا يمنح مستوى ثقة واضحًا.',
    },
  };

  return labels[reason]?.[lang] ?? (lang === 'ar' ? 'لا يوجد تفسير إضافي' : 'No extra explanation');
}

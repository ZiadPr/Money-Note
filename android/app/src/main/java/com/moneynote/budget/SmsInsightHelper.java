package com.moneynote.budget;

import java.text.DecimalFormat;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONException;
import org.json.JSONObject;

public final class SmsInsightHelper {

    private static final int FLAGS = Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE;
    private static final Pattern LETTER_PATTERN = Pattern.compile("[A-Za-z\\u0600-\\u06FF]");
    private static final Pattern NUMERIC_SENDER_PATTERN = Pattern.compile("^\\+?\\d{4,15}$");
    private static final Pattern UNKNOWN_SENDER_PATTERN = Pattern.compile("^(unknown|unknown sender|مرسل غير معروف)$", FLAGS);
    private static final Pattern AMOUNT_PATTERN = Pattern.compile("\\b\\d+(?:[.,]\\d+)?\\b");
    private static final Pattern AMOUNT_WITH_CURRENCY_PATTERN = Pattern.compile(
        "(?:EGP|USD|SAR|AED|EUR|GBP|جنيه|ج\\.?م|دولار|ريال|درهم|\\$|€|£)\\s*([\\d,]+(?:[.]\\d+)?)|([\\d,]+(?:[.]\\d+)?)\\s*(?:EGP|USD|SAR|AED|EUR|GBP|جنيه|ج\\.?م|دولار|ريال|درهم|\\$|€|£)",
        FLAGS
    );
    private static final Pattern MONEY_CONTEXT_PATTERN = Pattern.compile(
        "بنك|حساب|رصيد|بطاقة|فيزا|محفظة|تحويل|إيداع|سحب|خصم|دفع|فاتورة|instapay|fawry|cash|bank|account|balance|card|visa|wallet|transfer|deposit|withdrawal|payment|purchase",
        FLAGS
    );
    private static final Pattern URL_PATTERN = Pattern.compile("https?://|www\\.|bit\\.ly|tinyurl|t\\.me|wa\\.me", FLAGS);
    private static final Pattern TRUSTED_PROVIDER_PATTERN = Pattern.compile(
        "vodafone(?:\\s*cash)?|orange(?:\\s*cash)?|etisalat(?:\\s*cash)?|we\\s*pay|telecom egypt|instapay|fawry|meeza|aman|masary|sadad|bank misr|banque misr|cib|nbe|qnb|alexbank|hsbc|adib|fabmisr|egbank|bank of alexandria|bm online|الأهلي|الاهلي|بنك مصر|بنك القاهرة|بنك الإسكندرية|بنك الاسكندرية|فودافون(?:\\s*كاش)?|أورنج(?:\\s*كاش)?|اورنج(?:\\s*كاش)?|اتصالات(?:\\s*كاش)?|وي(?:\\s*باي)?|انستاباي|فوري|ميزة|أمان|المصرف المتحد|أبوظبي الإسلامي",
        FLAGS
    );
    private static final Pattern TRUSTED_LINK_PATTERN = Pattern.compile(
        "(vodafone\\.com\\.eg|orange\\.eg|etisalat\\.eg|te\\.eg|we\\.com\\.eg|instapay\\.eg|ipn\\.eg|fawry\\.com|meeza\\.digital|cibeg\\.com|nbe\\.com\\.eg|banquemisr\\.com|qnbalahli\\.com|alexbank\\.com|hsbc\\.com\\.eg|adib\\.ae|fabmisr\\.com\\.eg|egbank\\.com\\.eg)",
        FLAGS
    );
    private static final Pattern URGENCY_PATTERN = Pattern.compile(
        "محظور|موقوف|عاجل|فوري|تحقق الآن|آخر فرصة|استجابة فورية|urgent|blocked|suspended|verify now|immediately|final notice",
        FLAGS
    );
    private static final Pattern CREDENTIAL_PATTERN = Pattern.compile(
        "pin|otp|password|passcode|cvv|one[-\\s]?time password|كلمة السر|الرقم السري|رمز التحقق|رمز التأكيد|بيانات البطاقة",
        FLAGS
    );
    private static final Pattern INCOME_PATTERN = Pattern.compile(
        "إيداع|راتب|استلام|إضافة|تحويل وارد|تم إضافة|تم استلام|deposit|salary|received|credit|added|incoming transfer",
        FLAGS
    );
    private static final Pattern EXPENSE_PATTERN = Pattern.compile(
        "خصم|سحب|دفع|شراء|فاتورة|تحويل صادر|تم خصم|تم دفع|withdrawal|payment|purchase|paid|spent|debited|outgoing transfer",
        FLAGS
    );

    private SmsInsightHelper() {}

    public static JSONObject buildEvent(String sender, String body) {
        String normalizedSender = normalizeSender(sender);
        String normalizedBody = body == null ? "" : body.trim();
        double amount = extractAmount(normalizedBody);
        String type = detectType(normalizedBody);
        String status = detectStatus(normalizedSender, normalizedBody);
        String reason = detectReason(normalizedSender, normalizedBody, status);
        long timestamp = System.currentTimeMillis();

        JSONObject event = new JSONObject();
        put(event, "id", "sms-" + timestamp);
        put(event, "sender", normalizedSender);
        put(event, "body", normalizedBody);
        put(event, "amount", amount);
        put(event, "type", type);
        put(event, "status", status);
        put(event, "reason", reason);
        put(event, "timestamp", timestamp);
        put(event, "notificationTitle", "رسالة مالية جديدة • " + getStatusLabel(status));
        put(event, "notificationBody", buildNotificationBody(normalizedSender, amount, status, type));
        return event;
    }

    private static void put(JSONObject object, String key, Object value) {
        try {
            object.put(key, value);
        } catch (JSONException ignored) {
        }
    }

    private static String normalizeSender(String sender) {
        if (sender == null || sender.trim().isEmpty()) {
            return "Unknown";
        }
        return sender.trim();
    }

    private static String normalizeNumericSender(String sender) {
        return sender.replaceAll("[\\s()\\-]+", "");
    }

    private static boolean isCarrierVerifiedSenderId(String sender) {
        String normalized = normalizeSender(sender);
        if (normalized.isEmpty() || UNKNOWN_SENDER_PATTERN.matcher(normalized).matches()) {
            return false;
        }

        return LETTER_PATTERN.matcher(normalized).find()
            && !NUMERIC_SENDER_PATTERN.matcher(normalizeNumericSender(normalized)).matches();
    }

    private static boolean isNumericSenderId(String sender) {
        String normalized = normalizeSender(sender);
        if (normalized.isEmpty() || UNKNOWN_SENDER_PATTERN.matcher(normalized).matches()) {
            return false;
        }

        return NUMERIC_SENDER_PATTERN.matcher(normalizeNumericSender(normalized)).matches();
    }

    private static boolean isTrustedProvider(String text) {
        return TRUSTED_PROVIDER_PATTERN.matcher(text).find();
    }

    private static boolean hasTrustedLink(String body) {
        return TRUSTED_LINK_PATTERN.matcher(body).find();
    }

    private static double extractAmount(String body) {
        Matcher currencyMatcher = AMOUNT_WITH_CURRENCY_PATTERN.matcher(body);
        if (currencyMatcher.find()) {
            String matchedAmount = currencyMatcher.group(1) != null ? currencyMatcher.group(1) : currencyMatcher.group(2);
            return parseAmount(matchedAmount);
        }

        Matcher matcher = AMOUNT_PATTERN.matcher(body);
        if (!matcher.find()) {
            return 0;
        }

        return parseAmount(matcher.group());
    }

    private static double parseAmount(String rawAmount) {
        if (rawAmount == null || rawAmount.isEmpty()) {
            return 0;
        }

        try {
            return Double.parseDouble(rawAmount.replace(',', '.'));
        } catch (NumberFormatException ignored) {
            return 0;
        }
    }

    private static String detectType(String body) {
        if (INCOME_PATTERN.matcher(body).find()) {
            return "income";
        }

        if (EXPENSE_PATTERN.matcher(body).find()) {
            return "expense";
        }

        return "expense";
    }

    private static String detectStatus(String sender, String body) {
        String combinedText = sender + " " + body;
        boolean carrierVerified = isCarrierVerifiedSenderId(sender);
        boolean numericSender = isNumericSenderId(sender);
        boolean hasUrl = URL_PATTERN.matcher(body).find();
        boolean trustedLink = hasTrustedLink(body);
        boolean hasUrgency = URGENCY_PATTERN.matcher(body).find();
        boolean asksCredentials = CREDENTIAL_PATTERN.matcher(body).find();
        boolean mentionsMoney = MONEY_CONTEXT_PATTERN.matcher(combinedText).find();
        boolean trustedProvider = isTrustedProvider(combinedText);

        if (carrierVerified || (trustedProvider && mentionsMoney)) {
            if (asksCredentials) {
                return "SUSPICIOUS";
            }

            if (hasUrl && !trustedLink) {
                return "SUSPICIOUS";
            }

            if (hasUrgency && mentionsMoney && !trustedProvider) {
                return "SUSPICIOUS";
            }

            return "VERIFIED";
        }

        if (numericSender) {
            if (asksCredentials) {
                return "SUSPICIOUS";
            }

            if (hasUrl && !trustedLink) {
                return "SUSPICIOUS";
            }

            if (trustedProvider && mentionsMoney) {
                return "VERIFIED";
            }

            if (mentionsMoney) {
                return "SUSPICIOUS";
            }

            if (hasUrgency) {
                return "SUSPICIOUS";
            }

            return "UNKNOWN";
        }

        if (asksCredentials) {
            return "SUSPICIOUS";
        }

        if (hasUrl && mentionsMoney && !trustedLink) {
            return "SUSPICIOUS";
        }

        if (hasUrgency) {
            return "SUSPICIOUS";
        }

        return "UNKNOWN";
    }

    private static String detectReason(String sender, String body, String status) {
        String combinedText = sender + " " + body;
        boolean carrierVerified = isCarrierVerifiedSenderId(sender);
        boolean numericSender = isNumericSenderId(sender);
        boolean hasUrl = URL_PATTERN.matcher(body).find();
        boolean trustedLink = hasTrustedLink(body);
        boolean hasUrgency = URGENCY_PATTERN.matcher(body).find();
        boolean asksCredentials = CREDENTIAL_PATTERN.matcher(body).find();
        boolean mentionsMoney = MONEY_CONTEXT_PATTERN.matcher(combinedText).find();
        boolean trustedProvider = isTrustedProvider(combinedText);

        if (carrierVerified || (trustedProvider && mentionsMoney && "VERIFIED".equals(status))) {
            if (asksCredentials) {
                return "carrier_verified_sensitive_request";
            }

            if (hasUrl && !trustedLink) {
                return "carrier_verified_link";
            }

            if (trustedProvider && !carrierVerified) {
                return "trusted_provider_sender";
            }

            return "carrier_verified_sender";
        }

        if (numericSender) {
            if (asksCredentials) {
                return "unknown_sender_sensitive_request";
            }

            if (hasUrl && !trustedLink) {
                return "suspicious_link";
            }

            if (trustedProvider && mentionsMoney) {
                return "trusted_numeric_provider";
            }

            if (mentionsMoney) {
                return "numeric_sender_financial_review";
            }

            if (hasUrgency) {
                return "urgent_language";
            }

            return "numeric_sender_unverified";
        }

        if (asksCredentials) {
            return "unknown_sender_sensitive_request";
        }

        if (hasUrl && mentionsMoney && !trustedLink) {
            return "suspicious_link";
        }

        if (hasUrgency) {
            return "urgent_language";
        }

        return "unknown_sender_format";
    }

    private static String buildNotificationBody(String sender, double amount, String status, String type) {
        StringBuilder builder = new StringBuilder();
        builder.append(sender);

        if (amount > 0) {
            builder.append(" • ").append(formatAmount(amount));
        }

        builder.append(" • ").append(getStatusLabel(status));
        builder.append(" • ").append("income".equals(type) ? "دخل" : "مصروف");
        return builder.toString();
    }

    private static String formatAmount(double amount) {
        DecimalFormat format = new DecimalFormat("#,##0.##");
        return format.format(amount);
    }

    private static String getStatusLabel(String status) {
        switch (status) {
            case "VERIFIED":
                return "موثّق";
            case "SUSPICIOUS":
                return "يحتاج مراجعة";
            case "FRAUD":
                return "خطر احتيال مرتفع";
            default:
                return "ثقة غير محسومة";
        }
    }
}

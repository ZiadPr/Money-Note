package com.moneynote.budget;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.provider.Telephony;
import android.telephony.SmsMessage;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import org.json.JSONObject;

public class SmsBroadcastReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(intent.getAction())) {
            return;
        }

        SmsMessage[] messages = Telephony.Sms.Intents.getMessagesFromIntent(intent);
        if (messages == null || messages.length == 0) {
            return;
        }

        String sender = "";
        StringBuilder bodyBuilder = new StringBuilder();

        for (SmsMessage message : messages) {
            if (sender.isEmpty() && message.getDisplayOriginatingAddress() != null) {
                sender = message.getDisplayOriginatingAddress();
            }

            if (message.getDisplayMessageBody() != null) {
                bodyBuilder.append(message.getDisplayMessageBody());
            }
        }

        String body = bodyBuilder.toString().trim();
        if (body.isEmpty()) {
            return;
        }

        JSONObject event = SmsInsightHelper.buildEvent(sender, body);
        MainActivity.publishSmsEvent(context, event);
        showNotification(context, event);
    }

    private void showNotification(Context context, JSONObject event) {
        NotificationHelper.ensureChannel(context);

        Intent launchIntent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        PendingIntent pendingIntent = null;

        if (launchIntent != null) {
            launchIntent.putExtra("openSmsInsights", true);
            launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            pendingIntent = PendingIntent.getActivity(
                context,
                event.optString("id", "sms").hashCode(),
                launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
        }

        String status = event.optString("status", "UNKNOWN");
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, NotificationHelper.CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_notify_chat)
            .setContentTitle(event.optString("notificationTitle", "New money SMS"))
            .setContentText(event.optString("notificationBody", "A new transaction message was analyzed."))
            .setStyle(new NotificationCompat.BigTextStyle().bigText(event.optString("body", "")))
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setColor(resolveColor(status));

        if (pendingIntent != null) {
            builder.setContentIntent(pendingIntent);
        }

        NotificationManagerCompat.from(context).notify(event.optString("id", "sms").hashCode(), builder.build());
    }

    private int resolveColor(String status) {
        switch (status) {
            case "VERIFIED":
                return Color.parseColor("#16A34A");
            case "SUSPICIOUS":
                return Color.parseColor("#F59E0B");
            case "FRAUD":
                return Color.parseColor("#DC2626");
            default:
                return Color.parseColor("#3B82F6");
        }
    }
}

package com.moneynote.budget;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.os.Build;

public final class NotificationHelper {

    public static final String CHANNEL_ID = "sms-insights";

    private NotificationHelper() {}

    public static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }

        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) {
            return;
        }

        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "Money Note Alerts",
            NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("Incoming transaction and fraud insights");
        manager.createNotificationChannel(channel);
    }
}

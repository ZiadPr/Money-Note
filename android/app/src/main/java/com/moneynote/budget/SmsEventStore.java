package com.moneynote.budget;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONException;
import org.json.JSONObject;

public final class SmsEventStore {

    private static final String PREFERENCES_NAME = "money_note_sms_monitor";
    private static final String KEY_PENDING_EVENT = "pending_event";

    private SmsEventStore() {}

    public static void storePendingEvent(Context context, JSONObject event) {
        SharedPreferences prefs = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE);
        prefs.edit().putString(KEY_PENDING_EVENT, event.toString()).apply();
    }

    public static JSONObject consumePendingEvent(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE);
        String rawEvent = prefs.getString(KEY_PENDING_EVENT, null);
        if (rawEvent == null || rawEvent.isEmpty()) {
            return null;
        }

        prefs.edit().remove(KEY_PENDING_EVENT).apply();

        try {
            return new JSONObject(rawEvent);
        } catch (JSONException ignored) {
            return null;
        }
    }
}

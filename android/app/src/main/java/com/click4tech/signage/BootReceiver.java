package com.click4tech.signage;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Opens the signage app by itself when the device starts. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        Intent launch = new Intent(context, MainActivity.class);
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            context.startActivity(launch);
        } catch (Exception ignored) {
            // Some Android versions block this until "Display over other apps" is allowed.
        }
    }
}

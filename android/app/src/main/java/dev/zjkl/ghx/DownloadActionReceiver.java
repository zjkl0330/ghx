package dev.zjkl.ghx;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * 通知栏按钮的落点。
 *
 * 只处理「取消」。做成 BroadcastReceiver 而不是 Activity，是因为取消必须在按下的
 * 那一刻生效 —— 先弹个界面再让用户点一次，跟没有这个按钮一样。
 *
 * 「安装」不放这里：安装器本身是 Activity，后台起 Activity 会被 Android 10+ 拦掉，
 * 所以它走 PendingIntent.getActivity 直接进 MainActivity（用户点通知本身就是交互，
 * 属于允许的场景）。
 */
public class DownloadActionReceiver extends BroadcastReceiver {

    static final String ACTION_CANCEL = "dev.zjkl.ghx.action.DL_CANCEL";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        if (ACTION_CANCEL.equals(intent.getAction())) {
            DownloadHub.cancel();
        }
    }
}

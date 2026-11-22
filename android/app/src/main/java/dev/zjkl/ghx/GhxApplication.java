package dev.zjkl.ghx;

import android.app.Application;
import android.content.Context;

/**
 * 进程入口。
 *
 * <p>存在的唯一理由：把崩溃处理器装得足够早。
 *
 * <p>以前装在 MainActivity.onCreate 里，看着挺早，其实漏掉一段：Activity 这个类
 * 本身要经过加载、校验、静态初始化才轮到 onCreate。如果崩溃发生在那之前
 * （例如某个仅高版本存在的类型被解析、某个静态块抛错），处理器根本还没装上，
 * 现场就一个字都留不下 —— 表现就是「闪一下就没了，屏幕空白」。
 *
 * <p>Application.attachBaseContext 是进程里最早能跑自己代码的地方，比 Activity 早一步。
 */
public class GhxApplication extends Application {

    @Override
    protected void attachBaseContext(Context base) {
        super.attachBaseContext(base);
        BootFailure.installCrashSink(this);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        /*
         * 进程一起来就把 Context 交给下载中枢。
         *
         * 页面加载完第一件事就是查下载状态，那时插件可能还在初始化。
         * 这里先装一次，任何时序下 getExternalFilesDir 都不会打在 null 上。
         */
        DownloadHub.install(this);
    }
}

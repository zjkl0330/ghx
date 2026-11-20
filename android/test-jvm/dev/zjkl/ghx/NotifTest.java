package dev.zjkl.ghx;

/**
 * 通知栏文案的测试。不需要模拟器、不需要 Android —— NotifText 是纯函数。
 *
 * 这些看起来是小事，但通知栏是用户唯一能看见下载的地方，一旦显示成
 * 「还剩 1 秒」却卡十分钟、或者文件名被截掉 .apk，观感就是「这 App 坏了」。
 */
public final class NotifTest {

    private static int fails;

    public static void main(String[] args) {
        bytesCases();
        speedCases();
        etaSecondsCases();
        etaCases();
        percentCases();
        shortNameCases();
        oneLineCases();

        System.out.println();
        if (fails > 0) {
            System.out.println(fails + " 项未通过");
            System.exit(1);
        }
        System.out.println("全部通过");
    }

    private static void bytesCases() {
        eq("0 字节", "0 B", NotifText.bytes(0));
        eq("不到 1 KB 直接报字节", "1023 B", NotifText.bytes(1023));
        eq("1 KB", "1.0 KB", NotifText.bytes(1024));
        eq("不到 1 MB", "512.0 KB", NotifText.bytes(512 * 1024L));
        eq("1 MB", "1.0 MB", NotifText.bytes(1024 * 1024L));
        eq("20.3 MB（安装包实际大小）", "20.3 MB", NotifText.bytes(21254452L));
        eq("超过 1 GB 换单位", "2.00 GB", NotifText.bytes(2L * 1024 * 1024 * 1024));
    }

    private static void speedCases() {
        eq("0 不显示小数", "0 KB/s", NotifText.speed(0));
        eq("几百 KB", "512 KB/s", NotifText.speed(512.4));
        eq("超过 1024 换 MB", "2.0 MB/s", NotifText.speed(2048));
    }

    private static void etaSecondsCases() {
        eq("速度还没测出来时不给剩余时间", -1L, NotifText.etaSeconds(100, 1000, 0));
        eq("总长未知不给", -1L, NotifText.etaSeconds(100, 0, 500));
        eq("已经下完不给", -1L, NotifText.etaSeconds(1000, 1000, 500));
        eq("下过头也不给（不能算出负数）", -1L, NotifText.etaSeconds(1200, 1000, 500));
        // 还剩 1 MB，速度 1024 KB/s → 1 秒
        eq("正常估算", 1L, NotifText.etaSeconds(0, 1024 * 1024L, 1024));
        // 还剩 10 MB，速度 100 KB/s → 102.4 秒，向上取整 103
        eq("向上取整，不提前说「好了」", 103L, NotifText.etaSeconds(0, 10L * 1024 * 1024, 100));
        eq("极慢时封顶 24 小时（链路假死会算出几百天）",
                24L * 3600, NotifText.etaSeconds(0, 100L * 1024 * 1024, 0.1));
    }

    private static void etaCases() {
        eq("0 秒", "0 秒", NotifText.eta(0));
        eq("45 秒", "45 秒", NotifText.eta(45));
        eq("整分钟不带秒", "1 分钟", NotifText.eta(60));
        eq("一分半", "1 分 30 秒", NotifText.eta(90));
        eq("整小时不带分", "1 小时", NotifText.eta(3600));
        eq("一小时半", "1 小时 30 分", NotifText.eta(5400));
        eq("负数返回空串（调用方据此不显示）", "", NotifText.eta(-1));
    }

    private static void percentCases() {
        eq("总长为 0 不除零", 0, NotifText.percent(100, 0));
        eq("刚开始", 0, NotifText.percent(0, 1000));
        eq("99.6% 显示 99，不能说 100% 却还在下", 99, NotifText.percent(996, 1000));
        eq("刚好 100", 100, NotifText.percent(1000, 1000));
        eq("下过头封顶 100", 100, NotifText.percent(1200, 1000));
    }

    private static void shortNameCases() {
        eq("短名字原样", "ghx-0.9.2.apk", NotifText.shortName("ghx-0.9.2.apk", 32));
        eq("null 变空串", "", NotifText.shortName(null, 32));

        String longApk = "ghx-0.9.2-debug-with-a-very-long-build-suffix.apk";
        String cut = NotifText.shortName(longApk, 32);
        ok("长名字截断到 32 以内", cut.length() <= 32, cut.length() + " 字符");
        ok("截断后仍以 .apk 结尾", cut.endsWith(".apk"), cut);
        ok("截断处有省略号", cut.contains("…"), cut);

        String noExt = "averyveryverylongfilenamewithoutanyextension";
        String cut2 = NotifText.shortName(noExt, 20);
        ok("没有扩展名也能截", cut2.length() <= 20 && cut2.endsWith("…"), cut2);

        // 扩展名超过 7 个字符就不当扩展名，否则会把整条文件名都让给它
        String weird = "some-really-long-name.brandnewextension";
        String cut3 = NotifText.shortName(weird, 24);
        ok("超长扩展名按无扩展名处理", cut3.length() <= 24 && !cut3.endsWith("brandnewextension"), cut3);
    }

    private static void oneLineCases() {
        eq("换行被抹平（通知里换行会被吃掉）", "a b", NotifText.oneLine("a\nb", 40));
        eq("null 给一句人话", "下载失败", NotifText.oneLine(null, 40));
        eq("空串也给一句人话", "下载失败", NotifText.oneLine("   ", 40));

        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 60; i += 1) sb.append('错');
        String long1 = NotifText.oneLine(sb.toString(), 20);
        ok("超长原因被截断", long1.length() <= 20 && long1.endsWith("…"), long1);
    }

    /* ---------------- 断言 ---------------- */

    private static void eq(String name, Object want, Object got) {
        boolean same = want == null ? got == null : want.equals(got);
        ok(name, same, "期望 " + want + " / 实际 " + got);
    }

    private static void ok(String name, boolean cond, String detail) {
        if (cond) {
            System.out.println("[PASS] " + name);
        } else {
            fails += 1;
            System.out.println("[FAIL] " + name + (detail.isEmpty() ? "" : " · " + detail));
        }
    }
}

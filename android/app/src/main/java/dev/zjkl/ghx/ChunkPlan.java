package dev.zjkl.ghx;

/**
 * 分片规划。**纯计算，不碰网络也不碰文件** —— 这样能在普通 JVM 上跑真值表，
 * 不必为「总长 21 MB 该怎么切」去求一台安卓机。
 *
 * 两条边界：
 *
 *  - 太小的包不值得切。每片至少 {@link #MIN_PART}（256 KiB），否则 300 KB 的 zip
 *    会被切成几十段，多出来的是几十次建连与 TLS 握手；
 *  - 片数有上限。部分 CDN 会把「同 IP 同时开几十条连接」判成异常流量，所以
 *    {@link #MAX_PARTS} 卡在 32：这是用户能选的最高档，实际片数还要被总长与
 *    MIN_PART 再夹一次（21 MB 的包最多切 32 片，每片约 650 KB）。
 */
final class ChunkPlan {

    /** 硬上限：界面最高档就是 32 路，再高容易被判异常流量 */
    static final int MAX_PARTS = 32;

    /** 单片最小长度：256 KiB。低于这个长度，建连开销比并行省下的时间还多 */
    static final long MIN_PART = 256L * 1024;

    private ChunkPlan() {}

    /**
     * 该切几片。总长未知（<=0）、只给一路、或包太小都返回 1。
     */
    static int partsFor(long total, int want, long minPart) {
        if (total <= 0 || want <= 1 || minPart <= 0) return 1;
        long byMin = (total + minPart - 1) / minPart;
        if (byMin <= 1) return 1;
        long n = Math.min(byMin, Math.min(want, MAX_PARTS));
        return (int) Math.max(1, Math.min(n, total));
    }

    /**
     * 把 [0, total-1] 切成 parts 段闭区间，首尾相接、不重不漏。
     *
     * 余数摊给前几片（每片多 1 字节），保证每段长度只差 1，不会出现「最后一片
     * 只有一个字节」这种让进度条跳变的结果。
     */
    static long[][] ranges(long total, int parts) {
        if (total <= 0) return new long[0][];
        int n = (int) Math.min(Math.max(parts, 1), total);
        if (n == 1) return new long[][] {{0, total - 1}};

        long base = total / n;
        long rest = total % n;
        long[][] out = new long[n][];
        long at = 0;
        for (int i = 0; i < n; i += 1) {
            long len = base + (i < rest ? 1 : 0);
            out[i] = new long[] {at, at + len - 1};
            at += len;
        }
        return out;
    }

    /** 从 `Content-Range: bytes 0-1023/21253906` 里取总长；`*` 或畸形返回 -1 */
    static long totalFromContentRange(String raw) {
        if (raw == null) return -1L;
        int slash = raw.lastIndexOf('/');
        if (slash < 0 || slash == raw.length() - 1) return -1L;
        String tail = raw.substring(slash + 1).trim();
        if (tail.isEmpty() || "*".equals(tail)) return -1L;
        try {
            long v = Long.parseLong(tail);
            return v > 0 ? v : -1L;
        } catch (NumberFormatException e) {
            return -1L;
        }
    }

    /** 从 `Content-Range: bytes 0-1023/…` 里取起始偏移；畸形返回 -1 */
    static long startFromContentRange(String raw) {
        if (raw == null) return -1L;
        int space = raw.indexOf(' ');
        if (space < 0) return -1L;
        String body = raw.substring(space + 1);
        int dash = body.indexOf('-');
        if (dash <= 0) return -1L;
        try {
            long v = Long.parseLong(body.substring(0, dash).trim());
            return v >= 0 ? v : -1L;
        } catch (NumberFormatException e) {
            return -1L;
        }
    }
}

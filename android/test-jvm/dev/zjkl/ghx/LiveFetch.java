package dev.zjkl.ghx;

import java.io.File;
import java.util.concurrent.atomic.AtomicLong;

/**
 * 真网络跑一次分片下载，用来证明「本地服务能过、线上线路也能过」。
 *
 * 用法：
 *   java -cp <classes> dev.zjkl.ghx.LiveFetch <url> <输出文件> [片数]
 *
 * 落盘后自己算 md5，与发布包比对 —— 只看「下完了」是不够的，分片最典型的
 * 事故是各线程写错偏移，文件长度对但内容不对。
 */
public final class LiveFetch {

    public static void main(String[] args) throws Exception {
        String url = args[0];
        File out = new File(args[1]);
        int want = args.length > 2 ? Integer.parseInt(args[2]) : 4;

        final AtomicLong last = new AtomicLong();
        final long[] lastAt = {System.currentTimeMillis()};
        final int[] seenParts = {0};

        long t0 = System.currentTimeMillis();
        ChunkedFetch.Outcome o = ChunkedFetch.fetch(
                url, null, out, 0, "ghx-live", want,
                new ChunkedFetch.Progress() {
                    @Override
                    public void onBytes(long done, long total, double kbps, int parts) {
                        last.set(done);
                        seenParts[0] = parts;
                        long now = System.currentTimeMillis();
                        if (now - lastAt[0] >= 500 || done >= total) {
                            lastAt[0] = now;
                            System.out.printf("  %5.1f%%  %s  %d 路  %.0f KB/s%n",
                                    total > 0 ? done * 100.0 / total : 0,
                                    mb(done) + (total > 0 ? " / " + mb(total) : ""),
                                    parts, kbps);
                        }
                    }
                },
                new ChunkedFetch.Cancel() {
                    @Override
                    public boolean cancelled() {
                        return false;
                    }
                });

        long ms = System.currentTimeMillis() - t0;
        System.out.printf("完成：%d 字节 · %d 路 · 分片=%s · %.1f s · 平均 %.0f KB/s%n",
                o.bytes, o.parts, o.chunked, ms / 1000.0, o.bytes / 1024.0 / (ms / 1000.0));
        System.out.println("md5=" + md5(out));
    }

    private static String mb(long v) {
        return String.format("%.1f MB", v / 1048576.0);
    }

    private static String md5(File f) throws Exception {
        java.security.MessageDigest md = java.security.MessageDigest.getInstance("MD5");
        try (java.io.InputStream in = new java.io.BufferedInputStream(new java.io.FileInputStream(f))) {
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) md.update(buf, 0, n);
        }
        StringBuilder sb = new StringBuilder();
        for (byte b : md.digest()) sb.append(String.format("%02x", b));
        return sb.toString();
    }
}

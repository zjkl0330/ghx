package dev.zjkl.ghx;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Arrays;

/**
 * 断点续传的进度账本。**纯 Java，不 import android.*** ——
 * 这样能在普通 JVM 上对着本地 HTTP 服务真跑「下一半 → 掐断 → 接着下」。
 *
 * 为什么不用文件长度当进度：分片下载会先把文件 setLength(total) 预占空间，
 * 长度从头到尾都等于总长，看不出下到哪。所以每片单独记「写到第几个字节」，
 * 恢复时从那里接着写。
 *
 * 存放在 part 文件旁边（`xxx.apk.part.resume`），纯文本、逐行 key=value：
 *
 * <pre>
 * v=1
 * total=21253906
 * parts=8
 * at=1763000000000
 * pos=1048576,2097152,0,0,0,0,0,0
 * </pre>
 *
 * 判定续传是否可用的三条：总长一致、片数一致、每片位置不越界。
 * 文件被清掉、账本被写坏、换了另一个包（总长不同）都当「没有账本」，
 * 从头下 —— 宁可多花流量，也不能把两半不同的文件拼在一起。
 */
final class ResumeState {

    static final int VERSION = 1;

    final long total;
    final int parts;
    /** 每片已写字节数（相对该片起点，不是绝对偏移） */
    final long[] pos;
    final long at;

    ResumeState(long total, int parts, long[] pos, long at) {
        this.total = total;
        this.parts = parts;
        this.pos = pos;
        this.at = at;
    }

    /** 账本文件：与 part 同目录同名，后缀再加 .resume */
    static File sidecar(File part) {
        if (part == null) return null;
        return new File(part.getParentFile(), part.getName() + ".resume");
    }

    static boolean exists(File part) {
        File f = sidecar(part);
        return f != null && f.exists() && f.length() > 0;
    }

    /**
     * 读账本。任何一项对不上都返回 null（调用方据此从头下）。
     *
     * @param total 本次探针拿到的总长；<=0 表示未知，不能续
     * @param parts 本次规划的片数
     */
    static ResumeState load(File part, long total, int parts) {
        if (part == null || total <= 0 || parts <= 0) return null;
        if (!part.exists() || part.length() <= 0) return null;
        File f = sidecar(part);
        if (f == null || !f.exists()) return null;

        long gotTotal = -1;
        int gotParts = -1;
        long[] gotPos = null;
        try (InputStream in = new FileInputStream(f)) {
            byte[] buf = new byte[(int) Math.min(f.length(), 8192)];
            int n = in.read(buf);
            if (n <= 0) return null;
            String[] lines = new String(buf, 0, n, "UTF-8").split("\n");
            for (String line : lines) {
                int eq = line.indexOf('=');
                if (eq <= 0) continue;
                String k = line.substring(0, eq).trim();
                String v = line.substring(eq + 1).trim();
                if ("total".equals(k)) gotTotal = parseLong(v, -1);
                else if ("parts".equals(k)) gotParts = (int) parseLong(v, -1);
                else if ("pos".equals(k)) gotPos = parsePos(v);
            }
        } catch (Exception e) {
            return null;
        }

        if (gotTotal != total || gotParts != parts || gotPos == null) return null;
        if (gotPos.length != parts) return null;

        // 每片位置必须落在自己的长度范围内；越界说明账本与文件不是一对
        long[][] ranges = ChunkPlan.ranges(total, parts);
        if (ranges.length != parts) return null;
        for (int i = 0; i < parts; i += 1) {
            long len = ranges[i][1] - ranges[i][0] + 1;
            if (gotPos[i] < 0 || gotPos[i] > len) return null;
        }
        // 全部完成时没有续传的意义，交给上层走正常完成分支
        long sum = 0;
        for (long p : gotPos) sum += p;
        if (sum <= 0) return null;
        return new ResumeState(total, parts, gotPos, System.currentTimeMillis());
    }

    /** 已写总量：给界面显示「上次下到 42%」 */
    static long doneOf(File part) {
        if (part == null || !part.exists()) return 0;
        File f = sidecar(part);
        if (f == null || !f.exists()) return 0;
        long sum = 0;
        try (InputStream in = new FileInputStream(f)) {
            byte[] buf = new byte[(int) Math.min(f.length(), 8192)];
            int n = in.read(buf);
            if (n <= 0) return 0;
            for (String line : new String(buf, 0, n, "UTF-8").split("\n")) {
                int eq = line.indexOf('=');
                if (eq <= 0) continue;
                if (!"pos".equals(line.substring(0, eq).trim())) continue;
                long[] got = parsePos(line.substring(eq + 1).trim());
                if (got == null) return 0;
                for (long p : got) sum += p;
            }
        } catch (Exception e) {
            return 0;
        }
        return sum;
    }

    /** 保存。先写临时文件再改名，避免写到一半断电留下半行 JSON。 */
    void save(File part) {
        File f = sidecar(part);
        if (f == null) return;
        File tmp = new File(f.getAbsolutePath() + ".tmp");
        StringBuilder sb = new StringBuilder(160);
        sb.append("v=").append(VERSION).append('\n');
        sb.append("total=").append(total).append('\n');
        sb.append("parts=").append(parts).append('\n');
        sb.append("at=").append(at).append('\n');
        sb.append("pos=");
        for (int i = 0; i < pos.length; i += 1) {
            if (i > 0) sb.append(',');
            sb.append(pos[i]);
        }
        sb.append('\n');
        try (FileOutputStream out = new FileOutputStream(tmp, false)) {
            out.write(sb.toString().getBytes("UTF-8"));
            out.flush();
            out.getFD().sync();
        } catch (IOException e) {
            // 写不进去就下次重来，不影响正在跑的下载
            //noinspection ResultOfMethodCallIgnored
            tmp.delete();
            return;
        }
        // renameTo 在部分分区上会失败（目标已存在），先删再改
        //noinspection ResultOfMethodCallIgnored
        f.delete();
        if (!tmp.renameTo(f)) {
            //noinspection ResultOfMethodCallIgnored
            tmp.delete();
        }
    }

    static void clear(File part) {
        File f = sidecar(part);
        if (f != null) {
            //noinspection ResultOfMethodCallIgnored
            f.delete();
        }
    }

    /** 记一份「全是 0」的初始账本，取消在探针之后也能续 */
    static ResumeState zeros(long total, int parts) {
        return new ResumeState(total, parts, new long[Math.max(1, parts)], System.currentTimeMillis());
    }

    static long[] copy(long[] src) {
        return src == null ? new long[0] : Arrays.copyOf(src, src.length);
    }

    private static long parseLong(String s, long fallback) {
        try {
            return Long.parseLong(s.trim());
        } catch (Exception e) {
            return fallback;
        }
    }

    private static long[] parsePos(String raw) {
        if (raw == null || raw.isEmpty()) return null;
        String[] parts = raw.split(",");
        long[] out = new long[parts.length];
        for (int i = 0; i < parts.length; i += 1) {
            try {
                out[i] = Long.parseLong(parts[i].trim());
            } catch (NumberFormatException e) {
                return null;
            }
            if (out[i] < 0) return null;
        }
        return out;
    }
}

package dev.zjkl.ghx;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.RandomAccessFile;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;

/**
 * 分片下载本体。**故意不 import 任何 android.*** —— 这样同一份代码能在普通 JVM 上
 * 对着本地 HTTP 服务跑集成测试（见 scripts/test-chunked.sh），而不是只能装到手机上赌。
 *
 * 为什么值得做分片：GitHub 的 release 资产单连接常被压到几百 KB/s，而限制通常在
 * 单条 TCP 连接的窗口而不是总带宽，多开几条连接能吃满。但这条路有三个坑，代码里
 * 逐条堵：
 *
 *  1. **必须确认服务器真的认 Range。** 有些反代对 `Range` 视而不见，直接回 200 全文。
 *     这种线路如果按分片写文件，各线程的字节会互相覆盖，出来是个花文件。所以先发
 *     一个 2 字节的探针，只有拿到 `206` + `Content-Range` 才敢分片。
 *  2. **重定向会丢 Range。** GitHub 会 302 到签名地址，跟随重定向时自定义头不一定
 *     被带过去；每一跳都重设 Range 才稳。
 *  3. **压缩会错位。** 若中间层对响应做 gzip，Range 算的是压缩后字节、我们写到文件
 *     的是解压后字节，偏移全错。显式 `Accept-Encoding: identity` 关掉。
 *
 * 分片失败一律降级：删掉半截文件，改用单连接从头下。分片只是「更快」，
 * 不该让原本能下的包变成下不了。
 */
final class ChunkedFetch {

    interface Progress {
        /**
         * @param done  已写字节
         * @param total 总长，0 表示服务器没给
         * @param kbps  瞬时速度 KB/s
         * @param parts 本次实际并发数，1 表示单连接
         */
        void onBytes(long done, long total, double kbps, int parts);
    }

    interface Cancel {
        boolean cancelled();
    }

    static final class Outcome {
        long bytes;
        int parts;
        boolean chunked;
    }

    /** 用户取消，与「网络失败」必须分开：前者不该触发降级重下 */
    static final class Cancelled extends IOException {
        Cancelled() {
            super("已取消");
        }
    }

    /** 分片阶段失败，带上已经下到的量，用来判断值不值得重下 */
    private static final class Partial extends IOException {
        final long done;

        Partial(String msg, long done) {
            super(msg);
            this.done = done;
        }
    }

    private static final int BUF = 64 * 1024;
    /** 每片最多试两次：第一次失败多半是连接抖动，换条连接往往就过了 */
    private static final int PART_ATTEMPTS = 2;
    private static final int MAX_HOPS = 5;

    private static final Set<HttpURLConnection> LIVE =
            Collections.newSetFromMap(new ConcurrentHashMap<HttpURLConnection, Boolean>());
    private static final AtomicBoolean ABORT = new AtomicBoolean(false);

    private ChunkedFetch() {}

    /** 掐断所有在途连接。取消按钮与「换线路」都会走到这里 */
    static void abortAll() {
        ABORT.set(true);
        for (HttpURLConnection c : LIVE) {
            try {
                c.disconnect();
            } catch (Exception ignored) {
                // 断开失败无所谓，读循环下一轮会看到 ABORT 并退出
            }
        }
        LIVE.clear();
    }

    private static void resetAbort() {
        ABORT.set(false);
    }

    /**
     * 下载到 part。成功时 part 是完整文件，调用方负责改名。
     *
     * @param wantParts 期望并发数，1 表示不切片；实际片数由总长与 {@link ChunkPlan} 决定
     */
    static Outcome fetch(String url, Map<String, String> headers, File part, long expect,
                         String ua, int wantParts, Progress cb, Cancel cancel) throws IOException {
        resetAbort();
        Probe p = probe(url, headers, ua, cancel);
        long total = p.total > 0 ? p.total : Math.max(0, expect);
        int parts = ChunkPlan.partsFor(total, wantParts, ChunkPlan.MIN_PART);

        if (p.ranged && parts > 1 && total > 0) {
            try {
                return chunked(p, total, parts, part, ua, cb, cancel);
            } catch (Cancelled c) {
                throw c;
            } catch (Partial pf) {
                // 已经下了大半就别重来 —— 重下的流量比省下的时间贵
                if (pf.done >= total / 2) throw pf;
                deleteQuietly(part);
            } catch (IOException e) {
                if (cancel.cancelled() || ABORT.get()) throw new Cancelled();
                deleteQuietly(part);
            }
        }
        return single(p, total, part, ua, cb, cancel);
    }

    /* ---------------- 探针 ---------------- */

    private static final class Probe {
        final String url;
        final long total;
        final boolean ranged;
        final int code;

        Probe(String url, long total, boolean ranged, int code) {
            this.url = url;
            this.total = total;
            this.ranged = ranged;
            this.code = code;
        }
    }

    /**
     * 要 2 个字节，看回的是 206 还是 200。
     *
     * 不用 `bytes=0-0`：个别反代把零长度区间当非法请求直接回 416。
     */
    private static Probe probe(String url, Map<String, String> headers, String ua, Cancel cancel)
            throws IOException {
        Opened o = openAt(url, headers, 0, 1, ua, cancel);
        try {
            String cr = o.conn.getHeaderField("Content-Range");
            long total = ChunkPlan.totalFromContentRange(cr);
            if (o.code == 206 && total > 0) return new Probe(o.url, total, true, o.code);
            if (o.code == 200) {
                return new Probe(o.url, lengthOf(o.conn), false, o.code);
            }
            if (o.code == 416 && total > 0) {
                // 服务器嫌区间非法，但至少告诉了我们总长：当作不支持分段
                return new Probe(o.url, total, false, o.code);
            }
            throw new IOException("HTTP " + o.code);
        } finally {
            closeQuietly(o);
        }
    }

    /* ---------------- 单连接 ---------------- */

    private static Outcome single(Probe p, long total, File part, String ua, Progress cb, Cancel cancel)
            throws IOException {
        Opened o = openAt(p.url, null, -1, -1, ua, cancel);
        InputStream in = null;
        FileOutputStream fos = null;
        long done = 0;
        Meter meter = new Meter();
        try {
            if (o.code != 200 && o.code != 206) throw new IOException("HTTP " + o.code);
            long declared = lengthOf(o.conn);
            if (declared > 0) total = declared;

            in = new BufferedInputStream(o.conn.getInputStream(), BUF);
            fos = new FileOutputStream(part);
            byte[] buf = new byte[BUF];
            int n;
            long lastEmit = 0;
            while ((n = in.read(buf)) > 0) {
                if (cancel.cancelled() || ABORT.get()) throw new Cancelled();
                fos.write(buf, 0, n);
                done += n;
                long now = System.currentTimeMillis();
                if (now - lastEmit >= 200) {
                    cb.onBytes(done, total, meter.tick(done), 1);
                    lastEmit = now;
                }
            }
            fos.flush();
            if (done <= 0) throw new IOException("下载到 0 字节");
            if (total > 0 && done != total) {
                throw new IOException("只下到 " + done + " / " + total + " 字节");
            }
            cb.onBytes(done, total, meter.tick(done), 1);
            Outcome r = new Outcome();
            r.bytes = done;
            r.parts = 1;
            r.chunked = false;
            return r;
        } finally {
            closeQuietly(fos);
            closeQuietly(in);
            closeQuietly(o);
        }
    }

    /* ---------------- 分片 ---------------- */

    private static Outcome chunked(Probe p, long total, int parts, File part, String ua,
                                   Progress cb, Cancel cancel) throws IOException {
        final long[][] ranges = ChunkPlan.ranges(total, parts);
        final AtomicLong done = new AtomicLong(0);

        RandomAccessFile raf = null;
        FileChannel ch = null;
        ExecutorService pool = null;
        try {
            raf = new RandomAccessFile(part, "rw");
            // 预分配：让「空间不够」在开始时就暴露，而不是下到 90% 才报错；
            // 也避免各片交替写把文件写成分散块。
            raf.setLength(total);
            ch = raf.getChannel();

            pool = Executors.newFixedThreadPool(ranges.length, new ThreadFactory() {
                private int seq = 0;

                @Override
                public synchronized Thread newThread(Runnable r) {
                    Thread t = new Thread(r, "ghx-part-" + (seq += 1));
                    t.setDaemon(true);
                    return t;
                }
            });

            final FileChannel fch = ch;
            final String fua = ua;
            List<Future<?>> futures = new ArrayList<>();
            for (final long[] r : ranges) {
                futures.add(pool.submit(new Runnable() {
                    @Override
                    public void run() {
                        try {
                            pull(fch, p.url, r[0], r[1], done, fua, cancel);
                        } catch (IOException e) {
                            throw new RuntimeException(e);
                        }
                    }
                }));
            }

            pool.shutdown();
            Meter meter = new Meter();
            long lastEmit = 0;
            while (true) {
                boolean settled;
                try {
                    settled = pool.awaitTermination(150, TimeUnit.MILLISECONDS);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    pool.shutdownNow();
                    throw new IOException("下载被中断");
                }
                if (settled) break;
                if (cancel.cancelled() || ABORT.get()) {
                    pool.shutdownNow();
                    abortAll();
                    throw new Cancelled();
                }
                long now = System.currentTimeMillis();
                if (now - lastEmit >= 150) {
                    long d = Math.min(done.get(), total);
                    cb.onBytes(d, total, meter.tick(d), ranges.length);
                    lastEmit = now;
                }
            }
            // 收尾：把已完成的量补报一次，界面不会停在 97%
            for (Future<?> f : futures) {
                try {
                    f.get();
                } catch (ExecutionException ee) {
                    Throwable cause = ee.getCause();
                    if (cause instanceof RuntimeException && cause.getCause() instanceof IOException) {
                        throw (IOException) cause.getCause();
                    }
                    throw new IOException(cause == null ? "分片失败" : cause.toString());
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    throw new IOException("下载被中断");
                }
            }

            long got = done.get();
            if (got != total) throw new Partial("只下到 " + got + " / " + total + " 字节", got);
            ch.truncate(total);
            ch.force(false);
            cb.onBytes(total, total, meter.tick(total), ranges.length);

            Outcome r = new Outcome();
            r.bytes = got;
            r.parts = ranges.length;
            r.chunked = true;
            return r;
        } finally {
            if (pool != null) pool.shutdownNow();
            closeQuietly(ch);
            closeQuietly(raf);
        }
    }

    /** 拉一片。落盘用 positional write：多线程各自定位，不需要锁 */
    private static void pull(FileChannel ch, String url, long start, long end, AtomicLong done,
                             String ua, Cancel cancel) throws IOException {
        IOException last = null;
        long wrote = 0;
        for (int attempt = 1; attempt <= PART_ATTEMPTS; attempt += 1) {
            if (cancel.cancelled() || ABORT.get()) throw new Cancelled();
            Opened o = null;
            InputStream in = null;
            try {
                o = openAt(url, null, start, end, ua, cancel);
                if (o.code == 200) throw new Partial("线路不支持分段", done.get());
                if (o.code != 206) throw new IOException("HTTP " + o.code);

                long cs = ChunkPlan.startFromContentRange(o.conn.getHeaderField("Content-Range"));
                if (cs >= 0 && cs != start) throw new Partial("分段起点错位", done.get());

                in = new BufferedInputStream(o.conn.getInputStream(), BUF);
                byte[] buf = new byte[BUF];
                long pos = start;
                int n;
                while ((n = in.read(buf)) > 0) {
                    if (cancel.cancelled() || ABORT.get()) throw new Cancelled();
                    ByteBuffer bb = ByteBuffer.wrap(buf, 0, n);
                    while (bb.hasRemaining()) {
                        int written = ch.write(bb, pos);
                        if (written <= 0) throw new IOException("写入没有进展");
                        pos += written;
                    }
                    wrote += n;
                    done.addAndGet(n);
                    if (pos > end + 1) throw new IOException("线路返回的长度超出分段");
                }
                if (pos != end + 1) {
                    throw new Partial("分段只收到 " + (pos - start) + " / " + (end - start + 1) + " 字节",
                            done.get());
                }
                return;
            } catch (Cancelled c) {
                throw c;
            } catch (Partial pf) {
                throw pf;
            } catch (IOException e) {
                last = e;
                // 重试会从 start 重新写，先把这一轮记进 done 的字节退回去，
                // 否则第二遍会让进度条冲过 100%、末了校验必然失败。
                if (wrote > 0) {
                    done.addAndGet(-wrote);
                    wrote = 0;
                }
            } finally {
                closeQuietly(in);
                closeQuietly(o);
            }
        }
        throw last == null ? new IOException("分段失败") : last;
    }

    /* ---------------- 连接与工具 ---------------- */

    private static final class Opened {
        final HttpURLConnection conn;
        final String url;
        final int code;

        Opened(HttpURLConnection conn, String url, int code) {
            this.conn = conn;
            this.url = url;
            this.code = code;
        }
    }

    /**
     * 建连并手动跟随重定向。
     *
     * `start < 0` 表示不带 Range。重定向之后不再带调用方的 header（Authorization
     * 不该被带到签名地址那个域上），但 Range 每一跳都要重设。
     */
    private static Opened openAt(String url, Map<String, String> headers, long start, long end,
                                 String ua, Cancel cancel) throws IOException {
        String at = url;
        for (int hop = 0; hop <= MAX_HOPS; hop += 1) {
            if (cancel != null && cancel.cancelled()) throw new Cancelled();
            HttpURLConnection c = (HttpURLConnection) new URL(at).openConnection();
            LIVE.add(c);
            try {
                c.setInstanceFollowRedirects(false);
                c.setConnectTimeout(15000);
                c.setReadTimeout(30000);
                c.setRequestProperty("User-Agent", ua);
                c.setRequestProperty("Accept", "*/*");
                // 必须显式关掉压缩：否则 Range 按压缩后字节算、写入按解压后字节算
                c.setRequestProperty("Accept-Encoding", "identity");
                if (start >= 0) {
                    c.setRequestProperty("Range", "bytes=" + start + "-" + (end >= 0 ? end : ""));
                }
                if (hop == 0 && headers != null) {
                    for (Map.Entry<String, String> e : headers.entrySet()) {
                        c.setRequestProperty(e.getKey(), e.getValue());
                    }
                }
                int code = c.getResponseCode();
                if (isRedirect(code)) {
                    String loc = c.getHeaderField("Location");
                    if (loc == null || loc.trim().isEmpty()) {
                        throw new IOException("HTTP " + code + " 没有 Location");
                    }
                    at = new URL(new URL(at), loc).toString();
                    LIVE.remove(c);
                    try {
                        c.disconnect();
                    } catch (Exception ignored) {
                        // 已经要换下一跳了
                    }
                    continue;
                }
                return new Opened(c, at, code);
            } catch (IOException e) {
                LIVE.remove(c);
                try {
                    c.disconnect();
                } catch (Exception ignored) {
                    // 建连就失败了，断开也算尽力
                }
                throw e;
            }
        }
        throw new IOException("重定向次数过多");
    }

    private static boolean isRedirect(int code) {
        return code == 301 || code == 302 || code == 303 || code == 307 || code == 308;
    }

    private static long lengthOf(HttpURLConnection c) {
        String raw = c.getHeaderField("Content-Length");
        if (raw == null) return -1L;
        try {
            long v = Long.parseLong(raw.trim());
            return v > 0 ? v : -1L;
        } catch (NumberFormatException e) {
            return -1L;
        }
    }

    private static void closeQuietly(Opened o) {
        if (o == null) return;
        LIVE.remove(o.conn);
        try {
            o.conn.disconnect();
        } catch (Exception ignored) {
            // 收尾失败不覆盖主异常
        }
    }

    private static void closeQuietly(java.io.Closeable c) {
        if (c == null) return;
        try {
            c.close();
        } catch (Exception ignored) {
            // 同上
        }
    }

    private static void deleteQuietly(File f) {
        if (f != null && f.exists()) {
            //noinspection ResultOfMethodCallIgnored
            f.delete();
        }
    }

    /** 速度表：按两次采样之间的增量算，和界面上的 KB/s 同一口径 */
    private static final class Meter {
        private long lastBytes;
        private long lastAt = System.currentTimeMillis();

        double tick(long done) {
            long now = System.currentTimeMillis();
            long dt = Math.max(1, now - lastAt);
            double kb = (done - lastBytes) / 1024.0;
            lastBytes = done;
            lastAt = now;
            return Math.round(kb / (dt / 1000.0) * 10) / 10.0;
        }
    }
}

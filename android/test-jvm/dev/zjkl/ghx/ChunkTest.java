package dev.zjkl.ghx;

import com.sun.net.httpserver.Headers;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;

import java.io.File;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.Random;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

/**
 * 分片下载的真实集成测试。**不装模拟器、不需要 Android**：ChunkedFetch 与 ChunkPlan
 * 都不依赖 android.*，所以可以直接在 JVM 上对着本地 HTTP 服务跑。
 *
 * 覆盖六件事，每条都是真跑出来的：
 *
 *  1. 分片规划的真值表（含非整除、超小包、总长未知）；
 *  2. 服务器支持 Range → 走分片，落盘字节与源文件 md5 一致；
 *  3. 服务器无视 Range（回 200）→ 必须降级单连接，且文件仍然正确；
 *  4. 302 到签名地址 → 每一跳都要重设 Range，否则拿到的是全文；
 *  5. 并发是真的：服务器侧统计同时在处理的最大请求数；
 *  6. 取消能及时停下；某片偶发 503 会重试一次而不是整单失败。
 */
public final class ChunkTest {

    private static int fails;
    private static byte[] data;
    private static String md5;
    private static HttpServer srv;
    private static ExecutorService serverPool;
    private static String base;
    private static final AtomicInteger inflight = new AtomicInteger();
    private static final AtomicInteger peak = new AtomicInteger();
    private static final AtomicInteger flakyHits = new AtomicInteger();

    public static void main(String[] args) throws Exception {
        data = new byte[6 * 1024 * 1024 + 12345];
        new Random(42).nextBytes(data);
        md5 = md5Of(data);

        startServer();
        try {
            planTests();
            chunkedHappyPath();
            noRangeFallsBack();
            redirectKeepsRange();
            concurrencyIsReal();
            cancelStops();
            flakyRetries();
        } finally {
            srv.stop(0);
            serverPool.shutdownNow();
        }
        System.out.println(fails == 0 ? "\nALL PASS" : "\n" + fails + " FAILED");
        if (fails > 0) System.exit(1);
    }

    /* ---------------- 1. 规划 ---------------- */

    private static void planTests() {
        ok("21 MB、要 4 路 → 4 片", ChunkPlan.partsFor(21253906L, 4, ChunkPlan.MIN_PART) == 4, "");
        ok("300 KB 的包不切", ChunkPlan.partsFor(300 * 1024L, 4, ChunkPlan.MIN_PART) == 1, "");
        ok("总长未知不切", ChunkPlan.partsFor(0, 4, ChunkPlan.MIN_PART) == 1, "");
        ok("只要 1 路时不切", ChunkPlan.partsFor(21253906L, 1, ChunkPlan.MIN_PART) == 1, "");
        ok("要 99 路也封顶 4", ChunkPlan.partsFor(21253906L, 99, ChunkPlan.MIN_PART) == 4, "");

        long[][] r = ChunkPlan.ranges(21253906L, 4);
        long sum = 0;
        boolean seamless = true;
        for (int i = 0; i < r.length; i += 1) {
            if (i > 0 && r[i][0] != r[i - 1][1] + 1) seamless = false;
            sum += r[i][1] - r[i][0] + 1;
        }
        ok("四段首尾相接、合计等于总长", seamless && sum == 21253906L && r[3][1] == 21253906L - 1,
                "sum=" + sum);
        ok("分段长度只差 1 字节",
                Math.abs((r[0][1] - r[0][0]) - (r[3][1] - r[3][0])) <= 1, "");

        long[][] one = ChunkPlan.ranges(1024, 1);
        ok("一路时是整段", one.length == 1 && one[0][0] == 0 && one[0][1] == 1023, "");
        ok("总长 0 返回空", ChunkPlan.ranges(0, 4).length == 0, "");
        ok("3 字节切成 4 路时按字节数封顶", ChunkPlan.ranges(3, 4).length == 3, "");

        ok("Content-Range 取总长",
                ChunkPlan.totalFromContentRange("bytes 0-1023/21253906") == 21253906L, "");
        ok("Content-Range 是 * 时不瞎猜",
                ChunkPlan.totalFromContentRange("bytes 0-1023/*") == -1L, "");
        ok("Content-Range 畸形不抛异常",
                ChunkPlan.totalFromContentRange("garbage") == -1L, "");
        ok("Content-Range 取起点", ChunkPlan.startFromContentRange("bytes 5242880-6291455/21253906") == 5242880L,
                "");
    }

    /* ---------------- 2. 正常分片 ---------------- */

    private static void chunkedHappyPath() throws Exception {
        File part = tempPart();
        Rec rec = new Rec();
        ChunkedFetch.Outcome o = ChunkedFetch.fetch(base + "/range", null, part, 0, "ghx-test", 4, rec, never());
        ok("支持 Range 时走分片", o.chunked && o.parts == 4, "parts=" + o.parts);
        ok("分片结果字节数正确", o.bytes == data.length, o.bytes + " vs " + data.length);
        ok("分片落盘 md5 与源一致", md5.equals(md5Of(Files.readAllBytes(part.toPath()))), "");
        ok("进度最终到 100%", rec.lastDone == data.length && rec.lastTotal == data.length,
                rec.lastDone + "/" + rec.lastTotal);
        ok("进度单调不减", rec.monotonic, "");
        part.delete();
    }

    /* ---------------- 3. 不支持 Range ---------------- */

    private static void noRangeFallsBack() throws Exception {
        File part = tempPart();
        Rec rec = new Rec();
        ChunkedFetch.Outcome o = ChunkedFetch.fetch(base + "/norange", null, part, 0, "ghx-test", 4, rec, never());
        ok("服务器无视 Range 时降级单连接", !o.chunked && o.parts == 1, "parts=" + o.parts);
        ok("降级后文件照样完整", md5.equals(md5Of(Files.readAllBytes(part.toPath()))), "");
        part.delete();
    }

    /* ---------------- 4. 重定向 ---------------- */

    private static void redirectKeepsRange() throws Exception {
        File part = tempPart();
        Rec rec = new Rec();
        ChunkedFetch.Outcome o = ChunkedFetch.fetch(base + "/redirect", null, part, 0, "ghx-test", 4, rec, never());
        ok("302 之后仍然分片（Range 没被丢掉）", o.chunked && o.parts == 4, "parts=" + o.parts);
        ok("302 之后文件字节正确", md5.equals(md5Of(Files.readAllBytes(part.toPath()))), "");
        part.delete();
    }

    /* ---------------- 5. 并发是不是真的 ---------------- */

    private static void concurrencyIsReal() throws Exception {
        peak.set(0);
        File part = tempPart();
        Rec rec = new Rec();
        long t0 = System.currentTimeMillis();
        ChunkedFetch.Outcome o = ChunkedFetch.fetch(base + "/slowrange", null, part, 0, "ghx-test", 4, rec, never());
        long ms4 = System.currentTimeMillis() - t0;
        int p4 = peak.get();
        part.delete();

        File part1 = tempPart();
        Rec rec1 = new Rec();
        long t1 = System.currentTimeMillis();
        ChunkedFetch.Outcome o1 = ChunkedFetch.fetch(base + "/slowrange", null, part1, 0, "ghx-test", 1, rec1, never());
        long ms1 = System.currentTimeMillis() - t1;
        String md5One = md5Of(Files.readAllBytes(part1.toPath()));
        part1.delete();

        ok("服务器同时看到 4 条在途请求", p4 >= 4, "peak=" + p4);
        ok("4 路确实比 1 路快（同一条限速链路）", ms4 < ms1 / 2, ms4 + "ms vs " + ms1 + "ms");
        ok("两种模式落盘一致", o.bytes == data.length && o1.bytes == data.length && md5.equals(md5One),
                o.bytes + " / " + o1.bytes);
        System.out.println("     分片 4 路 " + ms4 + "ms · 单路 " + ms1 + "ms · 峰值并发 " + p4);
    }

    /* ---------------- 6. 取消 ---------------- */

    private static void cancelStops() throws Exception {
        File part = tempPart();
        final long t0 = System.currentTimeMillis();
        ChunkedFetch.Cancel c = new ChunkedFetch.Cancel() {
            @Override
            public boolean cancelled() {
                // /veryslow 每 64 KB 停 40 ms，4 路整包要 1 秒以上；
                // 250 ms 处按取消，一定是在传输中途
                return System.currentTimeMillis() - t0 > 250;
            }
        };
        boolean cancelled = false;
        long ms;
        try {
            ChunkedFetch.fetch(base + "/veryslow", null, part, 0, "ghx-test", 4, new Rec(), c);
        } catch (ChunkedFetch.Cancelled e) {
            cancelled = true;
        } finally {
            ms = System.currentTimeMillis() - t0;
            part.delete();
        }
        ok("取消能中断分片下载", cancelled, "");
        ok("取消在 2 秒内停住", ms < 2000, ms + "ms");
        ok("取消后没有残留线程还在跑", !hasPartThreads(), "");
    }

    /* ---------------- 7. 单片失败重试 ---------------- */

    private static void flakyRetries() throws Exception {
        flakyHits.set(0);
        File part = tempPart();
        Rec rec = new Rec();
        ChunkedFetch.Outcome o = ChunkedFetch.fetch(base + "/flaky", null, part, 0, "ghx-test", 4, rec, never());
        ok("某片偶发 503 会重试而不是整单失败",
                o.bytes == data.length && md5.equals(md5Of(Files.readAllBytes(part.toPath()))),
                "bytes=" + o.bytes);
        ok("确实发生过一次 503", flakyHits.get() >= 1, "hits=" + flakyHits.get());
        part.delete();
    }

    /* ---------------- 服务端 ---------------- */

    private static void startServer() throws Exception {
        srv = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        serverPool = Executors.newFixedThreadPool(16);
        srv.setExecutor(serverPool);
        srv.createContext("/", new HttpHandler() {
            @Override
            public void handle(HttpExchange ex) {
                try {
                    route(ex);
                } catch (Exception e) {
                    try {
                        ex.sendResponseHeaders(500, -1);
                    } catch (Exception ignored) {
                        // 已经发过响应头了
                    }
                } finally {
                    ex.close();
                }
            }
        });
        srv.start();
        base = "http://127.0.0.1:" + srv.getAddress().getPort();
    }

    private static void route(HttpExchange ex) throws Exception {
        String path = ex.getRequestURI().getPath();
        if ("/redirect".equals(path)) {
            ex.getResponseHeaders().add("Location", "/range");
            ex.sendResponseHeaders(302, -1);
            return;
        }
        boolean ranged = !"/norange".equals(path);
        String range = ex.getRequestHeaders().getFirst("Range");

        if (ranged && range != null) {
            if ("/flaky".equals(path) && !"bytes=0-1".equals(range) && flakyHits.incrementAndGet() == 1) {
                ex.sendResponseHeaders(503, -1);
                return;
            }
            long[] r = parseRange(range, data.length);
            if (r == null) {
                ex.sendResponseHeaders(416, -1);
                return;
            }
            long len = r[1] - r[0] + 1;
            Headers h = ex.getResponseHeaders();
            h.add("Content-Range", "bytes " + r[0] + "-" + r[1] + "/" + data.length);
            h.add("Accept-Ranges", "bytes");
            ex.sendResponseHeaders(206, len);
            int slowMs = slowMsOf(path);
            int now = inflight.incrementAndGet();
            peak.accumulateAndGet(now, Math::max);
            try (OutputStream os = ex.getResponseBody()) {
                writeChunk(os, (int) r[0], (int) len, slowMs);
            } finally {
                inflight.decrementAndGet();
            }
            return;
        }
        ex.sendResponseHeaders(200, data.length);
        try (OutputStream os = ex.getResponseBody()) {
            writeChunk(os, 0, data.length, slowMsOf(path));
        }
    }

    private static int slowMsOf(String path) {
        if ("/slowrange".equals(path)) return 6;
        if ("/veryslow".equals(path)) return 40;
        return 0;
    }

    private static void writeChunk(OutputStream os, int off, int len, int slowMs) throws Exception {
        int step = 64 * 1024;
        for (int i = 0; i < len; i += step) {
            int n = Math.min(step, len - i);
            os.write(data, off + i, n);
            if (slowMs > 0) Thread.sleep(slowMs);
        }
        os.flush();
    }

    private static long[] parseRange(String raw, long total) {
        if (!raw.startsWith("bytes=")) return null;
        String body = raw.substring(6);
        int dash = body.indexOf('-');
        if (dash < 0) return null;
        try {
            long s = Long.parseLong(body.substring(0, dash).trim());
            String tail = body.substring(dash + 1).trim();
            long e = tail.isEmpty() ? total - 1 : Long.parseLong(tail);
            if (s < 0 || s >= total) return null;
            if (e >= total) e = total - 1;
            if (e < s) return null;
            return new long[] {s, e};
        } catch (NumberFormatException e) {
            return null;
        }
    }

    /* ---------------- 工具 ---------------- */

    private static final class Rec implements ChunkedFetch.Progress {
        long lastDone;
        long lastTotal;
        boolean monotonic = true;
        private long prev;

        @Override
        public void onBytes(long done, long total, double kbps, int parts) {
            if (done < prev) monotonic = false;
            prev = done;
            lastDone = done;
            lastTotal = total;
        }
    }

    private static ChunkedFetch.Cancel never() {
        return new ChunkedFetch.Cancel() {
            @Override
            public boolean cancelled() {
                return false;
            }
        };
    }

    private static File tempPart() throws Exception {
        File dir = Files.createTempDirectory("ghx-chunk").toFile();
        dir.deleteOnExit();
        File f = new File(dir, "out.part");
        f.deleteOnExit();
        return f;
    }

    private static String md5Of(byte[] bytes) {
        try {
            MessageDigest md = MessageDigest.getInstance("MD5");
            byte[] d = md.digest(bytes);
            StringBuilder sb = new StringBuilder();
            for (byte b : d) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static boolean hasPartThreads() {
        for (Thread t : Thread.getAllStackTraces().keySet()) {
            if (t.getName().startsWith("ghx-part-") && t.isAlive()) return true;
        }
        return false;
    }

    private static void ok(String name, boolean cond, String detail) {
        System.out.println((cond ? "[PASS] " : "[FAIL] ") + name + (detail.isEmpty() ? "" : " · " + detail));
        if (!cond) fails += 1;
    }
}

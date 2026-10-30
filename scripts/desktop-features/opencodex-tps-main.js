/* codex-tps-opencodex-bridge-v2 */
try {
  const __codexTpsElectron = require("electron");
  const __codexTpsBridgeFs = require("node:fs");
  const __codexTpsBridgePath = require("node:path");
  if (__codexTpsElectron.ipcMain) {
    const __codexTpsOpenCodexHandler = async (event, request) => {
      const senderUrl = String((event.senderFrame && event.senderFrame.url) || (event.sender && event.sender.getURL && event.sender.getURL()) || "");
      if (!senderUrl.startsWith("app://-/")) return null;
      const req = request && typeof request === "object" ? request : {};
      const base = process.env.USERPROFILE || process.env.HOME || "";
      const usagePath = __codexTpsBridgePath.join(base, ".opencodex", "usage.jsonl");
      const stat = await __codexTpsBridgeFs.promises.stat(usagePath);
      const bytes = Math.min(stat.size, 4 * 1024 * 1024);
      const start = Math.max(0, stat.size - bytes);
      const handle = await __codexTpsBridgeFs.promises.open(usagePath, "r");
      let text = "";
      try {
        const buffer = Buffer.alloc(bytes);
        const read = await handle.read(buffer, 0, bytes, start);
        text = buffer.subarray(0, read.bytesRead).toString("utf8");
      } finally {
        await handle.close();
      }
      if (start > 0) text = text.slice(text.indexOf("\n") + 1);
      const from = Number(req.sinceMs) || 0;
      const until = Number(req.untilMs) || Date.now();
      const wanted = String(req.model || "").toLowerCase();
      const norm = value => String(value || "").toLowerCase();
      const modelMatches = row => {
        if (!wanted) return true;
        const values = [norm(row.requestedModel), norm(row.resolvedModel), norm(row.model), norm(row.servedModel)];
        return values.some(value => value === wanted || value.endsWith("/" + wanted) || wanted.endsWith("/" + value) || value.includes(wanted) || wanted.includes(value));
      };
      const rows = [];
      for (const line of text.split(/\r?\n/)) {
        if (!line) continue;
        let row;
        try { row = JSON.parse(line); } catch { continue; }
        const timestamp = Number(row.timestamp);
        const outputTokens = Number(row.usage && row.usage.outputTokens) || 0;
        const durationMs = Number(row.durationMs) || 0;
        if (!Number.isFinite(timestamp) || timestamp < from - 15000 || timestamp > until + 5000) continue;
        if (!outputTokens || durationMs < 16 || Number(row.status) !== 200 || !modelMatches(row)) continue;
        rows.push({ requestId: row.requestId, timestamp, outputTokens, durationMs });
      }
      rows.sort((a, b) => a.timestamp - b.timestamp);
      const expected = Array.isArray(req.tokenCounts) ? req.tokenCounts.map(Number).filter(n => Number.isFinite(n) && n > 0) : [];
      const selected = [];
      const used = new Set();
      for (const tokens of expected) {
        const index = rows.findIndex((row, i) => !used.has(i) && row.outputTokens === tokens);
        if (index >= 0) { used.add(index); selected.push(rows[index]); }
      }
      const finalRows = expected.length > 0 && selected.length === expected.length ? selected : rows;
      const unique = [...new Map(finalRows.map(row => [row.requestId || row.timestamp + ":" + row.outputTokens, row])).values()];
      const result = unique.reduce((sum, row) => ({ tokens: sum.tokens + row.outputTokens, durationMs: sum.durationMs + row.durationMs }), { tokens: 0, durationMs: 0 });
      return { ...result, tps: result.durationMs > 0 ? result.tokens / (result.durationMs / 1000) : 0, requestCount: unique.length, matchedTokenEvents: selected.length };
    };
    __codexTpsElectron.ipcMain.handle("codex-tps:opencodex-v2", __codexTpsOpenCodexHandler);
    globalThis.__codexTpsOpenCodex = request => __codexTpsOpenCodexHandler({ senderFrame: { url: "app://-/main" } }, request);
  }
} catch {}

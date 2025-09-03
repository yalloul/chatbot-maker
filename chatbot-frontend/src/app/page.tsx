"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ingestCSV, chat } from "@/lib/api";
import type { ChatResponse, ChatHit } from "@/types/api";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: ChatResponse["citations"];
  hits?: ChatHit[];
};

export default function Home() {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8000";
  const [company, setCompany] = useState("instagram");
  const [file, setFile] = useState<File | null>(null);
  const [reset, setReset] = useState(true);
  const [ingestStatus, setIngestStatus] = useState<null | string>(null);

  const [query, setQuery] = useState("");
  const [topK, setTopK] = useState(3);
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const listRef = useRef<HTMLDivElement>(null);

  const disabledChat = useMemo(() => loading || !company.trim(), [loading, company]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setIngestStatus("Please choose a CSV file first.");
      return;
    }
    setIngestStatus("Uploading & indexing…");
    try {
      const res = await ingestCSV(company.trim(), file, reset);
      setIngestStatus(`✅ Ingested ${res.records} rows for "${res.company}".`);
    } catch (err: any) {
      setIngestStatus(`❌ ${err.message || "Upload failed"}`);
    }
  }

  async function handleSend() {
    const q = query.trim();
    if (!q) return;

    const userMsg: Message = { id: crypto.randomUUID(), role: "user", content: q };
    setMessages((m) => [...m, userMsg]);
    setQuery("");
    setLoading(true);

    try {
      const res: ChatResponse = await chat(company.trim(), q, topK);
      const citationsText =
        res.citations?.map((c) => `${c.data_type} · ${c.title}`).join(" | ") || "";
      const content = res.answer || "(no answer)";

      const asstMsg: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content,
        citations: res.citations,
        hits: res.hits,
      };
      setMessages((m) => [...m, asstMsg]);
    } catch (err: any) {
      const asstMsg: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: `❌ Error: ${err.message || "request failed"}`,
      };
      setMessages((m) => [...m, asstMsg]);
    } finally {
      setLoading(false);
    }
  }

  function MessageBubble({ msg }: { msg: Message }) {
    const mine = msg.role === "user";
    return (
      <div
        style={{
          display: "flex",
          justifyContent: mine ? "flex-end" : "flex-start",
          marginBottom: 10,
        }}
      >
        <div
          style={{
            maxWidth: "75%",
            background: mine ? "#2563eb" : "#111827",
            color: "white",
            padding: "10px 14px",
            borderRadius: 12,
            whiteSpace: "pre-wrap",
            boxShadow: "0 1px 3px rgba(0,0,0,.2)",
          }}
        >
          <div style={{ fontSize: 14, opacity: 0.9 }}>{msg.content}</div>
          {msg.citations && msg.citations.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
              <strong>Citations:</strong>{" "}
              {msg.citations.map((c, i) => (
                <span key={i}>
                  ({c.data_type} · {c.title}){i < msg.citations!.length - 1 ? " | " : ""}
                </span>
              ))}
            </div>
          )}
          {msg.hits && msg.hits.length > 0 && (
            <details style={{ marginTop: 6 }}>
              <summary style={{ cursor: "pointer" }}>Ranked hits</summary>
              <ul style={{ marginTop: 6 }}>
                {msg.hits.map((h, i) => (
                  <li key={i} style={{ fontSize: 12, opacity: 0.85 }}>
                    {h.title} — {h.data_type} — score {h.score.toFixed(3)}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0b0f19", color: "#e5e7eb" }}>
      <header style={{ padding: "14px 18px", borderBottom: "1px solid #1f2937" }}>
        <div style={{ fontWeight: 700, fontSize: 18 }}>Chatbot Factory — Demo</div>
        <div style={{ fontSize: 12, opacity: 0.75 }}>
          API: <code>{apiBase}</code>
        </div>
      </header>

      <main style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 16, padding: 16 }}>
        {/* Sidebar: Upload & Settings */}
        <aside style={{ background: "#0f172a", border: "1px solid #1f2937", borderRadius: 8, padding: 16 }}>
          <h3 style={{ marginTop: 0, marginBottom: 12 }}>Upload</h3>
          <form onSubmit={handleUpload}>
            <label style={{ fontSize: 13 }}>Company</label>
            <input
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="company slug (e.g. instagram)"
              style={{
                width: "100%", marginTop: 6, marginBottom: 10, padding: "8px 10px",
                background: "#111827", color: "white", border: "1px solid #1f2937", borderRadius: 6,
              }}
            />
            <label style={{ fontSize: 13 }}>CSV file</label>
            <input
              type="file"
              accept=".csv"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              style={{ width: "100%", marginTop: 6, marginBottom: 10 }}
            />
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <input type="checkbox" checked={reset} onChange={(e) => setReset(e.target.checked)} />
              Reset index before ingest
            </label>
            <button
              type="submit"
              style={{
                marginTop: 12, width: "100%", background: "#2563eb", color: "white",
                border: "none", padding: "10px 12px", borderRadius: 6, cursor: "pointer",
              }}
            >
              Upload & Index
            </button>
          </form>
          <div style={{ marginTop: 10, fontSize: 12, minHeight: 18 }}>{ingestStatus}</div>

          <hr style={{ borderColor: "#1f2937", margin: "16px 0" }} />

          <h3 style={{ marginTop: 0, marginBottom: 12 }}>Settings</h3>
          <div style={{ fontSize: 13, opacity: 0.8 }}>
            - API base: <code>{apiBase}</code>
            <br />- Chat endpoint: <code>/v1/chat</code>
            <br />- Ingest endpoint: <code>/v1/ingest</code>
          </div>
        </aside>

        {/* Chat panel */}
        <section style={{ display: "grid", gridTemplateRows: "1fr auto", background: "#0f172a", border: "1px solid #1f2937", borderRadius: 8 }}>
          <div ref={listRef} style={{ padding: 16, overflowY: "auto" }}>
            {messages.length === 0 && (
              <div style={{ opacity: 0.7, fontSize: 14 }}>
                Start a new conversation. Upload a CSV on the left, then ask questions about your documents.
              </div>
            )}
            {messages.map((m) => (
              <MessageBubble key={m.id} msg={m} />
            ))}
            {loading && <div style={{ opacity: 0.7, fontSize: 13 }}>Thinking…</div>}
          </div>

          <div style={{ padding: 12, borderTop: "1px solid #1f2937" }}>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey ? (e.preventDefault(), handleSend()) : undefined}
                placeholder="Ask a question about your docs…"
                style={{
                  flex: 1, background: "#111827", color: "white", border: "1px solid #1f2937",
                  borderRadius: 6, padding: "10px 12px",
                }}
                disabled={disabledChat}
              />
              <input
                type="number"
                min={1}
                max={20}
                value={topK}
                onChange={(e) => setTopK(parseInt(e.target.value || "3", 10))}
                title="top_k"
                style={{
                  width: 70, background: "#111827", color: "white", border: "1px solid #1f2937",
                  borderRadius: 6, padding: "10px 8px"
                }}
              />
              <button
                onClick={handleSend}
                disabled={disabledChat}
                style={{
                  background: "#22c55e", color: "black", fontWeight: 600, border: "none",
                  padding: "10px 14px", borderRadius: 6, cursor: "pointer",
                  opacity: disabledChat ? 0.6 : 1
                }}
              >
                Send
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

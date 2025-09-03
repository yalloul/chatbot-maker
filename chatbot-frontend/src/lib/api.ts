const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8000";

export async function ingestCSV(company: string, file: File, reset: boolean) {
  const form = new FormData();
  form.append("company", company);
  form.append("reset", String(reset));
  form.append("file", file);
  const res = await fetch(`${API_BASE}/v1/ingest`, { method: "POST", body: form });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function chat(company: string, query: string, top_k = 3) {
  const res = await fetch(`${API_BASE}/v1/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ company, query, top_k }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

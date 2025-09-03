# rag_core.py  —  cleaner ingestion, persistent embeddings, MMR search, tidy answers

import json
from dataclasses import dataclass
from pathlib import Path
from typing import List, Dict, Any, Tuple, Optional

import numpy as np
import pandas as pd
import faiss
from sentence_transformers import SentenceTransformer

from settings import STORE_ROOT, EMBEDDING_MODEL_NAME, TOP_K, MAX_CONTEXT_CHARS

CSV_COLS = ["app_name", "data_type", "title", "content", "keywords"]


# ---------- Utils ----------
def l2_normalize(x: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(x, axis=1, keepdims=True) + 1e-12
    return x / norms


@dataclass
class Record:
    id: str
    app_name: str
    data_type: str
    title: str
    content: str
    keywords: str


# ---------- Index per company ----------
class CompanyIndex:
    """
    One FAISS cosine index + metadata per company (slug).
    - Cosine similarity via IndexFlatIP on L2-normalized embeddings.
    - Persists: FAISS index, metadata JSONL, and the embeddings matrix (embeddings.npy).
    """

    def __init__(self, company_slug: str, model_name: str = EMBEDDING_MODEL_NAME):
        self.company_slug = company_slug
        self.root = STORE_ROOT / company_slug
        self.root.mkdir(parents=True, exist_ok=True)

        self.model = SentenceTransformer(model_name)
        self.dim = self.model.get_sentence_embedding_dimension()

        # Files
        self.faiss_path = self.root / "chunks.faiss"
        self.meta_path = self.root / "meta.jsonl"
        self.emb_path = self.root / "embeddings.npy"

        self.index: Optional[faiss.IndexFlatIP] = None
        self.meta: List[Record] = []
        self.embs: Optional[np.ndarray] = None  # shape (N, dim), float32, L2-normalized

        if self.faiss_path.exists() and self.meta_path.exists() and self.emb_path.exists():
            self._load()

    # ---------- Persistence ----------
    def _load(self):
        self.index = faiss.read_index(str(self.faiss_path))
        with open(self.meta_path, "r", encoding="utf-8") as f:
            self.meta = [Record(**json.loads(line)) for line in f]
        self.embs = np.load(self.emb_path).astype(np.float32)

    def _save(self):
        if self.index is None or self.embs is None:
            raise RuntimeError("Index/embeddings not built.")
        faiss.write_index(self.index, str(self.faiss_path))
        with open(self.meta_path, "w", encoding="utf-8") as f:
            for r in self.meta:
                f.write(json.dumps(r.__dict__, ensure_ascii=False) + "\n")
        np.save(self.emb_path, self.embs)

    # ---------- Ingestion ----------
    def clear(self):
        """Remove current store (useful to re-ingest)."""
        if self.root.exists():
            for p in self.root.iterdir():
                try:
                    p.unlink()
                except IsADirectoryError:
                    # Shouldn't happen with our current files, but be safe.
                    pass
        self.root.mkdir(parents=True, exist_ok=True)
        self.index = None
        self.meta = []
        self.embs = None

    def ingest_csv(self, csv_path: str | Path):
        df = pd.read_csv(csv_path)

        # Validate columns
        for c in CSV_COLS:
            if c not in df.columns:
                raise ValueError(f"CSV missing required column: {c}")

        # Normalize, fill NA, strip
        df = df.fillna("").copy()
        for c in ["app_name", "data_type", "title", "content", "keywords"]:
            df[c] = df[c].astype(str).str.strip()

        # Hard de-dup (type + title + content)
        df["__dedupe_key__"] = (
            df["data_type"].str.lower() + "||" +
            df["title"].str.lower() + "||" +
            df["content"].str.lower()
        )
        before = len(df)
        df = df.drop_duplicates(subset="__dedupe_key__", keep="first").drop(columns="__dedupe_key__")
        after = len(df)
        print(f"[{self.company_slug}] Deduped {before - after} duplicate rows (kept {after}).")

        # Build records
        recs: List[Record] = []
        for i, row in df.iterrows():
            recs.append(Record(
                id=f"row-{i}",
                app_name=row["app_name"],
                data_type=row["data_type"],
                title=row["title"],
                content=row["content"],
                keywords=row.get("keywords", ""),
            ))

        # Embed
        texts = [self._record_to_text(r) for r in recs]
        embs = self._embed(texts)  # (N, dim) L2-normalized, float32

        # Build FAISS cosine index
        index = faiss.IndexFlatIP(self.dim)
        index.add(embs.astype(np.float32))

        # Persist
        self.index = index
        self.meta = recs
        self.embs = embs.astype(np.float32)
        self._save()

    # ---------- Retrieval ----------
    def search(
        self,
        query: str,
        k: int = TOP_K,
        prefer_types: Optional[List[str]] = None,
    ) -> List[Tuple[float, Record]]:
        """
        Returns up to k diversified results as (score, Record).
        - Over-fetch from FAISS, then apply MMR for diversity.
        - De-duplicate by (data_type, title).
        - Optionally prioritize certain data_types via stable partition.
        """
        if self.index is None or self.embs is None:
            if self.faiss_path.exists():
                self._load()
            else:
                raise RuntimeError("Index not found for this company. Ingest first.")

        # Encode query
        q_vec = self._embed([query])[0].astype(np.float32)  # (dim,)

        # Over-fetch to allow MMR + dedupe
        over_k = max(k * 8, 50)
        scores, idxs = self.index.search(q_vec.reshape(1, -1), over_k)
        cand_idxs = [i for i in idxs[0] if i != -1]
        if not cand_idxs:
            return []

        # Candidate vectors
        cand_vecs = self.embs[cand_idxs]  # shape (M, dim), already L2-normalized

        # MMR selection (indices relative to cand_idxs)
        sel_local = _mmr(q_vec, cand_vecs, top_k=over_k, lambda_mult=0.7)

        # Build picked list, de-dup by (data_type, title)
        # Keep original FAISS score for transparency.
        picked: List[Tuple[float, Record]] = []
        seen_keys = set()
        # Mapping from global index -> its FAISS score (first occurrence)
        score_map = {gi: sc for gi, sc in zip(idxs[0], scores[0]) if gi != -1}

        for li in sel_local:
            gi = cand_idxs[li]
            r = self.meta[gi]
            key = (r.data_type.lower(), r.title.lower())
            if key in seen_keys:
                continue
            seen_keys.add(key)
            picked.append((float(score_map.get(gi, 0.0)), r))
            if len(picked) >= k:
                break

        # Optional stable partition to prefer some data_types
        if prefer_types:
            order = {t: i for i, t in enumerate([t.lower() for t in prefer_types])}

            def pref_key(item: Tuple[float, Record]):
                _, rec = item
                return (order.get(rec.data_type.lower(), 999),)  # unknown types sink

            picked = sorted(picked, key=pref_key)

        return picked

    # ---------- Helpers ----------
    def _record_to_text(self, r: Record) -> str:
        # Compact but informative text for embedding
        pieces = [
            f"app_name: {r.app_name}",
            f"type: {r.data_type}",
            f"title: {r.title}",
            f"keywords: {r.keywords}",
            f"content: {r.content}",
        ]
        return "\n".join(pieces)

    def _embed(self, texts: List[str]) -> np.ndarray:
        vecs = self.model.encode(
            texts,
            batch_size=64,
            show_progress_bar=False,
            convert_to_numpy=True,
            normalize_embeddings=True,  # SentenceTransformers can do L2 norm for us
        ).astype(np.float32)
        # normalize_embeddings=True already does L2 norm; keep for safety
        return l2_normalize(vecs)


# ---------- Prompt & Answer helpers ----------
def make_prompt(company: str, user_query: str, passages: List[Tuple[float, Record]]) -> str:
    bulleted = []
    for score, r in passages:
        ctx = (r.content or "")[:MAX_CONTEXT_CHARS]
        src = f"{r.data_type} · {r.title}"
        bulleted.append(f"- [{src}] {ctx}")
    context_block = "\n".join(bulleted) if bulleted else "No relevant context found."

    return f"""You are a helpful chatbot for **{company}**.
Only answer using the CONTEXT below; if the answer is not present, say you don't know and suggest what information is needed.

USER QUESTION:
{user_query}

CONTEXT (ranked, most relevant first):
{context_block}

Answer in the user's language. Include short references like (source: data_type · title) when you use a passage.
"""


def simple_answer(company: str, user_query: str, passages: List[Tuple[float, Record]]) -> Dict[str, Any]:
    """
    Extractive MVP answer:
    - Use only the top unique passage.
    - Return de-duplicated citations (max 3).
    """
    if not passages:
        return {
            "answer": "Je ne trouve pas cette information dans la base actuelle. "
                      "Ajoutez la documentation correspondante et réessayez.",
            "citations": [],
        }

    # De-duplicate citations by (type, title)
    seen = set()
    cits = []
    snippets = []
    for score, r in passages:
        key = (r.data_type, r.title)
        if key in seen:
            continue
        seen.add(key)
        cits.append({"data_type": r.data_type, "title": r.title})
        snippets.append(r.content.strip())

    # Keep the most relevant snippet only for a concise answer
    snippet = (snippets[0] if snippets else "")
    if len(snippet) > 500:
        snippet = snippet[:500] + "…"

    return {
        "answer": snippet if snippet else "Désolé, je n'ai pas assez de contexte pour répondre.",
        "citations": cits[:3],
    }


# ---------- MMR (Maximal Marginal Relevance) ----------
def _mmr(query_vec: np.ndarray, doc_vecs: np.ndarray, top_k: int, lambda_mult: float = 0.7):
    """
    Simple MMR on cosine similarities.
    query_vec: (d,)
    doc_vecs:  (N, d)  # assumed L2-normalized
    Returns: list of selected indices into doc_vecs
    """
    # relevance (cosine sim) because everything is L2-normalized
    sims = doc_vecs @ query_vec  # (N,)

    selected: List[int] = []
    candidates = list(range(len(doc_vecs)))

    while candidates and len(selected) < top_k:
        if not selected:
            # pick the most relevant first
            best_i = int(np.argmax(sims[candidates]))
            selected.append(candidates.pop(best_i))
            continue

        best_idx_local = None
        best_score = -1e9
        for ci, idx in enumerate(candidates):
            # diversity: max sim to already selected
            div = float(np.max(doc_vecs[idx] @ doc_vecs[selected].T))
            score = lambda_mult * float(sims[idx]) - (1.0 - lambda_mult) * div
            if score > best_score:
                best_score = score
                best_idx_local = ci

        selected.append(candidates.pop(best_idx_local))

    return selected

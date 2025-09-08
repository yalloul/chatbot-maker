import os
from typing import List, Tuple, Optional

import requests

from rag_core import Record
from settings import MAX_CONTEXT_CHARS

# Prefer environment variables so you don't hardcode URLs/models
OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "http://127.0.0.1:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "mistral")


def ollama_available() -> bool:
    """
    Returns true if Ollama is reachable and the model is present locally.
    """
    try:
        # Check server is up
        r = requests.get(f"{OLLAMA_BASE_URL}/api/tags", timeout=3)
        r.raise_for_status()
        tags = r.json().get("models", [])
        # If specific model present, great; otherwise still allow (Ollama can auto-pull)
        if any((m.get("name") or "").startswith(OLLAMA_MODEL) for m in tags):
            return True
        # Server up, but model not listed; still return True to allow auto-pull/use
        return True
    except Exception:
        return False


def _build_context(passages: List[Tuple[float, Record]]) -> str:
    bulleted = []
    for score, r in passages:
        ctx = (r.content or "")[:MAX_CONTEXT_CHARS]
        src = f"{r.data_type} · {r.title}"
        bulleted.append(f"- [{src}] {ctx}")
    return "\n".join(bulleted) if bulleted else "No relevant context found."


def judge_and_answer_with_ollama(
    company: str,
    user_query: str,
    passages: List[Tuple[float, Record]],
    model: Optional[str] = None,
) -> Tuple[bool, str]:
    """
    Returns (True, answer) if context is sufficient and an answer was generated.
    Returns (False, "") if the model refuses (NOT_CAPABLE) or context is insufficient.
    """
    model = model or OLLAMA_MODEL
    context_block = _build_context(passages)

    system_msg = (
        f"You are a strict answer validator and writer for {company}.\n"
        "Use only the provided CONTEXT. If the CONTEXT does not clearly contain the information "
        "needed to answer the USER QUESTION faithfully, reply with ONLY this token:\n"
        "NOT_CAPABLE\n\n"
        "Behavior rules:\n"
        "- If the USER QUESTION is a greeting or chit-chat (e.g., 'hi', 'hello', 'thanks'), "
        "  respond briefly and politely, and do NOT produce domain instructions.\n"
        "- If the USER QUESTION is unrelated to the company/domain or cannot be answered from CONTEXT, "
        "  reply with ONLY: NOT_CAPABLE.\n"
        "- If the context is sufficient, write a clear, concise answer in the user's language. "
        "  When you rely on a passage, include brief parenthetical references like "
        "  (source: data_type · title). "
        f"Do not introduce unrelated topics (e.g., if the question is not about {company}, do not discuss {company}). "
        "If you know the answer from your own knowledge, but it is NOT in the CONTEXT, don't use it."
    )
    user_msg = (
        f"USER QUESTION:\n{user_query}\n\n"
        f"CONTEXT (ranked, most relevant first):\n{context_block}"
    )

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_msg},
            {"role": "user", "content": user_msg},
        ],
        "stream": False,  # easier to handle in this backend
        "options": {
            "temperature": 0.2,
        },
    }

    try:
        resp = requests.post(f"{OLLAMA_BASE_URL}/api/chat", json=payload, timeout=120)
        resp.raise_for_status()
        data = resp.json()
        content = ((data.get("message") or {}).get("content") or "").strip()
        if content.upper() == "NOT_CAPABLE":
            return False, ""
        return bool(content), content
    except Exception:
        # In production, log the exception
        return False, ""
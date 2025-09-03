import os
from typing import List, Tuple, Optional

from mistralai import Mistral

from rag_core import Record
from settings import MAX_CONTEXT_CHARS, MISTRAL_MODEL, MISTRAL_API_KEY


def mistral_available() -> bool:
    return bool(os.environ.get("MISTRAL_API_KEY") or MISTRAL_API_KEY)


def _client() -> Mistral:
    api_key = os.environ.get("MISTRAL_API_KEY") or MISTRAL_API_KEY
    if not api_key:
        raise RuntimeError("Mistral API key not configured.")
    return Mistral(api_key=api_key)


def _build_context(passages: List[Tuple[float, Record]]) -> str:
    bulleted = []
    for score, r in passages:
        ctx = (r.content or "")[:MAX_CONTEXT_CHARS]
        src = f"{r.data_type} · {r.title}"
        bulleted.append(f"- [{src}] {ctx}")
    return "\n".join(bulleted) if bulleted else "No relevant context found."


def judge_and_answer_with_mistral(
    company: str,
    user_query: str,
    passages: List[Tuple[float, Record]],
    model: Optional[str] = None,
) -> Tuple[bool, str]:
    """
    Uses Mistral to decide if the retrieved context is sufficient.
    If sufficient: returns (True, generated_answer)
    If not:        returns (False, "")
    """
    model = model or MISTRAL_MODEL
    context_block = _build_context(passages)

    system_msg = (
        f"You are a strict answer validator and writer for {company}.\n"
        "Use only the provided CONTEXT. If the CONTEXT does not clearly contain the information "
        "needed to answer the USER QUESTION faithfully, reply with ONLY this token:\n"
        "NOT_CAPABLE\n\n"
        "If the context is sufficient, write a clear, concise answer in the user's language. "
        "When you rely on a passage, include brief parenthetical references like (source: data_type · title). "
        f"Do not introduce unrelated topics (e.g., if the question is not about {company}, do not discuss {company})."
        "If you know the answer from your own knowledge, but it is NOT in the CONTEXT,don't use it."
    )

    user_msg = (
        f"USER QUESTION:\n{user_query}\n\n"
        f"CONTEXT (ranked, most relevant first):\n{context_block}"
    )

    client = _client()
    resp = client.chat.complete(
        model=model,
        messages=[
            {"role": "system", "content": system_msg},
            {"role": "user", "content": user_msg},
        ],
        temperature=0.2,
    )

    content = (resp.choices[0].message.content or "").strip()
    if content.upper() == "NOT_CAPABLE":
        return False, ""
    return True, content
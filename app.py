import os
try:
    from dotenv import load_dotenv
    load_dotenv()  # Load variables from .env if present
except Exception:
    # dotenv optional; ignore if not installed
    pass
from datetime import datetime
from pathlib import Path
from typing import Optional

import pandas as pd
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from rag_core import CompanyIndex
from settings import TOP_K, MIN_TOP_SCORE, USE_MISTRAL, USE_OLLAMA
from settings import MONGODB_URI, MONGODB_DB, MONGODB_PROMPTS_COLLECTION
from fastapi.middleware.cors import CORSMiddleware

# Optional Mistral support (won't break if not present)
try:
    from llm_mistral import mistral_available, judge_and_answer_with_mistral
except Exception:
    mistral_available = lambda: False  # noqa: E731
    judge_and_answer_with_mistral = None  # type: ignore

# Ollama (local) LLM support
from llm_ollama import ollama_available, judge_and_answer_with_ollama

app = FastAPI(title="CSV → Chatbot Maker", version="0.1.1")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ChatRequest(BaseModel):
    company: str
    query: str
    top_k: Optional[int] = TOP_K
@app.on_event("startup")
async def _startup_mongo():
    """Initialize Mongo client (Motor) if URI is provided. Prefer env vars; validate with ping."""
    # Prefer environment variables over settings to avoid committing secrets
    uri = (os.environ.get("MONGODB_URI") or MONGODB_URI).strip() if (os.environ.get("MONGODB_URI") or MONGODB_URI) else ""
    if not uri:
        app.state.mongo = None
        print("[mongo] MONGODB_URI not set; prompt logging disabled.")
        return
    try:
        from motor.motor_asyncio import AsyncIOMotorClient  # lazy import
        # small timeout to fail fast if Atlas not reachable
        client = AsyncIOMotorClient(uri, serverSelectionTimeoutMS=3000)
        # Ping admin to verify connectivity
        await client.admin.command("ping")
        db_name = (os.environ.get("MONGODB_DB") or MONGODB_DB or "chatbot").strip()
        app.state.mongo = client[db_name]
        print(f"[mongo] Connected to '{db_name}'.")
    except Exception as e:
        app.state.mongo = None
        print(f"[mongo] Disabled. Could not connect: {e}")


@app.on_event("shutdown")
async def _shutdown_mongo():
    """Close Mongo client on shutdown if present."""
    mongo = getattr(app.state, "mongo", None)
    if mongo is not None:
        try:
            client = mongo.client
            client.close()
        except Exception:
            pass


def small_talk_reply(company: str, text: str) -> Optional[str]:
    """
    Lightweight small-talk handler to avoid sending greetings to retrieval/LLM.
    """
    t = (text or "").strip().lower()

    greetings = ("hi", "hello", "hey", "yo", "hola", "salut", "bonjour")
    thanks = ("thanks", "thank you", "thx", "merci", "gracias")
    goodbyes = ("bye", "goodbye", "see you", "ciao")

    if any(t.startswith(g) for g in greetings):
        return f"Hello! I'm your assistant for {company}. How can I help you today?"
    if any(t.startswith(x) for x in thanks):
        return "You're welcome! How else can I help?"
    if any(t.startswith(x) for x in goodbyes):
        return "Goodbye! If you need anything else, just ask."
    return None


@app.post("/v1/ingest")
async def ingest(company: str = Form(...), file: UploadFile = File(...), reset: bool = Form(False)):
    """
    Upload a CSV for a company. CSV must have columns:
    app_name,data_type,title,content,keywords
    """
    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(400, "Please upload a CSV file.")

    tmp_path = Path("data") / f"{company}.csv"
    tmp_path.parent.mkdir(parents=True, exist_ok=True)
    with open(tmp_path, "wb") as f:
        f.write(await file.read())

    # Validate quickly
    df = pd.read_csv(tmp_path)
    expected = {"app_name", "data_type", "title", "content", "keywords"}
    if not expected.issubset(set(map(str, df.columns))):
        raise HTTPException(400, f"CSV must contain columns: {', '.join(sorted(expected))}")

    ix = CompanyIndex(company)
    if reset:
        ix.clear()
    ix.ingest_csv(tmp_path)

    return {"ok": True, "company": company, "records": len(df)}


@app.post("/v1/chat")
async def chat(req: ChatRequest):
    # 0) Optional: log prompt to MongoDB Atlas
    mongo = getattr(app.state, "mongo", None)
    if mongo is not None:
        try:
            coll_name = (os.environ.get("MONGODB_PROMPTS_COLLECTION") or MONGODB_PROMPTS_COLLECTION or "prompts").strip()
            doc = {
                "company": req.company,
                "query": req.query,
                "top_k": req.top_k,
                "ts": datetime.utcnow().isoformat() + "Z",
            }
            await mongo[coll_name].insert_one(doc)
        except Exception as e:
            # Non-blocking: log and continue
            print(f"[mongo] Insert failed: {e}")
    # 1) Small-talk fast path
    st = small_talk_reply(req.company, req.query)
    if st:
        return JSONResponse({
            "company": req.company,
            "query": req.query,
            "top_k": req.top_k,
            "answer": st,
        })

    # 2) Retrieve
    ix = CompanyIndex(req.company)
    results = ix.search(req.query, k=req.top_k or TOP_K)

    # 3) Guardrail: if nothing relevant enough, don't answer
    if not results or float(results[0][0]) < MIN_TOP_SCORE:
        answer = (
            "I'm not capable of answering this question with the current knowledge. "
            "Please provide more relevant documentation and try again."
        )
        return JSONResponse({
            "company": req.company,
            "query": req.query,
            "top_k": req.top_k,
            "answer": answer,
            # Do NOT include citations or hits to avoid showing ranked snippets
        })

    # 4) Try different LLM options (Mistral first if configured, then Ollama)
    if USE_MISTRAL and mistral_available():
        can_answer, gen_answer = judge_and_answer_with_mistral(req.company, req.query, results)  # type: ignore
        if can_answer and gen_answer.strip():
            answer = gen_answer
        else:
            answer = (
                "I'm not capable of answering this question with the current knowledge. "
                "Please provide more relevant documentation and try again."
            )
    elif USE_OLLAMA and ollama_available():
        can_answer, gen_answer = judge_and_answer_with_ollama(req.company, req.query, results)
        if can_answer and gen_answer.strip():
            answer = gen_answer
        else:
            answer = (
                "I'm not capable of answering this question with the current knowledge. "
                "Please provide more relevant documentation and try again."
            )
    else:
        answer = (
            "LLM is not configured. Start Ollama and set OLLAMA_BASE_URL/OLLAMA_MODEL, "
            "or set MISTRAL_API_KEY and disable/enable USE_OLLAMA / USE_MISTRAL appropriately."
        )

    return JSONResponse({
        "company": req.company,
        "query": req.query,
        "top_k": req.top_k,
        "answer": answer,
        # No citations, no hits in response
    })


@app.get("/v1/health/mongo")
async def health_mongo():
    """Return basic Mongo connectivity status and collection name used."""
    mongo = getattr(app.state, "mongo", None)
    if mongo is None:
        return {"connected": False}
    try:
        await mongo.command("ping")
        coll_name = (os.environ.get("MONGODB_PROMPTS_COLLECTION") or MONGODB_PROMPTS_COLLECTION or "prompts").strip()
        return {"connected": True, "db": mongo.name, "collection": coll_name}
    except Exception as e:
        return {"connected": False, "error": str(e)}
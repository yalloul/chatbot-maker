import os
from pathlib import Path
from typing import Optional

import pandas as pd
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from rag_core import CompanyIndex
from settings import STORE_ROOT, TOP_K, MIN_TOP_SCORE, USE_MISTRAL
from fastapi.middleware.cors import CORSMiddleware

from llm_mistral import mistral_available, judge_and_answer_with_mistral

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
    expected = {"app_name","data_type","title","content","keywords"}
    if not expected.issubset(set(map(str, df.columns))):
        raise HTTPException(400, f"CSV must contain columns: {', '.join(sorted(expected))}")

    ix = CompanyIndex(company)
    if reset:
        ix.clear()
    ix.ingest_csv(tmp_path)

    return {"ok": True, "company": company, "records": len(df)}


@app.post("/v1/chat")
async def chat(req: ChatRequest):
    ix = CompanyIndex(req.company)
    results = ix.search(req.query, k=req.top_k or TOP_K)

    # Guardrail: if nothing relevant enough, don't answer
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

    # Require Mistral and return only its answer
    if USE_MISTRAL and mistral_available():
        can_answer, gen_answer = judge_and_answer_with_mistral(req.company, req.query, results)
        if can_answer and gen_answer.strip():
            answer = gen_answer
        else:
            answer = (
                "I'm not capable of answering this question with the current knowledge. "
                "Please provide more relevant documentation and try again."
            )
    else:
        answer = (
            "Mistral is not configured. Set MISTRAL_API_KEY and restart, or disable USE_MISTRAL."
        )

    return JSONResponse({
        "company": req.company,
        "query": req.query,
        "top_k": req.top_k,
        "answer": answer,
        # No citations, no hits in response
    })
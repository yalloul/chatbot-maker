import os
from pathlib import Path
from typing import Optional

import pandas as pd
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from rag_core import CompanyIndex, make_prompt, simple_answer
from settings import STORE_ROOT, TOP_K

app = FastAPI(title="CSV → Chatbot Maker", version="0.1.0")

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

    # If you have an LLM, call it with `make_prompt(...)`.
    # For MVP we do a simple extractive fusion:
    # prompt = make_prompt(req.company, req.query, results)
    # answer = call_llm(prompt)  # <- plug your LLM here
    result = simple_answer(req.company, req.query, results)

    return JSONResponse({
        "company": req.company,
        "query": req.query,
        "top_k": req.top_k,
        "answer": result["answer"],
        "citations": result["citations"],
        "hits": [
            {
                "score": float(score),
                "data_type": r.data_type,
                "title": r.title,
                "keywords": r.keywords,
            } for score, r in results
        ]
    })

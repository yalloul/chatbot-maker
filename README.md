# Chatbot Maker — CSV → RAG Chatbot

Turn a simple CSV into a searchable knowledge base and chat with it through a lightweight Retrieval-Augmented Generation (RAG) pipeline.

- Backend: FastAPI + FAISS + SentenceTransformers
- Frontend: Next.js (App Router) simple chat UI
- Storage: One FAISS index and metadata per “company” (logical namespace)
- Optional: LLM answerer (e.g., Mistral) to validate context and compose final responses

---

## Features

- CSV ingestion with deduplication and persistent vector store per company
- Fast cosine similarity search via FAISS
- Diversified retrieval using Maximal Marginal Relevance (MMR)
- Clean extractive MVP answers out of the box
- Prompt builder (make_prompt) for plugging any LLM
- Optional Mistral integration to:
  - check whether the retrieved context is sufficient to answer
  - generate a well-formed answer in the user’s language
  - refuse when context is insufficient

---

## How it works

1. Ingest
   - Upload a CSV with columns:
     - app_name, data_type, title, content, keywords
   - The backend embeds rows using SentenceTransformers and writes:
     - stores/{company}/chunks.faiss
     - stores/{company}/meta.jsonl
     - stores/{company}/embeddings.npy

2. Retrieve
   - For a query, embed and search FAISS
   - Over-fetch results, then apply MMR to diversify
   - De-duplicate by (data_type, title)

3. Answer
   - Default: simple extractive snippet with compact citations
   - Optional: build a prompt (make_prompt) and call an LLM (e.g., Mistral) to:
     - validate that the retrieved context is sufficient
     - generate the final answer or say “not capable” when context is missing

---

## Project structure

```
.
├── app.py                # FastAPI app (ingest + chat endpoints)
├── rag_core.py           # Indexing, retrieval, MMR, prompt and extractive answer
├── settings.py           # Configuration
├── stores/               # Persistent FAISS stores (created at runtime)
├── data/                 # Uploaded CSVs (temporary, created at runtime)
└── chatbot-frontend/     # Next.js chat UI
    └── src/app/page.tsx  # Basic chat page
```

If you add Mistral integration, you might also have:
```
llm_mistral.py           # Mistral helper (optional)
```

---

## Requirements

- Python 3.10+ recommended
- Node.js 18+ (for the frontend)
- pip (or uv)
- On Windows, FAISS is easiest via `faiss-cpu` pip wheel or conda-forge

---

## Setup

### 1) Backend

Create and activate a venv, then install Python dependencies.

Windows (PowerShell):
```powershell
py -3 -m venv .venv
.\.venv\Scripts\activate
python -m pip install -U pip setuptools wheel
pip install -r requirements.txt
```

macOS/Linux:
```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -U pip setuptools wheel
pip install -r requirements.txt
```

If FAISS gives you trouble on Windows:
```powershell
pip install faiss-cpu
# or with conda:
# conda install -c conda-forge faiss-cpu
```

Run the API:
```bash
uvicorn app:app --reload
```
The server starts at http://127.0.0.1:8000.

### 2) Frontend

From the project root:
```bash
cd chatbot-frontend
npm install     # or: pnpm install / yarn
npm run dev     # starts on http://localhost:3000
```

The backend CORS is configured for http://localhost:3000 by default.

---

## Configuration

See `settings.py` for defaults:

- STORE_ROOT = "stores"
- EMBEDDING_MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
- TOP_K = 6
- MAX_CONTEXT_CHARS = 1800
- Optional LLM provider flags

Environment variables override hardcoded keys for safety. Example (PowerShell):
```powershell
$env:MISTRAL_API_KEY="your_mistral_key"
```
macOS/Linux:
```bash
export MISTRAL_API_KEY="your_mistral_key"
```

Optional with python-dotenv:
- Create a `.env` in repo root:
  ```
  MISTRAL_API_KEY=your_mistral_key
  ```
- Load it at the top of `app.py` if you wish:
  ```python
  from dotenv import load_dotenv
  load_dotenv()
  ```

---

## CSV format

Your CSV must include these columns (header row required):
- app_name: logical app or product name the row belongs to
- data_type: category/type (e.g., faq, tutorial, feature)
- title: short title of the snippet
- content: the text body to index
- keywords: optional comma-separated keywords

Example:
```csv
app_name,data_type,title,content,keywords
myapp,faq,Why can't I log in?,If you've forgotten your password you can reset it...,login,password,reset
myapp,tutorial,How to Create an Account,Open the app, tap Sign up...,account,signup
```

The ingestion flow hard-deduplicates rows by (data_type, title, content).

---

## API

### POST /v1/ingest
Upload a CSV and build a store for a given company.

- Form fields:
  - company: string (namespace for this store)
  - reset: boolean (optional, default false)
  - file: CSV file

Example (PowerShell):
```powershell
Invoke-WebRequest `
  -Uri "http://127.0.0.1:8000/v1/ingest" `
  -Method POST `
  -Form @{ company="myco"; reset="true"; file=Get-Item ".\docs.csv" }
```

cURL:
```bash
curl -X POST "http://127.0.0.1:8000/v1/ingest" \
  -F "company=myco" \
  -F "reset=true" \
  -F "file=@docs.csv"
```

Response:
```json
{ "ok": true, "company": "myco", "records": 123 }
```

### POST /v1/chat
Ask a question against the company store.

- Body:
  ```json
  {
    "company": "myco",
    "query": "How do I reset my password?",
    "top_k": 6
  }
  ```

- Default (extractive MVP) response fields:
  - answer: string
  - citations: list of { data_type, title }
  - hits: ranked hits with scores and metadata (useful for debugging)

- If you enable a pure-LLM answer flow (Mistral only), you may choose to return only:
  - answer: string

Example:
```bash
curl -X POST "http://127.0.0.1:8000/v1/chat" \
  -H "Content-Type: application/json" \
  -d '{"company":"myco","query":"How to log in?","top_k":6}'
```

---

## Optional: Mistral integration

This project ships with a prompt builder and a clear extension point for LLMs.
If you add `llm_mistral.py` and wire it in `app.py`:

- Install:
  ```bash
  pip install mistralai
  ```
- Set your API key:
  ```bash
  export MISTRAL_API_KEY="your_key"  # on Windows: $env:MISTRAL_API_KEY="your_key"
  ```
- In `settings.py`, add:
  ```python
  USE_MISTRAL = True
  MISTRAL_MODEL = "mistral-small-latest"   # or "mistral-large-latest"
  MISTRAL_API_KEY = ""                     # prefer env var
  ```
- In `app.py`’s /v1/chat, call your `judge_and_answer_with_mistral(...)` using the retrieved passages. If the model returns a refusal token (e.g., `NOT_CAPABLE`), respond with a friendly “not enough context” message.

Tip: If you don't want to expose raw retrieved snippets to users, only return the LLM’s final text and omit hits/citations from the JSON response.

---

## Development tips

- Re-ingest: re-upload with `reset=true` to rebuild the store
- Stores are per-company under `stores/{company}/`
- Troubleshooting:
  - “Failed to fetch” in the frontend
    - Ensure backend is running at 127.0.0.1:8000
    - CORS: backend allows http://localhost:3000 by default
  - FAISS install on Windows
    - Try `pip install faiss-cpu`
    - Or `conda install -c conda-forge faiss-cpu`
  - ModuleNotFoundError: llm_mistral
    - Create `llm_mistral.py` and `pip install mistralai`
    - Restart the server

---

## Roadmap ideas

- Streaming answers to the frontend
- More robust citation formatting and source previews
- Better guardrails (domain restriction, semantic off-topic detection)
- Pluggable rerankers (e.g., cross-encoders)
- Multi-tenant auth and per-tenant rate limits
- Dockerization

---

## License

If you plan to open-source, add a LICENSE file (e.g., MIT, Apache-2.0). If this is private, document your internal usage terms.
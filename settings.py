from pathlib import Path

# Where we persist one FAISS index per company
STORE_ROOT = Path("stores")

# Embedding model (fast + good): 384-dim
EMBEDDING_MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"

# Retrieval defaults
TOP_K = 6
MAX_CONTEXT_CHARS = 1800  # slice retrieved chunks to keep prompt small

# Optional: LLM provider (pseudo, plug your own)
USE_OPENAI = False
OPENAI_MODEL = "gpt-4o-mini"
OPENAI_API_KEY = ""  # set env var or put here if you must

# Mistral LLM provider
USE_MISTRAL = True
MISTRAL_MODEL = "mistral-small-latest"  # or "mistral-large-latest"
MISTRAL_API_KEY = "4O4QYaX9oKCM0DBoXBpXgo3tEdTuPLAV"  # prefer env var MISTRAL_API_KEY

# Guardrail: if top retrieved cosine score is below this, treat as insufficient
MIN_TOP_SCORE = 0.22  # tune 0.18–0.30 depending on your data
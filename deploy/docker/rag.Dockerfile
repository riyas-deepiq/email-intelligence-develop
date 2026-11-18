# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────────────────────
# RAG service image — parse · OCR · embed · retrieve · rerank · generate (:8000).
#
# Two deliberate choices here, both about on-prem reality:
#
#  1. CPU-only torch. sentence-transformers pulls torch, whose default wheel
#     carries the full CUDA runtime (~2.5 GB). Installing the CPU wheel first
#     keeps the image around a third of that. Inference of the *chat* model
#     happens in Ollama/MiPhi, not here — this service only runs the small
#     cross-encoder reranker.
#  2. The reranker is baked in at build time. sentence-transformers otherwise
#     downloads it from HuggingFace on first query, which fails on an air-gapped
#     customer network. Build once with egress, ship the image without.
#
# Tesseract language packs cover the four required languages (eng/sin/tam/hin).
#
# Build context is the REPOSITORY ROOT:
#   docker build -f deploy/docker/rag.Dockerfile .
# ─────────────────────────────────────────────────────────────────────────────

FROM python:3.11.15-slim-trixie AS dependencies

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    VIRTUAL_ENV=/opt/venv \
    PATH=/opt/venv/bin:$PATH \
    HF_HOME=/opt/huggingface

WORKDIR /app

COPY RAG/requirements.txt ./
RUN --mount=type=cache,target=/root/.cache/pip \
    python -m venv "$VIRTUAL_ENV" \
 && pip install torch --index-url https://download.pytorch.org/whl/cpu \
 && pip install -r requirements.txt

# Bake the reranker into the image (see header note 2). Requires network at
# build time only. Keep in sync with RERANKER_MODEL in RAG/config.py.
ARG RERANKER_MODEL=cross-encoder/ms-marco-MiniLM-L-6-v2
RUN python -c "from sentence_transformers import CrossEncoder; CrossEncoder('${RERANKER_MODEL}')"

FROM python:3.11.15-slim-trixie AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    VIRTUAL_ENV=/opt/venv \
    PATH=/opt/venv/bin:$PATH \
    HF_HOME=/opt/huggingface \
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1

RUN apt-get update && apt-get install -y --no-install-recommends \
      tesseract-ocr \
      tesseract-ocr-eng \
      tesseract-ocr-sin \
      tesseract-ocr-tam \
      tesseract-ocr-hin \
      libgl1 \
      libglib2.0-0 \
      curl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=dependencies /opt/venv /opt/venv
COPY --from=dependencies /opt/huggingface /opt/huggingface
COPY --chown=10001:10001 RAG/config.py ./config.py
COPY --chown=10001:10001 RAG/api ./api
COPY --chown=10001:10001 RAG/db ./db
COPY --chown=10001:10001 RAG/embedding ./embedding
COPY --chown=10001:10001 RAG/ingestion ./ingestion
COPY --chown=10001:10001 RAG/llm ./llm
COPY --chown=10001:10001 RAG/retrieval ./retrieval
COPY --chown=10001:10001 RAG/scripts ./scripts
COPY --chown=10001:10001 RAG/vector_store ./vector_store
COPY deploy/docker/rag-entrypoint.sh /usr/local/bin/rag-entrypoint

# Attachment extraction from the manual /upload path writes here; the bulk
# Postgres path never has attachment bytes.
RUN useradd --create-home --uid 10001 rag \
 && mkdir -p /app/data/attachments \
 && chown -R rag:rag /app/data \
 && chmod 0555 /usr/local/bin/rag-entrypoint
USER rag

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=5 \
  CMD curl -fsS http://127.0.0.1:8000/health || exit 1

ENTRYPOINT ["rag-entrypoint"]
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000"]

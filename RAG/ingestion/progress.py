# =============================================================================
# ingestion/progress.py — Live per-stage progress for an ingestion run
# =============================================================================
"""
Tracks which stage of the pipeline a run is in, how long each took, and a
timestamped log of what happened — so the dashboard can tick each stage off as
it completes instead of showing a single opaque "running".

The stages mirror diagram.txt's ingestion flow:

    read → extract → chunk → embed → store

A subtlety worth stating, because it decides the whole design: these stages do
NOT run once each. They run once *per email or attachment*, in a loop. So
"stage 3 finished" is not a real event — the honest model is:

    pending  never produced anything yet
    running  currently the furthest stage the run has reached
    done     has produced output, and a later stage has since started

State only ever moves forward. Attachments are parsed *after* the body is
stored, so the run legitimately re-enters `extract` after `store`; without the
monotonic rule the display would flicker backwards on every email.

A stage that ends a run still `pending` is informative rather than broken —
`extract` stays pending when no message had an attachment, and saying so beats
showing a fake tick.

**What "duration" means here.** Because stages loop and overlap, a stage's
elapsed time is the wall-clock span from the first moment it ran to the moment
it was marked done. It is NOT exclusive CPU time in that stage, and the five
durations do not sum to the run's total. The UI says so rather than implying a
breakdown that would be false.

Thread-safe: both Postgres ingestion paths drive this from a ThreadPoolExecutor
with max_workers threads all reporting at once.
"""
from __future__ import annotations

import threading
import time
from collections import deque
from typing import Callable, Deque, Dict, List, Optional

# Ordered. Index position is what "earlier stage" means below.
MAIL_STAGES: List[tuple[str, str, str]] = [
    # key,       label shown to an operator,   unit of the count
    ("read",    "Reading mail",                "emails"),
    ("extract", "Extracting attachments",      "files"),
    ("chunk",   "Splitting into passages",     "passages"),
    ("embed",   "Creating fingerprints",       "vectors"),
    ("store",   "Storing in the index",        "points"),
]

ATTACHMENT_STAGES: List[tuple[str, str, str]] = [
    ("read",    "Reading attachment records",  "files"),
    ("extract", "Running OCR & text extraction", "files"),
    ("chunk",   "Splitting extracted text",    "passages"),
    ("embed",   "Creating vector fingerprints", "vectors"),
    ("store",   "Storing in the search index", "points"),
]

COMBINED_STAGES: List[tuple[str, str, str]] = [
    ("read",    "Reading new mail & files",      "items"),
    ("extract", "Running OCR & text extraction", "files"),
    ("chunk",   "Splitting searchable text",    "passages"),
    ("embed",   "Creating vector fingerprints", "vectors"),
    ("store",   "Storing in the search index",  "points"),
]

# Kept as a public compatibility alias for callers/tests that imported STAGES.
STAGES = MAIL_STAGES

PENDING, RUNNING, DONE = "pending", "running", "done"

# Enough to read a run's story, bounded so a long run cannot grow without limit.
LOG_CAPACITY = 400


class StageTracker:
    """Live per-stage state, timings and log for one ingestion run."""

    def __init__(
        self,
        job_kind: str = "mail",
        on_change: Optional[Callable[[], None]] = None,
    ) -> None:
        self.job_kind = job_kind if job_kind in {"mail", "attachments", "combined"} else "mail"
        self._stages = (
            ATTACHMENT_STAGES if self.job_kind == "attachments"
            else COMBINED_STAGES if self.job_kind == "combined"
            else MAIL_STAGES
        )
        self._order: Dict[str, int] = {
            key: i for i, (key, _, _) in enumerate(self._stages)
        }
        self._label: Dict[str, str] = {
            key: label for key, label, _ in self._stages
        }
        self._units: Dict[str, str] = {
            key: unit for key, _, unit in self._stages
        }
        self._lock = threading.Lock()
        self._state: Dict[str, str] = {key: PENDING for key, _, _ in self._stages}
        self._count: Dict[str, int] = {key: 0 for key, _, _ in self._stages}
        self._started: Dict[str, Optional[float]] = {key: None for key, _, _ in self._stages}
        self._ended:   Dict[str, Optional[float]] = {key: None for key, _, _ in self._stages}
        self._log: Deque[dict] = deque(maxlen=LOG_CAPACITY)
        self._run_started = time.time()
        self._run_ended: Optional[float] = None
        self._finished = False
        self._on_change = on_change

    def _notify_change(self) -> None:
        """Wake live observers without allowing dashboard failures to stop ingestion."""
        if self._on_change is None:
            return
        try:
            self._on_change()
        except Exception:
            # Progress reporting is observational; it must never fail the job.
            pass

    # ── Logging ──────────────────────────────────────────────────────────────

    def _append(self, level: str, message: str) -> None:
        """Caller must hold the lock."""
        self._log.append({"ts": time.time(), "level": level, "message": message})

    def log(self, message: str, level: str = "info") -> None:
        with self._lock:
            self._append(level, message)
        self._notify_change()

    # ── Reporting (called from pipeline threads) ─────────────────────────────

    def advance(self, stage: str) -> None:
        """Mark `stage` as the current one; everything before it is done."""
        idx = self._order.get(stage)
        if idx is None:
            return
        now = time.time()
        with self._lock:
            if self._finished:
                return
            for key, i in self._order.items():
                if i < idx and self._state[key] == RUNNING:
                    self._state[key] = DONE
                    self._ended[key] = now
                    self._append("info", f"{self._label[key]} — complete ({self._count[key]} {self._unit(key)})")
                elif i == idx and self._state[key] != DONE:
                    if self._state[key] != RUNNING:
                        self._started[key] = self._started[key] or now
                        self._append("info", f"{self._label[key]} — started")
                    self._state[key] = RUNNING
        self._notify_change()

    def add(self, stage: str, n: int = 1) -> None:
        """Record `n` more units produced by `stage`."""
        if n <= 0 or stage not in self._count:
            return
        with self._lock:
            self._count[stage] += n
        self._notify_change()

    def finish(self, message: Optional[str] = None, level: str = "info") -> None:
        """Run over: every stage that produced something is done."""
        now = time.time()
        with self._lock:
            if self._finished:
                return
            self._finished = True
            self._run_ended = now
            for key, _, _ in self._stages:
                if self._count[key] > 0:
                    if self._state[key] != DONE:
                        self._append("info", f"{self._label[key]} — complete ({self._count[key]} {self._unit(key)})")
                    self._state[key] = DONE
                    self._started[key] = self._started[key] or now
                    self._ended[key] = self._ended[key] or now
                elif self._state[key] == RUNNING:
                    # Reached but produced nothing — not a completed stage.
                    self._state[key] = PENDING
            if message:
                self._append(level, message)
        self._notify_change()

    # ── Reading (called from the API thread) ─────────────────────────────────

    def _unit(self, key: str) -> str:
        return self._units[key]

    def snapshot(self) -> List[dict]:
        with self._lock:
            now = time.time()
            out = []
            for key, label, unit in self._stages:
                started, ended = self._started[key], self._ended[key]
                if started is None:
                    elapsed_ms = None
                else:
                    elapsed_ms = int(((ended or now) - started) * 1000)
                out.append({
                    "key":        key,
                    "label":      label,
                    "unit":       unit,
                    "state":      self._state[key],
                    "count":      self._count[key],
                    "started_at": started,
                    "ended_at":   ended,
                    "elapsed_ms": elapsed_ms,
                })
            return out

    def log_lines(self, limit: int = LOG_CAPACITY) -> List[dict]:
        with self._lock:
            lines = list(self._log)[-limit:]
        return [{"ts": ln["ts"], "level": ln["level"], "message": ln["message"]} for ln in lines]

    def run_elapsed_ms(self) -> int:
        with self._lock:
            return int(((self._run_ended or time.time()) - self._run_started) * 1000)

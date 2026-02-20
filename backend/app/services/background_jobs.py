from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor
import logging
import threading
import uuid

from app.core.config import settings

logger = logging.getLogger(__name__)

_executor: ThreadPoolExecutor | None = None
_executor_lock = threading.Lock()


def _get_executor() -> ThreadPoolExecutor:
    global _executor
    with _executor_lock:
        if _executor is None:
            _executor = ThreadPoolExecutor(
                max_workers=settings.BACKGROUND_WORKERS,
                thread_name_prefix="popinn-bg",
            )
        return _executor


def _log_future_result(job_name: str, task_id: str, future: Future) -> None:
    try:
        future.result()
        logger.info("%s job %s finished", job_name, task_id)
    except Exception:
        logger.exception("%s job %s failed", job_name, task_id)


def submit_job(job_name: str, fn: Callable, *args, **kwargs) -> str:
    task_id = str(uuid.uuid4())
    future = _get_executor().submit(fn, *args, **kwargs)
    future.add_done_callback(lambda f: _log_future_result(job_name, task_id, f))
    logger.info("%s job %s queued", job_name, task_id)
    return task_id


def shutdown_background_jobs(wait: bool = False) -> None:
    global _executor
    with _executor_lock:
        executor = _executor
        _executor = None
    if executor is not None:
        executor.shutdown(wait=wait, cancel_futures=False)

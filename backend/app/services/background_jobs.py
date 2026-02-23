from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor
import logging
import threading
import uuid

from app.core.config import settings

logger = logging.getLogger(__name__)

_executor: ThreadPoolExecutor | None = None
_executor_lock = threading.Lock()
_cancel_events: dict[str, threading.Event] = {}
_cancel_events_lock = threading.Lock()


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


def _clear_cancel_event(cancel_key: str | None) -> None:
    if not cancel_key:
        return
    with _cancel_events_lock:
        _cancel_events.pop(cancel_key, None)


def request_cancel(cancel_key: str) -> bool:
    with _cancel_events_lock:
        event = _cancel_events.get(cancel_key)
    if event is None:
        return False
    event.set()
    return True


def is_cancel_requested(cancel_key: str) -> bool:
    with _cancel_events_lock:
        event = _cancel_events.get(cancel_key)
    return bool(event and event.is_set())


def submit_job(job_name: str, fn: Callable, *args, cancel_key: str | None = None, **kwargs) -> str:
    task_id = str(uuid.uuid4())
    if cancel_key:
        with _cancel_events_lock:
            _cancel_events[cancel_key] = threading.Event()

    def _run_with_cleanup():
        try:
            return fn(*args, **kwargs)
        finally:
            _clear_cancel_event(cancel_key)

    future = _get_executor().submit(_run_with_cleanup)
    future.add_done_callback(lambda f: _log_future_result(job_name, task_id, f))
    logger.info("%s job %s queued", job_name, task_id)
    return task_id


def shutdown_background_jobs(wait: bool = False) -> None:
    global _executor
    with _executor_lock:
        executor = _executor
        _executor = None
    with _cancel_events_lock:
        _cancel_events.clear()
    if executor is not None:
        executor.shutdown(wait=wait, cancel_futures=False)

import asyncio
import os
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch
import main


class LifecycleTests(unittest.TestCase):
    def test_teardown_waits_for_worker_unloads_model_and_clears_cache(self):
        order = []
        native = Mock()
        native.unload_model.side_effect = lambda: order.append('unload')
        model = SimpleNamespace(model=native)
        pool = Mock()
        pool.shutdown.side_effect = lambda **kwargs: order.append('shutdown')
        async def lifecycle():
            with patch.object(main, 'create_model', return_value=model), patch.object(main, 'ThreadPoolExecutor', return_value=pool), patch.object(main, 'clear_vad_cache', side_effect=lambda: order.append('cache')), patch.dict(os.environ, {}, clear=True):
                async with main.lifespan(main.app):
                    self.assertTrue(main.app.state.ready)
                    self.assertIs(main.app.state.executor, pool)
                self.assertFalse(main.app.state.ready)
                self.assertFalse(hasattr(main.app.state, 'model'))
                self.assertFalse(hasattr(main.app.state, 'executor'))
        asyncio.run(lifecycle())
        self.assertEqual(order, ['shutdown', 'unload', 'cache'])
        pool.shutdown.assert_called_once_with(wait=True, cancel_futures=True)

    def test_teardown_runs_when_application_raises(self):
        model = SimpleNamespace(model=Mock())
        async def lifecycle():
            with patch.object(main, 'create_model', return_value=model), patch.object(main, 'clear_vad_cache'), patch.dict(os.environ, {}, clear=True):
                with self.assertRaisesRegex(RuntimeError, 'fixture'):
                    async with main.lifespan(main.app):
                        raise RuntimeError('fixture')
        asyncio.run(lifecycle())
        model.model.unload_model.assert_called_once()

    def test_real_owned_worker_thread_exits_at_shutdown(self):
        model = SimpleNamespace(model=Mock())
        async def lifecycle():
            with patch.object(main, 'create_model', return_value=model), patch.object(main, 'clear_vad_cache'), patch.dict(os.environ, {}, clear=True):
                async with main.lifespan(main.app):
                    name = await main.run_in_threadpool(lambda: threading.current_thread().name)
                    self.assertTrue(name.startswith('vmi-asr'))
                self.assertFalse(any(t.name.startswith('vmi-asr') for t in threading.enumerate()))
        asyncio.run(lifecycle())

    def test_cancelled_waiter_keeps_overload_gate_until_native_work_finishes(self):
        model = SimpleNamespace(model=Mock())
        started, release = threading.Event(), threading.Event()
        def work():
            started.set(); release.wait(timeout=2); return 'done'
        async def lifecycle():
            with patch.object(main, 'create_model', return_value=model), patch.object(main, 'clear_vad_cache'), patch.dict(os.environ, {}, clear=True):
                async with main.lifespan(main.app):
                    pending = asyncio.create_task(main.run_in_threadpool(work))
                    await asyncio.sleep(0)
                    self.assertTrue(started.wait(timeout=1))
                    pending.cancel()
                    with self.assertRaises(asyncio.CancelledError): await pending
                    with self.assertRaises(main.HTTPException) as error: await main.run_in_threadpool(lambda: None)
                    self.assertEqual(error.exception.status_code, 503)
                    release.set()
                    for _ in range(100):
                        if not main.app.state.dispatch_lock.locked(): break
                        await asyncio.sleep(0.01)
                    self.assertEqual(await main.run_in_threadpool(lambda: 'retry'), 'retry')
        try: asyncio.run(lifecycle())
        finally: release.set()

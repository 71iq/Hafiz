import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('control', Path(__file__).resolve().parents[1] / 'control.py')
control = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(control)


def task(task_id='T1', status='pending', dependencies=None):
    return {'id': task_id, 'title': 'Simplify fixture', 'status': status, 'approved': True,
            'dependencies': dependencies or [], 'allowed_paths': ['fixture.txt'],
            'verification': [[sys.executable, '-c', 'print("verified fixture")']]}


class SelectionTests(unittest.TestCase):
    def test_waits_for_verified_dependencies(self):
        first = task()
        second = task('T2', dependencies=['T1'])
        self.assertIs(control.select_task([first, second]), first)
        first['status'] = 'verified'
        self.assertIs(control.select_task([first, second]), second)

    def test_recovers_unfinished_task_before_new_work(self):
        active = task('T2', status='retry')
        self.assertIs(control.select_task([task(), active]), active)

    def test_ignores_unapproved_and_blocked_tasks(self):
        first = task()
        first['approved'] = False
        self.assertIsNone(control.select_task([first, task('T2', status='blocked')]))

    def test_scope_does_not_override_protected_paths(self):
        broad = task()
        broad['allowed_paths'] = ['*']
        for path in ['assets/data/quran.db', 'supabase/schema.sql', 'android/app/build.gradle',
                     'AGENTS.md', '.env.local', 'scripts/ralph/control.py', '.github/workflows/a.yml']:
            with self.subTest(path=path):
                self.assertFalse(control.path_allowed(path, broad))
        self.assertTrue(control.path_allowed('lib/example.ts', broad))

    def test_dynamic_route_brackets_match_literal_paths(self):
        dynamic = task()
        dynamic['allowed_paths'] = ['app/profile/[userId].tsx']
        self.assertTrue(control.path_allowed('app/profile/[userId].tsx', dynamic))
        self.assertFalse(control.path_allowed('app/profile/u.tsx', dynamic))
        dynamic['allowed_paths'] = ['app/*/[userId].tsx']
        self.assertTrue(control.path_allowed('app/profile/[userId].tsx', dynamic))
        self.assertFalse(control.path_allowed('app/profile/u.tsx', dynamic))

    def test_staged_protected_rename_source_is_denied(self):
        candidate = task()
        candidate['allowed_paths'] = ['lib/new.ts']
        self.assertFalse(control.path_allowed('assets/data/old.ts', candidate))
        self.assertTrue(control.path_allowed('lib/new.ts', candidate))


class IterationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.state = self.root / '.ralph'
        self.docs = self.root / 'docs/refactoring'
        self.docs.mkdir(parents=True)
        self.state.mkdir()
        self.backlog = self.docs / 'backlog.json'
        self.config = self.root / 'config.json'
        self.config.write_text(json.dumps({'max_attempts': 2, 'batch_seconds': 30, 'session_seconds': 5, 'batch_tokens': 1000}))
        (self.root / '.gitignore').write_text('.ralph/\nstop.md\n')
        (self.root / 'fixture.txt').write_text('before\n')
        (self.docs / 'PROGRESS.md').write_text('# Progress\n')
        self.backlog.write_text(json.dumps({'tasks': [task()]}))
        self.git('init', '-q')
        self.git('config', 'user.name', 'Fixture')
        self.git('config', 'user.email', 'fixture@example.invalid')
        self.git('config', 'commit.gpgsign', 'false')
        self.git('add', '.')
        self.git('commit', '-qm', 'fixture baseline')
        self.patch = patch.multiple(control, ROOT=self.root, STATE=self.state, BACKLOG=self.backlog,
                                    CONFIG=self.config, STOP=self.root / 'stop.md')
        self.patch.start()
        self.addCleanup(self.patch.stop)
        control.write_json(self.state / 'smoke-passed.json', {'passed': True})
        control.write_json(self.state / 'batch.json', {'started_epoch': control.time.time(), 'tokens': 0})

    def git(self, *args):
        return subprocess.check_output(['git', *args], cwd=self.root, text=True).strip()

    def current_task(self):
        return control.read_json(self.backlog)['tasks'][0]

    def generate(self, *_args, **_kwargs):
        (self.root / 'fixture.txt').write_text('after\n')
        return {'status': 'implemented', 'summary': 'Fixture simplified', 'evidence': []}

    def test_success_requires_commands_and_review_before_commit(self):
        def run_agent(*args, **kwargs):
            return {'verdict': 'pass', 'findings': []} if kwargs.get('readonly') else self.generate()
        with patch('sys.stdin.read', return_value='prompt'), patch.object(control, 'agent', side_effect=run_agent):
            control.iteration()
        self.assertEqual(self.current_task()['status'], 'verified')
        self.assertTrue(self.git('log', '-1', '--format=%s').startswith('T1:'))
        self.assertEqual(self.git('status', '--porcelain'), '')
        evidence = self.root / self.current_task()['evidence']
        self.assertEqual(control.read_json(evidence / 'verification.json')[0]['exit'], 0)

    def test_rejected_review_preserves_diff_and_exhausts_after_two_attempts(self):
        head = self.git('rev-parse', 'HEAD')
        def run_agent(*args, **kwargs):
            return {'verdict': 'fail', 'findings': ['Missing regression case']} if kwargs.get('readonly') else self.generate()
        for expected in ['retry', 'blocked']:
            with patch('sys.stdin.read', return_value='prompt'), patch.object(control, 'agent', side_effect=run_agent):
                with self.assertRaisesRegex(RuntimeError, 'Independent review failed'):
                    control.iteration()
            self.assertEqual(self.current_task()['status'], expected)
            self.assertEqual(self.git('rev-parse', 'HEAD'), head)
            self.assertEqual((self.root / 'fixture.txt').read_text(), 'after\n')
        self.assertTrue((self.root / 'stop.md').exists())

    def test_failed_command_cannot_be_marked_verified(self):
        data = control.read_json(self.backlog)
        data['tasks'][0]['verification'] = [[sys.executable, '-c', 'raise SystemExit(7)']]
        control.write_json(self.backlog, data)
        self.git('add', '.')
        self.git('commit', '-qm', 'failing verification fixture')
        with patch('sys.stdin.read', return_value='prompt'), patch.object(control, 'agent', side_effect=self.generate):
            with self.assertRaisesRegex(RuntimeError, 'Verification failed'):
                control.iteration()
        self.assertEqual(self.current_task()['status'], 'retry')

    def test_out_of_scope_change_stops_before_review(self):
        def generate(*_args, **_kwargs):
            (self.root / 'unrelated.txt').write_text('keep for inspection')
            return {'status': 'implemented', 'summary': 'bad scope', 'evidence': []}
        with patch('sys.stdin.read', return_value='prompt'), patch.object(control, 'agent', side_effect=generate) as agent:
            with self.assertRaisesRegex(RuntimeError, 'paths invalid'):
                control.iteration()
            self.assertEqual(agent.call_count, 1)
        self.assertTrue((self.root / 'unrelated.txt').exists())

    def test_exhausted_batch_does_not_spend_task_attempt(self):
        control.write_json(self.state / 'batch.json', {'started_epoch': control.time.time(), 'tokens': 1000})
        with patch('sys.stdin.read', return_value='prompt'), patch.object(control, 'agent') as agent:
            control.iteration()
            agent.assert_not_called()
        self.assertEqual(self.current_task()['status'], 'pending')
        self.assertEqual(self.current_task().get('attempts', 0), 0)
        self.assertTrue((self.root / 'stop.md').exists())

    def test_review_budget_limit_preserves_retry_without_spending_attempt(self):
        def run_agent(*args, **kwargs):
            if kwargs.get('readonly'):
                raise control.BatchLimit('Batch resource limit reached')
            return self.generate()
        with patch('sys.stdin.read', return_value='prompt'), patch.object(control, 'agent', side_effect=run_agent):
            control.iteration()
        self.assertEqual(self.current_task()['status'], 'retry')
        self.assertEqual(self.current_task()['attempts'], 0)
        self.assertEqual((self.root / 'fixture.txt').read_text(), 'after\n')

    def test_command_timeout_preserves_generation_and_reruns_checks_before_review(self):
        config = control.read_json(self.config)
        config['session_seconds'] = 0.3
        control.write_json(self.config, config)
        backlog = control.read_json(self.backlog)
        backlog['tasks'][0]['verification'] = [
            [sys.executable, '-c',
             'from pathlib import Path; '
             'p=Path(".ralph/check-runs"); '
             'p.write_text((p.read_text() if p.exists() else "") + "ran\\n")'],
            [sys.executable, '-c',
             'from pathlib import Path; import time; '
             'p=Path(".ralph/slow-once"); first=not p.exists(); '
             'p.touch(); time.sleep(2 if first else 0)'],
        ]
        control.write_json(self.backlog, backlog)
        self.git('add', '.')
        self.git('commit', '-qm', 'timeout verification fixture')
        head = self.git('rev-parse', 'HEAD')

        def run_agent(*args, **kwargs):
            return {'verdict': 'pass', 'findings': []} if kwargs.get('readonly') else self.generate()

        with patch('sys.stdin.read', return_value='prompt'), patch.object(control, 'agent', side_effect=run_agent) as agent:
            control.iteration()
            self.assertEqual(agent.call_count, 1)
            self.assertEqual(self.current_task()['status'], 'retry')
            self.assertEqual(self.current_task()['attempts'], 0)
            self.assertEqual(self.current_task()['resource_timeouts'], 1)
            self.assertIn('Time limit 0.3s exceeded', self.current_task()['failure'])
            self.assertEqual(self.git('rev-parse', 'HEAD'), head)
            self.assertEqual((self.root / 'fixture.txt').read_text(), 'after\n')
            self.assertIsNotNone(control.generation_checkpoint(self.current_task()))
            self.assertIsNone(control.CHILD)
            self.assertEqual((self.state / 'check-runs').read_text(), 'ran\n')
            interrupted = next((self.state / 'runs').iterdir())
            self.assertEqual([entry['exit'] for entry in control.read_json(interrupted / 'verification.json')], [0])

            control.write_json(self.state / 'batch.json', {'started_epoch': control.time.time(), 'tokens': 0})
            control.iteration()

        self.assertEqual(agent.call_count, 2)
        self.assertTrue(agent.call_args.kwargs['readonly'])
        self.assertEqual((self.state / 'check-runs').read_text(), 'ran\nran\n')
        self.assertEqual(self.current_task()['status'], 'verified')
        evidence = self.root / self.current_task()['evidence']
        self.assertEqual([entry['exit'] for entry in control.read_json(evidence / 'verification.json')], [0, 0])

    def test_repeated_command_timeouts_block_without_spending_implementation_attempts(self):
        config = control.read_json(self.config)
        config.update({'session_seconds': 0.3, 'max_resource_timeouts': 2})
        control.write_json(self.config, config)
        backlog = control.read_json(self.backlog)
        backlog['tasks'][0]['verification'] = [[sys.executable, '-c', 'import time; time.sleep(2)']]
        control.write_json(self.backlog, backlog)
        self.git('add', '.')
        self.git('commit', '-qm', 'repeated timeout fixture')
        head = self.git('rev-parse', 'HEAD')
        with patch('sys.stdin.read', return_value='prompt'), patch.object(control, 'agent', side_effect=self.generate) as agent:
            for count, expected in [(1, 'retry'), (2, 'blocked')]:
                control.write_json(self.state / 'batch.json', {'started_epoch': control.time.time(), 'tokens': 0})
                control.iteration()
                self.assertEqual(self.current_task()['status'], expected)
                self.assertEqual(self.current_task()['resource_timeouts'], count)
                self.assertEqual(self.current_task()['attempts'], 0)
                self.assertEqual(self.git('rev-parse', 'HEAD'), head)
                self.assertTrue((self.state / 'generation-checkpoint.json').exists())
                if expected == 'retry':
                    self.assertIsNotNone(control.generation_checkpoint(self.current_task()))
                else:
                    self.assertIsNone(control.generation_checkpoint(self.current_task()))
        self.assertEqual(agent.call_count, 1)
        self.assertTrue(control.STOP.exists())

    def exhaust_after_generation(self):
        def generate(*_args, **_kwargs):
            result = self.generate()
            control.write_json(self.state / 'batch.json', {'started_epoch': control.time.time(), 'tokens': 1000})
            return result
        with patch('sys.stdin.read', return_value='prompt'), patch.object(control, 'agent', side_effect=generate):
            control.iteration()
        self.assertEqual(self.current_task()['status'], 'retry')
        self.assertEqual(self.current_task()['attempts'], 0)
        control.write_json(self.state / 'batch.json', {'started_epoch': control.time.time(), 'tokens': 0})

    def test_budget_resume_verifies_and_reviews_without_repeating_generation(self):
        self.exhaust_after_generation()
        with patch('sys.stdin.read', return_value='prompt'), patch.object(control, 'agent', return_value={'verdict': 'pass', 'findings': []}) as agent:
            control.iteration()
        self.assertEqual(agent.call_count, 1)
        self.assertTrue(agent.call_args.kwargs['readonly'])
        self.assertEqual(self.current_task()['status'], 'verified')
        evidence = self.root / self.current_task()['evidence']
        self.assertEqual(control.read_json(evidence / 'verification.json')[0]['exit'], 0)

    def test_checkpoint_rejects_changed_candidate_specification_head_or_index(self):
        self.exhaust_after_generation()
        candidate = self.current_task()
        self.assertIsNotNone(control.generation_checkpoint(candidate))
        (self.root / 'fixture.txt').write_text('changed after checkpoint\n')
        self.assertIsNone(control.generation_checkpoint(candidate))
        (self.root / 'fixture.txt').write_text('after\n')
        self.assertIsNotNone(control.generation_checkpoint(candidate))
        changed_spec = dict(candidate, acceptance_criteria=['New mandatory criterion'])
        self.assertIsNone(control.generation_checkpoint(changed_spec))
        config = self.config.read_text()
        self.config.write_text(config.replace('1000', '2000'))
        self.assertIsNone(control.generation_checkpoint(candidate))
        self.config.write_text(config)
        self.assertIsNotNone(control.generation_checkpoint(candidate))
        self.git('add', 'fixture.txt')
        self.assertIsNone(control.generation_checkpoint(candidate))
        self.git('commit', '-qm', 'changed base')
        self.assertIsNone(control.generation_checkpoint(candidate))

    def test_rejected_review_invalidates_generation_checkpoint(self):
        self.exhaust_after_generation()
        with patch('sys.stdin.read', return_value='prompt'), patch.object(control, 'agent', return_value={'verdict': 'fail', 'findings': ['Missing regression case']}):
            with self.assertRaisesRegex(RuntimeError, 'Independent review failed'):
                control.iteration()
        self.assertIsNone(control.generation_checkpoint(self.current_task()))

    def test_changed_checkpoint_candidate_returns_to_generator(self):
        self.exhaust_after_generation()
        (self.root / 'fixture.txt').write_text('external edit\n')
        def run_agent(*args, **kwargs):
            return {'verdict': 'pass', 'findings': []} if kwargs.get('readonly') else self.generate()
        with patch('sys.stdin.read', return_value='prompt'), patch.object(control, 'agent', side_effect=run_agent) as agent:
            control.iteration()
        self.assertEqual(agent.call_count, 2)
        self.assertEqual(self.current_task()['status'], 'verified')

    def test_agent_cannot_modify_checkpoint_even_on_timeout(self):
        self.exhaust_after_generation()
        checkpoint = self.state / 'generation-checkpoint.json'
        directory = self.state / 'timeout-checkpoint'
        directory.mkdir()
        def timed_out(*_args, **_kwargs):
            checkpoint.write_text('{}')
            raise RuntimeError('Time limit')
        config = control.read_json(self.config)
        config.update({'model': 'fixture', 'reasoning_effort': 'low'})
        with patch.object(control, 'run_process', side_effect=timed_out):
            with self.assertRaisesRegex(control.InvariantError, 'executable configuration'):
                control.agent('fixture prompt', control.GENERATOR_SCHEMA, directory, 'generator', config)

    def test_reconciles_verified_record_without_commit(self):
        backlog = control.read_json(self.backlog)
        backlog['tasks'][0]['status'] = 'verified'
        control.reconcile_status(backlog)
        self.assertEqual(backlog['tasks'][0]['status'], 'retry')

    def test_changed_paths_includes_hidden_index_changes_and_rename_sources(self):
        (self.root / 'fixture.txt').write_text('staged\n')
        self.git('add', 'fixture.txt')
        (self.root / 'fixture.txt').write_text('before\n')
        self.assertIn('fixture.txt', control.changed_paths())
        self.git('mv', 'fixture.txt', 'renamed.txt')
        self.assertIn('fixture.txt', control.changed_paths())
        self.assertIn('renamed.txt', control.changed_paths())

    def test_failed_verification_cannot_hide_controller_mutation(self):
        def fail_verification(*_args):
            (self.docs / 'PROGRESS.md').write_text('tampered')
            raise RuntimeError('command failed')
        with patch('sys.stdin.read', return_value='prompt'), patch.object(control, 'agent', side_effect=self.generate), patch.object(control, 'verify_commands', side_effect=fail_verification):
            with self.assertRaisesRegex(control.InvariantError, 'Verification changed controller'):
                control.iteration()
        self.assertEqual(self.current_task()['status'], 'blocked')
        self.assertTrue((self.root / 'stop.md').exists())

    def test_agent_timeout_cannot_hide_runner_mutation(self):
        (self.state / '.env').write_text('safe')
        directory = self.state / 'timeout'
        directory.mkdir()
        def timed_out(*_args, **_kwargs):
            (self.state / '.env').write_text('tampered')
            raise RuntimeError('Time limit')
        config = control.read_json(self.config)
        config.update({'model': 'fixture', 'reasoning_effort': 'low'})
        with patch.object(control, 'run_process', side_effect=timed_out):
            with self.assertRaisesRegex(control.InvariantError, 'executable configuration'):
                control.agent('fixture prompt', control.GENERATOR_SCHEMA, directory, 'generator', config)
        self.assertTrue(control.read_json(self.state / 'batch.json')['usage_unknown'])

    def test_worker_lease_survives_parent_descriptor_close(self):
        import fcntl
        lease_path = self.state / 'test.lock'
        with lease_path.open('a') as lease:
            fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
            child = subprocess.Popen([sys.executable, '-c', 'import time;time.sleep(3)'], pass_fds=(lease.fileno(),))
        try:
            with lease_path.open('a') as competing:
                with self.assertRaises(BlockingIOError):
                    fcntl.flock(competing, fcntl.LOCK_EX | fcntl.LOCK_NB)
        finally:
            child.terminate()
            child.wait()
        with lease_path.open('a') as released:
            fcntl.flock(released, fcntl.LOCK_EX | fcntl.LOCK_NB)

    def test_unrelated_dirty_work_is_never_claimed(self):
        (self.root / 'unrelated.txt').write_text('user work')
        with patch('sys.stdin.read', return_value='prompt'), patch.object(control, 'agent') as agent:
            with self.assertRaisesRegex(RuntimeError, 'Unexpected checkout changes'):
                control.iteration()
            agent.assert_not_called()
        self.assertEqual(self.current_task()['status'], 'pending')


if __name__ == '__main__':
    unittest.main()

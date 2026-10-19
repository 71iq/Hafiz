#!/usr/bin/env python3
"""Bounded task/review adapter for the pinned SantanderAI Ralph loop."""
import argparse
import datetime
import fcntl
import fnmatch
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]
STATE = ROOT / '.ralph'
BACKLOG = ROOT / 'docs/refactoring/backlog.json'
CONFIG = ROOT / 'scripts/ralph/config.json'
STOP = ROOT / 'stop.md'
STOP_PREFIX = 'Hafiz Ralph controller:'
CHILD = None
LEASES = ()


class BatchLimit(RuntimeError):
    pass


class CommandTimeout(BatchLimit):
    pass


class InvariantError(RuntimeError):
    pass


def read_json(path):
    return json.loads(path.read_text())


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + '.tmp')
    tmp.write_text(json.dumps(value, indent=2) + '\n')
    tmp.replace(path)


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, text=True).strip()


def changed_paths():
    paths = set()
    for args in [('diff', '--name-only', '--no-renames', 'HEAD', '-z'),
                 ('diff', '--cached', '--name-only', '--no-renames', '-z'),
                 ('diff', '--name-only', '--no-renames', '-z'),
                 ('ls-files', '--others', '--exclude-standard', '-z')]:
        paths.update(p for p in subprocess.check_output(['git', *args], cwd=ROOT).decode().split('\0') if p)
    return sorted(paths)


def controller_snapshot():
    paths = [BACKLOG, CONFIG, ROOT / 'docs/refactoring/PROGRESS.md', STATE / '.env',
             STATE / 'generation-checkpoint.json']
    paths.extend((ROOT / 'scripts/ralph').rglob('*'))
    return {str(p): p.read_bytes() for p in paths if p.is_file() and '__pycache__' not in p.parts}


def reconcile_status(backlog):
    try:
        committed = json.loads(git('show', 'HEAD:docs/refactoring/backlog.json'))
    except (subprocess.CalledProcessError, ValueError):
        return
    statuses = {t['id']: t['status'] for t in committed['tasks']}
    for task in backlog['tasks']:
        if task['status'] == 'verified' and statuses.get(task['id']) != 'verified':
            task['status'] = 'retry'
            task['failure'] = 'Recovered interruption before verified task was committed. Reverify preserved diff.'


def select_task(tasks):
    # Recover the same unfinished task before considering another task.
    active = [t for t in tasks if t['status'] in ('running', 'retry')]
    if active:
        return active[0]
    done = {t['id'] for t in tasks if t['status'] == 'verified'}
    return next((t for t in tasks if t['status'] == 'pending' and t.get('approved', False)
                 and all(d in done for d in t['dependencies'])), None)


def path_allowed(path, task):
    hard_denied = ['assets/', 'public/', 'supabase/', 'android/', 'ios/', '.github/',
                   'lib/database/native-loaders', 'lib/translations/translation-requires',
                   'lib/fonts/qpc-', 'scripts/ralph/', '.agents/', '.claude/']
    if path in ('AGENTS.md', '.gitignore') or path.startswith('.env'):
        return False
    if any(path.startswith(p) for p in hard_denied):
        return False
    for pattern in task['allowed_paths']:
        if path == pattern:
            return True
        if ('*' in pattern or '?' in pattern) and fnmatch.fnmatchcase(path, pattern.replace('[', '[[]')):
            return True
    return False


def generation_identity(task):
    runtime = {'status', 'attempts', 'resource_timeouts', 'started_at', 'completed_at', 'failure', 'evidence', 'summary'}
    specification = {k: v for k, v in task.items() if k not in runtime}
    owned = {'docs/refactoring/backlog.json', 'docs/refactoring/PROGRESS.md'}
    paths = [p for p in changed_paths() if p not in owned]
    if not paths or any(not path_allowed(p, task) for p in paths):
        return None
    files = {}
    for path in paths:
        source = ROOT / path
        if source.is_symlink():
            value = {'link': os.readlink(source)}
        elif source.is_file():
            value = {'sha256': hashlib.sha256(source.read_bytes()).hexdigest()}
        elif not source.exists():
            value = {'deleted': True}
        else:
            return None
        if source.exists() or source.is_symlink():
            value['mode'] = source.lstat().st_mode
        files[path] = value
    return {'specification': specification, 'head': git('rev-parse', 'HEAD'),
            'config': read_json(CONFIG), 'files': files,
            'index': hashlib.sha256(git('diff', '--cached', '--binary', '--no-renames').encode()).hexdigest()}


def save_generation_checkpoint(task, result, directory):
    identity = generation_identity(task)
    if identity is None or result.get('status') != 'implemented':
        raise InvariantError('Cannot checkpoint an invalid generation')
    record = {'version': 1, 'identity': identity, 'result': result,
              'evidence': str(directory.relative_to(ROOT))}
    write_json(STATE / 'generation-checkpoint.json', record)
    return record


def generation_checkpoint(task):
    if task['status'] not in ('running', 'retry'):
        return None
    try:
        record = read_json(STATE / 'generation-checkpoint.json')
        if (record['version'] == 1 and record['identity'] == generation_identity(task)
                and record['result']['status'] == 'implemented'):
            return record
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return None


def log_event(event, **fields):
    STATE.mkdir(exist_ok=True)
    with (STATE / 'events.jsonl').open('a') as stream:
        stream.write(json.dumps({'time': now(), 'event': event, **fields}) + '\n')


def stop(reason):
    STOP.write_text(f'{STOP_PREFIX} {reason}\n')
    log_event('stopped', reason=reason)


def terminate_child(*_args):
    stop('Interrupted. Wait for the writer lease to be released before resuming.')
    if CHILD and CHILD.poll() is None:
        os.killpg(CHILD.pid, signal.SIGTERM)
        try:
            CHILD.wait(timeout=10)
        except subprocess.TimeoutExpired:
            os.killpg(CHILD.pid, signal.SIGKILL)
            CHILD.wait()
    raise InterruptedError('Process interrupted. Resume preserves the current task and diff.')


def run_process(argv, logfile, timeout, stdin=None, env=None):
    global CHILD
    logfile.parent.mkdir(parents=True, exist_ok=True)
    with logfile.open('w') as output:
        CHILD = subprocess.Popen(argv, cwd=ROOT, stdin=subprocess.PIPE if stdin is not None else subprocess.DEVNULL,
                                 stdout=output, stderr=subprocess.STDOUT, text=True,
                                 start_new_session=True, env=env, pass_fds=LEASES)
        try:
            CHILD.communicate(input=stdin, timeout=timeout)
            return CHILD.returncode
        except subprocess.TimeoutExpired:
            os.killpg(CHILD.pid, signal.SIGTERM)
            try:
                CHILD.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(CHILD.pid, signal.SIGKILL)
                CHILD.wait()
            raise CommandTimeout(f'Time limit {timeout}s exceeded; see {logfile.relative_to(ROOT)}')
        finally:
            CHILD = None


def remaining_seconds(config):
    batch = read_json(STATE / 'batch.json')
    seconds = config['batch_seconds'] - (time.time() - batch['started_epoch'])
    if seconds <= 0 or batch['tokens'] >= config['batch_tokens']:
        raise BatchLimit('Batch resource limit reached')
    return min(config['session_seconds'], seconds)


def account_tokens(logfile):
    batch = read_json(STATE / 'batch.json')
    recorded = False
    if logfile.exists():
        for line in logfile.read_text().splitlines():
            try:
                event = json.loads(line)
                if event.get('type') == 'turn.completed':
                    usage = event.get('usage', {})
                    batch['tokens'] += usage.get('input_tokens', 0) + usage.get('output_tokens', 0)
                    recorded = True
            except (ValueError, TypeError):
                pass
    if not recorded:
        # Usage is unknown on termination. Exhaust this batch rather than assume zero.
        batch['usage_unknown'] = True
        batch['tokens'] = read_json(CONFIG)['batch_tokens']
    write_json(STATE / 'batch.json', batch)


def account_limit_reached(logfile):
    terminal = None
    if logfile.exists():
        for line in logfile.read_text().splitlines():
            try:
                event = json.loads(line)
            except ValueError:
                continue
            if isinstance(event, dict) and event.get('type') in ('turn.failed', 'turn.completed'):
                terminal = event
    if terminal is None or terminal['type'] != 'turn.failed':
        return False
    error = terminal.get('error')
    message = error.get('message') if isinstance(error, dict) else None
    return isinstance(message, str) and message.replace('\u2019', "'").startswith("You've hit your usage limit.")


def agent(prompt, schema, directory, role, config, readonly=False):
    schema_path = directory / f'{role}-schema.json'
    result_path = directory / f'{role}-result.json'
    write_json(schema_path, schema)
    (directory / f'{role}-prompt.md').write_text(prompt)
    args = [os.environ.get('HAFIZ_CODEX_BIN', 'codex'), 'exec', '--json',
            '--sandbox', 'read-only' if readonly else 'workspace-write',
            '-c', 'approval_policy="never"', '-c', 'sandbox_workspace_write.network_access=false',
            '-c', f'model_reasoning_effort="{config["reasoning_effort"]}"',
            '-m', config['model'] if readonly else config.get('generator_model', config['model']), '--output-schema', str(schema_path),
            '--output-last-message', str(result_path), '-']
    snapshot = controller_snapshot()
    batch_before = (STATE / 'batch.json').read_bytes()
    code = None
    try:
        code = run_process(args, directory / f'{role}.jsonl', remaining_seconds(config), stdin=prompt)
    finally:
        invariant_changed = controller_snapshot() != snapshot
        identity_changed = (STATE / 'batch.json').read_bytes() != batch_before
        account_tokens(directory / f'{role}.jsonl')
        if invariant_changed:
            raise InvariantError('Agent modified controller-owned documents or executable configuration')
        if identity_changed:
            raise InvariantError('Batch state changed during agent session')
    batch = read_json(STATE / 'batch.json')
    if code or not result_path.exists():
        if account_limit_reached(directory / f'{role}.jsonl'):
            raise BatchLimit(f'{role} stopped at account usage limit; see {directory.relative_to(ROOT)}/{role}.jsonl')
        raise RuntimeError(f'{role} exited {code}; see {directory.relative_to(ROOT)}/{role}.jsonl')
    result = read_json(result_path)
    # Fail closed even if the CLI did not enforce its output schema.
    for key in schema['required']:
        if key not in result:
            raise RuntimeError(f'{role} response omitted {key}')
    verdict_key = 'verdict' if 'verdict' in schema['properties'] else 'status'
    if result[verdict_key] not in schema['properties'][verdict_key]['enum']:
        raise RuntimeError(f'{role} returned an invalid verdict')
    return result


GENERATOR_SCHEMA = {'type': 'object', 'properties': {
    'status': {'type': 'string', 'enum': ['implemented', 'blocked']},
    'summary': {'type': 'string'}, 'evidence': {'type': 'array', 'items': {'type': 'string'}}},
    'required': ['status', 'summary', 'evidence'], 'additionalProperties': False}
REVIEW_SCHEMA = {'type': 'object', 'properties': {
    'verdict': {'type': 'string', 'enum': ['pass', 'fail']},
    'findings': {'type': 'array', 'items': {'type': 'string'}}},
    'required': ['verdict', 'findings'], 'additionalProperties': False}


def document_progress(task, message):
    with (ROOT / 'docs/refactoring/PROGRESS.md').open('a') as stream:
        stream.write(f'\n- {now()} `{task["id"]}` {task["status"]}. {message}\n')


def verify_commands(task, directory, config):
    evidence = []
    for index, command in enumerate(task['verification']):
        if not isinstance(command, list) or not command or not all(isinstance(x, str) for x in command):
            raise RuntimeError('Verification must be an argv array')
        logfile = directory / f'verify-{index}.log'
        code = run_process(command, logfile, remaining_seconds(config))
        evidence.append({'argv': command, 'exit': code, 'log': str(logfile.relative_to(ROOT))})
        write_json(directory / 'verification.json', evidence)
        if code:
            raise RuntimeError(f'Verification failed: {command}; see {logfile.relative_to(ROOT)}')
    write_json(directory / 'verification.json', evidence)


def generator_prompt(task):
    mode = task.get('implementation_mode', 'implementation')
    if mode == 'copy-only':
        payload = {k: v for k, v in task.items() if k != 'verification'}
        payload['controller_verification_command_count'] = len(task['verification'])
        prompt = ('Frozen artifact copy-only handoff. The primary engineer already inspected source, tests and reuse choices.\n'
                  'You are not alone. Preserve other edits. Read project instructions and the supplied readiness/reuse metadata.\n'
                  'Install only the exact primary-supplied artifacts using the task copy command. Do not design, refactor, '
                  'inspect callers or start an engineering-guided workflow.\n'
                  'Do not run verification, hash, transform or case-count checks. Do not dump source or test files. '
                  'Git status/branch and required instruction/metadata reads are allowed.\n'
                  'Do not spawn agents or reviewers, edit controller state, commit, push, merge, deploy, install packages '
                  'or contact live services. Edit only task allowed_paths.\n'
                  'Report the installed paths without claiming tests, hashes or acceptance passed. '
                  'All verification remains pending with the controller and independent evaluator. '
                  'Architecture, security and acceptance stay with the primary engineer.\n'
                  f'TASK:\n{json.dumps(payload, indent=2)}\n')
    elif mode == 'implementation':
        prompt = ('You are the bounded implementation worker for exactly this approved Hafiz task. '
                      'You are not alone in the codebase. Preserve other edits.\n'
                      'Do not spawn subagents or reviewers. The controller starts the separate stronger evaluator.\n'
                      'Read AGENTS.md, docs/refactoring/ARCHITECTURE.md, CONVENTIONS.md, TECH_STACK.md and PROGRESS.md.\n'
                      'Inspect callers and tests, record reuse choices in your response, implement the smallest coherent change.\n'
                      'Only edit task allowed_paths. Do not edit the backlog, progress, runner, agents, protected data or infrastructure.\n'
                      'Do not commit, push, merge, deploy, call live services or install packages. The controller verifies and commits.\n'
                      'Use installed focused skills when relevant. For a lightweight model, use adaptive-coding engineering guided.\n'
                      'Architecture, security choices and final acceptance belong to the primary engineer.\n'
                      'Follow task-specific verification ownership. Report checks you ran and pending controller checks honestly.\n'
                      'A documented implementation-sandbox bind restriction alone does not make controller-owned '
                      'verification unavailable. Do not claim those pending checks passed.\n'
                      'Return blocked when required infrastructure is genuinely unavailable to the assigned verifier.\n'
                      f'TASK:\n{json.dumps(task, indent=2)}\n')
    else:
        raise InvariantError(f'Unsupported implementation mode: {mode!r}')
    return prompt


def iteration():
    sys.stdin.read()  # Upstream supplies PROMPT.md; task prompts are constructed below.
    config = read_json(CONFIG)
    if os.environ.get('HAFIZ_RALPH_SMOKE') == '1':
        directory = STATE / 'smoke' / str(time.time_ns())
        directory.mkdir(parents=True)
        before = git('status', '--porcelain')
        result = agent('Harmless Ralph setup test. Read AGENTS.md and report the current Git branch. '
                       'Do not edit files, run installs, commit, push, or contact production. '
                       'Return status implemented and evidence containing the branch.',
                       GENERATOR_SCHEMA, directory, 'generator', config, readonly=True)
        if result['status'] != 'implemented' or before != git('status', '--porcelain'):
            raise RuntimeError('Smoke iteration did not preserve the checkout')
        review = agent('Independent harmless setup evaluator. Read AGENTS.md and confirm this is an '
                       f'isolated modernization branch. Candidate report: {json.dumps(result)}. '
                       'Do not edit any file. Return pass only if the branch is codex/hafiz-modernization.',
                       REVIEW_SCHEMA, directory, 'review', config, readonly=True)
        if review['verdict'] != 'pass' or before != git('status', '--porcelain'):
            raise RuntimeError('Smoke evaluator failed')
        write_json(STATE / 'smoke-passed.json', {'time': now(), 'evidence': str(directory.relative_to(ROOT))})
        print('Harmless fresh generator and independent evaluator passed.')
        return
    try:
        remaining_seconds(config)
    except BatchLimit as error:
        stop(str(error))
        print(str(error))
        return
    if not (STATE / 'smoke-passed.json').exists():
        raise RuntimeError('Run smoke before actual refactoring')
    backlog = read_json(BACKLOG)
    reconcile_status(backlog)
    task = select_task(backlog['tasks'])
    if task is None:
        reason = 'No approved unblocked task. Review blocked or deferred tasks; final review is still required.'
        stop(reason)
        print(reason)
        return
    mode = task.get('implementation_mode', 'implementation')
    if mode not in ('implementation', 'copy-only'):
        raise InvariantError(f'Unsupported implementation mode: {mode!r}')
    if task.get('attempts', 0) >= config['max_attempts']:
        task['status'] = 'blocked'
        write_json(BACKLOG, backlog)
        stop(f'{task["id"]} exhausted retries. Inspect the saved diff and evidence before reopening.')
        return
    dirty = changed_paths()
    state_owned = ['docs/refactoring/backlog.json', 'docs/refactoring/PROGRESS.md']
    if any(p not in state_owned and not path_allowed(p, task) for p in dirty):
        raise RuntimeError(f'Unexpected checkout changes; refusing to proceed: {dirty}')
    if dirty and task['status'] not in ('running', 'retry'):
        raise RuntimeError(f'Clean checkout required before a new task: {dirty}')
    task['attempts'] = task.get('attempts', 0) + 1
    task['status'] = 'running'
    task['started_at'] = now()
    write_json(BACKLOG, backlog)
    directory = STATE / 'runs' / f'{task["id"]}-{task["attempts"]}-{time.time_ns()}'
    directory.mkdir(parents=True)
    write_json(directory / 'task.json', task)
    policy = BACKLOG.read_bytes()
    head = git('rev-parse', 'HEAD')
    prompt = generator_prompt(task)
    try:
        checkpoint = generation_checkpoint(task)
        result = checkpoint['result'] if checkpoint else agent(prompt, GENERATOR_SCHEMA, directory, 'generator', config)
        if BACKLOG.read_bytes() != policy or git('rev-parse', 'HEAD') != head:
            raise InvariantError('Agent changed controller state or committed; manual inspection required')
        if result['status'] != 'implemented':
            raise RuntimeError('Agent blocked: ' + result['summary'])
        paths = changed_paths()
        edits = [p for p in paths if p not in state_owned]
        if not edits or any(not path_allowed(p, task) for p in edits):
            raise InvariantError(f'Task paths invalid or empty: {edits}')
        if not checkpoint:
            checkpoint = save_generation_checkpoint(task, result, directory)
        write_json(directory / 'generation.json', checkpoint)
        verification_snapshot = controller_snapshot()
        try:
            verify_commands(task, directory, config)
        finally:
            if controller_snapshot() != verification_snapshot or git('rev-parse', 'HEAD') != head:
                raise InvariantError('Verification changed controller state or HEAD')
        if subprocess.call(['git', 'diff', '--check'], cwd=ROOT):
            raise RuntimeError('git diff --check failed')
        paths = changed_paths()
        edits = [p for p in paths if p not in state_owned]
        if any(not path_allowed(p, task) for p in edits):
            raise InvariantError('Verification changed out-of-scope files')
        diff_before = git('diff', 'HEAD')
        untracked_before = {p: (ROOT / p).read_bytes() for p in edits if p in git('ls-files', '--others', '--exclude-standard').splitlines()}
        copy_review = (
            'For this copy-only handoff, inspect the original generator command log at '
            f'{checkpoint["evidence"]}/generator.jsonl. '
            'Reject prohibited generator-side checks or full source/test dumps, even if the artifacts are correct. '
            'Required instruction and readiness/reuse reads are allowed. '
        ) if mode == 'copy-only' else ''
        review = agent('Independent reviewer. Read the specification and inspect the entire current Git diff, '
                       'including untracked task files. Verify behavior preservation, tests, reuse, typing, '
                       'offline/native/RTL compatibility and acceptance evidence. Review only. Do not edit, commit, '
                       'push, deploy or modify state. Reject meaningful gaps and missing mandatory manual checks. ' + copy_review +
                       f'Task: {json.dumps(task)}. Verification logs: {directory.relative_to(ROOT)}/verification.json. '
                       f'Generation result and original evidence: {directory.relative_to(ROOT)}/generation.json. '
                       'Return pass or fail with actionable findings.', REVIEW_SCHEMA, directory, 'review', config, readonly=True)
        if git('diff', 'HEAD') != diff_before or any((ROOT / p).read_bytes() != data for p, data in untracked_before.items()):
            raise InvariantError('Read-only reviewer changed task files')
        if review['verdict'] != 'pass':
            raise RuntimeError('Independent review failed: ' + '; '.join(review['findings']))
        if changed_paths() != paths or BACKLOG.read_bytes() != policy or git('rev-parse', 'HEAD') != head:
            raise InvariantError('Checkout changed during independent review')
        task['status'] = 'verified'
        task['completed_at'] = now()
        task['evidence'] = str(directory.relative_to(ROOT))
        task['summary'] = result['summary']
        write_json(BACKLOG, backlog)
        document_progress(task, result['summary'] + f' Evidence `{task["evidence"]}`.')
        # All touched paths were checked above. Stage exactly this task and controller progress.
        subprocess.run(['git', 'add', '--', *edits, *state_owned], cwd=ROOT, check=True)
        staged = set(git('diff', '--cached', '--name-only', '--no-renames').splitlines())
        if staged != set(edits + state_owned):
            raise InvariantError(f'Unexpected staged paths: {staged}')
        subprocess.run(['git', 'diff', '--cached', '--check'], cwd=ROOT, check=True)
        (directory / 'staged.diff').write_text(git('diff', '--cached'))
        subprocess.run(['git', 'commit', '-m', f'{task["id"]}: {task["title"]}'], cwd=ROOT, check=True)
        log_event('verified', task=task['id'], commit=git('rev-parse', 'HEAD'), evidence=task['evidence'])
        print(f'{task["id"]} verified and committed locally.')
    except BatchLimit as error:
        task['attempts'] -= 1
        task['status'] = 'retry'
        if isinstance(error, CommandTimeout):
            task['resource_timeouts'] = task.get('resource_timeouts', 0) + 1
            if task['resource_timeouts'] >= config.get('max_resource_timeouts', 2):
                task['status'] = 'blocked'
        task['failure'] = str(error)
        write_json(BACKLOG, backlog)
        document_progress(task, f'{error}. Preserved work will be reverified on resume.')
        stop(str(error))
        print(str(error))
        return
    except Exception as error:
        checkpoint_path = STATE / 'generation-checkpoint.json'
        if checkpoint_path.exists():
            checkpoint_path.replace(directory / 'invalidated-generation-checkpoint.json')
        task['status'] = 'blocked' if isinstance(error, InvariantError) or task['attempts'] >= config['max_attempts'] else 'retry'
        task['failure'] = str(error)
        task['evidence'] = str(directory.relative_to(ROOT))
        write_json(BACKLOG, backlog)
        document_progress(task, str(error))
        log_event('failed', task=task['id'], reason=str(error), status=task['status'])
        if task['status'] == 'blocked':
            # Preserve failed work. Never reset a task or let it contaminate a different task.
            stop(f'{task["id"]} blocked: {error}')
        raise


def launch(mode, iterations):
    global LEASES
    STATE.mkdir(exist_ok=True)
    with (STATE / 'orchestrator.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('An orchestrator already owns this worktree')
        LEASES = (lock.fileno(),)
        config = read_json(CONFIG)
        if git('branch', '--show-current') != config['branch']:
            raise RuntimeError('Refusing to run outside the dedicated modernization branch')
        if not 1 <= iterations <= config['max_iterations']:
            raise RuntimeError(f'Batch must contain 1..{config["max_iterations"]} iterations')
        if STOP.exists():
            if mode != 'resume' or not STOP.read_text().startswith(STOP_PREFIX):
                raise RuntimeError('Stop signal present. Inspect it, then resume a controller-owned stop.')
            STOP.unlink()
        if mode == 'resume':
            tasks = read_json(BACKLOG)['tasks']
            if any(t['status'] == 'blocked' and changed_paths() for t in tasks):
                raise RuntimeError('Blocked task has preserved changes. Diagnose and reopen it before resuming.')
        write_json(STATE / 'batch.json', {'pid': os.getpid(), 'id': uuid.uuid4().hex, 'started': now(), 'started_epoch': time.time(), 'tokens': 0, 'mode': mode})
        # Upstream only reads .ralph/.env. Never use its unrestricted default flags or tool rotation.
        (STATE / '.env').write_text('\n'.join([
            'RALPH_TOOL=codex', 'RALPH_MODEL_CAPABILITY=high', 'RALPH_THINKING=true',
            'RALPH_SWITCH_ON_EXHAUSTION=false', f'RALPH_MEMORY_MAX={config["memory_max"]}',
            f'RALPH_CODEX_COMMAND="{ROOT / "scripts/ralph/iteration.sh"}"',
            'RALPH_CODEX_FLAGS="--sandbox workspace-write"',
            f'RALPH_CODEX_MODEL_HIGH={config["model"]}', 'RALPH_LOOP_MAX_LOGS=1000', '']))
        env = dict(os.environ, HAFIZ_RALPH_SMOKE='1' if mode == 'smoke' else '0',
                   HAFIZ_RALPH_BATCH_ID=read_json(STATE / 'batch.json')['id'])
        run_log = STATE / f'batch-{time.time_ns()}.log'
        code = run_process(['bash', 'scripts/ralph/vendor/ralph-loop.sh', str(iterations), 'scripts/ralph/PROMPT.md'],
                           run_log, config['batch_seconds'] + 30, env=env)
        batch = read_json(STATE / 'batch.json')
        batch['finished'] = now()
        batch['upstream_exit'] = code
        batch['log'] = str(run_log.relative_to(ROOT))
        write_json(STATE / 'batch.json', batch)
        print(run_log.read_text())
        # Upstream reports failed iterations in its summary but may exit zero.
        if code or 'failed=0 ' not in run_log.read_text():
            raise RuntimeError(f'Batch contains failures; inspect {run_log.relative_to(ROOT)}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['start', 'resume', 'stop', 'status', 'smoke', 'iteration'])
    parser.add_argument('--iterations', type=int, default=3)
    args, _upstream = parser.parse_known_args()
    os.chdir(ROOT)
    signal.signal(signal.SIGTERM, terminate_child)
    signal.signal(signal.SIGINT, terminate_child)
    if args.command == 'iteration':
        global LEASES
        STATE.mkdir(exist_ok=True)
        with (STATE / 'writer.lock').open('a') as writer:
            fcntl.flock(writer, fcntl.LOCK_EX | fcntl.LOCK_NB)
            LEASES = (writer.fileno(),)
            batch = read_json(STATE / 'batch.json')
            if not os.environ.get('HAFIZ_RALPH_BATCH_ID') or batch.get('id') != os.environ['HAFIZ_RALPH_BATCH_ID']:
                raise InvariantError('Direct iterations require an active launcher identity')
            os.kill(batch['pid'], 0)
            if STOP.exists() or git('branch', '--show-current') != read_json(CONFIG)['branch']:
                raise InvariantError('Iteration refused: stop signal or wrong branch')
            iteration()
    elif args.command == 'stop':
        stop('Requested graceful stop before the next iteration.')
        print('Stop recorded. The current task may finish; the next iteration will not start.')
    elif args.command == 'status':
        tasks = read_json(BACKLOG)['tasks']
        counts = {s: sum(t['status'] == s for t in tasks) for s in sorted({t['status'] for t in tasks})}
        print(json.dumps({'branch': git('branch', '--show-current'), 'counts': counts,
                          'stop': STOP.read_text().strip() if STOP.exists() else None,
                          'batch': read_json(STATE / 'batch.json') if (STATE / 'batch.json').exists() else None,
                          'active_or_blocked': [t for t in tasks if t['status'] in ['running', 'retry', 'blocked']]}, indent=2))
    else:
        launch(args.command, 1 if args.command == 'smoke' else args.iterations)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'Ralph: {error}', file=sys.stderr)
        sys.exit(1)

// Client of the Python computing core: one long-lived `python -m studio_core` child,
// one JSON request per line, replies matched by id.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { delimiter, join } from 'node:path';
import { createInterface } from 'node:readline';
import type { Issue } from '../shared/types.ts';

export class StudioError extends Error {
  code: string;
  path?: string;
  status: number;

  constructor(issue: Issue, status = 422) {
    super(issue.message);
    this.code = issue.code;
    this.path = issue.path;
    this.status = status;
  }

  issue(): Issue {
    return { code: this.code, message: this.message, ...(this.path ? { path: this.path } : {}) };
  }
}

interface Pending { resolve: (value: unknown) => void; reject: (error: Error) => void }

export class Core {
  #repo: string;
  #python: string;
  #child?: ChildProcessWithoutNullStreams;
  #pending = new Map<number, Pending>();
  #next = 1;
  #stderr = '';

  constructor(repo: string, python = process.env.CABLE_STUDIO_PYTHON || 'python') {
    this.#repo = repo;
    this.#python = python;
  }

  #start(): ChildProcessWithoutNullStreams {
    const child = spawn(this.#python, ['-m', 'studio_core'], {
      cwd: this.#repo,
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONPATH: [this.#repo, join(this.#repo, 'studio', 'core')].join(delimiter),
        PYTHONIOENCODING: 'utf-8',
        PYTHONDONTWRITEBYTECODE: '1',
        OMP_NUM_THREADS: '1',
        MKL_NUM_THREADS: '1',
        OPENBLAS_NUM_THREADS: '1',
      },
    });
    createInterface({ input: child.stdout }).on('line', line => {
      let reply: { id: number; result?: unknown; error?: Issue };
      try { reply = JSON.parse(line); } catch { return; }
      const waiting = this.#pending.get(reply.id);
      if (!waiting) return;
      this.#pending.delete(reply.id);
      if (reply.error) waiting.reject(new StudioError(reply.error, reply.error.code === 'INTERNAL' ? 500 : 422));
      else waiting.resolve(reply.result);
    });
    child.stderr.on('data', chunk => { this.#stderr = (this.#stderr + String(chunk)).slice(-4000); });
    const fail = (reason: string) => {
      if (this.#child === child) this.#child = undefined;
      for (const waiting of this.#pending.values()) {
        waiting.reject(new StudioError({ code: 'CORE_UNAVAILABLE', message: `计算核心不可用：${reason} ${this.#stderr}`.trim() }, 503));
      }
      this.#pending.clear();
    };
    child.on('error', error => fail(error.message));
    child.on('exit', code => fail(`进程已退出（${code}）。`));
    return child;
  }

  call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    this.#child ??= this.#start();
    const id = this.#next++;
    return new Promise<T>((resolve, reject) => {
      this.#pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.#child!.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }

  stop(): Promise<void> {
    const child = this.#child;
    if (!child) return Promise.resolve();
    return new Promise<void>(done => {
      child.once('close', () => done());
      child.stdin.end();
    });
  }
}

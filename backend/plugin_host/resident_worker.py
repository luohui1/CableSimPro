"""Opt-in resident entrypoint. The host still accepts each run/2 job separately."""
import json
import os
from pathlib import Path
import runpy
import sys
import time
import traceback


def main():
    entry, mailbox = Path(sys.argv[1]), Path(sys.argv[2])
    started=time.perf_counter()
    plugin=runpy.run_path(str(entry),run_name='resident_plugin')
    plugin['resident_warmup']()
    ready=mailbox/'ready.pending'
    ready.write_text(json.dumps({'startup_ms':(time.perf_counter()-started)*1000,'pid':os.getpid()}),'utf-8')
    ready.replace(mailbox/'ready.json')
    while True:
        command=mailbox/'next.json'
        if not command.is_file():
            time.sleep(.002)
            continue
        try:
            body=json.loads(command.read_text('utf-8'));command.unlink()
        except (FileNotFoundError,PermissionError):
            time.sleep(.005)
            continue
        task_started=time.perf_counter()
        job=Path(body['job'])
        result={'id':body['id'],'returncode':0,'stderr':''}
        original_env=dict(os.environ)
        try:
            os.chdir(job)
            os.environ.clear();os.environ.update(body['environment'])
            sys.argv=[str(entry)]
            plugin['resident_main']()
        except BaseException as error:
            if not isinstance(error,SystemExit) or error.code not in (0,None):
                result.update(returncode=1,stderr=traceback.format_exc()[-8000:])
        finally:
            os.chdir(mailbox)
            os.environ.clear();os.environ.update(original_env)
        result['execution_ms']=(time.perf_counter()-task_started)*1000
        pending=mailbox/'done.pending'
        pending.write_text(json.dumps(result),'utf-8');pending.replace(mailbox/'done.json')


if __name__=='__main__':main()

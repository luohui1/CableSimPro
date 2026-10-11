"""Cancellable report formatting; no calculations or mutable source values."""
from concurrent.futures import ThreadPoolExecutor
from threading import RLock
from uuid import uuid4
from time import perf_counter
from fastapi import HTTPException
from .research import encode
from .report_reads import progress_scope,byte_digest
from .workspace import stamp


class Cancelled(Exception): pass


class DeliveryJobs:
    def __init__(self,research):
        self.research=research;self.lock=RLock();self.jobs={};self.requests={}
        self.worker=ThreadPoolExecutor(max_workers=1,thread_name_prefix='report-format')

    def close(self):
        with self.lock:
            for job in self.jobs.values():
                if job['state'] in ('queued','running') and job['stage']!='save':job['state']='cancelled'
        self.worker.shutdown(wait=False,cancel_futures=True)

    def read(self,wid,jid):
        with self.lock:
            job=self.jobs.get(jid)
            if not job or job['workspace']!=wid:raise HTTPException(404,'计算书生成任务不存在或不属于此工程。')
            return {k:v for k,v in job.items() if k!='identity'}

    def start(self,wid,body):
        if not body.get('request_id'):raise HTTPException(422,'生成计算书必须提供重试标识 request_id。')
        identity=byte_digest(encode(body));key=(wid,body['request_id'])
        with self.lock:
            prior=self.requests.get(key)
            if prior:
                if self.jobs[prior]['identity']!=identity:raise HTTPException(409,'同一请求标识不能用于不同计算书。')
                return self.read(wid,prior)
            # Do not retain arbitrary image payloads in terminal task metadata.
            for old in list(self.jobs):
                if len(self.jobs)<128:break
                if self.jobs[old]['state'] in ('succeeded','cancelled','failed'):
                    self.jobs.pop(old)
                    self.requests={k:v for k,v in self.requests.items() if v!=old}
            jid=str(uuid4());self.requests[key]=jid
            self.jobs[jid]={'id':jid,'workspace':wid,'request_id':body['request_id'],'identity':identity,
                'state':'queued','stage':'queued','created':stamp(),'finished':None,'delivery_id':None,'error':None}
            self.worker.submit(self.execute,wid,jid,body)
            return self.read(wid,jid)

    def cancel(self,wid,jid):
        with self.lock:
            self.read(wid,jid);job=self.jobs[jid]
            if job['state']=='succeeded':return self.read(wid,jid)
            if job['stage']=='save' and job['state']=='running':raise HTTPException(409,'计算书正在提交保存，已不能取消；完成后可查看交付。')
            if job['state'] in ('queued','running'):job.update(state='cancelled',finished=stamp())
            return self.read(wid,jid)

    def execute(self,wid,jid,body):
        started=perf_counter();last=started;previous='queued';timings={}
        def progress(stage):
            nonlocal last,previous
            with self.lock:
                job=self.jobs[jid]
                if job['state']=='cancelled':raise Cancelled()
                now=perf_counter();timings[previous]=timings.get(previous,0)+now-last
                job.update(state='running',stage=stage,timings_seconds={k:round(v,4) for k,v in timings.items()})
                previous=stage;last=now
        try:
            progress('source')
            with progress_scope(progress):
                saved=self.research.deliver(wid,body['run_ids'],request_id=body['request_id'],current_only=True,
                    cad_images=body.get('cad_images'),section_images=body.get('section_images'),fem_chapter=body.get('fem_chapter'))
            progress('done')
            with self.lock:self.jobs[jid].update(state='succeeded',stage='done',delivery_id=saved['id'],finished=stamp(),elapsed_seconds=round(perf_counter()-started,4))
        except Cancelled:pass
        except Exception as exc:
            detail=getattr(exc,'detail',exc)
            error=({'code':detail.get('code','REPORT_GENERATION_FAILED'),'message':str(detail.get('message','计算书来源校验失败。'))}
                   if isinstance(detail,dict) else {'code':getattr(exc,'code','REPORT_GENERATION_FAILED'),'message':str(detail)})
            with self.lock:self.jobs[jid].update(state='failed',finished=stamp(),error=error)

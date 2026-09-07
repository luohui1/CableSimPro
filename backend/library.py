"""Local enterprise document/cable library; extraction never silently approves data."""
from contextlib import contextmanager
from datetime import datetime,timezone
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
import re
import sqlite3
from uuid import uuid4
from pypdf import PdfReader
from PIL import Image
from fastapi import HTTPException
from .schemas import Cable


def now():return datetime.now(timezone.utc).isoformat()


# Tolerant of label/value Markdown columns, not ambiguous multi-product row tables.
PATTERNS=[('area_mm2',r'(?:截面积|标称截面|conductor area|area)\s*[:：=]?\s*([0-9]+(?:\.[0-9]+)?)\s*(mm²|mm2|平方毫米)',1),
 ('r20_ohm_km',r'(?:R20|R₂₀|20\s*℃直流电阻|dc resistance at 20\s*°?C)\s*[:：=]?\s*([0-9]+(?:\.[0-9]+)?)\s*(Ω/km|ohm/km|mΩ/m)',1),
 ('insulation_mm',r'(?:绝缘厚度|insulation thickness)\s*[:：=]?\s*([0-9]+(?:\.[0-9]+)?)\s*(mm)',1),
 ('jacket_mm',r'(?:护套厚度|jacket thickness)\s*[:：=]?\s*([0-9]+(?:\.[0-9]+)?)\s*(mm)',1),
 ('u0_kv',r'(?:U0|U₀|相对地电压)\s*[:：=]?\s*([0-9]+(?:\.[0-9]+)?)\s*(kV)',1)]


def extract_fields(pages:list[dict]):
    found={};conflicts=[]
    for page in pages:
        original=page['text']
        # Replace Markdown formatting with spaces, preserving offsets for original quotations.
        clean=re.sub(r'[|*`_]', ' ',original)
        for field,pattern,factor in PATTERNS:
            for match in re.finditer(pattern,clean,re.I):
                item={'field':field,'value':float(match[1])*factor,'unit':match[2],
                      'page':page['page'],'quote':original[match.start():match.end()]}
                if field in found and found[field]['value']!=item['value']:
                    conflicts.append(field)
                else:found[field]=item
    return {'fields':[v for k,v in found.items() if k not in conflicts],
            'conflicts':sorted(set(conflicts)),'missing':[f for f,_,_ in PATTERNS if f not in found]}


def read_file(raw:bytes,filename:str):
    if not raw or len(raw)>10_000_000:raise HTTPException(413,'文件限制为 1 字节–10 MB。')
    suffix=Path(filename).suffix.lower()
    if suffix=='.pdf':
        if not raw.startswith(b'%PDF-'):raise HTTPException(422,'PDF 文件签名无效。')
        try:
            reader=PdfReader(BytesIO(raw))
            if reader.is_encrypted:raise ValueError('加密 PDF 不支持，请先解密。')
            if not 1<=len(reader.pages)<=60:raise ValueError('PDF 限制为 1–60 页。')
            pages=[]
            for i,page in enumerate(reader.pages):
                content=page.get_contents()
                if content and len(content.get_data())>8_000_000:raise ValueError('单页内容流超出限制。')
                text=(page.extract_text() or '').strip()
                if len(text)>80000:raise ValueError('单页提取文本超出限制。')
                pages.append({'page':i+1,'text':text,'method':'pdf-text' if text else 'needs-ocr','reviewed':False})
            return 'application/pdf',pages
        except Exception as exc:
            raise HTTPException(422,'PDF 无法安全解析：'+str(exc)[:100]) from None
    if suffix in ('.png','.jpg','.jpeg'):
        try:
            with Image.open(BytesIO(raw)) as image:
                if image.width*image.height>30_000_000 or image.format not in ('PNG','JPEG'):raise ValueError()
                mime='image/png' if image.format=='PNG' else 'image/jpeg';image.verify()
            return mime,[{'page':1,'text':'','method':'needs-ocr','reviewed':False}]
        except Exception:raise HTTPException(422,'图片无效或超过 3000 万像素。') from None
    if suffix in ('.txt','.md','.csv'):
        try:text=raw.decode('utf-8-sig')
        except UnicodeError:raise HTTPException(422,'文本文件请使用 UTF-8 编码。') from None
        if '\0' in text or len(text)>200000:raise HTTPException(422,'文本包含非法内容或过长。')
        return 'text/plain',[{'page':1,'text':text,'method':'text','reviewed':False}]
    raise HTTPException(422,'支持 PDF、PNG、JPEG、UTF-8 TXT/MD/CSV。')


class Library:
    def __init__(self,path):self.path=Path(path);self.root=self.path.parent/'library-blobs'
    @contextmanager
    def db(self):
        db=sqlite3.connect(self.path,timeout=20);db.row_factory=sqlite3.Row
        try:
            with db:yield db
        finally:db.close()
    def initialize(self):
        self.root.mkdir(parents=True,exist_ok=True)
        with self.db() as db:
            db.executescript('''
            CREATE TABLE IF NOT EXISTS enterprise_docs(id TEXT PRIMARY KEY,name TEXT,company TEXT,mime TEXT,hash TEXT,pages TEXT,status TEXT,created TEXT,revision INTEGER NOT NULL DEFAULT 1);
            CREATE TABLE IF NOT EXISTS cable_catalog(id TEXT PRIMARY KEY,name TEXT,manufacturer TEXT,cable TEXT,source_id TEXT,evidence TEXT,status TEXT,created TEXT);
            CREATE TABLE IF NOT EXISTS design_runs(id TEXT PRIMARY KEY,workspace TEXT,revision INTEGER,kind TEXT,input TEXT,output TEXT,created TEXT);
            ''')
            for material in ('copper','aluminium'):
                for area in (120,185,240,300,400,500,630):
                    name=f'演示 {material} / XLPE 12/20 kV / {area} mm²'
                    c=Cable(name=name,conductor=material,area_mm2=area)
                    db.execute('INSERT OR IGNORE INTO cable_catalog VALUES(?,?,?,?,?,?,?,?)',
                         (f'demo-{material}-{area}',name,'演示模板 · 非厂家数据',c.model_dump_json(),None,'[]','demo',now()))
    def add(self,raw,filename,company):
        mime,pages=read_file(raw,filename);digest=sha256(raw).hexdigest()
        with self.db() as db:
            old=db.execute('SELECT id FROM enterprise_docs WHERE hash=? AND company=?',(digest,company)).fetchone()
            if old:return self.document(old['id'])
            ident=str(uuid4());(self.root/ident).write_bytes(raw)
            status='ready' if all(p['text'].strip() for p in pages) else 'needs_ocr'
            db.execute('INSERT INTO enterprise_docs(id,name,company,mime,hash,pages,status,created) VALUES(?,?,?,?,?,?,?,?)',(ident,Path(filename).name[:150],company,mime,digest,json.dumps(pages,ensure_ascii=False),status,now()))
        return self.document(ident)
    def document(self,ident):
        with self.db() as db:r=db.execute('SELECT * FROM enterprise_docs WHERE id=?',(ident,)).fetchone()
        if not r:raise HTTPException(404,'资料不存在。')
        return {**dict(r),'pages':json.loads(r['pages'])}
    def documents(self):
        with self.db() as db:
            return [dict(r) for r in db.execute('SELECT id,name,company,mime,hash,status,created FROM enterprise_docs ORDER BY created DESC LIMIT 500')]
    def update_pages(self,ident,pages,expected_revision):
        with self.db() as db:
            updated=db.execute('UPDATE enterprise_docs SET pages=?,status=?,revision=revision+1 WHERE id=? AND revision=?',
                       (json.dumps(pages,ensure_ascii=False),'ready' if all(p['text'].strip() for p in pages) else 'needs_ocr',ident,expected_revision))
            if updated.rowcount!=1:raise HTTPException(409,'资料版本已变化，本次结果未覆盖已有文本；请刷新重试。')
        return self.document(ident)
    def search(self,query,limit=8):
        terms=[t for t in re.split(r'[\s,，;；]+',query.strip()) if t][:8]
        if not terms:return []
        hits=[]
        with self.db() as db:docs=db.execute('SELECT * FROM enterprise_docs ORDER BY created DESC LIMIT 500').fetchall()
        for doc in docs:
            for page in json.loads(doc['pages']):
                hay=(doc['name']+' '+doc['company']+' '+page['text']).lower()
                score=sum(hay.count(t.lower()) for t in terms)
                if score:
                    pos=min([page['text'].lower().find(t.lower()) for t in terms if t.lower() in page['text'].lower()] or [0])
                    hits.append({'id':f"{doc['id']}:p{page['page']}",'document_id':doc['id'],'name':doc['name'],'company':doc['company'],
                                 'page':page['page'],'quote':page['text'][max(0,pos-80):max(0,pos-80)+850],
                                 'reviewed':page['reviewed'],'method':page['method'],'score':score})
        return sorted(hits,key=lambda h:-h['score'])[:limit]
    def catalog(self):
        with self.db() as db:rows=db.execute('SELECT * FROM cable_catalog ORDER BY created DESC').fetchall()
        return [{**dict(r),'cable':json.loads(r['cable']),'evidence':json.loads(r['evidence'])} for r in rows]
    def save_cable(self,name,manufacturer,cable,source_id,evidence):
        if not evidence:raise HTTPException(422,'至少需要一项有原文引用的参数；其它值仍标为输入假设。')
        doc=self.document(source_id)
        if len({e['page'] for e in evidence})!=1:raise HTTPException(422,'一次入库只允许同一产品页面的证据。')
        known={(e['field'],e['page'],e['quote'],e['value']) for p in doc['pages'] for e in extract_fields([p])['fields']}
        for e in evidence:
            if (e['field'],e['page'],e['quote'],e['value']) not in known or getattr(cable,e['field'])!=e['value']:
                raise HTTPException(422,'引用与原始提取值或候选参数不一致，请重新提取和核对。')
        ident=str(uuid4())
        with self.db() as db:
            db.execute('INSERT INTO cable_catalog VALUES(?,?,?,?,?,?,?,?)',(ident,name,manufacturer,cable.model_dump_json(),source_id,
                         json.dumps(evidence,ensure_ascii=False),'reviewed_partial',now()))
        return next(c for c in self.catalog() if c['id']==ident)
    def save_run(self,wid,revision,kind,inputs,output):
        ident=str(uuid4())
        with self.db() as db:db.execute('INSERT INTO design_runs VALUES(?,?,?,?,?,?,?)',(ident,wid,revision,kind,json.dumps(inputs,ensure_ascii=False),json.dumps(output,ensure_ascii=False),now()))
        return {'id':ident,'revision':revision,'kind':kind,'input':inputs,'output':output}

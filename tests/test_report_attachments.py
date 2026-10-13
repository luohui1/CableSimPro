"""Frozen display evidence and FEM hand-checks; no native solver or live values."""
from base64 import b64encode, b64decode
from copy import deepcopy
from io import BytesIO
import re
from types import SimpleNamespace
from uuid import uuid4

import fitz
from PIL import Image
import pytest
from fastapi import HTTPException

from backend.kernel.report_attachments import CadReportImage, SectionReportImage, prepare
from test_research import client, study, request
from test_hpc_convergence import saved_fixture


def image_for(run):
    stream = BytesIO(); Image.new('RGB', (80, 40), 'white').save(stream, format='PNG')
    case = run['output']['cases'][0]
    return {'png_base64': b64encode(stream.getvalue()).decode(), 'metadata': {
        'schema':'cablesim.cad-image/1','mime':'image/png','width':80,'height':40,
        'camera':{'yaw':0,'elevation':0.5,'heading':0,'zoom':1,'panX':0,'panY':0,'view':'iso','mode':'scene','section':.5},
        'geometryInputSha256':'c'*64,'displayLengthM':1,'scaleMmPerPixel':1,
        'field':{'runId':run['id'],'caseId':case['case_id'], 'source':run['snapshot']['definition']['method']['release_digest'],
                 'minimum':20,'maximum':90}}}


def test_cad_image_delivery_is_frozen_retry_safe_and_pdf_contains_image(client, monkeypatch):
    w, s = study(client); root, body = request(client,w,s)
    run = client.post(root+'/runs',json=body).json()
    assert run['integrity']=='verified' and run['status']=='succeeded'
    image = image_for(run)
    image['metadata']['field']['source'] += ' '+run['output']['cases'][0]['artifact_digests'].get('x-cablesim.temperature-field','')
    # A display export is not a second calculation.
    monkeypatch.setattr(client.app.state.research.executor,'run',lambda *a,**kw:pytest.fail('delivery invoked a solver'))
    payload = {'run_ids':[run['id']],'request_id':str(uuid4()),'cad_images':[image]}
    endpoint = f"/api/workspaces/{w['id']}/deliveries/current"
    reply = client.post(endpoint,json=payload)
    assert reply.status_code==201,reply.text
    book = reply.json()
    assert 'data-report-attachment="saved"' in book['html'] and 'image_sha256' in book['html']
    assert client.post(endpoint,json=payload).json()['id']==book['id']
    stored = client.get(f"/api/workspaces/{w['id']}/deliveries/{book['id']}").json()
    assert stored['digest']==book['digest'] and stored['html']==book['html']
    pdf = b64decode(re.search(r'data-report-pdf="customer"[^>]+base64,([^"]+)', book['html'])[1])
    with fitz.open(stream=pdf,filetype='pdf') as document:
        assert any(page.get_images() for page in document)
        assert '三维结果图' in ''.join(page.get_text() for page in document)
    changed = deepcopy(payload); changed['cad_images'][0]['metadata']['camera']['zoom']=2
    assert client.post(endpoint,json=changed).status_code==409
    rejected = deepcopy(payload);rejected['request_id']=str(uuid4());rejected['cad_images'][0]['metadata']['field']['provisional']=True
    assert client.post(endpoint,json=rejected).status_code==409
    rejected['cad_images'][0]['metadata']['field']['provisional']=False
    rejected['cad_images'][0]['metadata']['width']=81
    assert client.post(endpoint,json=rejected).json()['detail']['code']=='REPORT_ATTACHMENT_INVALID'


def test_linear_saved_fem_chapter_is_rebuilt_and_unconverged_is_blocked(monkeypatch, tmp_path):
    monkeypatch.setattr('backend.kernel.fem_evidence.workflow_for',lambda *a:None)
    fem, iec = saved_fixture()
    fem['convergence']={'status':'converged','reason':'三档网格及计算域通过', 'reference_case_id':'case-0',
        'rows':[{'case_id':f'mesh-{i}','mesh_size_m':h,'hotspot_k':t,'change_k':delta}
                for i,(h,t,delta) in enumerate(((.008,320.08,None),(.004,320.03,.05),(.002,320.,.03)))]+
        [{'case_id':'domain','mesh_size_m':.002,'hotspot_k':320.02,'change_k':.02}]}
    saved = {fem['id']:fem,iec['id']:iec}
    from backend.kernel.workspace import WorkspaceStore
    research = SimpleNamespace(get_run=lambda wid,rid:deepcopy(saved[rid]),
                               store=WorkspaceStore(tmp_path/'attachments.sqlite'))
    # This existing linear hand-check has no database source rows. Keep its
    # in-memory display adapter explicit; real source-byte/display validation
    # is exercised with the saved Slurm run in test_read_projections.
    monkeypatch.setattr('backend.kernel.batch_field_projection.read_display',
                        lambda service,wid,rid:deepcopy(saved[rid]))
    ref = {'fem_run_id':fem['id'],'iec_run_id':iec['id']}
    ids, attachments = prepare(research,fem['workspace'],[fem['id']],[],ref)
    assert ids==[fem['id'],iec['id']]
    data = attachments['fem_chapter']['data']
    assert data['schema_version']=='cablesim.fem-report-chapter/1'
    assert data['rows'][0]['delta']==pytest.approx(1.)  # 320 K - 319 K, independent hand check.
    assert b64decode(attachments['fem_chapter']['png_base64']).startswith(b'\x89PNG')
    from backend.kernel import study_pdf
    from backend.kernel.workspace import fingerprint
    # Isolate the new attachment section from unrelated IEC chapter rendering.
    # Its source is the independently checked 320 K / 319 K saved linear field.
    fem['input_digest']=fingerprint(fem['snapshot']);fem['output_digest']=fingerprint(fem['output'])
    monkeypatch.setattr(study_pdf,'chapters',lambda *_:[])
    with fitz.open(stream=study_pdf.render_pdf([fem],'customer',attachments=attachments),filetype='pdf') as pdf:
        assert any(page.get_images() for page in pdf)
        assert '有限元温度场与 IEC 对照' in ''.join(page.get_text() for page in pdf)
    before = deepcopy(attachments)
    fem['output']['cases'][0]['results'][0]['value']=900
    assert attachments==before  # Frozen evidence never follows subsequent live changes.
    fem['convergence']['status']='unconverged'
    with pytest.raises(HTTPException) as caught:prepare(research,fem['workspace'],[fem['id']],[],ref)
    assert caught.value.status_code==422


def test_image_contract_and_source_binding_reject_foreign_case_and_invalid_png():
    fem, _ = saved_fixture();image=image_for(fem)
    image['metadata']['field']['source'] += ' '+fem['output']['cases'][0]['artifact_digests']['x-cablesim.temperature-field']
    image=CadReportImage.model_validate(image).model_dump(mode='json',by_alias=True)
    research=SimpleNamespace(get_run=lambda *a:fem)
    _, frozen=prepare(research,fem['workspace'],[fem['id']],[image],None)
    assert len(frozen['cad_images'][0]['image_sha256'])==64
    image['metadata']['field']['caseId']='foreign'
    with pytest.raises(HTTPException):prepare(research,fem['workspace'],[fem['id']],[image],None)
    image['metadata']['field']['caseId']='case-0';image['png_base64']='bm90LWEtUE5H'
    with pytest.raises(OSError):prepare(research,fem['workspace'],[fem['id']],[image],None)


def test_section_image_is_bound_to_saved_input_and_frozen_without_solving(client,monkeypatch):
    w,s=study(client);root,body=request(client,w,s)
    run=client.post(root+'/runs',json=body).json()
    saved=client.app.state.research.get_run(w['id'],run['id'])
    domain=saved['snapshot']['cases'][0]['input']
    png=image_for(run)['png_base64']
    image=SectionReportImage.model_validate({'run_id':run['id'],'case_id':'case-0','section_id':domain['sections'][0]['id'],
        'input_digest':run['input_digest'],'width':80,'height':40,'png_base64':png}).model_dump(mode='json')
    monkeypatch.setattr(client.app.state.research.executor,'run',lambda *a,**kw:pytest.fail('report invoked solver'))
    payload={'run_ids':[run['id']],'request_id':str(uuid4()),'section_images':[image]}
    endpoint=f"/api/workspaces/{w['id']}/deliveries/current"
    reply=client.post(endpoint,json=payload);assert reply.status_code==201,reply.text
    book=reply.json();assert client.post(endpoint,json=payload).json()['id']==book['id']
    pdf=b64decode(re.search(r'data-report-pdf="customer"[^>]+base64,([^"]+)',book['html'])[1])
    with fitz.open(stream=pdf,filetype='pdf') as document:
        assert document[1].get_images() and '敷设截面与电缆详图' in document[1].get_text()
    for key,value in [('input_digest','0'*64),('case_id','other-case'),('section_id','foreign'),('run_id',str(uuid4()))]:
        bad=deepcopy(payload);bad['request_id']=str(uuid4());bad['section_images'][0][key]=value
        assert client.post(endpoint,json=bad).status_code==409

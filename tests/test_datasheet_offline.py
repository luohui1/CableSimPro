"""Offline routing and semantic safety; real OCR scores live in the Slurm evaluation."""
import base64,json
from hashlib import sha256
import fitz,pytest
from test_datasheet_grounding import parser,table


def test_concatenated_model_list_is_tokenized_without_prefix_guessing():
 assert parser.model_present('TYPE:YJLW02YJLLW02YJLW03YJLLW03','YJLW03')
 assert parser.model_present('YJVYJLV','YJV')
 assert not parser.model_present('YJV22YJLV22','YJV')
 assert not parser.model_present('FOOYJVYJLV','YJV')


def test_header_aliases_and_units_are_explicit():
 assert parser.header_field('Conductor Approx. Diam. (mm)')=='conductor_diameter'
 assert parser.header_field('導 體 外徑 mm')=='conductor_diameter'
 assert parser.header_field('絕緣厚度 mm')=='insulation_thickness'
 assert parser.header_field('Minimum insulation resistance at20 C MΩ-km') is None
 assert parser.units('weight kg/100m','weight')=='kg/100m'
 assert parser.units('diameter mm²','outer_diameter') is None
 assert parser.numeric_cell('1,751','weight')==1751
 assert parser.numeric_cell('23-28','outer_diameter') is None


def test_original_and_ocr_candidates_share_review_gate_and_grounding(monkeypatch):
 t=table(50,86.1);page={'page':1,'width_pt':500,'height_pt':500,'text':'YJV','words':[c for row in t['rows'] for c in row],'tables':[t],'requires_ocr':True}
 recognized={**page,'text_source':'ocr','region_pt':[0,0,500,500],'evidence_sha256':'a'*64}
 recognized['words']=[dict(w,confidence=.99) for w in page['words']]
 monkeypatch.setattr(parser,'page_data',lambda *a,**kw:page)
 calls=[]
 def offline(*a):calls.append(1);return recognized,{'ocr_model':'test-only-ocr'}
 monkeypatch.setattr(parser,'offline_page',offline)
 result=parser.operation({'schema_version':'cablesim.datasheet/1'},{'model':{'designation':'YJV','specification':'300','identity_note':'unit fixture'},'selections':[{'page':1}]},'rules')
 assert calls==[1] and result['candidates']
 assert all(c['evidence_source']=='ocr' and c['evidence_sha256']=='a'*64 for c in result['candidates'])
 assert result['ocr_evidence'][0]['ocr_model']=='test-only-ocr'


def test_blank_page_stops_before_any_ocr_model_loading():
 pdf=fitz.open();pdf.new_page();raw=pdf.tobytes();pdf.close()
 with pytest.raises(parser.Invalid) as caught:parser.offline_page({'sha256':sha256(raw).hexdigest(),'pdf_base64':base64.b64encode(raw).decode()},{'page':1})
 assert caught.value.code=='OCR_NO_TEXT'


def test_overlapping_native_and_ocr_selections_keep_their_own_evidence(monkeypatch):
 t=table(50,86.1);words=[dict(c,confidence=.99) for row in t['rows'] for c in row]
 native={'page':1,'width_pt':500,'height_pt':500,'text':'YJV','words':words,'tables':[t],'requires_ocr':False,'text_source':'original'}
 def page_data(*a,region=None,**kw):return {**native,'requires_ocr':region is not None}
 monkeypatch.setattr(parser,'page_data',page_data)
 def offline(document,selection):
  digest=('a' if selection['region'][0]==0 else 'b')*64
  return {**native,'text_source':'ocr','region_pt':selection['region'],'evidence_sha256':digest},{'ocr_model':'fixture','sha256':digest}
 monkeypatch.setattr(parser,'offline_page',offline)
 result=parser.offline_extract({}, {'model':{'designation':'YJV','specification':'300','identity_note':'overlap regression'},'selections':[{'page':1},{'page':1,'region':[0,0,500,500]},{'page':1,'region':[1,0,500,500]}]})
 candidates=[c for c in result['candidates'] if c['field']=='outer_diameter']
 assert len(candidates)==3 and len({c['id'] for c in candidates})==3
 assert {c.get('evidence_sha256') for c in candidates}=={None,'a'*64,'b'*64}
 assert next(c for c in candidates if 'evidence_sha256' not in c).get('evidence_source','original')=='original'


def test_missing_offline_environment_does_not_attempt_network(monkeypatch):
 import importlib.metadata,socket
 monkeypatch.setattr(importlib.metadata,'version',lambda name:'not-installed-version')
 monkeypatch.setattr(socket,'create_connection',lambda *a,**k:pytest.fail('OCR attempted a network connection'))
 pdf=fitz.open();p=pdf.new_page();p.insert_text((50,50),'Manufacturer data');raw=pdf.tobytes();pdf.close()
 with pytest.raises(parser.Invalid) as caught:parser.offline_page({'sha256':sha256(raw).hexdigest(),'pdf_base64':base64.b64encode(raw).decode()},{'page':1})
 assert caught.value.code=='OCR_ENVIRONMENT_MISSING'


def test_minimum_thickness_is_not_silently_a_nominal_layer():
 t=table(50,86.1);t['rows'][0][1]['text']='Minimum insulation thickness mm'
 p={'page':1,'text':'YJV','words':[c for row in t['rows'] for c in row],'tables':[t]}
 result=parser.extract([p],{'designation':'YJV','specification':'300','identity_note':'minimum is a limit'})
 item=next(c for c in result['candidates'] if c['field']=='insulation_thickness')
 assert item['ambiguities']


def test_specification_is_selected_by_header_not_any_matching_number():
 def c(text,x,y):return {'text':text,'bbox':[x,y,x+80,y+20]}
 rows=[[c('Nominal area mm2',0,0),c('Overall diameter mm',80,0),c('Test voltage kV',160,0)],
       [c('2.0',0,30),c('9.0',80,30),c('3.5',160,30)],
       [c('3.5',0,60),c('12.5',80,60),c('3.5',160,60)]]
 p={'page':1,'text':'VV','words':[a for r in rows for a in r],'tables':[{'rows':rows,'bbox':[0,0,240,80]}]}
 result=parser.extract([p],{'designation':'VV','specification':'3.5','identity_note':'selected cross-section'})
 assert [(x['field'],x['raw_value']) for x in result['candidates']]==[('outer_diameter',12.5)]

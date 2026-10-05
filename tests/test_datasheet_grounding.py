"""Evidence alignment, cropped content and duplicate/model ambiguity regressions."""
import base64,importlib.util,json
from hashlib import sha256
from pathlib import Path
from io import BytesIO
import fitz,pytest
from PIL import Image

source=Path(__file__).resolve().parents[1]/'plugins/cablesim.datasheet-extract/src/cablesim_datasheet_extract/main.py'
spec=importlib.util.spec_from_file_location('datasheet_parser_tests',source);parser=importlib.util.module_from_spec(spec);spec.loader.exec_module(parser)

@pytest.mark.parametrize('rotation',[0,90,180,270])
def test_crop_and_rotation_use_visible_page_coordinates(rotation):
 doc=fitz.open();page=doc.new_page(width=500,height=500);page.insert_text((30,40),'YJV PRIVATE',fontsize=10)
 page.set_cropbox(fitz.Rect(20,20,480,480));page.set_rotation(rotation);raw=doc.tobytes();doc.close()
 document={'pdf_base64':base64.b64encode(raw).decode(),'sha256':sha256(raw).hexdigest()}
 result=parser.page_data(document,1,render=True);word=next(w for w in result['words'] if w['text']=='YJV');x0,y0,x1,y1=word['bbox'];x=(x0+x1)/2;y=(y0+y1)/2
 assert (x<60 if rotation in (0,270) else x>400) and (y<60 if rotation in (0,90) else y>400)
 assert result['width_pt']==460 and result['height_pt']==460
 image=Image.open(BytesIO(base64.b64decode(result['png_base64']))).convert('L')
 crop=image.crop((int(x0*1.3),int(y0*1.3),int(x1*1.3)+1,int(y1*1.3)+1))
 assert crop.getextrema()[0]<100  # Source text pixels occupy the cited rectangle.
 region=[max(0,x0-1),max(0,y0-1),min(460,x1+1),min(460,y1+1)]
 selected=parser.page_data(document,1,region=region,render=True)
 assert 'PRIVATE' not in selected['text'] and all(w['text']=='YJV' for w in selected['words'])
 assert Image.open(BytesIO(base64.b64decode(selected['png_base64']))).width <= (region[2]-region[0])*1.3+2

def table(top,value):
 def cell(text,x,y,width=90):return {'text':text,'bbox':[x,y,x+width,y+20]}
 return {'bbox':[0,top,270,top+60],'rows':[[cell('Size',0,top),cell('Conductor diameter mm',90,top),cell('Overall diameter mm',180,top)], [cell('300',0,top+30),cell('20.6',90,top+30),cell(str(value),180,top+30)]]}

def two_model_page():
 tables=[table(50,86.1),table(200,93.6)];words=[c for t in tables for row in t['rows'] for c in row]
 return {'page':1,'width_pt':500,'height_pt':500,'text':'YJV YJV22','words':words,'tables':tables}

def test_same_spec_in_two_model_tables_remains_explicitly_ambiguous():
 model={'designation':'YJV','specification':'300','identity_note':'Two different constructions in same fragment'}
 result=parser.extract([two_model_page()],model)
 assert result['candidates'] and all(c['ambiguities'] for c in result['candidates'])

def test_provider_duplicate_ids_are_deduplicated_and_other_model_stays_ambiguous():
 page=two_model_page();model={'designation':'YJV','specification':'300','identity_note':'YJV upper table'}
 item={'field':'outer_diameter','raw_value':93.6,'raw_unit':'mm','page':1,'quote':'93.6','bbox_pt':[180,230,270,250]}
 result=parser.provider_response([page],model,json.dumps({'candidates':[item,item]}))
 assert len(result['candidates'])==1 and result['candidates'][0]['ambiguities']
 assert result['issues'][0]['code']=='PROVIDER_DUPLICATE_CANDIDATE'

def test_oversized_page_image_is_rejected_without_losing_original():
 doc=fitz.open();doc.new_page(width=10000,height=10000);raw=doc.tobytes();doc.close()
 source={'pdf_base64':base64.b64encode(raw).decode(),'sha256':sha256(raw).hexdigest()}
 with pytest.raises(parser.Invalid) as error:parser.page_data(source,1,render=True)
 assert error.value.code=='PAGE_RENDER_LIMIT'

def test_modified_r20_binding_keeps_engineer_basis_not_manufacturer_guarantee():
 from backend.kernel.datasheets import Documents
 payload={'cable_type':{'cores':[{'conductor':{'r20':.0001}}]},'sources':{'original':{'kind':'user','reference':'Engineer correction','reviewed':True}}}
 Documents.bind_structural(payload,'r20',(.00009,'ohm/m'),['/cable_type/cores/0/conductor/r20'],'original',{},'engineer_given')
 assert payload['cable_type']['cores'][0]['conductor']['r20_basis']=='design'
 with pytest.raises(Exception):Documents.bind_structural(payload,'r20',(.01,'m'),['/cable_type/cores/0/conductor/r20'],'original',{},'manufacturer_limit')

@pytest.mark.parametrize('value',[True,'1',float('inf'),float('nan')])
def test_non_numeric_review_or_region_stops_at_specific_field(value):
 from backend.kernel.datasheet_contracts import Decision,Selection
 from pydantic import ValidationError
 with pytest.raises(ValidationError) as error:Decision(candidate_id='one',action='modify',value=value,unit='mm',reason='Human correction')
 assert error.value.errors()[0]['loc']==('value',)
 with pytest.raises(ValidationError) as error:Selection(page=1,region=[0,0,value,10])
 assert error.value.errors()[0]['loc']==('region',)

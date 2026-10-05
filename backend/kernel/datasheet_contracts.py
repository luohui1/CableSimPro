"""Public document/review contracts. All adopted quantities use explicit SI units."""
from typing import Literal
from uuid import UUID
from math import isfinite
from pydantic import Field, model_validator, field_validator
from backend.schemas import StrictModel
from .candidates import CableModelVersion

Digest=str
class DocumentPage(StrictModel):
 page:int=Field(ge=1,description='1-based PDF page number.')
 width_pt:float=Field(gt=0,description='PDF page width in points (1/72 inch).')
 height_pt:float=Field(gt=0,description='PDF page height in points.')
 has_text:bool=Field(description='Original PDF text layer exists; OCR is a separate action.')
class DocumentResponse(StrictModel):
 id:str=Field(description='Immutable original document identity.')
 name:str=Field(description='Original filename; display only, never used as a filesystem path.')
 sha256:str=Field(pattern='^[0-9a-f]{64}$',description='SHA256 of exact uploaded PDF bytes.')
 size_bytes:int=Field(ge=1,description='Original file size in bytes; limit 64 MiB.')
 page_count:int=Field(ge=1,le=500,description='Number of original PDF pages.')
 pages:list[DocumentPage]=Field(description='Page dimensions and text-layer availability.')
 created:str=Field(description='UTC import timestamp.')
class Selection(StrictModel):
 page:int=Field(ge=1,le=500,description='Selected 1-based original PDF page.')
 region:list[float]|None=Field(default=None,min_length=4,max_length=4,description='Optional [left,top,right,bottom] in PDF points; top-left origin, y down.')
 @field_validator('region',mode='before')
 @classmethod
 def finite_coordinates(cls,value):
  if value is not None and (not isinstance(value,list) or any(type(v) not in (int,float) or not isfinite(v) for v in value)):
   raise ValueError('region：使用有限数值的 PDF 点坐标，不接受布尔值、字符串或非有限值。')
  return value
class SelectedModel(StrictModel):
 designation:str=Field(min_length=1,max_length=80,description='Explicit selected model/family printed in the source, such as YJLW03.')
 specification:str=Field(min_length=1,max_length=40,description='Exact selected row/column label, such as 240 or 3×300; never inferred from another row.')
 identity_note:str=Field(min_length=1,max_length=300,description='Human-selected voltage, conductor, sheath variant and manufacturer context.')
class ExtractionScope(StrictModel):
 method:Literal['rules','offline_ocr','llm','ocr','hybrid']=Field(description='Rules with automatic offline OCR for scans (default); offline_ocr forces local CPU OCR; llm/hybrid and optional Mistral ocr require explicit outbound confirmation.')
 model:SelectedModel
 selections:list[Selection]=Field(min_length=1,max_length=4,description='Only these pages/regions are processed or disclosed.')
 @model_validator(mode='after')
 def unique(self):
  if len({(x.page,tuple(x.region or [])) for x in self.selections})!=len(self.selections):raise ValueError('selections：不要重复选择相同页／片段。')
  return self
class DisclosureResponse(StrictModel):
 id:str=Field(description='Saved outbound disclosure identity; scoped to exact document, region, provider and model.')
 document_sha256:str=Field(description='Exact original SHA256.')
 scope:ExtractionScope
 service:str=Field(description='Configured external service name.')
 endpoint:str=Field(description='Exact destination chat-completions URL; secrets omitted.')
 ocr_endpoint:str|None=Field(default=None,description='Additional OCR destination for selected scanned images; included in the same explicit confirmation.')
 ocr_model:str|None=Field(default=None,description='Pinned OCR model ID; separate from the field extraction model.')
 provider_model:str=Field(description='Configured external model ID.')
 payload_sha256:str=Field(description='Digest of exact selected text/tables or image payload; original PDF is not sent.')
 disclosure_sha256:str=Field(description='Digest to echo with explicit confirmation before any outbound request.')
 content_kind:Literal['selected_text_tables','selected_page_images','selected_text_and_images']
 available:bool=Field(description='Provider URL/model/key configured; no secrets returned.')
class ExtractionRequest(ExtractionScope):
 request_id:UUID=Field(description='Reuse this ID for retries/double-clicks; a different payload with the same ID is rejected.')
 disclosure_id:str|None=Field(default=None,description='Required for llm/ocr; obtained before human confirms outbound disclosure.')
 disclosure_sha256:str|None=Field(default=None,description='Exact acknowledged disclosure digest.')
 outbound_confirmed:Literal[True]|None=Field(default=None,description='Must be literal true after the user sees destination and selected content.')
 @model_validator(mode='before')
 @classmethod
 def explicit(cls,value):
  if isinstance(value,dict) and value.get('outbound_confirmed') is not None and value['outbound_confirmed'] is not True:raise ValueError('outbound_confirmed：必须明确填写 true。')
  return value
class Candidate(StrictModel):
 id:str=Field(description='Stable candidate evidence identity.')
 field:str=Field(description='Canonical structural/electrical field name.')
 raw_value:float=Field(gt=0,description='Value as printed, before SI conversion.')
 raw_unit:str=Field(description='Explicit unit printed in source.')
 value_si:float=Field(gt=0,description='Plugin-converted positive SI value.')
 unit_si:Literal['m','ohm/m','kg/m']=Field(description='SI length, longitudinal resistance or mass unit.')
 model:SelectedModel
 page:int=Field(ge=1,description='1-based source page.')
 quote:str=Field(description='Exact numeric source fragment.')
 bbox_pt:list[float]=Field(min_length=4,max_length=4,description='Source evidence rectangle [left,top,right,bottom], PDF points, top-left origin. Native text cites cells/glyphs; local OCR cites recovered cells, Mistral OCR cites its containing table block.')
 basis:Literal['manufacturer','manufacturer_limit']=Field(description='Manufacturer published value or stated maximum; never relabeled as measured/standard data.')
 ambiguities:list[str]=Field(description='Conflicts/recognition uncertainty requiring explicit human decisions.')
 evidence_source:Literal['original','ocr']=Field(default='original',description='Original PDF glyphs or separately stored OCR evidence; both require individual human review.')
 evidence_sha256:str|None=Field(default=None,description='SHA256 of separately stored OCR page evidence when applicable.')
 extraction_origin:Literal['rules','llm']=Field(default='rules',description='Producer of this candidate, retained by hybrid merging.')
 header_quote:str|None=Field(default=None,description='Verified original field/unit header supporting LLM candidates.')
 header_bbox_pt:list[float]|None=Field(default=None,min_length=4,max_length=4,description='Verified header rectangle in PDF points.')
class ProviderCall(StrictModel):
 operation:Literal['ocr','extraction']
 requested_model:str=Field(description='Pinned model sent in the request.')
 returned_model:str=Field(description='Actual model identifier returned by provider.')
 elapsed_seconds:float=Field(ge=0,description='Wall latency in seconds, including HTTP response download.')
 service_seconds:float|None=Field(default=None,ge=0,description='Optional external HTTP service latency measured by authorized evaluation relay; excludes SSH relay overhead.')
 prompt_tokens:int=Field(ge=0,description='Provider reported input tokens; zero for page-priced OCR.')
 completion_tokens:int=Field(ge=0,description='Provider reported output tokens.')
 pages:int=Field(ge=0,description='Provider reported processed OCR pages.')
 response_sha256:str=Field(description='Digest of raw provider response; raw response bodies are not exposed in logs.')
class ExtractionResult(StrictModel):
 schema_:Literal['cablesim.datasheet-candidates/1']=Field(alias='schema')
 method:str=Field(description='Pinned extraction method version.')
 model:SelectedModel
 candidates:list[Candidate]
 issues:list[dict]=Field(description='Structured extraction diagnostics, never substitute invented candidates.')
 provider_calls:list[ProviderCall]=Field(default_factory=list,description='Actual provider models, usage and latency; no credentials.')
 ocr_evidence:list[dict]=Field(default_factory=list,description='Separate OCR page/region evidence with original SHA, OCR model, response hash and recognized blocks; never replaces the original text layer.')
 strategy:Literal['rules','offline_ocr','llm','ocr','hybrid']=Field(default='rules',description='Executed extraction strategy; offline_ocr never sends source content to a service.')
class Decision(StrictModel):
 candidate_id:str=Field(description='Evidence ID being individually reviewed.')
 action:Literal['accept','modify','reject']
 value:float|None=Field(default=None,gt=0,description='Modified raw numeric value; required only for modify.')
 unit:Literal['mm','cm','m','ohm/km','ohm/m','kg/km','kg/m','kg/100m']|None=Field(default=None,description='Modified raw unit; converted by the extraction plugin.')
 reason:str=Field(min_length=1,max_length=500,description='Human reason/context, especially when editing or resolving ambiguity.')
 @field_validator('value',mode='before')
 @classmethod
 def finite_value(cls,value):
  if value is not None and (type(value) not in (int,float) or not isfinite(value)):raise ValueError('value：填写有限数值，不接受布尔值或字符串。')
  return value
 @model_validator(mode='after')
 def edited(self):
  if (self.action=='modify')!=(self.value is not None and self.unit is not None):raise ValueError('modify：同时填写值和单位；接受／拒绝不要填写修改值。')
  return self
class ReviewRequest(StrictModel):
 expected_revision:int=Field(ge=0,description='CAS revision of extraction review; stale reviews are rejected.')
 request_id:UUID
 reviewer:str=Field(min_length=1,max_length=100,description='Local human operator name; this deployment is not multiuser identity authentication.')
 decisions:list[Decision]=Field(min_length=1,max_length=100,description='Explicit individual accept/modify/reject decisions; no automatic approval.')
 @model_validator(mode='after')
 def unique(self):
  if len({d.candidate_id for d in self.decisions})!=len(self.decisions):raise ValueError('decisions：每个候选只能核对一次。')
  return self
class ExtractionResponse(StrictModel):
 id:str
 document_id:str
 document_sha256:str
 request_id:str
 status:Literal['accepted','running','succeeded','failed','interrupted']
 request:dict=Field(description='Saved method/scope/disclosure inputs without keys, PDF bytes or provider response.')
 method:dict=Field(description='Exact plugin/capability/version/release digest.')
 result:ExtractionResult|None=None
 error:dict|None=Field(default=None,description='Stable code, specific correction and failure state.')
 result_sha256:str|None=None
 snapshot_integrity:Literal['verified','unsealed']=Field(default='verified',description='Older local development records without input seals remain readable but cannot create proposals.')
 revision:int=Field(ge=0,description='Monotonically increasing human review revision.')
 reviews:list[dict]=Field(description='Saved individual decisions and SI normalized values.')
 created:str
class DocumentErrorDetail(StrictModel):
 code:str=Field(description='Stable machine-readable error code.')
 message:str=Field(description='Specific correction; no provider bodies, credentials or invented content.')
class DocumentErrorResponse(StrictModel):
 detail:DocumentErrorDetail
class InputFieldError(StrictModel):
 loc:list[str|int]=Field(description='Exact failing request-field path.')
 msg:str
 type:str
class InputFieldErrorResponse(StrictModel):
 detail:list[InputFieldError]
class TextCell(StrictModel):
 text:str
 bbox:list[float]=Field(min_length=4,max_length=4,description='PDF points; top-left origin, y down.')
class PageTable(StrictModel):
 bbox:list[float]=Field(min_length=4,max_length=4)
 rows:list[list[TextCell|None]]
 strategy:Literal['lines','text']
class PageResponse(StrictModel):
 schema_:Literal['cablesim.datasheet-page/1']=Field(alias='schema')
 page:int
 width_pt:float=Field(description='PDF points.')
 height_pt:float=Field(description='PDF points.')
 coordinate_system:Literal['pdf-points-top-left-y-down']
 text:str=Field(description='Original text layer; OCR does not overwrite it.')
 lines:list[TextCell]
 words:list[TextCell]
 tables:list[PageTable]
 text_source:Literal['original','none']
 requires_ocr:bool=Field(default=False,description='No usable parameter text layer: empty or image-dominant page containing only a few native labels/page numbers. Rules use local CPU OCR without outbound requests.')
class ProposalRequest(StrictModel):
 request_id:UUID
 extraction_id:str=Field(description='Successfully extracted and completely human-reviewed record.')
 expected_review_revision:int=Field(ge=1)
 target_model_id:str=Field(description='Existing immutable cable-model version to branch.')
 expected_model_sha256:str=Field(pattern='^[0-9a-f]{64}$')
 version:str=Field(min_length=1,max_length=32,description='New draft version label; original model remains unchanged.')
 field_bindings:dict[str,list[str]]=Field(default_factory=dict,max_length=20,description='For a complete structural target only: canonical field -> explicit JSON pointer(s) under /cable_type. Matching conductor quantity/layer role and SI unit are required; no geometry inference.')
class ApprovalRequest(StrictModel):
 request_id:UUID
 proposal_sha256:str=Field(pattern='^[0-9a-f]{64}$',description='Exact proposal contents acknowledged by the human.')
 approver:str=Field(min_length=1,max_length=100)
 human_approved:Literal[True]=Field(description='Explicit human approval; extraction plugin never calls this endpoint.')
 @model_validator(mode='before')
 @classmethod
 def explicit(cls,value):
  if isinstance(value,dict) and value.get('human_approved') is not True:raise ValueError('human_approved：必须人工明确填写 true。')
  return value
class ProposalResponse(StrictModel):
 id:str
 document_id:str
 status:Literal['proposed','approved']
 sha256:str
 target_model_id:str
 base_sha256:str
 draft:CableModelVersion=Field(description='Proposed immutable new model version; creation happens only after approval.')
 changes:list[dict]=Field(description='Before/after SI values, source evidence and human decisions.')
 new_model_id:str|None=None
 approval:dict|None=None
class ExtractionComparisonRequest(StrictModel):
 extraction_ids:list[str]=Field(min_length=2,max_length=2,description='Two completed runs on exactly the same document/model/pages/regions.')
class ComparedField(StrictModel):
 field:str
 left:list[Candidate]
 right:list[Candidate]
 agrees:bool=Field(description='Exact SI value/unit sets agree; ambiguity remains independently visible.')
class ExtractionComparisonResponse(StrictModel):
 document_sha256:str
 extraction_ids:list[str]
 methods:list[dict]
 rows:list[ComparedField]

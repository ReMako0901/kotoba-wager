from typing import Literal
from pydantic import BaseModel, Field


class Concept(BaseModel):
    id: str
    label: str
    kind: Literal['person','place','relation','event','object','attribute']
    description: str
    depends_on: list[str] = []
    anchors: list[str] = []


class ResolvedConcept(Concept):
    selected_surfaces: list[str]
    mentions: list[str]


class Unit(BaseModel):
    id: str
    text: str
    start: int
    end: int
    stakeable: bool


class Analysis(BaseModel):
    units: list[Unit]


class StakeMeaning(BaseModel):
    unit_id: str
    source_text: str
    label: str
    kind: Literal['person','place','relation','event','object','attribute']
    description: str
    mentions: list[str]


class MeaningResponse(BaseModel):
    meanings: list[StakeMeaning] = Field(min_length=1,max_length=80)


class StakesResolution(BaseModel):
    concepts: list[ResolvedConcept]


class Checks(BaseModel):
    protected_retained: bool
    lost_absent: bool
    reward_realized: bool
    notes: str


class Rewrite(BaseModel):
    text: str = Field(min_length=1,max_length=140)
    summary: str
    changes: list[str] = Field(min_length=1,max_length=8)
    checks: Checks


class CreateSession(BaseModel):
    story_id: str
    request_id: str = Field(pattern=r'^[a-zA-Z0-9_-]{8,80}$')


class TradeRequest(BaseModel):
    request_id: str = Field(pattern=r'^[a-zA-Z0-9_-]{8,80}$')
    version: int = Field(ge=1)
    offer_id: str
    unit_ids: list[str] = Field(min_length=1,max_length=80)


class TextEdit(BaseModel):
    sentence_id: int = Field(ge=0)
    before: str = Field(min_length=1)
    after: str
    reason: str


class EditProposal(BaseModel):
    edits: list[TextEdit] = Field(min_length=1,max_length=12)
    summary: str
    changes: list[str] = Field(min_length=1,max_length=8)
    checks: Checks

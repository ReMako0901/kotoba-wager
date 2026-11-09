from typing import Literal
from pydantic import BaseModel, Field


class Concept(BaseModel):
    id: str
    label: str
    kind: Literal["person", "place", "relation", "event", "object", "attribute"]
    description: str
    depends_on: list[str]


class RawUnit(BaseModel):
    text: str = Field(min_length=1)
    score: int = Field(ge=0, le=9)
    concept_ids: list[str]
    score_reason: str


class RawAnalysis(BaseModel):
    units: list[RawUnit] = Field(min_length=1, max_length=300)
    concepts: list[Concept] = Field(min_length=1, max_length=100)


class Unit(RawUnit):
    id: str
    start: int
    end: int


class Analysis(BaseModel):
    units: list[Unit]
    concepts: list[Concept]


class Checks(BaseModel):
    protected_retained: bool
    lost_absent: bool
    reward_realized: bool
    notes: str


class Rewrite(BaseModel):
    text: str = Field(min_length=30, max_length=140)
    summary: str
    changes: list[str] = Field(min_length=1, max_length=8)
    checks: Checks


class CreateSession(BaseModel):
    story_id: str
    request_id: str = Field(pattern=r"^[a-zA-Z0-9_-]{8,80}$")


class TradeRequest(BaseModel):
    request_id: str = Field(pattern=r"^[a-zA-Z0-9_-]{8,80}$")
    version: int = Field(ge=1)
    offer_id: str
    unit_ids: list[str] = Field(min_length=1, max_length=80)


class ScoredSegment(BaseModel):
    unit_index: int = Field(ge=0)
    score: int = Field(ge=0, le=9)
    concept_ids: list[str]
    score_reason: str


class IndexedAnalysis(BaseModel):
    # Establish the concept table before generating references to it.
    concepts: list[Concept] = Field(min_length=1, max_length=100)
    units: list[ScoredSegment] = Field(min_length=1, max_length=300)

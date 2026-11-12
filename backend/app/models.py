from typing import Literal
from pydantic import BaseModel, Field, field_validator, model_validator


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
    text: str = Field(min_length=1)
    summary: str
    changes: list[str] = Field(min_length=1,max_length=8)
    checks: Checks


class CreateSession(BaseModel):
    story_id: str | None = None
    custom_text: str | None = Field(default=None, min_length=20, max_length=100)
    request_id: str = Field(pattern=r'^[a-zA-Z0-9_-]{8,80}$')

    @field_validator('custom_text', mode='before')
    @classmethod
    def normalize_text(cls, value):
        return value.replace('\r\n', '\n').replace('\r', '\n').strip() if isinstance(value, str) else value

    @model_validator(mode='after')
    def one_story_source(self):
        if bool(self.story_id) == bool(self.custom_text):
            raise ValueError('物語を選ぶか、本文を入力してください。')
        return self


class TradeRequest(BaseModel):
    request_id: str = Field(pattern=r'^[a-zA-Z0-9_-]{8,80}$')
    version: int = Field(ge=1)
    offer_id: str
    unit_ids: list[str] = Field(min_length=1,max_length=80)
    game: Literal["slot", "blackjack", "baccarat"] | None = None


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


class StoryReview(BaseModel):
    verdict: Literal['accept', 'repair', 'reject']
    edits: list[TextEdit] = Field(max_length=12)
    summary: str
    changes: list[str] = Field(max_length=8)
    checks: Checks

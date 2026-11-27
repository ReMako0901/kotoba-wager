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
    mark_starts: list[int] | None = None
    text: str = Field(min_length=1)
    summary: str
    changes: list[str] = Field(min_length=1,max_length=8)
    checks: Checks


class CreateSession(BaseModel):
    mark_ids: list[str] | None = Field(default=None, max_length=3)
    title: str | None = Field(default=None, max_length=500)
    generated_story_id: str | None = Field(default=None, pattern=r"^[a-f0-9]{32}$")
    story_id: str | None = None
    intro: str = ""
    custom_text: str | None = Field(default=None, min_length=20, max_length=100)
    request_id: str = Field(pattern=r'^[a-zA-Z0-9_-]{8,80}$')

    @field_validator('custom_text', 'intro', mode='before')
    @classmethod
    def normalize_text(cls, value):
        return value.replace('\r\n', '\n').replace('\r', '\n').strip() if isinstance(value, str) else value

    @model_validator(mode='after')
    def one_story_source(self):
        if bool(self.story_id) == bool(self.custom_text):
            raise ValueError('物語を選ぶか、本文を入力してください。')
        if self.story_id and self.intro:
            raise ValueError('開始文の導入は変更できません。')
        return self


class TradeRequest(BaseModel):
    request_id: str = Field(pattern=r'^[a-zA-Z0-9_-]{8,80}$')
    version: int = Field(ge=1)
    offer_id: str
    unit_ids: list[str] = Field(min_length=1,max_length=80)
    game: Literal["slot", "blackjack", "baccarat", "rps", "card_guess", "chinchiro"] | None = None


class GameMoveRequest(BaseModel):
    attempt: int = Field(ge=0, strict=True)
    choice: int | None = Field(default=None, ge=0, le=2, strict=True)


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


class ReviewFinding(BaseModel):
    present: bool = Field(strict=True)
    reason: str

    @model_validator(mode='after')
    def require_reason(self):
        if self.present and not self.reason.strip():
            raise ValueError('減点項目には具体的な理由が必要です。')
        return self


class ReviewFindings(BaseModel):
    lost_reference: ReviewFinding
    setting_conflict: ReviewFinding
    style_shift: ReviewFinding
    broken_connection: ReviewFinding
    outcome_conflict: ReviewFinding


class StoryReview(BaseModel):
    findings: ReviewFindings
    verdict: Literal['accept', 'repair', 'reject']
    edits: list[TextEdit] = Field(max_length=12)
    summary: str
    changes: list[str] = Field(max_length=8)
    checks: Checks


class StoryChoiceRequest(BaseModel):
    request_id: str = Field(pattern=r'^[a-zA-Z0-9_-]{8,80}$')
    version: int = Field(ge=1)
    choice: Literal['escape', 'continue']

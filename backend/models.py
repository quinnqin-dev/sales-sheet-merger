from typing import Literal
from .i18n import DomainError
from pydantic import BaseModel, Field, model_validator


class Column(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=80)
    type: Literal['text', 'number', 'date'] = 'text'
    required: bool = False


class Template(BaseModel):
    name: str = Field(default='Standard Sales Details', min_length=1, max_length=80)
    columns: list[Column] = Field(min_length=1, max_length=100)

    @model_validator(mode='after')
    def unique_columns(self):
        for attr in ('id', 'name'):
            values = [getattr(c, attr).strip() for c in self.columns]
            if not all(values) or len(values) != len(set(values)):
                raise DomainError('invalid_columns')
        return self


class Replacement(BaseModel):
    before: str = Field(max_length=1000)
    after: str = Field(max_length=1000)


class Mapping(BaseModel):
    target_id: str
    mode: Literal['source', 'fixed', 'empty'] = 'source'
    source_index: int | None = Field(default=None, ge=0, le=999)
    fixed: str = Field(default='', max_length=1000)
    trim: bool = True
    fill: str = Field(default='', max_length=1000)
    replacements: list[Replacement] = Field(default_factory=list, max_length=100)
    date_format: Literal['%Y-%m-%d', '%Y/%m/%d', '%Y%m%d', '%d/%m/%Y', '%m/%d/%Y', '%Y-%m-%d %H:%M:%S'] = '%Y-%m-%d'
    number_style: Literal['plain', 'comma', 'european'] = 'comma'


class Rule(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=100)
    headers: list[str] = Field(max_length=1000)
    mappings: list[Mapping] = Field(max_length=100)

    @model_validator(mode='after')
    def unique_targets(self):
        ids = [m.target_id for m in self.mappings]
        if len(ids) != len(set(ids)):
            raise DomainError('duplicate_mapping')
        return self


class Library(BaseModel):
    version: Literal[1] = 1
    template: Template
    rules: list[Rule] = Field(default_factory=list, max_length=500)

    @model_validator(mode='after')
    def unique_rules(self):
        if len({r.id for r in self.rules}) != len(self.rules):
            raise DomainError('duplicate_rules')
        return self


class InspectRequest(BaseModel):
    encoding: Literal['utf-8-sig', 'gb18030'] = 'utf-8-sig'
    header_rows: dict[str, int] = Field(default_factory=dict)


class Selection(BaseModel):
    file_id: str
    sheet: str
    header_row: int = Field(default=1, ge=1, le=1000)
    rule: Rule


class RunRequest(BaseModel):
    template: Template
    selections: list[Selection] = Field(min_length=1, max_length=300)


DEFAULT_TEMPLATE = Template(columns=[
    Column(id='date', name='Date', type='date', required=True),
    Column(id='order_id', name='Order ID'),
    Column(id='sku', name='SKU'),
    Column(id='product', name='Product'),
    Column(id='quantity', name='Quantity', type='number'),
    Column(id='price', name='Unit Price', type='number'),
    Column(id='amount', name='Sales Amount', type='number', required=True),
    Column(id='channel', name='Channel'),
])

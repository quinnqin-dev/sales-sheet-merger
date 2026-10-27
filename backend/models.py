from typing import Literal
from pydantic import BaseModel, Field, model_validator


class Column(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=80)
    type: Literal['text', 'number', 'date'] = 'text'
    required: bool = False


class Template(BaseModel):
    name: str = Field(default='标准销售明细', min_length=1, max_length=80)
    columns: list[Column] = Field(min_length=1, max_length=100)

    @model_validator(mode='after')
    def unique_columns(self):
        for attr in ('id', 'name'):
            values = [getattr(c, attr).strip() for c in self.columns]
            if not all(values) or len(values) != len(set(values)):
                raise ValueError('目标列名称和标识必须唯一且非空')
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
            raise ValueError('同一目标列只能配置一次')
        return self


class Library(BaseModel):
    version: Literal[1] = 1
    template: Template
    rules: list[Rule] = Field(default_factory=list, max_length=500)

    @model_validator(mode='after')
    def unique_rules(self):
        if len({r.id for r in self.rules}) != len(self.rules):
            raise ValueError('规则标识不能重复')
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
    Column(id='date', name='日期', type='date', required=True),
    Column(id='order_id', name='订单号'),
    Column(id='sku', name='商品编码'),
    Column(id='product', name='商品名称'),
    Column(id='quantity', name='数量', type='number'),
    Column(id='price', name='单价', type='number'),
    Column(id='amount', name='销售额', type='number', required=True),
    Column(id='channel', name='渠道'),
])

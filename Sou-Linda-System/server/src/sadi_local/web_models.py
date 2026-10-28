"""Strict request contracts; monetary values are integer cents, never floats."""
from typing import Annotated, Any, Literal
from pydantic import BaseModel, ConfigDict, Field

MAX_CENTS = 9_000_000_000_000_000
Money = Annotated[int, Field(strict=True, ge=0, le=MAX_CENTS)]
PositiveMoney = Annotated[int, Field(strict=True, ge=1, le=MAX_CENTS)]
Quantity = Annotated[int, Field(strict=True, ge=1, le=1_000_000_000)]
Stock = Annotated[int, Field(strict=True, ge=0, le=1_000_000_000)]
BasisPoints = Annotated[int, Field(strict=True, ge=0, le=10_000)]
BusinessDate = Annotated[str, Field(pattern=r'^\d{4}-\d{2}-\d{2}$')]
Identifier = Annotated[str, Field(min_length=1, max_length=160)]
Channel = Literal['Instagram', 'WhatsApp', 'TikTok', 'Local']
PaidMethod = Literal['Efectivo', 'Transferencia', 'Tarjeta', 'QR']
RequestedMethod = Literal['Efectivo', 'Transferencia', 'Tarjeta', 'QR', 'Crédito']


class StrictRequest(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)


class CommandRequest(StrictRequest):
    date: BusinessDate | None = None
    commandId: Identifier | None = None


class VariantRequest(StrictRequest):
    name: Annotated[str, Field(min_length=1, max_length=160)]
    category: Annotated[str, Field(max_length=160)]
    productId: Identifier | None = None
    variantId: Identifier | None = None
    sku: Annotated[str, Field(min_length=1, max_length=80)]
    size: Annotated[str, Field(min_length=1, max_length=30)]
    color: Annotated[str, Field(min_length=1, max_length=60)]
    cost: Money
    retailPrice: Money
    wholesalePrice: Money
    stock: Stock
    minStock: Stock
    active: bool = True


class ReceiveRequest(CommandRequest):
    variantId: Identifier
    quantity: Quantity
    totalCost: Money
    note: Annotated[str, Field(max_length=2000)] = ''
    paid: bool = False
    paymentMethod: PaidMethod = 'Transferencia'


class AdjustmentRequest(CommandRequest):
    variantId: Identifier
    delta: Annotated[int, Field(strict=True, ge=-1_000_000_000, le=1_000_000_000)]
    totalCost: Money = 0
    note: Annotated[str, Field(min_length=1, max_length=2000)]


class CustomerRequest(StrictRequest):
    id: Identifier | None = None
    name: Annotated[str, Field(min_length=1, max_length=160)]
    phone: Annotated[str, Field(max_length=80)] = ''
    social: Annotated[str, Field(max_length=160)] = ''
    preferredSize: Annotated[str, Field(max_length=160)] = ''


class SaleLineRequest(StrictRequest):
    variantId: Identifier
    quantity: Quantity
    unitPrice: Money


class SaleRequest(CommandRequest):
    customerId: Identifier | None = None
    channel: Channel
    paymentMethod: RequestedMethod
    items: Annotated[list[SaleLineRequest], Field(min_length=1, max_length=1000)]
    shippingCost: Money = 0
    packagingCost: Money = 0
    discount: Money = 0
    discountKind: Literal['fixed', 'percent'] = 'fixed'
    discountValue: Money | None = None
    commissionRate: BasisPoints = 0
    status: Literal['pending', 'reserved', 'completed'] = 'completed'
    directCostMethod: PaidMethod = 'Efectivo'
    directCostsPaid: bool = True
    notes: Annotated[str, Field(max_length=2000)] = ''


class CancelRequest(CommandRequest):
    confirmReturn: bool = False


class ReturnRequest(CommandRequest):
    items: dict[Identifier, Quantity] | None = None


class PaymentRequest(CommandRequest):
    amount: PositiveMoney
    method: PaidMethod
    commissionRate: BasisPoints | None = None


class RefundRequest(CommandRequest):
    amount: PositiveMoney
    method: PaidMethod


class SettleRequest(CommandRequest):
    method: PaidMethod


class ExpenseRequest(CommandRequest):
    category: Annotated[str, Field(min_length=1, max_length=160)]
    description: Annotated[str, Field(min_length=1, max_length=2000)]
    amount: PositiveMoney
    paymentMethod: PaidMethod
    channel: Channel | None = None
    costType: Literal['fixed', 'variable'] = 'variable'
    paid: bool = True


class CashClosingRequest(StrictRequest):
    date: BusinessDate
    openingCash: Money
    countedCash: Money
    note: Annotated[str, Field(max_length=2000)] = ''
    allowRevision: bool = False


class DraftRequest(StrictRequest):
    draft: dict[str, Any] | None

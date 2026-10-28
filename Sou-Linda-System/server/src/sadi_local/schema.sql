PRAGMA foreign_keys = ON;
CREATE TABLE products (
 id TEXT PRIMARY KEY, name TEXT NOT NULL CHECK(length(trim(name))>0),
 category TEXT NOT NULL, normalized_name TEXT NOT NULL UNIQUE
) STRICT;
CREATE TABLE variants (
 id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id),
 sku TEXT NOT NULL UNIQUE CHECK(length(trim(sku))>0), size TEXT NOT NULL CHECK(length(trim(size))>0),
 color TEXT NOT NULL CHECK(length(trim(color))>0),
 retail_cents INTEGER NOT NULL CHECK(retail_cents BETWEEN 0 AND 9000000000000000),
 wholesale_cents INTEGER NOT NULL CHECK(wholesale_cents BETWEEN 0 AND 9000000000000000),
 min_stock INTEGER NOT NULL CHECK(min_stock BETWEEN 0 AND 1000000000),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), UNIQUE(product_id,size,color)
) STRICT;
CREATE TABLE inventory (
 variant_id TEXT PRIMARY KEY REFERENCES variants(id),
 on_hand INTEGER NOT NULL CHECK(on_hand BETWEEN 0 AND 1000000000),
 reserved INTEGER NOT NULL CHECK(reserved BETWEEN 0 AND on_hand),
 value_cents INTEGER NOT NULL CHECK(value_cents BETWEEN 0 AND 9000000000000000),
 version INTEGER NOT NULL DEFAULT 0 CHECK(version>=0), CHECK(on_hand>0 OR value_cents=0)
) STRICT;
CREATE TABLE customers (
 id TEXT PRIMARY KEY, name TEXT NOT NULL CHECK(length(trim(name))>0), phone TEXT NOT NULL,
 social TEXT NOT NULL, preferred_sizes TEXT NOT NULL
) STRICT;
CREATE TABLE orders (
 id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE,
 business_date TEXT NOT NULL CHECK(length(business_date)=10 AND date(business_date,'+0 days') IS NOT NULL AND date(business_date,'+0 days')=business_date),
 completed_date TEXT CHECK(completed_date IS NULL OR (length(completed_date)=10 AND date(completed_date,'+0 days') IS NOT NULL AND date(completed_date,'+0 days')=completed_date)),
 cancelled_date TEXT CHECK(cancelled_date IS NULL OR (length(cancelled_date)=10 AND date(cancelled_date,'+0 days') IS NOT NULL AND date(cancelled_date,'+0 days')=cancelled_date)),
 channel TEXT NOT NULL CHECK(channel IN ('Instagram','WhatsApp','TikTok','Local')),
 customer_id TEXT REFERENCES customers(id),
 status TEXT NOT NULL CHECK(status IN ('pending','reserved','completed','cancelled')),
 terms TEXT NOT NULL CHECK(terms IN ('immediate','credit')),
 payment_method TEXT NOT NULL CHECK(payment_method IN ('Efectivo','Transferencia','Tarjeta','QR','Crédito')),
 subtotal_cents INTEGER NOT NULL CHECK(subtotal_cents BETWEEN 0 AND 9000000000000000),
 discount_kind TEXT NOT NULL CHECK(discount_kind IN ('fixed','percent')),
 discount_value INTEGER NOT NULL CHECK(discount_value BETWEEN 0 AND 9000000000000000),
 discount_cents INTEGER NOT NULL CHECK(discount_cents BETWEEN 0 AND subtotal_cents),
 total_cents INTEGER NOT NULL CHECK(total_cents=subtotal_cents-discount_cents),
 cogs_cents INTEGER CHECK(cogs_cents IS NULL OR cogs_cents BETWEEN 0 AND 9000000000000000),
 commission_bps INTEGER NOT NULL CHECK(commission_bps BETWEEN 0 AND 10000),
 shipping_cents INTEGER NOT NULL CHECK(shipping_cents BETWEEN 0 AND 9000000000000000),
 packaging_cents INTEGER NOT NULL CHECK(packaging_cents BETWEEN 0 AND 9000000000000000),
 direct_cost_method TEXT NOT NULL CHECK(direct_cost_method IN ('Efectivo','Transferencia','Tarjeta','QR')),
 direct_costs_paid INTEGER NOT NULL CHECK(direct_costs_paid IN (0,1)),
 source TEXT NOT NULL DEFAULT 'pos' CHECK(source IN ('pos','import')), external_key TEXT UNIQUE,
 created_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0, notes TEXT NOT NULL DEFAULT '',
 CHECK((terms<>'credit' AND payment_method<>'Crédito') OR customer_id IS NOT NULL)
) STRICT;
CREATE INDEX idx_orders_date ON orders(completed_date);
CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE TABLE order_items (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id),
 variant_id TEXT NOT NULL REFERENCES variants(id), model_snapshot TEXT NOT NULL,
 variant_snapshot TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 1000000000),
 unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents BETWEEN 0 AND 9000000000000000),
 gross_cents INTEGER NOT NULL CHECK(gross_cents BETWEEN 0 AND 9000000000000000),
 discount_cents INTEGER NOT NULL CHECK(discount_cents BETWEEN 0 AND gross_cents),
 net_cents INTEGER NOT NULL CHECK(net_cents=gross_cents-discount_cents),
 cogs_cents INTEGER CHECK(cogs_cents IS NULL OR cogs_cents BETWEEN 0 AND 9000000000000000),
 UNIQUE(order_id,variant_id)
) STRICT;
CREATE TABLE reservations (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id),
 order_item_id TEXT NOT NULL REFERENCES order_items(id), variant_id TEXT NOT NULL REFERENCES variants(id),
 quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 1000000000),
 state TEXT NOT NULL CHECK(state IN ('active','consumed','released','expired')), expires_at TEXT
) STRICT;
CREATE UNIQUE INDEX idx_active_reservation ON reservations(order_item_id) WHERE state='active';
CREATE TABLE inventory_movements (
 id TEXT PRIMARY KEY, sequence INTEGER NOT NULL UNIQUE, variant_id TEXT NOT NULL REFERENCES variants(id),
 order_id TEXT REFERENCES orders(id), quantity_delta INTEGER NOT NULL, reserved_delta INTEGER NOT NULL,
 value_delta_cents INTEGER NOT NULL CHECK(value_delta_cents BETWEEN -9000000000000000 AND 9000000000000000),
 kind TEXT NOT NULL, business_date TEXT NOT NULL, note TEXT NOT NULL, created_at TEXT NOT NULL
) STRICT;
CREATE INDEX idx_stock_movement_variant ON inventory_movements(variant_id,sequence);
CREATE TABLE payments (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), business_date TEXT NOT NULL,
 amount_cents INTEGER NOT NULL CHECK(amount_cents BETWEEN 1 AND 9000000000000000),
 method TEXT NOT NULL CHECK(method IN ('Efectivo','Transferencia','Tarjeta','QR')),
 kind TEXT NOT NULL CHECK(kind IN ('receipt','refund')),
 commission_bps INTEGER NOT NULL CHECK(commission_bps BETWEEN 0 AND 10000),
 commission_cents INTEGER NOT NULL CHECK(commission_cents BETWEEN 0 AND amount_cents), created_at TEXT NOT NULL
) STRICT;
CREATE INDEX idx_payment_order ON payments(order_id);
CREATE TABLE returns (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), business_date TEXT NOT NULL,
 revenue_cents INTEGER NOT NULL CHECK(revenue_cents BETWEEN 0 AND 9000000000000000),
 cogs_cents INTEGER NOT NULL CHECK(cogs_cents BETWEEN 0 AND 9000000000000000), created_at TEXT NOT NULL
) STRICT;
CREATE TABLE return_items (
 id TEXT PRIMARY KEY, return_id TEXT NOT NULL REFERENCES returns(id), order_item_id TEXT NOT NULL REFERENCES order_items(id),
 quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 1000000000),
 revenue_cents INTEGER NOT NULL CHECK(revenue_cents BETWEEN 0 AND 9000000000000000),
 cogs_cents INTEGER NOT NULL CHECK(cogs_cents BETWEEN 0 AND 9000000000000000), UNIQUE(return_id,order_item_id)
) STRICT;
CREATE TABLE expenses (
 id TEXT PRIMARY KEY, business_date TEXT NOT NULL, category TEXT NOT NULL,
 cost_type TEXT NOT NULL CHECK(cost_type IN ('fixed','variable')), description TEXT NOT NULL,
 amount_cents INTEGER NOT NULL CHECK(amount_cents BETWEEN 1 AND 9000000000000000),
 payment_method TEXT NOT NULL CHECK(payment_method IN ('Efectivo','Transferencia','Tarjeta','QR')),
 channel TEXT CHECK(channel IS NULL OR channel IN ('Instagram','WhatsApp','TikTok','Local')),
 paid INTEGER NOT NULL CHECK(paid IN (0,1))
) STRICT;
CREATE TABLE economic_entries (
 id TEXT PRIMARY KEY, business_date TEXT NOT NULL,
 bucket TEXT NOT NULL CHECK(bucket IN ('revenue','cogs','commission','shipping','packaging','operating_expense','inventory_loss')),
 amount_cents INTEGER NOT NULL CHECK(amount_cents BETWEEN -9000000000000000 AND 9000000000000000),
 order_id TEXT REFERENCES orders(id), channel TEXT CHECK(channel IS NULL OR channel IN ('Instagram','WhatsApp','TikTok','Local')),
 reference TEXT NOT NULL
) STRICT;
CREATE INDEX idx_economic_date ON economic_entries(business_date,bucket);
CREATE TABLE cash_entries (
 id TEXT PRIMARY KEY, sequence INTEGER NOT NULL UNIQUE, business_date TEXT NOT NULL,
 method TEXT NOT NULL CHECK(method IN ('Efectivo','Transferencia','Tarjeta','QR')),
 delta_cents INTEGER NOT NULL CHECK(delta_cents BETWEEN -9000000000000000 AND 9000000000000000),
 kind TEXT NOT NULL, order_id TEXT REFERENCES orders(id), reference TEXT NOT NULL, note TEXT NOT NULL
) STRICT;
CREATE INDEX idx_cash_date ON cash_entries(business_date,method);
CREATE TABLE cash_closings (
 id TEXT PRIMARY KEY, business_date TEXT NOT NULL, opening_cents INTEGER NOT NULL CHECK(opening_cents>=0),
 expected_cents INTEGER NOT NULL, counted_cents INTEGER NOT NULL CHECK(counted_cents>=0),
 difference_cents INTEGER NOT NULL CHECK(difference_cents=counted_cents-expected_cents),
 cutoff_sequence INTEGER NOT NULL, note TEXT NOT NULL, created_at TEXT NOT NULL
) STRICT;
CREATE TABLE purchases (
 id TEXT PRIMARY KEY, business_date TEXT NOT NULL, variant_id TEXT NOT NULL REFERENCES variants(id),
 quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 1000000000),
 total_cost_cents INTEGER NOT NULL CHECK(total_cost_cents BETWEEN 0 AND 9000000000000000),
 note TEXT NOT NULL, paid INTEGER NOT NULL CHECK(paid IN (0,1)),
 method TEXT NOT NULL CHECK(method IN ('Efectivo','Transferencia','Tarjeta','QR'))
) STRICT;
CREATE TABLE drafts (key TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL) STRICT;
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
CREATE TABLE commands (id TEXT PRIMARY KEY, input_hash TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL) STRICT;
PRAGMA user_version=1;

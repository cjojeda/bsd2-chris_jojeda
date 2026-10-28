"""Explicit demonstration data; never loaded automatically."""
from datetime import date, timedelta
from .constants import CHANNELS, PAYMENT_METHODS


def seed_demo(service):
    db = service.db
    with db.transaction():
        if any(db.connection.execute(f'SELECT 1 FROM {table} LIMIT 1').fetchone()
               for table in ('products', 'orders', 'customers', 'expenses')):
            raise ValueError('La demostración solo puede cargarse en una base vacía.')
        specs = [
            ('Valentina', 'Conjuntos', 'VAL-95-ROJ', '95', 'Rojo', 280000, 175000, 120000, 16),
            ('Valentina', 'Conjuntos', 'VAL-100-NEG', '100', 'Negro', 280000, 175000, 120000, 12),
            ('Luna', 'Conjuntos', 'LUN-95-MAR', '95', 'Marfil', 340000, 220000, 150000, 10),
            ('Amelia', 'Bodys', 'AME-M-NEG', 'M', 'Negro', 420000, 275000, 200000, 12),
            ('Bruma', 'Bombachas', 'BRU-L-ROS', 'L', 'Rosa', 150000, 95000, 65000, 2),
            ('Isabella', 'Corpiños', 'ISA-90-BLA', '90', 'Blanco', 260000, 165000, 105000, 0),
            ('Nina', 'Pijamas', 'NIN-M-NEG', 'M', 'Negro', 580000, 375000, 280000, 12),
            ('Zoe', 'Camisolines', 'ZOE-U-NAT', 'Único', 'Natural', 490000, 320000, 230000, 10),
        ]
        variants = []
        for model, category, sku, size, color, retail, wholesale, cost, qty in specs:
            variants.append(service.save_variant(dict(model=model, category=category, sku=sku, size=size, color=color,
                retail_cents=retail, wholesale_cents=wholesale, min_stock=3, initial_qty=qty, initial_unit_cost_cents=cost)))
        customers = [service.save_customer(name, phone, social, size) for name, phone, social, size in [
            ('Lucía García', '5491100000001', '@lucia.ejemplo', '95, M'),
            ('Martina López', '5491100000002', '@martina.ejemplo', '100, L'),
            ('Sofía Torres', '5491100000003', '@sofia.ejemplo', 'M'),
            ('Camila Ruiz', '5491100000004', '@camila.ejemplo', '90, S'),
        ]]
        today = date.today()
        # Every document is explicitly marked as demonstration through dataset metadata.
        sale_variants = [0, 1, 2, 3, 6, 7]
        for i in range(20):
            index = sale_variants[i % len(sale_variants)]
            variant = variants[index]
            day = (today - timedelta(days=19-i)).isoformat()
            credit = i in (5, 14)
            service.create_order([dict(variant_id=variant, quantity=1, unit_price_cents=specs[index][5])],
                CHANNELS[i % len(CHANNELS)], customer_id=customers[i % 4], payment_method='Crédito' if credit else PAYMENT_METHODS[i % 4],
                payment_terms='credit' if credit else 'immediate', discount_kind='percent', discount_value=1000 if i % 5 == 0 else 0,
                commission_bps=300 if i % 4 in (2, 3) else 0, packaging_cents=15000, shipping_cents=35000 if i % 3 == 0 else 0,
                business_date=day)
        service.create_order([dict(variant_id=variants[0], quantity=2, unit_price_cents=280000)], 'Instagram',
            customer_id=customers[2], status='reserved', business_date=today.isoformat())
        service.create_order([dict(variant_id=variants[7], quantity=1, unit_price_cents=490000)], 'WhatsApp',
            customer_id=customers[3], status='pending', business_date=today.isoformat())
        service.save_expense(today.replace(day=1).isoformat(), 'Publicidad', 'Campaña de Instagram · ejemplo',
            850000, 'Transferencia', channel='Instagram', cost_type='variable')
        service.save_expense(today.replace(day=1).isoformat(), 'Alquiler', 'Espacio de trabajo · ejemplo',
            1200000, 'Transferencia', cost_type='fixed')
        db.set_meta('demo', 'true')
    return True

-- Migration: add role field to users, split order state into order_status + invoice_status, and create quote + quote_item tables

-- 1) Add role column to users if missing
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS role VARCHAR(30) NOT NULL DEFAULT 'Sale'
    CHECK (role IN ('Sale', 'Accountant', 'Manager'));

-- 2) Update existing users with default role if null
UPDATE users
SET role = 'Sale'
WHERE role IS NULL OR role = '';

-- 3) Add order_status and invoice_status to sale_order if missing
ALTER TABLE sale_order
    ADD COLUMN IF NOT EXISTS order_status VARCHAR(30) NOT NULL DEFAULT 'Pending'
    CHECK (order_status IN ('Pending', 'Processing', 'Done', 'Canceled'));

ALTER TABLE sale_order
    ADD COLUMN IF NOT EXISTS invoice_status VARCHAR(30) NOT NULL DEFAULT 'Unpaid'
    CHECK (invoice_status IN ('Unpaid', 'Partial', 'Paid', 'Refunded'));

-- 4) Backfill old `state` column values into the new status columns if needed
UPDATE sale_order
SET
    order_status = CASE
        WHEN state IN ('draft', 'sale', 'done', 'cancel') THEN
            CASE
                WHEN state = 'draft' THEN 'Pending'
                WHEN state = 'sale' THEN 'Processing'
                WHEN state = 'done' THEN 'Done'
                WHEN state = 'cancel' THEN 'Canceled'
                ELSE 'Pending'
            END
        ELSE 'Pending'
    END,
    invoice_status = CASE
        WHEN state = 'done' THEN 'Paid'
        WHEN state = 'cancel' THEN 'Refunded'
        ELSE 'Unpaid'
    END
WHERE order_status IS NULL OR order_status = '' OR invoice_status IS NULL OR invoice_status = '';

-- 5) If table still has old state column, keep it for compatibility or remove after code migration
-- ALTER TABLE sale_order DROP COLUMN IF EXISTS state;

-- 6) Create Quote table
CREATE TABLE IF NOT EXISTS quote (
    id SERIAL PRIMARY KEY,
    quote_number VARCHAR(100) NOT NULL UNIQUE,
    customer_id INT NOT NULL,
    created_by INT NOT NULL,
    quote_status VARCHAR(30) NOT NULL DEFAULT 'Draft'
        CHECK (quote_status IN ('Draft', 'Sent', 'Accepted', 'Rejected', 'Expired')),
    valid_until DATE,
    notes TEXT,
    subtotal NUMERIC(15,2) NOT NULL DEFAULT 0,
    discount_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
    tax_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
    total_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_quote_customer
        FOREIGN KEY (customer_id)
        REFERENCES res_partner(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,
    CONSTRAINT fk_quote_user
        FOREIGN KEY (created_by)
        REFERENCES users(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
);

-- 7) Create Quote Item table
CREATE TABLE IF NOT EXISTS quote_item (
    id SERIAL PRIMARY KEY,
    quote_id INT NOT NULL,
    product_name VARCHAR(255) NOT NULL,
    description TEXT,
    quantity NUMERIC(15,2) NOT NULL DEFAULT 1,
    unit_price NUMERIC(15,2) NOT NULL DEFAULT 0,
    line_total NUMERIC(15,2) NOT NULL DEFAULT 0,
    CONSTRAINT fk_quote_item_quote
        FOREIGN KEY (quote_id)
        REFERENCES quote(id)
        ON UPDATE CASCADE
        ON DELETE CASCADE
);

-- 8) Add quote_id and created_by to sale_order if they do not exist
ALTER TABLE sale_order
    ADD COLUMN IF NOT EXISTS quote_id INT,
    ADD COLUMN IF NOT EXISTS created_by INT;

ALTER TABLE sale_order
    ADD CONSTRAINT IF NOT EXISTS fk_sale_order_quote
        FOREIGN KEY (quote_id)
        REFERENCES quote(id)
        ON UPDATE CASCADE
        ON DELETE SET NULL;

ALTER TABLE sale_order
    ADD CONSTRAINT IF NOT EXISTS fk_sale_order_user
        FOREIGN KEY (created_by)
        REFERENCES users(id)
        ON UPDATE CASCADE
        ON DELETE SET NULL;

-- 9) Optional: if users table is missing and project already has another user table, change the name accordingly.
-- In this project, the table used for auth is `users`.

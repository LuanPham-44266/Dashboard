DROP TABLE IF EXISTS account_move;
DROP TABLE IF EXISTS sale_order_line;
DROP TABLE IF EXISTS sale_order;
DROP TABLE IF EXISTS product_product;
DROP TABLE IF EXISTS res_partner;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    role VARCHAR(30) NOT NULL DEFAULT 'Sale'
        CHECK (role IN ('Sale', 'Accountant', 'Manager')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE res_partner (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(50)
);

CREATE TABLE product_product (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    list_price NUMERIC(15,2) NOT NULL DEFAULT 0
);

CREATE TABLE sale_order (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    partner_id INT NOT NULL,
    created_by INT,
    date_order TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    state VARCHAR(50) NOT NULL DEFAULT 'draft'
        CHECK (state IN ('draft', 'sale', 'done', 'cancel')),
    amount_untaxed NUMERIC(15,2) NOT NULL DEFAULT 0,
    amount_total NUMERIC(15,2) NOT NULL DEFAULT 0,
    CONSTRAINT fk_sale_order_partner
        FOREIGN KEY (partner_id)
        REFERENCES res_partner(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,
    CONSTRAINT fk_sale_order_user
        FOREIGN KEY (created_by)
        REFERENCES users(id)
        ON UPDATE CASCADE
        ON DELETE SET NULL
);

CREATE TABLE sale_order_line (
    id SERIAL PRIMARY KEY,
    order_id INT NOT NULL,
    product_id INT NOT NULL,
    product_uom_qty NUMERIC(15,2) NOT NULL DEFAULT 1,
    price_unit NUMERIC(15,2) NOT NULL DEFAULT 0,
    price_subtotal NUMERIC(15,2) NOT NULL DEFAULT 0,
    CONSTRAINT fk_sale_order_line_order
        FOREIGN KEY (order_id)
        REFERENCES sale_order(id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,
    CONSTRAINT fk_sale_order_line_product
        FOREIGN KEY (product_id)
        REFERENCES product_product(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
);

CREATE TABLE account_move (
    id SERIAL PRIMARY KEY,
    partner_id INT NOT NULL,
    invoice_origin VARCHAR(100),
    name VARCHAR(100) UNIQUE,
    state VARCHAR(50) DEFAULT 'draft' CHECK (state IN ('draft', 'posted', 'paid', 'cancel')),
    amount_total NUMERIC(15,2),
    CONSTRAINT fk_account_move_partner
        FOREIGN KEY (partner_id)
        REFERENCES res_partner(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
);

INSERT INTO users (username, email, password_hash, full_name, role) VALUES
('sale01', 'sale01@company.com', '$2b$10$jVne5x9icVlNqkK9269bT.EJR1GCiyztoqEtpaamQVeDsvAIvJK1C', 'Sale User 1', 'Sale'),
('accountant01', 'accountant01@company.com', '$2b$10$EDnHlGb3cmcBw1Z4lhfXTu2zuoew1hlwQUIpSkGCw6kLudYQjkGLy', 'Accountant User 1', 'Accountant'),
('manager01', 'manager01@company.com', '$2b$10$hAQejtIX9YhLNHkeR532Au6.nJ3brXuVMTKkoUopvBQaKKaJYSIni', 'Manager User 1', 'Manager');

INSERT INTO res_partner (name, email, phone) VALUES
('Nguyễn Văn An', 'nguyenvanan@example.com', '0901000001'),
('Trần Thị Bình', 'tranthibinh@example.com', '0901000002'),
('Lê Hoàng Cường', 'lehoangcuong@example.com', '0901000003'),
('Phạm Minh Dũng', 'phamminhdung@example.com', '0901000004'),
('Hoàng Thị Em', 'hoangthiem@example.com', '0901000005');

INSERT INTO product_product (name, list_price) VALUES
('Laptop Dell XPS 13', 24990000.00),
('Máy in HP LaserJet', 4890000.00),
('Monitor LG 27 inch', 6990000.00),
('Chuột Logitech MX Master', 2990000.00),
('Bàn phím cơ Keychron K8', 3990000.00),
('USB-C Hub 7 in 1', 990000.00),
('Ổ cứng SSD 1TB', 1590000.00),
('Tai nghe JBL Tune', 2190000.00),
('Webcam Logitech C920', 2490000.00),
('Router WiFi TP-Link', 1290000.00);

INSERT INTO sale_order (name, partner_id, created_by, date_order, state, amount_untaxed, amount_total) VALUES
('SO-2024-001', 1, 1, '2024-01-10 09:15:00', 'draft', 24990000.00, 27489000.00),
('SO-2024-002', 2, 1, '2024-01-12 10:00:00', 'sale', 12580000.00, 13838000.00),
('SO-2024-003', 3, 1, '2024-01-20 14:20:00', 'done', 18460000.00, 20206000.00),
('SO-2024-004', 4, 1, '2024-02-03 11:10:00', 'sale', 9200000.00, 10120000.00),
('SO-2024-005', 5, 1, '2024-02-15 16:45:00', 'cancel', 13830000.00, 15213000.00);

INSERT INTO sale_order_line (order_id, product_id, product_uom_qty, price_unit, price_subtotal) VALUES
(1, 1, 1, 24990000.00, 24990000.00),
(1, 6, 2, 990000.00, 1980000.00),
(2, 3, 1, 6990000.00, 6990000.00),
(2, 4, 1, 2990000.00, 2990000.00),
(2, 10, 1, 1290000.00, 1290000.00),
(3, 2, 2, 4890000.00, 9780000.00),
(3, 7, 1, 1590000.00, 1590000.00),
(3, 8, 1, 2190000.00, 2190000.00),
(4, 5, 1, 3990000.00, 3990000.00),
(4, 9, 1, 2490000.00, 2490000.00),
(5, 1, 1, 24990000.00, 24990000.00),
(5, 3, 1, 6990000.00, 6990000.00),
(5, 6, 2, 990000.00, 1980000.00);

--update user
UPDATE users
SET username = 'sale01',
    full_name = 'Sale User 1',
    role = 'Sale',
    password_hash = '$2b$10$jVne5x9icVlNqkK9269bT.EJR1GCiyztoqEtpaamQVeDsvAIvJK1C'
WHERE email = 'sale01@company.com';

UPDATE users
SET username = 'accountant01',
    full_name = 'Accountant User 1',
    role = 'Accountant',
    password_hash = '$2b$10$EDnHlGb3cmcBw1Z4lhfXTu2zuoew1hlwQUIpSkGCw6kLudYQjkGLy'
WHERE email = 'accountant01@company.com';

UPDATE users
SET username = 'manager01',
    full_name = 'Manager User 1',
    role = 'Manager',
    password_hash = '$2b$10$hAQejtIX9YhLNHkeR532Au6.nJ3brXuVMTKkoUopvBQaKKaJYSIni'
WHERE email = 'manager01@company.com';
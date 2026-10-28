const ExcelJS = require('exceljs');
const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const XLSX = require('xlsx');
const { pool, query } = require('./db');
const authRole = require('./middlewares/authRole.middleware');
const { sendQuoteEmail } = require('./services/email.service');
const { generateInvoicePDF } = require('./services/pdf.service');
const { getRevenueReport } = require('./controllers/revenue.controller');
const jwt = require('jsonwebtoken');
const { login, JWT_SECRET } = require('./controllers/auth.controller');

const app = express();
const PORT = process.env.PORT || 3000;
const ORDER_STATES = ['draft', 'sale', 'done', 'cancel'];
const ORDER_SORT_FIELDS = {
  order_name: 'so.name',
  customer_name: 'rp.name',
  date_order: 'so.date_order',
  amount_total: 'so.amount_total',
  state: 'so.state',
};

const upload = multer({
  storage: multer.memoryStorage(),
});

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/', (req, res) => {
  return res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use('/api', (req, res, next) => {
  if (req.path === '/auth/login') {
    return next();
  }

  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized: token is missing.',
    });
  }

  return next();
});

app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
  if (!req.user) {
    const roleFromHeader = req.headers['x-user-role'];
    req.user = {
      role: String(roleFromHeader || 'Manager').trim(),
    };
  }
  next();
});

app.use((req, res, next) => {
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = {
        id: decoded.userId,
        role: decoded.role,
        email: decoded.email,
      };
    } catch (error) {
      console.warn('Invalid JWT:', error.message);
    }
  }
  next();
});

app.post('/api/auth/login', login);

function toNumber(value, defaultValue = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function normalizeState(value) {
  const state = String(value || '').trim().toLowerCase();
  const legacyMap = {
    draft: 'draft',
    sale: 'sale',
    done: 'done',
    cancel: 'cancel',
    pending: 'draft',
    processing: 'sale',
    canceled: 'cancel',
    cancelled: 'cancel',
  };

  return legacyMap[state] || (ORDER_STATES.includes(state) ? state : 'draft');
}

function isPositiveNumber(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0;
}

function validateOrderLine(line, lineIndex = 0) {
  const productId = Number(line?.product_id);
  const quantity = Number(line?.quantity ?? line?.product_uom_qty ?? 0);
  const priceUnit = Number(line?.price_unit ?? 0);

  if (!productId) {
    return { valid: false, message: `Dòng ${lineIndex + 1}: Vui lòng chọn sản phẩm.` };
  }

  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { valid: false, message: `Dòng ${lineIndex + 1}: Quantity phải lớn hơn 0.` };
  }

  if (!Number.isFinite(priceUnit) || priceUnit <= 0) {
    return { valid: false, message: `Dòng ${lineIndex + 1}: Unit Price phải lớn hơn 0.` };
  }

  return { valid: true };
}

function validateOrderPayload(payload) {
  if (!payload || (!Number(payload.partner_id) && !payload.partner_name)) {
    return 'Vui lòng chọn hoặc nhập tên khách hàng hợp lệ.';
  }

  if (!Array.isArray(payload.lines) || payload.lines.length === 0) {
    return 'Đơn hàng phải có ít nhất 1 sản phẩm.';
  }

  for (let index = 0; index < payload.lines.length; index += 1) {
    const lineValidation = validateOrderLine(payload.lines[index], index);
    if (!lineValidation.valid) {
      return lineValidation.message;
    }
  }

  return null;
}

async function generateOrderName(client = null) {
  const runner = client || { query: (text, params) => query(text, params) };
  const result = await runner.query(`
    SELECT name
    FROM sale_order
    WHERE name ~ '^SO-[0-9]{4}-[0-9]+$'
    ORDER BY id DESC
    LIMIT 1;
  `);

  const currentYear = new Date().getFullYear();
  let nextSequence = 1;

  if (result.rows[0]?.name) {
    const match = result.rows[0].name.match(/^SO-(\d{4})-(\d+)$/);
    if (match) {
      const matchedYear = Number(match[1]);
      if (matchedYear === currentYear) {
        nextSequence = Number(match[2]) + 1;
      }
    }
  }

  return `SO-${currentYear}-${String(nextSequence).padStart(3, '0')}`;
}

async function getOrderSummary(orderId) {
  const orderQuery = `
      SELECT
        so.id,
        so.name AS order_name,
        so.state,
        so.date_order,
        so.amount_untaxed,
        so.amount_total,
        so.partner_id,
        rp.name AS customer_name,
        rp.phone,
        rp.email,
        am.state AS invoice_state,
        am.id AS invoice_id,
        COUNT(sol.id) AS item_count
      FROM sale_order so
      INNER JOIN res_partner rp ON rp.id = so.partner_id
      LEFT JOIN account_move am ON am.invoice_origin = so.name
      LEFT JOIN sale_order_line sol ON sol.order_id = so.id
      WHERE so.id = $1
      GROUP BY
        so.id,
        so.name,
        so.state,
        so.date_order,
        so.amount_untaxed,
        so.amount_total,
        so.partner_id,
        rp.name,
        rp.phone,
        rp.email,
        am.state,
        am.id;
    `;
  const linesQuery = `
    SELECT
      sol.id,
      sol.order_id,
      sol.product_id,
      pp.name AS product_name,
      sol.product_uom_qty,
      sol.price_unit,
      sol.price_subtotal
    FROM sale_order_line sol
    INNER JOIN product_product pp ON pp.id = sol.product_id
    WHERE sol.order_id = $1
    ORDER BY sol.id ASC;
  `;

  const [orderResult, linesResult] = await Promise.all([
    query(orderQuery, [orderId]),
    query(linesQuery, [orderId]),
  ]);

  return {
    order: orderResult.rows[0] || null,
    lines: linesResult.rows,
  };
}

async function computeLineSubtotal(quantity, priceUnit) {
  const qty = toNumber(quantity, 0);
  const price = toNumber(priceUnit, 0);
  return Number((qty * price).toFixed(2));
}

app.get('/api/customers', authRole(['Sale', 'Accountant', 'Manager']), async (req, res) => {
  try {
    const result = await query(`
      SELECT id, name, email, phone
      FROM res_partner
      ORDER BY name ASC;
    `);
    return res.json(result.rows);
  } catch (error) {
    console.error('Error fetching customers:', error);
    return res.status(500).json({ message: 'Lỗi khi truy xuất khách hàng', error: error.message });
  }
});

app.get('/api/products', authRole(['Sale', 'Accountant', 'Manager']), async (req, res) => {
  try {
    const result = await query(`
      SELECT id, name, list_price
      FROM product_product
      ORDER BY name ASC;
    `);
    return res.json(result.rows);
  } catch (error) {
    console.error('Error fetching products:', error);
    return res.status(500).json({ message: 'Lỗi khi truy xuất sản phẩm', error: error.message });
  }
});

app.post('/api/products', authRole(['Sale', 'Manager']), async (req, res) => {
  try {
    const { name, list_price } = req.body || {};
    const trimmedName = String(name || '').trim();
    const price = Number(list_price);

    if (!trimmedName) {
      return res.status(400).json({ message: 'Tên sản phẩm không được để trống.' });
    }

    if (!Number.isFinite(price) || price < 0) {
      return res.status(400).json({ message: 'Giá sản phẩm phải là số hợp lệ và không âm.' });
    }

    const result = await query(
      `
        INSERT INTO product_product (name, list_price)
        VALUES ($1, $2)
        RETURNING id, name, list_price;
      `,
      [trimmedName, price]
    );

    return res.status(201).json({
      message: 'Tạo sản phẩm thành công',
      product: result.rows[0],
    });
  } catch (error) {
    console.error('Error creating product:', error);
    return res.status(500).json({ message: 'Lỗi khi tạo sản phẩm', error: error.message });
  }
});

app.put('/api/products/:id', authRole(['Sale', 'Manager']), async (req, res) => {
  try {
    const productId = Number(req.params.id);
    const { name, list_price } = req.body || {};
    const trimmedName = String(name || '').trim();
    const price = Number(list_price);

    if (!Number.isFinite(productId) || productId <= 0) {
      return res.status(400).json({ message: 'ID sản phẩm không hợp lệ.' });
    }

    if (!trimmedName) {
      return res.status(400).json({ message: 'Tên sản phẩm không được để trống.' });
    }

    if (!Number.isFinite(price) || price < 0) {
      return res.status(400).json({ message: 'Giá sản phẩm phải là số hợp lệ và không âm.' });
    }

    const existing = await query(`SELECT id FROM product_product WHERE id = $1;`, [productId]);
    if (!existing.rows[0]) {
      return res.status(404).json({ message: 'Không tìm thấy sản phẩm.' });
    }

    const result = await query(
      `
        UPDATE product_product
        SET name = $1, list_price = $2
        WHERE id = $3
        RETURNING id, name, list_price;
      `,
      [trimmedName, price, productId]
    );

    return res.json({
      message: 'Cập nhật sản phẩm thành công',
      product: result.rows[0],
    });
  } catch (error) {
    console.error('Error updating product:', error);
    return res.status(500).json({ message: 'Lỗi khi cập nhật sản phẩm', error: error.message });
  }
});

app.delete('/api/products/:id', authRole(['Sale', 'Manager']), async (req, res) => {
  try {
    const productId = Number(req.params.id);

    if (!Number.isFinite(productId) || productId <= 0) {
      return res.status(400).json({ message: 'ID sản phẩm không hợp lệ.' });
    }

    const productCheck = await query(`SELECT id FROM product_product WHERE id = $1;`, [productId]);
    if (!productCheck.rows[0]) {
      return res.status(404).json({ message: 'Không tìm thấy sản phẩm.' });
    }

    const usageCheck = await query(
      `SELECT id FROM sale_order_line WHERE product_id = $1 LIMIT 1;`,
      [productId]
    );

    if (usageCheck.rows[0]) {
      return res.status(400).json({
        message: 'Sản phẩm đã phát sinh giao dịch, không thể xóa',
      });
    }

    await query(`DELETE FROM product_product WHERE id = $1;`, [productId]);
    return res.json({ message: 'Xóa sản phẩm thành công' });
  } catch (error) {
    console.error('Error deleting product:', error);
    return res.status(500).json({ message: 'Lỗi khi xóa sản phẩm', error: error.message });
  }
});

app.get('/api/orders', authRole(['Sale', 'Accountant', 'Manager']), async (req, res) => {
  try {
    const { search = '', status = '', sortBy = 'date_order', order = 'desc' } = req.query;
    const safeSortField = ORDER_SORT_FIELDS[sortBy] || 'so.date_order';
    const safeOrder = String(order).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const searchTerm = String(search || '').trim();
    const statusFilter = String(status || '').trim().toLowerCase();

    const whereClauses = [];
    const params = [];

    if (searchTerm) {
      params.push(`%${searchTerm}%`);
      whereClauses.push(`(so.name ILIKE $${params.length} OR rp.name ILIKE $${params.length})`);
    }

    if (statusFilter && statusFilter !== 'all') {
      const normalizedStatus = normalizeState(statusFilter);
      params.push(normalizedStatus);
      whereClauses.push(`so.state = $${params.length}`);
    }

    const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const sql = `
      SELECT
        so.id,
        so.name AS order_name,
        so.state,
        so.date_order,
        so.amount_untaxed,
        so.amount_total,
        rp.id AS partner_id,
        rp.name AS customer_name,
        rp.phone,
        rp.email,
        COUNT(sol.id) AS item_count
      FROM sale_order so
      INNER JOIN res_partner rp ON rp.id = so.partner_id
      LEFT JOIN sale_order_line sol ON sol.order_id = so.id
      ${whereSql}
      GROUP BY
        so.id,
        so.name,
        so.state,
        so.date_order,
        so.amount_untaxed,
        so.amount_total,
        rp.id,
        rp.name,
        rp.phone,
        rp.email
      ORDER BY ${safeSortField} ${safeOrder};
    `;

    const result = await query(sql, params);
    return res.json(result.rows);
  } catch (error) {
    console.error('Error fetching orders:', error);
    return res.status(500).json({
      message: 'Lỗi khi truy xuất danh sách đơn hàng',
      error: error.message,
    });
  }
});

// ==========================================
// 1. API EXPORT SALE ORDERS RA EXCEL CHUẨN FORMAT
// ==========================================
app.get('/api/orders/export', authRole(['Sale', 'Manager']), async (req, res) => {
  try {
    const result = await query(`
      SELECT 
        so.id,
        so.name AS order_number, 
        so.date_order, 
        so.state AS order_status, 
        so.amount_total,
        rp.name AS customer_name,
        rp.phone AS customer_phone
      FROM sale_order so
      LEFT JOIN res_partner rp ON rp.id = so.partner_id
      ORDER BY so.id DESC
    `);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Danh Sách Đơn Hàng');

    // 1. Cấu hình cột và độ rộng
    worksheet.columns = [
      { header: 'Mã Đơn Hàng', key: 'order_number', width: 18 },
      { header: 'Khách Hàng', key: 'customer_name', width: 30 },
      { header: 'Số Điện Thoại', key: 'customer_phone', width: 18 },
      { header: 'Ngày Đặt', key: 'date_order', width: 20 },
      { header: 'Trạng Thái', key: 'order_status', width: 15 },
      { header: 'Tổng Tiền (VNĐ)', key: 'amount_total', width: 25 }
    ];

    // 2. Đổ dữ liệu vào bảng
    result.rows.forEach(row => {
      worksheet.addRow({
        order_number: row.order_number || '',
        customer_name: row.customer_name || '',
        customer_phone: row.customer_phone || '',
        date_order: row.date_order ? new Date(row.date_order).toLocaleString('vi-VN') : '',
        order_status: (row.order_status || '').toUpperCase(),
        amount_total: Number(row.amount_total || 0)
      });
    });

    // 3. Format UI/UX cho Excel
    // - In đậm và tô nền xám cho Header
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F81BD' } };
    worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
    
    // - Format cột Tổng Tiền (cột số 6) thành định dạng tiền tệ có dấu phẩy phân cách
    worksheet.getColumn(6).numFmt = '#,##0';
    // - Căn giữa cột Mã đơn, SĐT, Trạng thái
    worksheet.getColumn(1).alignment = { horizontal: 'center' };
    worksheet.getColumn(3).alignment = { horizontal: 'center' };
    worksheet.getColumn(5).alignment = { horizontal: 'center' };

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Danh_sach_don_hang.xlsx"');

    await workbook.xlsx.write(res);
    return res.end();
  } catch (err) {
    console.error(' Export Orders Error:', err);
    return res.status(500).json({ success: false, message: 'Lỗi xuất dữ liệu đơn hàng: ' + err.message });
  }
});
// ==========================================
// API IMPORT SẢN PHẨM TỪ FILE EXCEL (RAM BUFFER)
// ==========================================
app.post('/api/products/import', authRole(['Manager']), upload.single('file'), async (req, res) => {
  try {
    // Với memoryStorage, dữ liệu file nằm ở req.file.buffer
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ success: false, message: 'Vui lòng chọn file Excel.' });
    }

    // 1. Dùng thư viện XLSX đọc file trực tiếp từ Buffer trên RAM
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    
    // 2. Chuyển đổi dữ liệu Sheet thành mảng JSON
    const data = XLSX.utils.sheet_to_json(sheet);
    
    if (!data || data.length === 0) {
      return res.status(400).json({ success: false, message: 'File Excel không có dữ liệu.' });
    }

    let successCount = 0;

    // 3. Lặp qua từng dòng và lưu vào Database
    for (const row of data) {
      // Hỗ trợ đọc tên cột linh hoạt
      const name = row['Tên Sản Phẩm'] || row['Tên sản phẩm'] || row['name'];
      const price = row['Đơn Giá'] || row['Đơn giá'] || row['list_price'] || 0;

      if (name) {
        await query(
          `INSERT INTO product_product (name, list_price) VALUES ($1, $2)`, 
          [name, Number(price)]
        );
        successCount++;
      }
    }

    return res.json({ 
      success: true, 
      message: `Đã import thành công ${successCount} sản phẩm vào hệ thống.` 
    });

  } catch (error) {
    console.error(' Lỗi Import Sản Phẩm:', error);
    return res.status(500).json({ success: false, message: 'Lỗi hệ thống khi import file: ' + error.message });
  }
});

// ==========================================
// 2. API EXPORT PRODUCTS RA EXCEL CHUẨN FORMAT
// ==========================================
app.get('/api/products/export', authRole(['Sale', 'Manager']), async (req, res) => {
  try {
    let result;
    try {
      result = await query(`SELECT id, name, list_price FROM product_product ORDER BY id ASC`);
    } catch (e) {
      result = await query(`SELECT id, name, lst_price AS list_price FROM product_product ORDER BY id ASC`);
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Danh Mục Sản Phẩm');

    worksheet.columns = [
      { header: 'Mã SP', key: 'id', width: 12 },
      { header: 'Tên Sản Phẩm', key: 'name', width: 45 },
      { header: 'Đơn Giá (VNĐ)', key: 'list_price', width: 25 }
    ];

    result.rows.forEach(row => {
      worksheet.addRow({
        id: row.id,
        name: row.name || '',
        list_price: Number(row.list_price || 0)
      });
    });

    // Format UI/UX
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F81BD' } };
    worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
    
    // Format tiền tệ cho cột Đơn giá (cột số 3)
    worksheet.getColumn(3).numFmt = '#,##0';
    worksheet.getColumn(1).alignment = { horizontal: 'center' };

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Danh_sach_san_pham.xlsx"');

    await workbook.xlsx.write(res);
    return res.end();
  } catch (err) {
    console.error(' Export Products Error:', err);
    return res.status(500).json({ success: false, message: 'Lỗi xuất dữ liệu sản phẩm: ' + err.message });
  }
});

app.get('/api/orders/:id', authRole(['Sale', 'Accountant', 'Manager']), async (req, res) => {
  try {
    const { id } = req.params;
    const summary = await getOrderSummary(id);

    if (!summary.order) {
      return res.status(404).json({ message: 'Không tìm thấy đơn hàng' });
    }

    return res.json(summary);
  } catch (error) {
    console.error('Error fetching single order:', error);
    return res.status(500).json({ message: 'Lỗi khi truy xuất đơn hàng', error: error.message });
  }
});

app.get('/api/orders/:id/details', authRole(['Sale', 'Accountant', 'Manager']), async (req, res) => {
  try {
    const { id } = req.params;
    const summary = await getOrderSummary(id);

    if (!summary.order) {
      return res.status(404).json({ message: 'Không tìm thấy đơn hàng' });
    }

    return res.json(summary);
  } catch (error) {
    console.error('Error fetching order details:', error);
    return res.status(500).json({
      message: 'Lỗi khi truy xuất chi tiết đơn hàng',
      error: error.message,
    });
  }
});

app.post('/api/orders', authRole(['Sale', 'Manager']), async (req, res) => {
  const payload = req.body || {};
  const validationError = validateOrderPayload(payload);

  if (validationError) {
    return res.status(400).json({ message: validationError });
  }

  let { partner_id, partner_name, partner_phone, lines = [] } = payload;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    if (!Number(partner_id) && partner_name) {
      const trimmedName = String(partner_name).trim();
      const trimmedPhone = String(partner_phone || '').trim();
      const insertCustomer = await client.query(
        `INSERT INTO res_partner (name, phone) VALUES ($1, $2) RETURNING id;`,
        [trimmedName, trimmedPhone]
      );
      partner_id = insertCustomer.rows[0].id;
    } else if (Number(partner_id) && partner_phone !== undefined) {
      const trimmedPhone = String(partner_phone || '').trim();
      await client.query(
        `UPDATE res_partner SET phone = $1 WHERE id = $2;`,
        [trimmedPhone, Number(partner_id)]
      );
    }

    const orderName = await generateOrderName(client);
    const orderInsert = await client.query(
      `
        INSERT INTO sale_order (name, partner_id, state, date_order, amount_untaxed, amount_total)
        VALUES ($1, $2, 'draft', NOW(), 0, 0)
        RETURNING id, name, partner_id, state, amount_untaxed, amount_total;
      `,
      [orderName, Number(partner_id)]
    );

    const orderId = orderInsert.rows[0].id;
    let totalAmount = 0;

    for (const [index, line] of lines.entries()) {
      const productId = Number(line.product_id);
      const quantity = toNumber(line.quantity ?? line.product_uom_qty, 0);
      const priceUnit = toNumber(line.price_unit, 0);
      const validationResult = validateOrderLine(line, index);

      if (!validationResult.valid) {
        throw new Error(validationResult.message);
      }

      const subtotal = await computeLineSubtotal(quantity, priceUnit);
      totalAmount += subtotal;

      await client.query(
        `
          INSERT INTO sale_order_line (order_id, product_id, product_uom_qty, price_unit, price_subtotal)
          VALUES ($1, $2, $3, $4, $5);
        `,
        [orderId, productId, quantity, priceUnit, subtotal]
      );
    }

    const roundedTotal = Number(totalAmount.toFixed(2));

    await client.query(
      `
        UPDATE sale_order
        SET amount_untaxed = $1, amount_total = $2
        WHERE id = $3;
      `,
      [roundedTotal, roundedTotal, orderId]
    );

    await client.query('COMMIT');

    const summary = await getOrderSummary(orderId);
    return res.status(201).json({
      message: 'Tạo đơn hàng thành công',
      order: summary.order,
      lines: summary.lines,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating order:', error);
    return res.status(400).json({
      message: error.message || 'Lỗi khi tạo đơn hàng',
      error: error.message,
    });
  } finally {
    client.release();
  }
});

app.get('/api/orders/summary', authRole(['Accountant', 'Manager']), async (req, res) => {
  try {
    const result = await query(`
      SELECT
        COUNT(*)::int AS total_orders,
        COUNT(*) FILTER (WHERE state = 'draft')::int AS draft_quotes,
        COALESCE(SUM(CASE WHEN state IN ('sale', 'done') THEN amount_total ELSE 0 END), 0)::numeric AS total_revenue
      FROM sale_order;
    `);

    const summary = result.rows[0] || {
      total_orders: 0,
      draft_quotes: 0,
      total_revenue: 0,
    };

    return res.json({
      total_orders: Number(summary.total_orders || 0),
      draft_quotes: Number(summary.draft_quotes || 0),
      total_revenue: Number(summary.total_revenue || 0),
    });
  } catch (error) {
    console.error('Error fetching order summary:', error);
    return res.status(500).json({
      message: 'Lỗi khi truy xuất thống kê đơn hàng',
      error: error.message,
    });
  }
});

app.put('/api/orders/:id/status', authRole(['Sale', 'Manager']), async (req, res) => {
  const { id } = req.params;
  const { state } = req.body;
  const nextState = normalizeState(state);

  if (!ORDER_STATES.includes(nextState)) {
    return res.status(400).json({ message: 'Trạng thái không hợp lệ.' });
  }

  try {
    const existingOrder = await query(
      `SELECT id, state FROM sale_order WHERE id = $1;`,
      [id]
    );

    if (!existingOrder.rows[0]) {
      return res.status(404).json({ message: 'Không tìm thấy đơn hàng.' });
    }

    const allowedTransitions = {
      draft: ['sale', 'cancel'],
      sale: ['done', 'cancel', 'draft'],
      done: ['done'],
      cancel: ['draft'],
    };

    const currentState = existingOrder.rows[0].state;
    const transitionList = allowedTransitions[currentState] || [currentState];

    if (!transitionList.includes(nextState)) {
      return res.status(400).json({
        message: `Không thể chuyển từ trạng thái '${currentState}' sang '${nextState}'.`,
      });
    }

    if (nextState === 'sale') {
      const linesResult = await query(
        `SELECT COUNT(*)::int AS line_count FROM sale_order_line WHERE order_id = $1;`,
        [id]
      );
      if ((linesResult.rows[0]?.line_count || 0) < 1) {
        return res.status(400).json({
          message: 'Không chốt đơn rỗng. Đơn hàng cần có ít nhất 1 sản phẩm trước khi xác nhận.',
        });
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `UPDATE sale_order SET state = $1 WHERE id = $2;`,
        [nextState, id]
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    const summary = await getOrderSummary(id);
    return res.json({
      message: 'Cập nhật trạng thái đơn hàng thành công',
      order: summary.order,
      lines: summary.lines,
    });
  } catch (error) {
    console.error('Error updating order status:', error);
    return res.status(500).json({
      message: 'Lỗi khi cập nhật trạng thái đơn hàng',
      error: error.message,
    });
  }
});

app.put('/api/orders/:id', authRole(['Sale', 'Manager']), async (req, res) => {
  const { id } = req.params;
  const { partner_id, partner_phone, state, lines } = req.body;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const orderResult = await client.query(
      `SELECT id, partner_id, state, amount_total FROM sale_order WHERE id = $1;`,
      [id]
    );

    if (!orderResult.rows[0]) {
      return res.status(404).json({ message: 'Không tìm thấy đơn hàng.' });
    }

    const currentOrder = orderResult.rows[0];
    const nextPartnerId = partner_id !== undefined ? Number(partner_id) : currentOrder.partner_id;
    const nextState = state ? normalizeState(state) : currentOrder.state;

    if (currentOrder.state !== 'draft') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: 'Backend không cho phép UPDATE/DELETE nội dung khi đơn hàng không ở trạng thái Draft.',
      });
    }

    if (partner_id !== undefined && !Number(nextPartnerId)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Khách hàng không hợp lệ.' });
    }

    if (Number(nextPartnerId) && partner_phone !== undefined) {
      await client.query(
        `UPDATE res_partner SET phone = $1 WHERE id = $2;`,
        [String(partner_phone || '').trim(), Number(nextPartnerId)]
      );
    }

    let totalAmount = toNumber(currentOrder.amount_total, 0);

    if (Array.isArray(lines)) {
      if (lines.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Đơn hàng phải có ít nhất 1 sản phẩm.' });
      }

      for (let index = 0; index < lines.length; index += 1) {
        const lineValidation = validateOrderLine(lines[index], index);
        if (!lineValidation.valid) {
          throw new Error(lineValidation.message);
        }
      }

      await client.query(`DELETE FROM sale_order_line WHERE order_id = $1;`, [id]);

      totalAmount = 0;
      for (const line of lines) {
        const productId = Number(line.product_id);
        const quantity = toNumber(line.quantity ?? line.product_uom_qty, 0);
        const priceUnit = toNumber(line.price_unit, 0);

        const subtotal = await computeLineSubtotal(quantity, priceUnit);
        totalAmount += subtotal;

        await client.query(
          `
            INSERT INTO sale_order_line (order_id, product_id, product_uom_qty, price_unit, price_subtotal)
            VALUES ($1, $2, $3, $4, $5);
          `,
          [id, productId, quantity, priceUnit, subtotal]
        );
      }
    }

    const roundedTotal = Number(totalAmount.toFixed(2));

    await client.query(
      `
        UPDATE sale_order
        SET partner_id = $1,
            state = $2,
            amount_untaxed = $3,
            amount_total = $4
        WHERE id = $5;
      `,
      [nextPartnerId, nextState, roundedTotal, roundedTotal, id]
    );

    await client.query('COMMIT');

    const summary = await getOrderSummary(id);
    return res.json({
      message: 'Cập nhật đơn hàng thành công',
      order: summary.order,
      lines: summary.lines,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating order:', error);
    return res.status(400).json({
      message: error.message || 'Lỗi khi cập nhật đơn hàng',
      error: error.message,
    });
  } finally {
    client.release();
  }
});

app.delete('/api/orders/:id', authRole(['Sale', 'Manager']), async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT id, state FROM sale_order WHERE id = $1;`,
      [id]
    );

    if (!existing.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Không tìm thấy đơn hàng.' });
    }

    if (existing.rows[0].state !== 'draft') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: 'Backend không cho phép UPDATE/DELETE nội dung khi đơn hàng không ở trạng thái Draft.',
      });
    }

    await client.query(`DELETE FROM sale_order_line WHERE order_id = $1;`, [id]);
    await client.query(`DELETE FROM sale_order WHERE id = $1;`, [id]);

    await client.query('COMMIT');
    return res.json({ message: 'Xóa đơn hàng thành công' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error deleting order:', error);
    return res.status(500).json({
      message: 'Lỗi khi xóa đơn hàng',
      error: error.message,
    });
  } finally {
    client.release();
  }
});

app.post('/api/send-quote-email', authRole(['Sale', 'Manager']), async (req, res) => {
  const { orderId, email } = req.body || {};

  if (!orderId) {
    return res.status(400).json({ message: 'Thiếu thông tin đơn hàng.' });
  }

  try {
    const result = await sendQuoteEmail(orderId, email);
    return res.json({ message: 'Gửi email báo giá thành công', result });
  } catch (error) {
    console.error('Error sending quote email:', error);
    return res.status(500).json({ message: 'Lỗi khi gửi email báo giá', error: error.message });
  }
});

app.get('/api/orders/:id/invoice/export', authRole(['Accountant', 'Manager']), async (req, res) => {
  try {
    const { id } = req.params;
    const pdfBuffer = await generateInvoicePDF(Number(id));

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="invoice-${id}.pdf"`);
    return res.send(pdfBuffer);
  } catch (error) {
    console.error('Error exporting invoice PDF:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Lỗi khi xuất hóa đơn PDF.',
    });
  }
});

app.get('/api/reports/revenue', authRole(['Accountant', 'Manager']), getRevenueReport);

// --- MODULE HÓA ĐƠN (ACCOUNT_MOVE) ---

app.post('/api/orders/:id/create-invoice', authRole(['Accountant', 'Manager']), async (req, res) => {
  try {
    const { id } = req.params;
    const orderResult = await query(`SELECT name, partner_id, amount_total FROM sale_order WHERE id = $1`, [id]);
    if (!orderResult.rows[0]) return res.status(404).json({ message: 'Không tìm thấy đơn hàng' });
    
    const order = orderResult.rows[0];
    const invoiceName = `INV-${order.name}`;
    
    const insertResult = await query(
      `INSERT INTO account_move (partner_id, invoice_origin, name, state, amount_total) 
       VALUES ($1, $2, $3, 'draft', $4) RETURNING *`,
      [order.partner_id, order.name, invoiceName, order.amount_total]
    );
    
    return res.status(201).json({ message: 'Tạo hóa đơn nháp thành công', invoice: insertResult.rows[0] });
  } catch (error) {
    return res.status(500).json({ message: 'Lỗi khi tạo hóa đơn', error: error.message });
  }
});

app.put('/api/invoices/:id/confirm', authRole(['Accountant', 'Manager']), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query(`UPDATE account_move SET state = 'posted' WHERE id = $1 RETURNING *`, [id]);
    if (!result.rows[0]) return res.status(404).json({ message: 'Không tìm thấy hóa đơn' });
    return res.json({ message: 'Đã vào sổ hóa đơn (posted)', invoice: result.rows[0] });
  } catch (error) {
    return res.status(500).json({ message: 'Lỗi khi xác nhận hóa đơn', error: error.message });
  }
});

app.put('/api/invoices/:id/payment', authRole(['Accountant', 'Manager']), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query(`UPDATE account_move SET state = 'paid' WHERE id = $1 RETURNING *`, [id]);
    if (!result.rows[0]) return res.status(404).json({ message: 'Không tìm thấy hóa đơn' });
    return res.json({ message: 'Đã thanh toán hóa đơn (paid)', invoice: result.rows[0] });
  } catch (error) {
    return res.status(500).json({ message: 'Lỗi khi thanh toán hóa đơn', error: error.message });
  }
});

app.post('/api/invoices/:id/send-email', authRole(['Sale', 'Manager']), async (req, res) => {
  try {
    // Giả lập độ trễ mạng và gửi email thành công
    await new Promise(resolve => setTimeout(resolve, 800));
    return res.json({ success: true, message: 'Đã gửi email hóa đơn PDF cho khách hàng thành công.' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Lỗi gửi email hóa đơn.' });
  }
});



// ==========================================
/* 1. API EXPORT SALE ORDERS RA EXCEL (CSV)
// ==========================================
app.get('/api/orders/export', async (req, res) => {
  try {
    const result = await query(`
      SELECT 
        so.name AS order_number, 
        rp.name AS customer_name, 
        rp.phone AS customer_phone,
        so.date_order, 
        so.state AS order_status, 
        so.amount_total
      FROM sale_order so
      LEFT JOIN res_partner rp ON rp.id = so.partner_id
      ORDER BY so.id DESC
    `);

    // \uFEFF là UTF-8 BOM để Excel hiển thị đúng tiếng Việt có dấu
    let csv = '\uFEFFMã đơn hàng,Khách hàng,Số điện thoại,Ngày đặt,Trạng thái,Tổng tiền (Đồng)\n';

    result.rows.forEach(row => {
      const dateStr = row.date_order ? new Date(row.date_order).toLocaleDateString('vi-VN') : '';
      const line = `"${row.order_number || ''}","${row.customer_name || ''}","${row.customer_phone || ''}","${dateStr}","${row.order_status || ''}","${row.amount_total || 0}"`;
      csv += line + '\n';
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="Danh_sach_don_hang.csv"');
    return res.status(200).send(csv);
  } catch (err) {
    console.error('Export Orders Error:', err);
    return res.status(500).json({ error: 'Lỗi xuất dữ liệu đơn hàng' });
  }
});

// ==========================================
// 2. API EXPORT PRODUCTS RA EXCEL (CSV)
 ==========================================
app.get('/api/products/export', async (req, res) => {
  try {
    const result = await query(`
      SELECT id, name, lst_price 
      FROM product_product 
      ORDER BY id ASC
    `);

    let csv = '\uFEFFMã sản phẩm,Tên sản phẩm,Đơn giá (Đồng)\n';

    result.rows.forEach(row => {
      const line = `"${row.id}","${row.name || ''}","${row.lst_price || 0}"`;
      csv += line + '\n';
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="Danh_sach_san_pham.csv"');
    return res.status(200).send(csv);
  } catch (err) {
    console.error('Export Products Error:', err);
    return res.status(500).json({ error: 'Lỗi xuất dữ liệu sản phẩm' });
  }
});
*/
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
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
  state: 'so.order_status',
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

function normalizeOrderStatus(value) {
  const rawState = String(value || '').trim();
  const normalized = rawState.toLowerCase();

  const legacyMap = {
    draft: 'Pending',
    sale: 'Processing',
    done: 'Done',
    cancel: 'Canceled',
    pending: 'Pending',
    processing: 'Processing',
    canceled: 'Canceled',
    cancelled: 'Canceled',
  };

  if (legacyMap[normalized]) {
    return legacyMap[normalized];
  }

  return rawState || 'Pending';
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
  // Sửa điều kiện: Báo lỗi khi KHÔNG CÓ ID khách cũ VÀ CŨNG KHÔNG CÓ tên khách mới
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
      so.order_status,
      so.date_order,
      so.amount_untaxed,
      so.amount_total,
      so.partner_id,
      rp.name AS customer_name,
      rp.phone,
      rp.email,
      COUNT(sol.id) AS item_count
    FROM sale_order so
    INNER JOIN res_partner rp ON rp.id = so.partner_id
    LEFT JOIN sale_order_line sol ON sol.order_id = so.id
    WHERE so.id = $1
    GROUP BY
      so.id,
      so.name,
      so.order_status,
      so.date_order,
      so.amount_untaxed,
      so.amount_total,
      so.partner_id,
      rp.name,
      rp.phone,
      rp.email;
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
      const normalizedStatus = normalizeOrderStatus(statusFilter);
      params.push(normalizedStatus);
      whereClauses.push(`so.order_status = $${params.length}`);
    }

    const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const sql = `
      SELECT
        so.id,
        so.name AS order_name,
        so.order_status AS state,
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
        so.order_status,
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

  let { partner_id, partner_name, lines = [] } = payload;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // UPSERT KHÁCH HÀNG: Nếu không có ID nhưng có tên, tạo mới
    if (!Number(partner_id) && partner_name) {
      const trimmedName = String(partner_name).trim();
      const insertCustomer = await client.query(
        `INSERT INTO res_partner (name) VALUES ($1) RETURNING id;`,
        [trimmedName]
      );
      partner_id = insertCustomer.rows[0].id;
    }

    const orderName = await generateOrderName(client);
    const orderInsert = await client.query(
      `
        INSERT INTO sale_order (name, partner_id, order_status, date_order, amount_untaxed, amount_total)
        VALUES ($1, $2, 'Pending', NOW(), 0, 0)
        RETURNING id, name, partner_id, order_status, amount_untaxed, amount_total;
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
        COUNT(*) FILTER (WHERE order_status = 'Pending')::int AS draft_quotes,
        COALESCE(SUM(CASE WHEN order_status IN ('Processing', 'Done') THEN amount_total ELSE 0 END), 0)::numeric AS total_revenue
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
  const nextOrderStatus = normalizeOrderStatus(state);

  if (!['Pending', 'Processing', 'Done', 'Canceled'].includes(nextOrderStatus)) {
    return res.status(400).json({ message: 'Trạng thái không hợp lệ.' });
  }

  try {
    const existingOrder = await query(
      `SELECT id, order_status FROM sale_order WHERE id = $1;`,
      [id]
    );

    if (!existingOrder.rows[0]) {
      return res.status(404).json({ message: 'Không tìm thấy đơn hàng.' });
    }

    const allowedTransitions = {
      Pending: ['Processing', 'Canceled'],
      Processing: ['Done', 'Canceled', 'Pending'],
      Done: ['Done'],
      Canceled: ['Pending'],
    };

    const currentStatus = existingOrder.rows[0].order_status;
    const transitionList = allowedTransitions[currentStatus] || [currentStatus];

    if (!transitionList.includes(nextOrderStatus)) {
      return res.status(400).json({
        message: `Không thể chuyển từ trạng thái '${currentStatus}' sang '${nextOrderStatus}'.`,
      });
    }

    if (nextOrderStatus === 'Processing') {
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
        `UPDATE sale_order SET order_status = $1 WHERE id = $2;`,
        [nextOrderStatus, id]
      );

      if (nextOrderStatus === 'Done') {
        await finalizeOrderDone(id, client);
      }

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
  const { partner_id, state, lines } = req.body;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const orderResult = await client.query(
      `SELECT id, partner_id, order_status, amount_total FROM sale_order WHERE id = $1;`,
      [id]
    );

    if (!orderResult.rows[0]) {
      return res.status(404).json({ message: 'Không tìm thấy đơn hàng.' });
    }

    const currentOrder = orderResult.rows[0];
    const nextPartnerId = partner_id !== undefined ? Number(partner_id) : currentOrder.partner_id;
    const nextOrderStatus = state ? normalizeOrderStatus(state) : currentOrder.order_status;

    if (currentOrder.order_status !== 'Pending') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: 'Backend không cho phép UPDATE/DELETE nội dung khi đơn hàng không ở trạng thái Pending.',
      });
    }

    if (partner_id !== undefined && !Number(nextPartnerId)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Khách hàng không hợp lệ.' });
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
            order_status = $2,
            amount_untaxed = $3,
            amount_total = $4
        WHERE id = $5;
      `,
      [nextPartnerId, nextOrderStatus, roundedTotal, roundedTotal, id]
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
      `SELECT id, order_status FROM sale_order WHERE id = $1;`,
      [id]
    );

    if (!existing.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Không tìm thấy đơn hàng.' });
    }

    if (existing.rows[0].order_status !== 'Pending') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: 'Backend không cho phép UPDATE/DELETE nội dung khi đơn hàng không ở trạng thái Pending.',
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

app.put('/api/orders/:id/invoice-status', authRole(['Accountant', 'Manager']), async (req, res) => {
  const { id } = req.params;
  const { invoice_status } = req.body || {};
  const allowedStates = ['Unpaid', 'Partial', 'Paid', 'Refunded'];

  if (!allowedStates.includes(invoice_status)) {
    return res.status(400).json({ message: 'invoice_status không hợp lệ.' });
  }

  try {
    const existingOrder = await query(
      `SELECT id, invoice_status FROM sale_order WHERE id = $1;`,
      [id]
    );

    if (!existingOrder.rows[0]) {
      return res.status(404).json({ message: 'Không tìm thấy đơn hàng.' });
    }

    await query(
      `UPDATE sale_order SET invoice_status = $1 WHERE id = $2;`,
      [invoice_status, id]
    );

    const summary = await getOrderSummary(id);
    return res.json({
      message: 'Cập nhật invoice_status thành công',
      order: summary.order,
    });
  } catch (error) {
    console.error('Error updating invoice status:', error);
    return res.status(500).json({ message: 'Lỗi cập nhật invoice_status', error: error.message });
  }
});

app.post('/api/quotes', authRole(['Sale', 'Manager']), async (req, res) => {
  try {
    const { customer_id, quote_number, valid_until, notes, items = [] } = req.body || {};

    if (!customer_id) {
      return res.status(400).json({ message: 'Thiếu khách hàng cho báo giá.' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const quoteInsert = await client.query(
        `
          INSERT INTO quote (quote_number, customer_id, created_by, quote_status, valid_until, notes, subtotal, discount_amount, tax_amount, total_amount)
          VALUES ($1, $2, $3, 'Draft', $4, $5, 0, 0, 0, 0)
          RETURNING id;
        `,
        [quote_number || `Q-${Date.now()}`, Number(customer_id), req.user?.id || 1, valid_until || null, notes || null]
      );

      const quoteId = quoteInsert.rows[0].id;
      let subtotal = 0;

      for (const item of items) {
        const quantity = Number(item.quantity || 0);
        const unitPrice = Number(item.unit_price || 0);
        const lineTotal = quantity * unitPrice;
        subtotal += lineTotal;

        await client.query(
          `
            INSERT INTO quote_item (quote_id, product_name, description, quantity, unit_price, line_total)
            VALUES ($1, $2, $3, $4, $5, $6);
          `,
          [quoteId, item.product_name, item.description || '', quantity, unitPrice, lineTotal]
        );
      }

      await client.query(
        `
          UPDATE quote
          SET subtotal = $1, total_amount = $1
          WHERE id = $2;
        `,
        [subtotal, quoteId]
      );

      await client.query('COMMIT');
      return res.status(201).json({ message: 'Tạo báo giá thành công', quote_id: quoteId });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error creating quote:', error);
    return res.status(500).json({ message: 'Lỗi khi tạo báo giá', error: error.message });
  }
});

app.put('/api/quotes/:id', authRole(['Sale', 'Manager']), async (req, res) => {
  try {
    const { id } = req.params;
    const { customer_id, quote_status, valid_until, notes, items = [] } = req.body || {};

    if (!customer_id) {
      return res.status(400).json({ message: 'Thiếu khách hàng cho báo giá.' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `
          UPDATE quote
          SET customer_id = $1,
              quote_status = COALESCE($2, quote_status),
              valid_until = $3,
              notes = $4,
              updated_at = NOW()
          WHERE id = $5;
        `,
        [Number(customer_id), quote_status || null, valid_until || null, notes || null, Number(id)]
      );

      await client.query(`DELETE FROM quote_item WHERE quote_id = $1;`, [Number(id)]);

      let subtotal = 0;
      for (const item of items) {
        const quantity = Number(item.quantity || 0);
        const unitPrice = Number(item.unit_price || 0);
        const lineTotal = quantity * unitPrice;
        subtotal += lineTotal;

        await client.query(
          `
            INSERT INTO quote_item (quote_id, product_name, description, quantity, unit_price, line_total)
            VALUES ($1, $2, $3, $4, $5, $6);
          `,
          [Number(id), item.product_name, item.description || '', quantity, unitPrice, lineTotal]
        );
      }

      await client.query(
        `
          UPDATE quote
          SET subtotal = $1,
              total_amount = $1,
              updated_at = NOW()
          WHERE id = $2;
        `,
        [subtotal, Number(id)]
      );

      await client.query('COMMIT');
      return res.json({ message: 'Cập nhật báo giá thành công' });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error updating quote:', error);
    return res.status(500).json({ message: 'Lỗi khi cập nhật báo giá', error: error.message });
  }
});

async function finalizeOrderDone(orderId, client = query) {
  const orderResult = await client.query(
    `
      SELECT id, quote_id, invoice_status, order_status
      FROM sale_order
      WHERE id = $1;
    `,
    [orderId]
  );

  if (!orderResult.rows[0]) {
    return null;
  }

  const currentOrder = orderResult.rows[0];

  if (currentOrder.order_status !== 'Done') {
    return currentOrder;
  }

  if (currentOrder.invoice_status === 'Unpaid' || currentOrder.invoice_status === 'Partial') {
    await client.query(
      `
        UPDATE sale_order
        SET invoice_status = 'Paid'
        WHERE id = $1;
      `,
      [orderId]
    );
  }

  if (currentOrder.quote_id) {
    await client.query(
      `
        UPDATE quote
        SET quote_status = 'Accepted'
        WHERE id = $1 AND quote_status IN ('Draft', 'Sent');
      `,
      [currentOrder.quote_id]
    );
  }

  return {
    ...currentOrder,
    invoice_status: 'Paid',
    trigger: 'order_done_finalized',
  };
}

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

app.post('/api/quotes/:id/send-email', authRole(['Sale', 'Manager']), async (req, res) => {
  try {
    const { id } = req.params;
    const { customer_email } = req.body || {};

    const result = await sendQuoteEmail(Number(id), customer_email);

    return res.json({
      success: true,
      message: 'Gửi email báo giá thành công.',
      data: result,
    });
  } catch (error) {
    console.error('Error sending quote email:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Lỗi khi gửi email báo giá.',
    });
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

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

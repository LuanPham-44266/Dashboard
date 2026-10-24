const express = require('express');
const cors = require('cors');
const path = require('path');
const { pool, query } = require('./db');

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

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function toNumber(value, defaultValue = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function normalizeState(value) {
  const state = String(value || '').trim().toLowerCase();
  return ORDER_STATES.includes(state) ? state : 'draft';
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
      COUNT(sol.id) AS item_count
    FROM sale_order so
    INNER JOIN res_partner rp ON rp.id = so.partner_id
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

app.get('/api/customers', async (req, res) => {
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

app.get('/api/products', async (req, res) => {
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

app.get('/api/orders', async (req, res) => {
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
      params.push(statusFilter);
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

app.get('/api/orders/:id', async (req, res) => {
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

app.get('/api/orders/:id/details', async (req, res) => {
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

app.post('/api/orders', async (req, res) => {
  const { partner_id, lines = [] } = req.body;

  if (!partner_id || !Array.isArray(lines) || lines.length === 0) {
    return res.status(400).json({
      message: 'Thiếu thông tin khách hàng hoặc danh sách sản phẩm.',
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

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

    for (const line of lines) {
      const productId = Number(line.product_id);
      const quantity = toNumber(line.quantity ?? line.product_uom_qty, 0);
      const priceUnit = toNumber(line.price_unit, 0);

      if (!productId || quantity <= 0 || priceUnit < 0) {
        throw new Error('Một dòng sản phẩm không hợp lệ.');
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
    return res.status(500).json({
      message: 'Lỗi khi tạo đơn hàng',
      error: error.message,
    });
  } finally {
    client.release();
  }
});

app.put('/api/orders/:id/status', async (req, res) => {
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

    await query(
      `UPDATE sale_order SET state = $1 WHERE id = $2;`,
      [nextState, id]
    );

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

app.put('/api/orders/:id', async (req, res) => {
  const { id } = req.params;
  const { partner_id, state, lines } = req.body;

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

    let totalAmount = toNumber(currentOrder.amount_total, 0);

    if (Array.isArray(lines)) {
      await client.query(`DELETE FROM sale_order_line WHERE order_id = $1;`, [id]);

      totalAmount = 0;
      for (const line of lines) {
        const productId = Number(line.product_id);
        const quantity = toNumber(line.quantity ?? line.product_uom_qty, 0);
        const priceUnit = toNumber(line.price_unit, 0);

        if (!productId || quantity <= 0 || priceUnit < 0) {
          throw new Error('Một dòng sản phẩm không hợp lệ.');
        }

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
    return res.status(500).json({
      message: 'Lỗi khi cập nhật đơn hàng',
      error: error.message,
    });
  } finally {
    client.release();
  }
});

app.delete('/api/orders/:id', async (req, res) => {
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
      return res.status(400).json({ message: 'Chỉ được xóa đơn hàng ở trạng thái Draft.' });
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

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

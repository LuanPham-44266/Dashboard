const express = require('express');
const cors = require('cors');
const path = require('path');
const { query } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/orders', async (req, res) => {
  try {
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
      ORDER BY so.id DESC;
    `;

    const result = await query(sql);
    return res.json(result.rows);
  } catch (error) {
    console.error('Error fetching orders:', error);
    return res.status(500).json({
      message: 'Lỗi khi truy xuất danh sách đơn hàng',
      error: error.message,
    });
  }
});

app.get('/api/orders/:id/details', async (req, res) => {
  try {
    const { id } = req.params;

    const sql = `
      SELECT
        sol.id,
        sol.order_id,
        sol.product_uom_qty,
        sol.price_unit,
        sol.price_subtotal,
        pp.id AS product_id,
        pp.name AS product_name,
        pp.list_price
      FROM sale_order_line sol
      INNER JOIN product_product pp ON pp.id = sol.product_id
      WHERE sol.order_id = $1
      ORDER BY sol.id ASC;
    `;

    const result = await query(sql, [id]);
    return res.json(result.rows);
  } catch (error) {
    console.error('Error fetching order details:', error);
    return res.status(500).json({
      message: 'Lỗi khi truy xuất chi tiết đơn hàng',
      error: error.message,
    });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

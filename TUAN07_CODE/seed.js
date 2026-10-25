const db = require('./db');

async function seedDatabase() {
  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');

    await client.query('DELETE FROM account_move');
    await client.query('DELETE FROM sale_order_line');
    await client.query('DELETE FROM sale_order');
    await client.query('DELETE FROM product_product');
    await client.query('DELETE FROM res_partner');

    const userResult = await client.query('SELECT id FROM users ORDER BY id ASC LIMIT 1');
    let createdBy = userResult.rows[0]?.id;

    if (!createdBy) {
      const fallbackUser = await client.query(
        `INSERT INTO users (username, email, password_hash, full_name, role)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        ['seed_user', 'seed_user@company.com', 'seed_hash', 'Seed User', 'Sale']
      );
      createdBy = fallbackUser.rows[0].id;
    }

    const customerRows = await client.query(
      `INSERT INTO res_partner (name, email, phone)
       VALUES
         ($1, $2, $3),
         ($4, $5, $6),
         ($7, $8, $9),
         ($10, $11, $12),
         ($13, $14, $15)
       RETURNING id, name`,
      [
        'Nguyễn Văn An', 'nguyenvanan@example.com', '0901000001',
        'Trần Thị Bình', 'tranthibinh@example.com', '0901000002',
        'Lê Hoàng Cường', 'lehoangcuong@example.com', '0901000003',
        'Phạm Minh Dũng', 'phamminhdung@example.com', '0901000004',
        'Hoàng Thị Em', 'hoangthiem@example.com', '0901000005',
      ]
    );

    const productRows = await client.query(
      `INSERT INTO product_product (name, list_price)
       VALUES
         ($1, $2),
         ($3, $4),
         ($5, $6),
         ($7, $8),
         ($9, $10)
       RETURNING id, name, list_price`,
      [
        'Laptop Dell XPS 13', 24990000,
        'Máy in HP LaserJet', 4890000,
        'Monitor LG 27 inch', 6990000,
        'Chuột Logitech MX Master', 2990000,
        'Bàn phím cơ Keychron K8', 3990000,
      ]
    );

    const customers = customerRows.rows;
    const products = productRows.rows;

    const orders = [
      {
        name: 'SO-2026-001',
        partner_id: customers[0].id,
        state: 'draft',
        amount_untaxed: 24990000,
        amount_total: 24990000,
        date_order: '2026-10-01T09:15:00',
      },
      {
        name: 'SO-2026-002',
        partner_id: customers[1].id,
        state: 'sale',
        amount_untaxed: 9980000,
        amount_total: 9980000,
        date_order: '2026-10-03T10:00:00',
      },
      {
        name: 'SO-2026-003',
        partner_id: customers[2].id,
        state: 'done',
        amount_untaxed: 18460000,
        amount_total: 18460000,
        date_order: '2026-10-05T14:20:00',
      },
      {
        name: 'SO-2026-004',
        partner_id: customers[3].id,
        state: 'draft',
        amount_untaxed: 6990000,
        amount_total: 6990000,
        date_order: '2026-10-08T08:45:00',
      },
      {
        name: 'SO-2026-005',
        partner_id: customers[4].id,
        state: 'cancel',
        amount_untaxed: 3890000,
        amount_total: 3890000,
        date_order: '2026-10-10T16:30:00',
      },
    ];

    const orderInsertValues = orders
      .map((_, index) => {
        const offset = index * 7;
        return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7})`;
      })
      .join(', ');

    const orderRows = await client.query(
      `INSERT INTO sale_order (name, partner_id, created_by, date_order, state, amount_untaxed, amount_total)
       VALUES ${orderInsertValues}
       RETURNING id, name`,
      orders.flatMap((order) => [
        order.name,
        order.partner_id,
        createdBy,
        order.date_order,
        order.state,
        order.amount_untaxed,
        order.amount_total,
      ])
    );

    const orderMap = new Map(orderRows.rows.map((row) => [row.name, row.id]));

    const orderLines = [
      { orderName: 'SO-2026-001', productId: products[0].id, quantity: 1, priceUnit: products[0].list_price, subtotal: products[0].list_price },
      { orderName: 'SO-2026-002', productId: products[2].id, quantity: 1, priceUnit: products[2].list_price, subtotal: products[2].list_price },
      { orderName: 'SO-2026-002', productId: products[3].id, quantity: 1, priceUnit: products[3].list_price, subtotal: products[3].list_price },
      { orderName: 'SO-2026-003', productId: products[1].id, quantity: 2, priceUnit: products[1].list_price, subtotal: products[1].list_price * 2 },
      { orderName: 'SO-2026-003', productId: products[4].id, quantity: 1, priceUnit: products[4].list_price, subtotal: products[4].list_price },
      { orderName: 'SO-2026-004', productId: products[2].id, quantity: 1, priceUnit: products[2].list_price, subtotal: products[2].list_price },
      { orderName: 'SO-2026-005', productId: products[0].id, quantity: 1, priceUnit: products[0].list_price, subtotal: products[0].list_price },
      { orderName: 'SO-2026-005', productId: products[3].id, quantity: 1, priceUnit: products[3].list_price, subtotal: products[3].list_price },
    ];

    if (orderLines.length > 0) {
      const orderLinePlaceholders = orderLines
        .map((_, index) => {
          const offset = index * 5;
          return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5})`;
        })
        .join(', ');

      const lineParams = orderLines.flatMap((line) => [
        orderMap.get(line.orderName),
        line.productId,
        line.quantity,
        line.priceUnit,
        line.subtotal,
      ]);

      await client.query(
        `INSERT INTO sale_order_line (order_id, product_id, product_uom_qty, price_unit, price_subtotal)
         VALUES ${orderLinePlaceholders}`,
        lineParams
      );
    }

    await client.query('COMMIT');

    console.log('Database seeded successfully.');
    console.log('Created customers:', customers.length);
    console.log('Created products:', products.length);
    console.log('Created orders:', orderRows.rows.length);
    console.log('Created order lines:', orderLines.length);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

seedDatabase()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  });
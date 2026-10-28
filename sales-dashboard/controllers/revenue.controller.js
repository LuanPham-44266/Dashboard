const { query } = require('../db');

async function getRevenueReport(req, res) {
  try {
    const startDate = String(req.query.startDate || '').trim();
    const endDate = String(req.query.endDate || '').trim();
    const whereClauses = ["state IN ('sale', 'done')"];
    const params = [];

    if (startDate) {
      params.push(`${startDate}T00:00:00Z`);
      whereClauses.push(`date_order >= $${params.length}`);
    }

    if (endDate) {
      params.push(`${endDate}T23:59:59Z`);
      whereClauses.push(`date_order <= $${params.length}`);
    }

    const result = await query(
      `
        SELECT so.id, so.name AS order_name, rp.name AS customer_name, so.date_order, so.state, so.amount_total 
        FROM sale_order so 
        LEFT JOIN res_partner rp ON rp.id = so.partner_id 
        WHERE ${whereClauses.join(' AND ')} 
        ORDER BY so.date_order DESC;
      `,
      params
    );

    const data = result.rows || [];
    const totalRevenue = data.reduce((sum, item) => sum + Number(item.amount_total || 0), 0);
    return res.json({ success: true, total_revenue: totalRevenue, data: data });
  } catch (error) {
    console.error('Error generating revenue report:', error);
    return res.status(500).json({
      success: false,
      message: 'Lỗi khi tạo báo cáo doanh thu.',
      error: error.message,
    });
  }
}

module.exports = { getRevenueReport };

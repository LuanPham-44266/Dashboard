const { query } = require('../db');

async function getRevenueReport(req, res) {
  try {
    const startDate = String(req.query.startDate || '').trim();
    const endDate = String(req.query.endDate || '').trim();
    const whereClauses = ['invoice_status = \'Paid\''];
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
        SELECT
          TO_CHAR(DATE_TRUNC('month', date_order), 'YYYY-MM') AS month,
          SUM(amount_total)::numeric AS total_revenue
        FROM sale_order
        WHERE ${whereClauses.join(' AND ')}
        GROUP BY DATE_TRUNC('month', date_order)
        ORDER BY DATE_TRUNC('month', date_order) ASC;
      `,
      params
    );

    const chartData = (result.rows || []).map((row) => ({
      month: row.month,
      total_revenue: Number(row.total_revenue || 0),
    }));

    const totalRevenue = chartData.reduce((sum, item) => sum + item.total_revenue, 0);

    return res.json({
      success: true,
      total_revenue: totalRevenue,
      data: chartData,
    });
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

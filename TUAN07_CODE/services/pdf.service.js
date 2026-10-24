const PDFDocument = require('pdfkit');
const { query } = require('../db');

async function getOrderInvoiceData(orderId) {
  const orderResult = await query(
    `
      SELECT
        so.id,
        so.name AS order_name,
        so.date_order,
        so.order_status,
        so.invoice_status,
        so.amount_untaxed,
        so.amount_total,
        rp.name AS customer_name,
        rp.email AS customer_email,
        rp.phone AS customer_phone,
        q.quote_number
      FROM sale_order so
      LEFT JOIN res_partner rp ON rp.id = so.partner_id
      LEFT JOIN quote q ON q.id = so.quote_id
      WHERE so.id = $1;
    `,
    [orderId]
  );

  if (!orderResult.rows[0]) {
    return null;
  }

  const itemsResult = await query(
    `
      SELECT
        sol.id,
        pp.name AS product_name,
        sol.product_uom_qty,
        sol.price_unit,
        sol.price_subtotal
      FROM sale_order_line sol
      INNER JOIN product_product pp ON pp.id = sol.product_id
      WHERE sol.order_id = $1
      ORDER BY sol.id ASC;
    `,
    [orderId]
  );

  return {
    order: orderResult.rows[0],
    items: itemsResult.rows,
  };
}

async function generateInvoicePDF(orderId) {
  const details = await getOrderInvoiceData(orderId);

  if (!details) {
    throw new Error('Không tìm thấy hóa đơn cho đơn hàng này.');
  }

  const { order, items } = details;
  const doc = new PDFDocument({ margin: 50 });
  const chunks = [];

  doc.on('data', (chunk) => chunks.push(chunk));

  doc.fontSize(20).text('HÓA ĐƠN BÁN HÀNG', { align: 'center' });
  doc.moveDown();

  doc.fontSize(12).text(`Mã đơn hàng: ${order.order_name}`);
  doc.text(`Ngày: ${new Date(order.date_order).toLocaleString('vi-VN')}`);
  doc.text(`Khách hàng: ${order.customer_name || 'Khách hàng'}`);
  doc.text(`Email: ${order.customer_email || '-'}`);
  doc.text(`Điện thoại: ${order.customer_phone || '-'}`);
  doc.text(`Trạng thái thanh toán: ${order.invoice_status || 'Unpaid'}`);
  doc.text(`Số báo giá: ${order.quote_number || '-'}`);
  doc.moveDown();

  doc.fontSize(12).text('Chi tiết sản phẩm:');
  doc.moveDown(0.5);

  const tableTop = doc.y;
  const itemX = 50;
  const qtyX = 290;
  const priceX = 380;
  const totalX = 500;

  doc.fontSize(10);
  doc.text('Sản phẩm', itemX, tableTop, { width: 200 });
  doc.text('SL', qtyX, tableTop, { width: 40 });
  doc.text('Đơn giá', priceX, tableTop, { width: 80 });
  doc.text('Thành tiền', totalX, tableTop, { width: 80 });

  let rowY = tableTop + 20;

  items.forEach((item) => {
    doc.text(String(item.product_name || 'Sản phẩm'), itemX, rowY, { width: 200 });
    doc.text(String(Number(item.product_uom_qty || 0)), qtyX, rowY, { width: 40 });
    doc.text(`${Number(item.price_unit || 0).toLocaleString('vi-VN')} đ`, priceX, rowY, { width: 80 });
    doc.text(`${Number(item.price_subtotal || 0).toLocaleString('vi-VN')} đ`, totalX, rowY, { width: 80 });
    rowY += 20;
  });

  doc.moveDown(2);
  doc.fontSize(12).text(`Tổng tiền chưa thuế: ${Number(order.amount_untaxed || 0).toLocaleString('vi-VN')} đ`);
  doc.text(`Tổng tiền thanh toán: ${Number(order.amount_total || 0).toLocaleString('vi-VN')} đ`);

  doc.end();

  await new Promise((resolve) => {
    doc.on('end', resolve);
  });

  return Buffer.concat(chunks);
}

module.exports = { generateInvoicePDF, getOrderInvoiceData };

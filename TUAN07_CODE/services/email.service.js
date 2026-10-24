const nodemailer = require('nodemailer');
const { query } = require('../db');

function buildQuoteHtml(quote, customer) {
  const quoteItems = quote.items || [];
  const itemRows = quoteItems
    .map(
      (item) => `
        <tr>
          <td>${item.product_name || 'Sản phẩm'}</td>
          <td>${Number(item.quantity || 0)}</td>
          <td>${Number(item.unit_price || 0).toLocaleString('vi-VN')} đ</td>
          <td>${Number(item.line_total || 0).toLocaleString('vi-VN')} đ</td>
        </tr>
      `
    )
    .join('');

  return `
    <div style="font-family: Arial, sans-serif; color: #1f2937; max-width: 760px; margin: 0 auto;">
      <div style="background: #0f172a; color: white; padding: 20px 24px; border-radius: 12px 12px 0 0;">
        <h2 style="margin: 0;">Báo giá ${quote.quote_number || 'Q-' + quote.id}</h2>
      </div>
      <div style="padding: 24px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px; background: #ffffff;">
        <p>Xin chào <strong>${customer?.name || 'Khách hàng'}</strong>,</p>
        <p>Dưới đây là báo giá của chúng tôi cho đơn hàng của bạn.</p>

        <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
          <thead>
            <tr style="background: #f3f4f6;">
              <th style="padding: 10px; text-align: left;">Sản phẩm</th>
              <th style="padding: 10px; text-align: left;">Số lượng</th>
              <th style="padding: 10px; text-align: left;">Đơn giá</th>
              <th style="padding: 10px; text-align: left;">Thành tiền</th>
            </tr>
          </thead>
          <tbody>
            ${itemRows || '<tr><td colspan="4">Không có sản phẩm</td></tr>'}
          </tbody>
        </table>

        <div style="margin-top: 20px; text-align: right;">
          <p style="margin: 6px 0;"><strong>Tổng tiền:</strong> ${Number(quote.total_amount || 0).toLocaleString('vi-VN')} đ</p>
        </div>

        <p style="margin-top: 24px;">Trân trọng,<br />Đội ngũ bán hàng</p>
      </div>
    </div>
  `;
}

async function getQuoteDetail(quoteId) {
  const quoteResult = await query(
    `
      SELECT q.id, q.quote_number, q.customer_id, q.created_by, q.quote_status, q.valid_until, q.notes, q.total_amount,
             rp.name AS customer_name, rp.email AS customer_email
      FROM quote q
      LEFT JOIN res_partner rp ON rp.id = q.customer_id
      WHERE q.id = $1;
    `,
    [quoteId]
  );

  if (!quoteResult.rows[0]) {
    return null;
  }

  const quote = quoteResult.rows[0];
  const itemsResult = await query(
    `
      SELECT product_name, description, quantity, unit_price, line_total
      FROM quote_item
      WHERE quote_id = $1
      ORDER BY id ASC;
    `,
    [quoteId]
  );

  return {
    ...quote,
    items: itemsResult.rows,
  };
}

async function sendQuoteEmail(quoteId, customerEmail) {
  const quote = await getQuoteDetail(quoteId);

  if (!quote) {
    throw new Error('Không tìm thấy báo giá để gửi email.');
  }

  const emailAddress = String(customerEmail || quote.customer_email || '').trim();
  if (!emailAddress) {
    throw new Error('Email khách hàng không hợp lệ hoặc chưa có trong dữ liệu.');
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || 'false') === 'true',
    auth: process.env.SMTP_USER
      ? {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        }
      : undefined,
  });

  const mailOptions = {
    from: process.env.SMTP_FROM || 'noreply@company.local',
    to: emailAddress,
    subject: `Báo giá ${quote.quote_number || quote.id}`,
    html: buildQuoteHtml(quote, { name: quote.customer_name || 'Khách hàng' }),
  };

  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    const previewTransport = nodemailer.createTransport({ jsonTransport: true });
    const result = await previewTransport.sendMail(mailOptions);
    return {
      success: true,
      preview: true,
      messageId: result.messageId,
      info: result,
    };
  }

  const info = await transporter.sendMail(mailOptions);
  return {
    success: true,
    preview: false,
    messageId: info.messageId,
    info,
  };
}

module.exports = { sendQuoteEmail, buildQuoteHtml, getQuoteDetail };

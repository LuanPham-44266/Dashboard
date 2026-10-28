const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { query } = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'sale-demo-secret';

function signUserToken(user) {
  return jwt.sign(
    {
      userId: user.id,
      role: user.role,
      email: user.email,
    },
    JWT_SECRET,
    { expiresIn: '8h' }
  );
}

async function login(req, res) {
  try {
    const { email, password } = req.body || {};
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const normalizedPassword = String(password || '').trim();

    if (!normalizedEmail || !normalizedPassword) {
      return res.status(400).json({
        success: false,
        message: 'Email và mật khẩu là bắt buộc.',
      });
    }

    const userResult = await query(
      `
        SELECT id, username, email, full_name, role, password_hash
        FROM users
        WHERE LOWER(email) = LOWER($1)
        LIMIT 1;
      `,
      [normalizedEmail]
    );

    const user = userResult.rows[0];
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Email hoặc mật khẩu không chính xác.',
      });
    }

    const passwordMatches = await bcrypt.compare(
      normalizedPassword,
      user.password_hash
    );

    if (!passwordMatches) {
      return res.status(401).json({
        success: false,
        message: 'Email hoặc mật khẩu không chính xác.',
      });
    }

    const token = signUserToken(user);

    return res.json({
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
      },
    });
  } catch (error) {
    console.error('Error in login controller:', error);
    return res.status(500).json({
      success: false,
      message: 'Lỗi hệ thống khi đăng nhập.',
      error: error.message,
    });
  }
}

module.exports = { login, signUserToken, JWT_SECRET };

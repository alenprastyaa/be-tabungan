// src/controllers/userController.js
const pool = require("../config/db");
const bcrypt = require("bcrypt");

const normalizeDob = (value) => {
  if (!value || typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  const slashMatch = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (slashMatch) {
    const [, day, month, year] = slashMatch;
    return `${year}-${month}-${day}`;
  }

  const dashMatch = trimmed.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (dashMatch) {
    const [, day, month, year] = dashMatch;
    return `${year}-${month}-${day}`;
  }

  return null;
};
exports.createUser = async (req, res) => {
  const { username, password, full_name, dob, address, phone } = req.body;
  const normalizedDob = dob ? normalizeDob(dob) : null;

  if (dob && !normalizedDob) {
    return res.status(400).json({
      message: "Format tanggal harus YYYY-MM-DD, DD-MM-YYYY, atau DD/MM/YYYY"
    });
  }

  const hashed = await bcrypt.hash(password, 10);

  const result = await pool.query(
    `INSERT INTO users (username, password, full_name, dob, address, phone)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [username, hashed, full_name, normalizedDob, address, phone]
  );

  res.json(result.rows[0]);
};
exports.searchUser = async (req, res) => {
  const { username, dob } = req.query;

  try {
    let query = `
      SELECT 
        u.id, 
        u.username, 
        u.full_name, 
        u.dob, 
        u.address,
        u.phone,
        (COALESCE(SUM(CASE WHEN s.type='deposit' THEN s.amount ELSE 0 END), 0) -
         COALESCE(SUM(CASE WHEN s.type='withdraw' THEN s.amount ELSE 0 END), 0)) AS balance
      FROM users u
      LEFT JOIN savings s ON s.user_id = u.id
      WHERE 1=1
    `;
    const values = [];
    let count = 1;

    if (username) {
      query += ` AND u.username ILIKE $${count}`;
      values.push(`%${username}%`);
      count++;
    }
    
    if (dob) {
      const formattedDob = normalizeDob(dob);

      if (formattedDob) {
        query += ` AND u.dob = $${count}`;
        values.push(formattedDob);
        count++;
      } else {
        return res.status(400).json({
          message: "Format tanggal harus YYYY-MM-DD, DD-MM-YYYY, atau DD/MM/YYYY"
        });
      }
    }
    query += ` GROUP BY u.id`;

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "User tidak ditemukan" });
    }

    const formattedResult = result.rows.map(user => ({
      ...user,
      balance: parseInt(user.balance, 10)
    }));
    
    res.json(formattedResult);
  } catch (error) {
    res.status(500).json({ message: "Terjadi kesalahan pada server", error: error.message });
  }
};
exports.getUserList = async (req, res) => {
  try {
    const { page = 1, limit = 10, username, dob } = req.query;
    const parsedPage = parseInt(page, 10) > 0 ? parseInt(page, 10) : 1;
    const parsedLimit = parseInt(limit, 10) > 0 ? parseInt(limit, 10) : 10;
    const offset = (parsedPage - 1) * parsedLimit;
    let whereClause = `WHERE 1=1`;
    const values = [];
    let count = 1;

    if (username) {
      whereClause += ` AND username ILIKE $${count}`;
      values.push(`%${username}%`);
      count++;
    }

    if (dob) {
      const formattedDob = normalizeDob(dob);

      if (formattedDob) {
        whereClause += ` AND dob = $${count}`;
        values.push(formattedDob);
        count++;
      } else {
        return res.status(400).json({
          message: "Format tanggal harus YYYY-MM-DD, DD-MM-YYYY, atau DD/MM/YYYY"
        });
      }
    }

    const countQuery = `SELECT COUNT(*) FROM users ${whereClause}`;
    const countResult = await pool.query(countQuery, values);
    const totalItems = parseInt(countResult.rows[0].count, 10);
    const totalPages = Math.ceil(totalItems / parsedLimit);
    const dataQuery = `
      SELECT id, username, full_name, dob, address, phone
      FROM users 
      ${whereClause} 
      ORDER BY id DESC 
      LIMIT $${count} OFFSET $${count + 1}
    `;
    
    const dataValues = [...values, parsedLimit, offset];

    const result = await pool.query(dataQuery, dataValues);

    res.status(200).json({
      message: "Berhasil mengambil daftar user",
      data: result.rows,
      pagination: {
        totalItems,
        totalPages,
        currentPage: parsedPage,
        limit: parsedLimit
      }
    });

  } catch (error) {
    console.error("Error fetching user list:", error);
    res.status(500).json({ message: "Terjadi kesalahan pada server", error: error.message });
  }
};

exports.updateUser = async (req, res) => {
  const { id } = req.params;
  const { full_name, dob, address, password, phone } = req.body;
  const normalizedDob = dob ? normalizeDob(dob) : null;

  try {
    if (dob && !normalizedDob) {
      return res.status(400).json({
        message: "Format tanggal harus YYYY-MM-DD, DD-MM-YYYY, atau DD/MM/YYYY"
      });
    }

    let query = `UPDATE users SET `;
    const values = [];
    let count = 1;

    // Pengecekan dinamis untuk setiap field yang dikirim
    if (full_name) {
      query += `full_name = $${count}, `;
      values.push(full_name);
      count++;
    }
      if (phone) {
      query += `phone = $${count}, `;
      values.push(phone);
      count++;
    }
    if (dob) {
      query += `dob = $${count}, `;
      values.push(normalizedDob);
      count++;
    }
    if (address) {
      query += `address = $${count}, `;
      values.push(address);
      count++;
    }
    if (password) {
      const hashed = await bcrypt.hash(password, 10);
      query += `password = $${count}, `;
      values.push(hashed);
      count++;
    }

    // Jika tidak ada data yang dikirim untuk diupdate
    if (values.length === 0) {
      return res.status(400).json({ message: "Tidak ada data yang dikirim untuk diupdate" });
    }

    // Menghapus koma dan spasi ekstra di akhir string query
    query = query.slice(0, -2); 
    
    // Menambahkan kondisi WHERE dan RETURNING
    query += ` WHERE id = $${count} RETURNING id, username, full_name, dob, address`;
    values.push(id);

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "User tidak ditemukan" });
    }

    res.json({
      message: "User berhasil diupdate",
      data: result.rows[0]
    });
  } catch (error) {
    console.error("Error updating user:", error);
    res.status(500).json({ message: "Terjadi kesalahan pada server", error: error.message });
  }
};

// Menghapus user berdasarkan ID
exports.deleteUser = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `DELETE FROM users WHERE id = $1 RETURNING id, username`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "User tidak ditemukan" });
    }

    res.json({ 
      message: "User berhasil dihapus", 
      deletedUser: result.rows[0] 
    });
  } catch (error) {
    console.error("Error deleting user:", error);
    res.status(500).json({ message: "Terjadi kesalahan pada server", error: error.message });
  }
};

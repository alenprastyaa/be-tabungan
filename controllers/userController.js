// src/controllers/userController.js
const pool = require("../config/db");
const bcrypt = require("bcrypt");

exports.createUser = async (req, res) => {
  const { username, password, full_name, dob, address } = req.body;

  const hashed = await bcrypt.hash(password, 10);

  const result = await pool.query(
    `INSERT INTO users (username, password, full_name, dob, address)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [username, hashed, full_name, dob, address ]
  );

  res.json(result.rows[0]);
};
exports.searchUser = async (req, res) => {
  const { username, dob } = req.query;

  try {
    let query = `SELECT id, username, full_name, dob, address FROM users WHERE 1=1`;
    const values = [];
    let count = 1;
    
    if (username) {
      query += ` AND username ILIKE $${count}`;
      values.push(`%${username}%`);
      count++;
    }
    
    if (dob) {
      const parts = dob.split('-');
      if (parts.length === 3) {
        const [day, month, year] = parts;
        const formattedDob = `${year}-${month}-${day}`;
        
        query += ` AND dob = $${count}`;
        values.push(formattedDob);
        count++;
      } else {
        return res.status(400).json({ message: "Format tanggal harus DD-MM-YYYY" });
      }
    }

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "User tidak ditemukan" });
    }
    
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: "Terjadi kesalahan pada server", error: error.message });
  }
};
exports.getUserList = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, username, full_name, dob, address
       FROM users 
       ORDER BY id DESC`
    );

    res.status(200).json(result.rows);
  } catch (error) {
    console.error("Error fetching user list:", error);
    res.status(500).json({ message: "Terjadi kesalahan pada server" });
  }
};

// Mengupdate data user berdasarkan ID
exports.updateUser = async (req, res) => {
  const { id } = req.params;
  const { full_name, dob, address, password } = req.body;

  try {
    let query = `UPDATE users SET `;
    const values = [];
    let count = 1;

    // Pengecekan dinamis untuk setiap field yang dikirim
    if (full_name) {
      query += `full_name = $${count}, `;
      values.push(full_name);
      count++;
    }
    if (dob) {
      query += `dob = $${count}, `;
      values.push(dob);
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
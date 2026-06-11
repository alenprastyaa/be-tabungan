const pool = require("../config/db");

const getBalance = async (user_id) => {
  const result = await pool.query(
    `
    SELECT 
      COALESCE(SUM(CASE WHEN type='deposit' THEN amount ELSE 0 END),0) -
      COALESCE(SUM(CASE WHEN type='withdraw' THEN amount ELSE 0 END),0)
      AS balance
    FROM savings WHERE user_id=$1
  `,
    [user_id]
  );

  return parseInt(result.rows[0].balance);
};

const calculateWithdrawalPenalty = (amount) => {
  if (amount < 1000000) {
    return {
      penaltyPercent: Math.round((5000 / amount) * 100),
      penaltyAmount: 5000
    };
  }

  return {
    penaltyPercent: 1,
    penaltyAmount: Math.floor(amount * 0.01)
  };
};

exports.deposit = async (req, res) => {
  const { user_id, amount } = req.body;

  const result = await pool.query(
    `INSERT INTO savings (user_id, amount, type, final_amount, created_by)
     VALUES ($1,$2,'deposit',$2,$3) RETURNING *`,
    [user_id, amount, req.user.id]
  );

  res.json(result.rows[0]);
};
exports.withdraw = async (req, res) => {
  try {
    const { user_id } = req.body;
    const amount = Number(req.body.amount);

    if (!user_id || !Number.isFinite(amount) || !Number.isInteger(amount)) {
      return res.status(400).json({
        message: "user_id dan amount wajib diisi, amount harus berupa angka bulat"
      });
    }

    if (amount <= 0) {
      return res.status(400).json({
        message: "amount harus lebih dari 0"
      });
    }

    const { penaltyPercent, penaltyAmount } = calculateWithdrawalPenalty(amount);
    const finalAmount = amount - penaltyAmount;

    if (finalAmount <= 0) {
      return res.status(400).json({
        message: "Nominal penarikan harus lebih besar dari potongan penalti"
      });
    }

    const balance = await getBalance(user_id);

    if (amount > balance) {
      return res.status(400).json({ message: "Saldo tidak cukup" });
    }

    const result = await pool.query(
      `INSERT INTO savings 
      (user_id, amount, type, penalty_percent, penalty_amount, final_amount, created_by)
      VALUES ($1,$2,'withdraw',$3,$4,$5,$6) RETURNING *`,
      [user_id, amount, penaltyPercent, penaltyAmount, finalAmount, req.user.id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Internal server error" });
  }
};

exports.getHistory = async (req, res) => {
  try {
    const user_id = req.user.id;
    const result = await pool.query(
      `SELECT * FROM savings WHERE user_id=$1 ORDER BY created_at DESC`,
      [user_id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Internal server error" });
  }
};

exports.getBalance = async (req, res) => {
  try {
    const user_id = req.user.id;
    const balance = await getBalance(user_id);
    res.json({ balance });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Internal server error" });
  }
};
exports.getAllHistory = async (req, res) => {
  try {
    let {
      page = 1,
      limit = 10,
      type,
      user_id,
      start_date,
      end_date,
      search
    } = req.query;

    page = parseInt(page);
    limit = parseInt(limit);

    if (page < 1) page = 1;
    if (limit < 1) limit = 10;

    const offset = (page - 1) * limit;

    let conditions = [];
    let values = [];
    let idx = 1;

    if (type) {
      conditions.push(`s.type = $${idx++}`);
      values.push(type);
    }
    if (user_id) {
      conditions.push(`s.user_id = $${idx++}`);
      values.push(user_id);
    }

    if (start_date) {
      conditions.push(`s.created_at >= $${idx++}`);
      values.push(start_date);
    }

    if (end_date) {
      conditions.push(`s.created_at <= $${idx++}`);
      values.push(end_date);
    }

    if (search) {
      conditions.push(`(u.username ILIKE $${idx} OR u.full_name ILIKE $${idx})`);
      values.push(`%${search}%`);
      idx++;
    }

    const where = conditions.length > 0
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    const totalQuery = `
      SELECT COUNT(*) 
      FROM savings s
      JOIN users u ON u.id = s.user_id
      ${where}
    `;

    const totalResult = await pool.query(totalQuery, values);
    const total = parseInt(totalResult.rows[0].count);

    const dataQuery = `
      SELECT 
        s.*,
        u.username,
        u.full_name
      FROM savings s
      JOIN users u ON u.id = s.user_id
      ${where}
      ORDER BY s.created_at DESC
      LIMIT $${idx++} OFFSET $${idx}
    `;

    values.push(limit, offset);

    const result = await pool.query(dataQuery, values);

    res.json({
      page,
      limit,
      total,
      total_pages: Math.ceil(total / limit),
      has_next: page * limit < total,
      has_prev: page > 1,
      data: result.rows
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Internal server error" });
  }
};
exports.getAllBalances = async (req, res) => {
  try {
    // 1. Tambahkan 'dob' pada destructuring req.query
    let { page = 1, limit = 10, search, dob } = req.query;

    page = parseInt(page);
    limit = parseInt(limit);
    const offset = (page - 1) * limit;

    let where = `WHERE u.role = 'user'`;
    let values = [];
    let idx = 1;

    // 2. Filter berdasarkan search (username / full_name)
    if (search) {
      where += ` AND (u.username ILIKE $${idx} OR u.full_name ILIKE $${idx})`;
      values.push(`%${search}%`);
      idx++;
    }

    // 3. Tambahkan logika filter berdasarkan dob
    if (dob) {
      const parts = dob.split('-');
      if (parts.length === 3) {
        const [day, month, year] = parts;
        const formattedDob = `${year}-${month}-${day}`;
        
        where += ` AND u.dob = $${idx}`;
        values.push(formattedDob);
        idx++;
      } else {
        return res.status(400).json({ message: "Format tanggal harus DD-MM-YYYY" });
      }
    }

    // 4. Query total data untuk pagination (menggunakan where dan values yang sudah di-update)
    const totalQuery = `
      SELECT COUNT(*) FROM users u ${where}
    `;
    const totalResult = await pool.query(totalQuery, values);
    const total = parseInt(totalResult.rows[0].count);

    // 5. Query utama untuk mengambil data balace
    const dataQuery = `
      SELECT 
        u.id AS user_id,
        u.username,
        u.full_name,
        u.address,
        u.dob,
        COALESCE(SUM(CASE WHEN s.type='deposit' THEN s.amount ELSE 0 END),0)
        -
        COALESCE(SUM(CASE WHEN s.type='withdraw' THEN s.amount ELSE 0 END),0)
        AS balance
      FROM users u
      LEFT JOIN savings s ON s.user_id = u.id
      ${where}
      GROUP BY u.id
      ORDER BY balance DESC
      LIMIT $${idx++} OFFSET $${idx}
   `;

    // 6. Masukkan limit dan offset ke array values pada urutan terakhir
    values.push(limit, offset);

    const result = await pool.query(dataQuery, values);

    // 7. Kirimkan response
    res.json({
      page,
      limit,
      total,
      total_pages: Math.ceil(total / limit),
      data: result.rows
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Internal server error" });
  }
};

exports.getMyBalance = async (req, res) => {
  try {
    const user_id = req.user.id;

    const balance = await getBalance(user_id);

    res.json({ balance });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Internal server error" });
  }
};
exports.getDashboardSummary = async (req, res) => {
  try {
    const [
      payoutsResult,
      depositsResult,
      customersResult,
      latestTransactionsResult,
      recentUsersResult
    ] = await Promise.all([
      pool.query(`
        SELECT COALESCE(SUM(s.amount), 0) AS total 
        FROM savings s 
        JOIN users u ON s.user_id = u.id 
        WHERE s.type='withdraw' AND u.role='user'
      `),
      pool.query(`
        SELECT COALESCE(SUM(s.amount), 0) AS total 
        FROM savings s 
        JOIN users u ON s.user_id = u.id 
        WHERE s.type='deposit' AND u.role='user'
      `),
      pool.query(`SELECT COUNT(*) AS total FROM users WHERE role='user'`),
      pool.query(`
        SELECT s.id, s.type, s.amount, s.created_at, u.full_name, u.username
        FROM savings s
        JOIN users u ON s.user_id = u.id
        ORDER BY s.created_at DESC
        LIMIT 5
      `),
      pool.query(`SELECT id, username, full_name FROM users WHERE role='user' ORDER BY id DESC LIMIT 5`)
    ]);

    const totalPayouts = parseInt(payoutsResult.rows[0].total);
    const totalDeposits = parseInt(depositsResult.rows[0].total);
    const totalBalance = totalDeposits - totalPayouts;

    const formattedTransactions = latestTransactionsResult.rows.map(row => ({
      id: row.id,
      transaction: `${row.type === 'deposit' ? 'Deposit from' : 'Withdrawal by'} ${row.full_name || row.username}`,
      datetime: new Date(row.created_at).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric'
      }),
      amount: `Rp.${parseInt(row.amount).toLocaleString('id-ID')}`,
      statusTransaction: 'completed' 
    }));

    res.json({
      summary: {
        totalPayouts: totalPayouts,
        totalDeposits: totalDeposits,
        totalCustomers: parseInt(customersResult.rows[0].total),
        totalBalance: totalBalance
      },
      latestTransactions: formattedTransactions,
      recentUsers: recentUsersResult.rows
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Internal server error" });
  }
};

exports.getUserDashboardSummary = async (req, res) => {
  try {
    const user_id = req.user.id;
    const [
      statsResult,
      latestTransactionsResult,
      monthlyActivityResult
    ] = await Promise.all([
      pool.query(`
        SELECT 
          COALESCE(SUM(CASE WHEN type='deposit' THEN amount ELSE 0 END), 0) AS total_deposit,
          COALESCE(SUM(CASE WHEN type='withdraw' THEN amount ELSE 0 END), 0) AS total_withdraw,
          COUNT(*) AS total_transactions
        FROM savings 
        WHERE user_id = $1
      `, [user_id]),
      pool.query(`
        SELECT id, type, amount, penalty_amount, final_amount, created_at
        FROM savings
        WHERE user_id = $1
        ORDER BY created_at DESC
      `, [user_id]),

      pool.query(`
        SELECT 
          TO_CHAR(created_at, 'Mon') AS month,
          SUM(CASE WHEN type='deposit' THEN amount ELSE -amount END) AS net_savings
        FROM savings
        WHERE user_id = $1 AND created_at > NOW() - INTERVAL '6 months'
        GROUP BY TO_CHAR(created_at, 'Mon'), DATE_TRUNC('month', created_at)
        ORDER BY DATE_TRUNC('month', created_at) ASC
      `, [user_id])
    ]);

    const stats = statsResult.rows[0];
    const totalBalance = parseInt(stats.total_deposit) - parseInt(stats.total_withdraw);
    const formattedTransactions = latestTransactionsResult.rows.map(row => ({
      id: row.id,
      type: row.type,
      displayAmount: parseInt(row.type === 'deposit' ? row.amount : row.final_amount),
      penalty: parseInt(row.penalty_amount || 0),
      date: new Date(row.created_at).toLocaleDateString('id-ID', {
        day: 'numeric', month: 'short', year: 'numeric'
      }),
      status: 'success'
    }));

    res.json({
      summary: {
        currentBalance: totalBalance,
        totalDeposit: parseInt(stats.total_deposit),
        totalWithdraw: parseInt(stats.total_withdraw),
        transactionCount: parseInt(stats.total_transactions)
      },
      recentTransactions: formattedTransactions,
      chartData: monthlyActivityResult.rows 
    });

  } catch (err) {
    console.error("User Dashboard Error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};

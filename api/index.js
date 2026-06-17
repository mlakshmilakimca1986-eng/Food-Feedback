const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

// Middleware to strip /api prefix if present (needed for Vercel/Hosting routing)
app.use((req, res, next) => {
  if (req.url.startsWith('/api/')) {
    req.url = req.url.substring(4);
  } else if (req.url === '/api') {
    req.url = '/';
  }
  next();
});

// TiDB Connection Configuration
const dbConfig = {
  host: "gateway01.ap-southeast-1.prod.alicloud.tidbcloud.com",
  port: 4000,
  user: "KqoqWbeyfmufP7y.root",
  password: "a6GfOcd9lvniJ3mq",
  database: "food_feedback",
  ssl: {
    minVersion: 'TLSv1.2',
    rejectUnauthorized: true
  }
};

// Helper to get a database connection
async function getDbConnection() {
  return await mysql.createConnection(dbConfig);
}

// ==========================================================================
// API ENDPOINTS
// ==========================================================================

// 1. Student Lookup
app.get("/student", async (req, res) => {
  const scsNumber = req.query.scsNumber;
  if (!scsNumber) {
    return res.status(400).json({ error: "scsNumber parameter is required" });
  }

  let connection;
  try {
    connection = await getDbConnection();
    const [rows] = await connection.execute(
      "SELECT * FROM students WHERE scsNumber = ?",
      [scsNumber.trim()]
    );
    
    if (rows.length > 0) {
      return res.json(rows[0]);
    } else {
      return res.status(404).json({ error: "Student not found" });
    }
  } catch (err) {
    console.error("Database error during student lookup:", err);
    return res.status(500).json({ error: "Internal Database Error", details: err.message });
  } finally {
    if (connection) await connection.end();
  }
});

// 2. Submit Feedback
app.post("/feedback", async (req, res) => {
  const { scsNumber, studentName, category, section, campus, date, day, ratings, comments, submittedAt } = req.body;
  
  if (!scsNumber || !ratings) {
    return res.status(400).json({ error: "Missing required feedback fields" });
  }

  let connection;
  try {
    connection = await getDbConnection();
    await connection.execute(
      `INSERT INTO feedback (scsNumber, studentName, category, section, campus, date, day, ratings, comments, submittedAt) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        scsNumber,
        studentName || "",
        category || "",
        section || "",
        campus || "",
        date,
        day,
        JSON.stringify(ratings),
        JSON.stringify(comments || {}),
        submittedAt || new Date().toISOString()
      ]
    );
    
    return res.json({ success: true, message: "Feedback saved to TiDB successfully" });
  } catch (err) {
    console.error("Database error during feedback submission:", err);
    return res.status(500).json({ error: "Internal Database Error", details: err.message });
  } finally {
    if (connection) await connection.end();
  }
});

// 3. Create Warden Account
app.post("/warden", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  const cleanEmail = email.toLowerCase().trim();
  let connection;
  try {
    connection = await getDbConnection();
    
    // Check if warden already exists
    const [existing] = await connection.execute(
      "SELECT email FROM wardens WHERE email = ?",
      [cleanEmail]
    );
    if (existing.length > 0) {
      return res.status(400).json({ error: "Warden account already exists" });
    }

    // Insert new warden
    await connection.execute(
      "INSERT INTO wardens (email, password, createdAt) VALUES (?, ?, ?)",
      [cleanEmail, password, new Date().toISOString().slice(0, 19).replace('T', ' ')]
    );
    
    return res.json({ success: true, message: "Warden account created in TiDB successfully" });
  } catch (err) {
    console.error("Database error during warden creation:", err);
    return res.status(500).json({ error: "Internal Database Error", details: err.message });
  } finally {
    if (connection) await connection.end();
  }
});

// 4. Login Authentication
app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  const cleanEmail = email.toLowerCase().trim();
  
  // Hardcoded AGM account bypass
  if (cleanEmail === "srinivasnaidu.m@srichaitanyaschool.net" && password === "Admin@123") {
    return res.json({ success: true, role: "agm", email: cleanEmail });
  }

  let connection;
  try {
    connection = await getDbConnection();
    const [rows] = await connection.execute(
      "SELECT * FROM wardens WHERE email = ? AND password = ?",
      [cleanEmail, password]
    );
    
    if (rows.length > 0) {
      return res.json({ success: true, role: "warden", email: cleanEmail });
    } else {
      return res.status(401).json({ error: "Invalid credentials" });
    }
  } catch (err) {
    console.error("Database error during login:", err);
    return res.status(500).json({ error: "Internal Database Error", details: err.message });
  } finally {
    if (connection) await connection.end();
  }
});

// 5. Get All Feedbacks (for AGM Analytics)
app.get("/feedback", async (req, res) => {
  let connection;
  try {
    connection = await getDbConnection();
    const [rows] = await connection.execute("SELECT * FROM feedback ORDER BY submittedAt DESC");
    
    // Parse JSON fields
    const parsedRows = rows.map(r => {
      return {
        ...r,
        ratings: typeof r.ratings === 'string' ? JSON.parse(r.ratings) : r.ratings,
        comments: typeof r.comments === 'string' ? JSON.parse(r.comments) : r.comments,
        // Format date to ISO YYYY-MM-DD
        date: r.date ? new Date(r.date).toISOString().split('T')[0] : ""
      };
    });
    
    return res.json(parsedRows);
  } catch (err) {
    console.error("Database error during feedback fetch:", err);
    return res.status(500).json({ error: "Internal Database Error", details: err.message });
  } finally {
    if (connection) await connection.end();
  }
});

// 6. Get All Wardens
app.get("/wardens", async (req, res) => {
  let connection;
  try {
    connection = await getDbConnection();
    const [rows] = await connection.execute("SELECT email, createdAt FROM wardens ORDER BY createdAt DESC");
    return res.json(rows);
  } catch (err) {
    console.error("Database error during wardens fetch:", err);
    return res.status(500).json({ error: "Internal Database Error", details: err.message });
  } finally {
    if (connection) await connection.end();
  }
});

// Export Express app for Vercel serverless function
module.exports = app;

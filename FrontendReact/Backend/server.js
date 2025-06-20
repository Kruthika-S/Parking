import express from 'express';
import mysql from 'mysql2';
import cors from 'cors';
import bodyParser from 'body-parser';
import nodemailer from 'nodemailer';
import crypto from 'crypto';
import ticketSlotRoutes from './ticket_slotServer.js'; 
import ticketBookingRoutes from './BookTicketServer.js';


const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use('/api', ticketSlotRoutes);
app.use('/api', ticketBookingRoutes);


// MySQL Connection
const db = mysql.createConnection({
  host: 'localhost',
  user: 'root',       // Replace with your MySQL username
  password: 'kruthi@1234',       // Replace with your MySQL password
  database: 'parking'
});

db.connect(err => {
  if (err) throw err;
  console.log('Connected to MySQL');
});

// 🔁 Auto-release expired bookings every 1 minute
setInterval(async () => {
  try {
    const [expired] = await db.promise().query(
      `SELECT spot_name, spotId FROM ticket_info WHERE end_time < NOW()`
    );

    for (const row of expired) {
      const tableName = row.spot_name.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();

      // Mark the slot as empty again
      await db.promise().query(
        `UPDATE \`${tableName}\` SET status = 'empty' WHERE slotId = ?`,
        [row.spotId]
      );

      // Delete the expired ticket from ticket_info
      await db.promise().query(
        `DELETE FROM ticket_info WHERE spot_name = ? AND spotId = ? AND end_time < NOW()`,
        [row.spot_name, row.spotId]
      );
    }
  } catch (err) {
    console.error("❌ Auto-release error:", err);
  }
}, 60 * 1000); // Runs every 60 seconds


// Signup Endpoint
app.post('/api/signup', (req, res) => {
  const { name, age, emailID, mobNo, password, confirm_password, gender } = req.body;
  
  const sql = `
    INSERT INTO login 
    (name, age, emailID, mobNo, password, confirm_password, gender) 
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;
  
  db.query(sql, 
    [name, age, emailID, mobNo, password, confirm_password, gender], 
    (err, result) => {
      if (err) {
        return res.status(400).json({ error: err.message });
      }
      res.json({ success: true });
    }
  );
});

// Login Endpoint
app.post('/api/login', (req, res) => {
  const { emailID, password } = req.body;
  
  if (!emailID || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  const sql = 'SELECT * FROM login WHERE emailID = ? AND password = ?';
  
  db.query(sql, [emailID, password], (err, results) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    if (results.length === 0) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }
    
    // If we get here, login was successful
    res.json({ success: true, message: 'Login successful' });
  });
});


// Forgot Password - Step 1: Request Password Reset
app.post('/api/forgot-password', (req, res) => {
  const { emailID } = req.body;

  if (!emailID) {
    return res.status(400).json({ message: 'Email is required' });
  }

  // 1. Check if email exists in database
  const sql = 'SELECT * FROM login WHERE emailID = ?';
  
  db.query(sql, [emailID], (err, results) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    if (results.length === 0) {
      // For security, don't reveal if email doesn't exist
      return res.json({ 
        success: true, 
        message: 'If this email exists, a reset link has been sent' 
      });
    }
    
    
    // 2. In a real app: Generate reset token and send email
    // For now, we'll just return a mock response
    res.json({ 
      success: true,
      message: 'Password reset link sent to your email',
      // In production: Never send the token back in response
      // This is just for testing
      resetToken: 'mock-reset-token-123' 
    });
  });
});

// Forgot Password - Step 2: Reset Password
app.post('/api/reset-password', async (req, res) => {
  const { token, newPassword } = req.body;

  if (!token || !newPassword) {
    return res.status(400).json({ error: 'Token and new password are required' });
  }

  try {
    // 1. Find user with valid token
    const [user] = await db.promise().query(
      'SELECT * FROM login WHERE resetToken = ? AND resetTokenExpires > NOW()',
      [token]
    );

    if (user.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired token' });
    }

    // 2. Hash new password (install bcrypt: npm install bcrypt)
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // 3. Update password and clear token
    await db.promise().query(
      'UPDATE login SET password = ?, resetToken = NULL, resetTokenExpires = NULL WHERE emailID = ?',
      [hashedPassword, user[0].emailID]
    );

    res.json({ success: true, message: 'Password updated successfully' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});
// server.js (add near the top with other imports)

// Email configuration (add after database connection)
const transporter = nodemailer.createTransport({
  service: 'Gmail',
  auth: {
    user: process.env.EMAIL_USER,  // Store these in .env file
    pass: process.env.EMAIL_PASS
  }
});

app.post('/api/forgot-password', async (req, res) => {
  const { emailID } = req.body;
  
  // ... (existing validation and DB check)
  
  // Generate token (use crypto or uuid)
  const token = crypto.randomBytes(32).toString('hex');
  
  // Store token in DB with expiration (add this to your users table)
  // await storeResetToken(emailID, token);
  
  try {
    await sendResetEmail(emailID, token);
    res.json({ success: true, message: 'Reset link sent to email' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to send email' });
  }
});

async function sendResetEmail(email, token) {
  try {
    await transporter.sendMail({
      from: 'no-reply@yourparkingapp.com',
      to: email,
      subject: 'Password Reset Request',
      html: `
        <p>You requested a password reset for your Parking App account.</p>
        <p>Click <a href="http://localhost:3000/reset-password?token=${token}">here</a> to reset your password.</p>
        <p>This link will expire in 1 hour.</p>
      `
    });
  } catch (error) {
    console.error('Error sending email:', error);
    throw error;
  }
}

const PORT = 5000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
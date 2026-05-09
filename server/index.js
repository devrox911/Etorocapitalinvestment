require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');
const { initScheduler } = require('./scheduler');
const emailService = require('./emailService');
const { getEmailProviderStatus, sendTransactionalEmail } = require('./mailProvider');

const PORT = process.env.PORT || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RECAPTCHA_SECRET = process.env.RECAPTCHA_SECRET || '';
const SITE_URL = (process.env.EMAIL_SITE_URL || process.env.VITE_APP_URL || `https://${process.env.APP_DOMAIN || 'etorocapitalinvestment.vercel.app'}`).replace(/\/$/, '');
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || process.env.EMAIL_REPLY_TO || process.env.EMAIL_FROM || 'noreply@etorocapital.online';
const GOOGLE_TRANSLATE_URL = 'https://translate.google.com/?sl=en&tl=auto&op=translate';
const EMAIL_TRANSLATION_BLOCK = `
      <div style="margin: 24px 0 0; padding: 16px; text-align: center; background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 8px;">
        <p style="margin: 0 0 10px; color: #475569; font-size: 13px;">Need this notification in another language?</p>
        <a href="${GOOGLE_TRANSLATE_URL}" target="_blank" style="display: inline-block; padding: 9px 16px; background: #ffffff; color: #0f172a; text-decoration: none; border: 1px solid #d1d5db; border-radius: 6px; font-weight: 600; font-size: 13px;">Open Google Translate</a>
      </div>
`;

const addEmailTranslationFeature = (html) => {
  if (!html || html.includes(GOOGLE_TRANSLATE_URL)) return html;
  const beforeFooter = /(\s*<\/div>\s*<div class="footer">)/;
  if (beforeFooter.test(html)) {
    return html.replace(beforeFooter, `${EMAIL_TRANSLATION_BLOCK}$1`);
  }
  return html.replace('</body>', `${EMAIL_TRANSLATION_BLOCK}</body>`);
};

const sendAdminActivityEmail = async ({ subject, heading, rows }) => {
  const htmlRows = rows
    .filter((row) => row.value !== undefined && row.value !== null && row.value !== '')
    .map((row) => `
      <tr>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; font-weight: 700; color: #334155; width: 38%;">${row.label}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; color: #0f172a;">${row.value}</td>
      </tr>
    `)
    .join('');

  const html = addEmailTranslationFeature(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${subject}</title>
</head>
<body style="margin:0; padding:0; background:#ffffff; font-family:Arial, sans-serif; color:#0f172a;">
  <div style="max-width:620px; margin:24px auto; border:1px solid #e5e7eb; border-radius:8px; overflow:hidden;">
    <div style="padding:24px; border-bottom:3px solid #f0b90b;">
      <h2 style="margin:0; color:#0f172a;">${heading}</h2>
    </div>
    <div style="padding:24px;">
      <p style="margin:0 0 16px; color:#475569;">A user activity needs admin review.</p>
      <table style="width:100%; border-collapse:collapse; border:1px solid #e5e7eb;">
        ${htmlRows}
      </table>
      <p style="margin:20px 0 0;"><a href="${SITE_URL}/dashboard/admin" style="display:inline-block; background:#f0b90b; color:#000; text-decoration:none; padding:10px 16px; border-radius:6px; font-weight:700;">Open Admin Dashboard</a></p>
    </div>
    <div class="footer" style="padding:16px 24px; border-top:1px solid #e5e7eb; color:#64748b; font-size:12px;">Automated admin notification.</div>
  </div>
</body>
</html>`);

  const result = await sendTransactionalEmail({
    to: ADMIN_EMAIL,
    toName: 'Admin',
    subject,
    html,
  });

  return result.sent;
};

// ... existing supabase setup ...

let supabase = null;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set. Server will run in limited "no-supabase" mode for local development or tests.');
  supabase = {
        from: () => ({
      insert: async (payload) => ({ data: Array.isArray(payload) ? payload : [payload], error: null })
    }),
    auth: {
      admin: {
        createUser: async (opts) => ({ data: { user: { id: `dev-${Date.now()}` } }, error: null })
      },
      signInWithPassword: async (creds) => ({ data: { session: { access_token: 'dev-token', refresh_token: 'dev-refresh', expires_in: 3600 }, user: { id: 'dev-user', email: creds.email } }, error: null })
    }
  };
} else {
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false } });
}

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// --- Notification Endpoints (Called by Application Logic) ---

// 1. Welcome Email
app.post('/api/notify/welcome', async (req, res) => {
  const { email, name } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  
  const sent = await emailService.sendWelcome(email, name || email.split('@')[0]);
  if (sent) return res.json({ success: true });
  return res.status(500).json({ error: 'Failed to send email' });
});

// 2. Deposit Request (User & Admin)
app.post('/api/notify/deposit-request', async (req, res) => {
  const { userEmail, userName, amount, method, currency, txHash, proofUrl } = req.body;
  if (!userEmail || !amount) return res.status(400).json({ error: 'Missing details' });

  await emailService.sendDepositRequest(userEmail, userName, amount, method, currency, txHash, proofUrl);
  res.json({ success: true });
});

// 3. Deposit Status Update
app.post('/api/notify/deposit-status', async (req, res) => {
  const { userEmail, userName, amount, status, reason } = req.body;
  if (!userEmail || !status) return res.status(400).json({ error: 'Missing details' });

  const sent = await emailService.sendDepositStatus(userEmail, userName, amount, status, reason);
  res.json({ success: sent });
});

// 4. Withdrawal Request
app.post('/api/notify/withdrawal-request', async (req, res) => {
  const { userEmail, userName, amount, method, wallet } = req.body;
  
  await emailService.sendWithdrawalRequest(userEmail, userName, amount, method, wallet);
  res.json({ success: true });
});

// 5. Withdrawal Status
app.post('/api/notify/withdrawal-status', async (req, res) => {
  const { userEmail, userName, amount, status, reason } = req.body;
  
  const sent = await emailService.sendWithdrawalStatus(userEmail, userName, amount, status, reason);
  res.json({ success: sent });
});

// 6. KYC Submission (Admin)
app.post('/api/notify/kyc-request', async (req, res) => {
  try {
    const { userEmail, userName, userId, documentType, documentNumber, documentFrontUrl, documentBackUrl, selfieUrl } = req.body || {};
    if (!userId && !userEmail) return res.status(400).json({ error: 'Missing user details' });

    const sent = await sendAdminActivityEmail({
      subject: `New KYC Submission from ${userName || userEmail || userId}`,
      heading: 'New KYC Submission',
      rows: [
        { label: 'User', value: userName || 'User' },
        { label: 'Email', value: userEmail },
        { label: 'User ID', value: userId },
        { label: 'Document Type', value: documentType },
        { label: 'Document Number', value: documentNumber },
        { label: 'ID Document', value: documentFrontUrl },
        { label: 'Address Document', value: documentBackUrl },
        { label: 'Selfie', value: selfieUrl },
        { label: 'Status', value: 'pending' },
      ],
    });

    if (sent) return res.json({ success: true });
    return res.status(500).json({ error: 'Failed to send KYC admin notification' });
  } catch (error) {
    console.error('KYC admin notification error:', error);
    return res.status(500).json({ error: 'Failed to send KYC admin notification' });
  }
});

// 7. Loan Application (Admin)
app.post('/api/notify/loan-request', async (req, res) => {
  try {
    const { userEmail, userName, userId, amount, duration, purpose, interestRate, totalRepayment, phoneNumber, employmentStatus, monthlyIncome } = req.body || {};
    if (!userId && !userEmail) return res.status(400).json({ error: 'Missing user details' });

    const sent = await sendAdminActivityEmail({
      subject: `New Loan Application: $${Number(amount || 0).toLocaleString()} from ${userName || userEmail || userId}`,
      heading: 'New Loan Application',
      rows: [
        { label: 'User', value: userName || 'User' },
        { label: 'Email', value: userEmail },
        { label: 'User ID', value: userId },
        { label: 'Phone', value: phoneNumber },
        { label: 'Amount', value: amount ? `$${Number(amount).toLocaleString()}` : '' },
        { label: 'Duration', value: duration ? `${duration} days` : '' },
        { label: 'Interest Rate', value: interestRate ? `${interestRate}%` : '' },
        { label: 'Total Repayment', value: totalRepayment ? `$${Number(totalRepayment).toLocaleString()}` : '' },
        { label: 'Employment Status', value: employmentStatus },
        { label: 'Monthly Income', value: monthlyIncome ? `$${Number(monthlyIncome).toLocaleString()}` : '' },
        { label: 'Purpose', value: purpose },
        { label: 'Status', value: 'pending' },
      ],
    });

    if (sent) return res.json({ success: true });
    return res.status(500).json({ error: 'Failed to send loan admin notification' });
  } catch (error) {
    console.error('Loan admin notification error:', error);
    return res.status(500).json({ error: 'Failed to send loan admin notification' });
  }
});

// 8. Referral Signup (Referrer Notification)
app.post('/api/notify/referral-signup', async (req, res) => {
  try {
    const { referrerId, referrerEmail, referrerName, newUserEmail, newUserName, referralBonus, totalReferrals } = req.body || {};
    if (!referrerEmail) return res.status(400).json({ error: 'Missing referrer email' });

    const SITE_URL = process.env.VITE_APP_URL || 'https://etorocapitalinvestment.vercel.app';
    const EMAIL_LOGO_PATH = '/images/email-logo.png';
    const LOGO_IMAGE = process.env.EMAIL_LOGO_URL || `${SITE_URL}${EMAIL_LOGO_PATH}`;

    const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>New Referral Signup</title>
    </head>
    <body style="margin: 0; padding: 0; background-color: #f5f5f5; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;">
      <div style="max-width: 600px; margin: 20px auto; background: #ffffff; border-radius: 8px; overflow: hidden; border: 1px solid #ddd; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
        <!-- Dark Header with Logo -->
        <div style="background: linear-gradient(135deg, #0f172a 0%, #1a202c 100%); padding: 50px 20px; text-align: center;">
          <a href="${SITE_URL}" target="_blank" style="text-decoration: none; display: inline-block;">
            <img src="${LOGO_IMAGE}" alt="eToro Trust Capital Logo" width="200" height="auto" style="display: block; max-width: 100%; height: auto; border: 0; font-family: sans-serif; font-size: 20px; color: #f0b90b; font-weight: bold;" onerror="this.style.display='none'; this.parentElement.innerHTML += '<div style=\\'color: #f0b90b; font-size: 24px; font-weight: bold; letter-spacing: 2px;\\'>eTORO TRUST CAPITAL</div>'" />
          </a>
          <p style="margin: 15px 0 0 0; color: #f0b90b; font-size: 14px; letter-spacing: 1px; font-weight: bold;">eTORO TRUST CAPITAL</p>
        </div>
        
        <!-- White Content Area -->
        <div style="padding: 30px 20px; color: #333; background-color: #ffffff;">
          <h2 style="color: #0f172a; margin: 0 0 15px 0; font-size: 24px;">🎉 New Referral Signup!</h2>
          <p style="line-height: 1.8; margin: 0 0 15px 0; font-size: 16px;">Hi ${referrerName},</p>
          <p style="line-height: 1.8; margin: 0 0 20px 0;">Great news! Someone has signed up using your referral code and you've earned a bonus!</p>
          
          <table style="width: 100%; border-collapse: collapse; margin: 25px 0;">
            <tr style="border-bottom: 1px solid #eee;">
              <td style="padding: 12px; font-weight: bold; color: #0f172a; background-color: #f9f9f9; width: 40%;">New User</td>
              <td style="padding: 12px; color: #333;">${newUserName}</td>
            </tr>
            <tr style="border-bottom: 1px solid #eee;">
              <td style="padding: 12px; font-weight: bold; color: #0f172a; background-color: #f9f9f9;">Email</td>
              <td style="padding: 12px; color: #333;">${newUserEmail}</td>
            </tr>
            <tr style="border-bottom: 1px solid #eee;">
              <td style="padding: 12px; font-weight: bold; color: #0f172a; background-color: #f9f9f9;">Bonus Earned</td>
              <td style="padding: 12px; color: #f0b90b; font-weight: bold; font-size: 18px;">$${Number(referralBonus || 0).toLocaleString()}</td>
            </tr>
            <tr>
              <td style="padding: 12px; font-weight: bold; color: #0f172a; background-color: #f9f9f9;">Total Referrals</td>
              <td style="padding: 12px; color: #333; font-weight: bold; font-size: 16px;">${totalReferrals}</td>
            </tr>
          </table>
          
          <div style="background: #f0f9ff; padding: 15px; border-left: 3px solid #f0b90b; border-radius: 4px; margin: 20px 0; color: #0f172a;">
            <p style="margin: 0;"><strong style="color: #0f172a;">✓ Bonus Credited:</strong> The $${Number(referralBonus || 0)} referral bonus has been automatically added to your account. You can use these funds to invest or withdraw anytime.</p>
          </div>
          
          <center style="margin-top: 25px;">
            <a href="${SITE_URL}/dashboard" style="display: inline-block; padding: 12px 30px; background-color: #f0b90b; color: #000; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 14px;">View Your Dashboard</a>
          </center>
        </div>
        
        <!-- Footer -->
        <div style="background-color: #f5f5f5; color: #666; padding: 20px; text-align: center; font-size: 12px; border-top: 1px solid #ddd;">
          <p style="margin: 0 0 5px 0;">&copy; ${new Date().getFullYear()} eToro Trust Capital. All rights reserved.</p>
          <p style="margin: 0;">This is an automated message, please do not reply.</p>
        </div>
      </div>
    </body>
    </html>
    `;

    const result = await sendTransactionalEmail({
      to: referrerEmail,
      toName: referrerName,
      subject: `🎉 New Referral Signup - $${Number(referralBonus || 0)} Bonus Earned!`,
      html: addEmailTranslationFeature(html)
    });

    if (result.sent) return res.json({ success: true });
    return res.status(500).json({ error: 'Failed to send referral notification' });
  } catch (error) {
    console.error('Referral signup notification error:', error);
    return res.status(500).json({ error: 'Failed to send referral notification' });
  }
});

// Test: Send test deposit email
app.post('/api/test/send-deposit-email', async (req, res) => {
  try {
    const { email, name, amount, method, currency, txHash } = req.body || {};
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const testName = name || 'Test User';
    const testAmount = amount || '250.00';
    const testMethod = method || 'Bitcoin';
    const testCurrency = currency || 'BTC';
    const testTxHash = txHash || '0x1234567890abcdef1234567890abcdef12345678901234567890abcdef';

    const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Deposit Confirmation</title>
    </head>
    <body style="margin: 0; padding: 0; background-color: #f5f5f5; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;">
      <div style="max-width: 600px; margin: 20px auto; background: #ffffff; border-radius: 8px; overflow: hidden; border: 1px solid #ddd; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
        <!-- Dark Header with Logo -->
        <div style="background: linear-gradient(135deg, #0f172a 0%, #1a202c 100%); padding: 50px 20px; text-align: center;">
          <a href="${SITE_URL}" target="_blank" style="text-decoration: none; display: inline-block;">
            <img src="${SITE_URL}/images/email-logo.png" alt="eToro Trust Capital Logo" width="200" height="auto" style="display: block; max-width: 100%; height: auto; border: 0; font-family: sans-serif; font-size: 20px; color: #f0b90b; font-weight: bold;" onerror="this.style.display='none'; this.parentElement.innerHTML += '<div style=\\'color: #f0b90b; font-size: 24px; font-weight: bold; letter-spacing: 2px;\\'>eTORO TRUST CAPITAL</div>'" />
          </a>
          <p style="margin: 15px 0 0 0; color: #f0b90b; font-size: 14px; letter-spacing: 1px; font-weight: bold;">eTORO TRUST CAPITAL</p>
        </div>
        
        <!-- White Content Area -->
        <div style="padding: 30px 20px; color: #333; background-color: #ffffff;">
          <h2 style="color: #0f172a; margin: 0 0 15px 0;">Deposit Request Received</h2>
          <p style="line-height: 1.8; margin: 0 0 15px 0;">Hello ${testName},</p>
          <p style="line-height: 1.8; margin: 0 0 20px 0;">We have received your deposit request. It is currently <strong>Pending</strong> waiting for blockchain confirmation and admin approval.</p>
          
          <table style="width: 100%; border-collapse: collapse; margin: 25px 0;">
            <tr style="border-bottom: 1px solid #eee;">
              <td style="padding: 12px; font-weight: bold; color: #0f172a; background-color: #f9f9f9; width: 40%;">Amount:</td>
              <td style="padding: 12px; color: #333;">$${testAmount}</td>
            </tr>
            <tr style="border-bottom: 1px solid #eee;">
              <td style="padding: 12px; font-weight: bold; color: #0f172a; background-color: #f9f9f9;">Method:</td>
              <td style="padding: 12px; color: #333;">${testMethod} ${testCurrency ? `(${testCurrency})` : ''}</td>
            </tr>
            <tr style="border-bottom: 1px solid #eee;">
              <td style="padding: 12px; font-weight: bold; color: #0f172a; background-color: #f9f9f9;">Transaction Hash:</td>
              <td style="padding: 12px; color: #333;"><small>${testTxHash.substring(0, 20)}...</small></td>
            </tr>
            <tr>
              <td style="padding: 12px; font-weight: bold; color: #0f172a; background-color: #f9f9f9;">Status:</td>
              <td style="padding: 12px; color: #f0b90b; font-weight: bold;">Pending</td>
            </tr>
          </table>
          
          <p style="line-height: 1.8; margin: 0 0 20px 0;">You will receive another email once your deposit is approved.</p>
          
          <center style="margin-top: 25px;">
            <a href="${SITE_URL}/dashboard" style="display: inline-block; padding: 12px 30px; background-color: #f0b90b; color: #000; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 14px;">Check Deposit Status</a>
          </center>
        </div>
        
        <!-- Footer -->
        <div style="background-color: #f5f5f5; color: #666; padding: 20px; text-align: center; font-size: 12px; border-top: 1px solid #ddd;">
          <p style="margin: 0 0 5px 0;">&copy; ${new Date().getFullYear()} eToro Trust Capital. All rights reserved.</p>
          <p style="margin: 0;">This is an automated message, please do not reply.</p>
        </div>
      </div>
    </body>
    </html>
    `;

    const result = await sendTransactionalEmail({
      to: email,
      toName: testName,
      subject: 'Test: Deposit Confirmation - eToro Trust Capital',
      html: addEmailTranslationFeature(html)
    });

    if (result.sent) {
      return res.json({ 
        success: true, 
        message: `Test deposit email sent to ${email}`,
        details: {
          recipient: email,
          name: testName,
          amount: testAmount,
          method: testMethod
        }
      });
    }
    return res.status(500).json({ error: 'Failed to send test email' });
  } catch (error) {
    console.error('Test email error:', error);
    return res.status(500).json({ error: error.message || 'Failed to send test email' });
  }
});

// Admin: Approve investment (server-side email, idempotent)
app.post('/api/admin/investments/approve', async (req, res) => {
  try {
    const { investmentId } = req.body || {};
    if (!investmentId) return res.status(400).json({ error: 'investmentId is required' });

    // Fetch investment
    const { data: investment, error: invError } = await supabase
      .from('investments')
      .select('*')
      .eq('id', investmentId)
      .single();

    if (invError) {
      console.error('❌ fetch investment error:', invError);
      return res.status(500).json({ error: 'Failed to fetch investment' });
    }

    if (!investment) return res.status(404).json({ error: 'Investment not found' });

    const statusLower = (investment.status || '').toLowerCase();
    const authLower = (investment.authStatus || investment.authstatus || '').toLowerCase();
    if (statusLower === 'active' || authLower === 'approved') {
      return res.json({ success: true, alreadyApproved: true, investment });
    }

    const startDate = new Date().toISOString();

    // Update investment atomically to Active/approved with start_date/authstatus columns
    const { data: updated, error: updateError } = await supabase
      .from('investments')
      .update({ status: 'Active', authStatus: 'approved', startDate: startDate })
      .eq('id', investmentId)
      .select()
      .single();

    if (updateError) {
      console.error('❌ update investment error:', updateError);
      return res.status(500).json({ error: 'Failed to approve investment' });
    }

    // Fetch user for email + notification
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('idnum, email, userName, name')
      .eq('idnum', updated.idnum)
      .single();

    if (userError) {
      console.error('❌ fetch user for investment approval error:', userError);
      return res.status(500).json({ error: 'Failed to fetch user for approval' });
    }

    // Idempotent notification insert
    try {
      await supabase.from('notifications').insert({
        idnum: user.idnum,
        title: 'Investment Approved',
        message: `Your investment ${investmentId} in ${updated.plan} is approved.`,
        type: 'success',
        read: false,
        created_at: new Date().toISOString()
      });
    } catch (notifyErr) {
      console.error('⚠️ failed to create notification record:', notifyErr);
    }

    // Send approval email (single)
    const emailDetails = {
      id: investmentId,
      amount: updated.capital,
      plan: updated.plan || 'Investment Plan',
      startDate: updated.start_date || startDate,
      status: updated.status || 'Active'
    };

    const emailSent = await emailService.sendInvestmentApproved(
      user.email,
      user.userName || user.name || user.email,
      emailDetails
    );

    return res.json({ success: true, emailSent, investment: updated });
  } catch (err) {
    console.error('❌ Approve investment handler error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// Admin: Approve withdrawal (backend-driven, idempotent email)
app.post('/api/admin/withdrawals/approve', async (req, res) => {
  try {
    const { withdrawalId } = req.body || {};
    if (!withdrawalId) return res.status(400).json({ error: 'withdrawalId is required' });

    // Fetch withdrawal
    const { data: withdrawal, error: fetchError } = await supabase
      .from('withdrawals')
      .select('*')
      .eq('id', withdrawalId)
      .single();

    if (fetchError || !withdrawal) {
      console.error('❌ fetch withdrawal error:', fetchError);
      return res.status(404).json({ error: 'Withdrawal not found' });
    }

    if (withdrawal.status === 'Approved') {
      return res.json({ success: true, alreadyApproved: true, withdrawal });
    }

    // Update Withdrawal
    const { data: updated, error: updateError } = await supabase
      .from('withdrawals')
      .update({ status: 'Approved', authStatus: 'approved' })
      .eq('id', withdrawalId)
      .select()
      .single();
    
    if (updateError) {
       console.error('❌ update withdrawal error:', updateError);
       return res.status(500).json({ error: 'Failed to approve withdrawal' });
    }
    
    // Fetch user for notification
    const { data: user } = await supabase
      .from('users')
      .select('email, userName, name, idnum')
      .eq('idnum', withdrawal.idnum)
      .single();

    if (user) {
        // Persist Notification
        try {
          await supabase.from('notifications').insert({
              idnum: user.idnum,
              title: 'Withdrawal Approved',
              message: `Your withdrawal of $${Number(withdrawal.amount).toLocaleString()} via ${withdrawal.method} has been approved.`,
              type: 'success',
              read: false, 
              created_at: new Date().toISOString()
          });
        } catch (nErr) {
          console.warn('⚠️ Notification insert failed', nErr);
        }

        // Send Email
        const destination = withdrawal.wallet || withdrawal.walletAddress || withdrawal.bankName || withdrawal.accountNumber || 'N/A';
        await emailService.sendWithdrawalApproved(
             user.email,
             user.userName || user.name || 'User',
             withdrawal.amount,
             withdrawal.method,
             destination
        );
        console.log(`✅ Withdrawal ${withdrawalId} approved, email sent to ${user.email}`);
    }

    return res.json({ success: true, withdrawal: updated });
  } catch (err) {
    console.error('❌ Withdrawal approval error:', err);
    return res.status(500).json({ error: 'Server error approving withdrawal' });
  }
});

// rate limiter for contact endpoint
const contactLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 12, standardHeaders: true, legacyHeaders: false });

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString(), supabase_mode: !!(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) });
});

// POST /api/contact - store contact message in Supabase 'contacts' table
app.post('/api/contact', contactLimiter, async (req, res) => {
  try {
    const { name, email, subject, message, hp, recaptcha } = req.body || {};

    // Honeypot anti-bot field — should be empty for human users
    if (hp) return res.status(400).json({ error: 'Spam detected' });

    if (!email || !message) {
      return res.status(400).json({ error: 'Missing required fields: email and message' });
    }

    // Optional reCAPTCHA verification if server is configured with RECAPTCHA_SECRET
    if (RECAPTCHA_SECRET) {
      if (!recaptcha) return res.status(400).json({ error: 'Missing recaptcha token' });
      try {
        const verifyUrl = `https://www.google.com/recaptcha/api/siteverify?secret=${encodeURIComponent(RECAPTCHA_SECRET)}&response=${encodeURIComponent(recaptcha)}`;
        const r = await fetch(verifyUrl, { method: 'POST' });
        const json = await r.json();
        if (!json.success) return res.status(400).json({ error: 'recaptcha verification failed' });
      } catch (e) {
        console.warn('recaptcha verification error', e?.message || e);
        return res.status(500).json({ error: 'recaptcha verification failed' });
      }
    }

    const payload = {
      name: name || null,
      email,
      subject: subject || null,
      message,
      created_at: new Date().toISOString()
    };

    const { data, error } = await supabase.from('contacts').insert(payload).select();

    if (error) {
      console.error('Supabase insert error:', error);
      return res.status(500).json({ error: 'Failed to store contact message' });
    }

    // Optionally, send a notification email to the system support address (if configured)
    const SUPPORT_EMAIL = process.env.CONTACT_NOTIFICATION_EMAIL || process.env.SUPPORT_EMAIL || null;
    if (SUPPORT_EMAIL) {
      try {
        const result = await sendTransactionalEmail({
          to: SUPPORT_EMAIL,
          toName: 'Support',
          subject: `New Contact Message: ${subject || '(no subject)'}`,
          text: `Name: ${name || 'N/A'}\nEmail: ${email}\nSubject: ${subject || 'N/A'}\nMessage:\n${message}`,
          html: `<p><strong>Name:</strong> ${name || 'N/A'}</p><p><strong>Email:</strong> ${email}</p><p><strong>Subject:</strong> ${subject || 'N/A'}</p><p><strong>Message:</strong><br/>${message}</p>`,
          replyToEmail: email,
          replyToName: name || email,
        });

        if (result.sent) {
          console.log(`Contact email sent to support via ${result.provider}:`, SUPPORT_EMAIL);
        } else {
          console.log('Support email set but no email provider configured; contact notification:', SUPPORT_EMAIL);
        }
      } catch (mailErr) {
        console.error('Failed to send contact notification email:', mailErr);
      }
    }

    return res.status(201).json({ saved: true, record: data && data[0] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/signup (server-side signup using service_role)
app.post('/api/signup', async (req, res) => {
  // ... existing signup handler ...
});

// POST /api/send-email - send arbitrary email using the configured provider
app.post('/api/send-email', async (req, res) => {
  try {
    const { to, subject, html } = req.body || {};
    console.log('📧 /api/send-email - Received request:', { to, subject: subject?.substring(0, 50) });
    
    if (!to || !subject || !html) {
      console.error('❌ Missing required fields:', { to: !!to, subject: !!subject, html: !!html });
      return res.status(400).json({ error: 'Missing required fields: to, subject, html' });
    }

    const result = await sendTransactionalEmail({ to, subject, html: addEmailTranslationFeature(html) });
    if (result.sent) {
      console.log(`✅ ${result.provider} send successful:`, {
        to,
        messageId: result.messageId
      });
      return res.json({ sent: true, provider: result.provider, messageId: result.messageId });
    }

    return res.status(400).json({ error: 'No mail provider configured (TurboSMTP / SMTP)' });
  } catch (err) {
    console.error('❌ Send email error:', {
      message: err.message,
      fullError: JSON.stringify(err, null, 2)
    });
    return res.status(500).json({ 
      error: 'Failed to send email',
      details: err.message 
    });
  }
});

// POST /api/admin/create-user
app.post('/api/admin/create-user', async (req, res) => {
  try {
    const { email, password, full_name, username } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'email and password are required' });

    // Create user using admin createUser
    const { data: userData, error: createError } = await supabase.auth.admin.createUser({
      email,
      password,
      user_metadata: { full_name: full_name || null, username: username || null }
    });

    if (createError) {
      console.error('createUser error:', createError);
      return res.status(500).json({ error: 'Failed to create user' });
    }

    // Optionally create a profile row if you use public.profiles
    try {
      const profile = {
        id: userData.user.id,
        username: username || null,
        full_name: full_name || null
      };
      await supabase.from('profiles').insert(profile);
    } catch (e) {
      // profile creation failure is non-fatal; log and continue
      console.warn('profile insert failed:', e.message || e);
    }

    return res.status(201).json({ created: true, user: userData.user });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/login — server-side sign-in and session return
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'email and password are required' });

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      console.error('login error', error);
      return res.status(401).json({ error: error.message || 'Invalid credentials' });
    }

    // Set httpOnly cookies for access & refresh tokens to improve security.
    const session = data.session || {};
    const accessToken = session.access_token;
    const refreshToken = session.refresh_token;
    const expiresIn = session.expires_in || 3600;

    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: expiresIn * 1000
    };

    if (accessToken) res.cookie('sv_access', accessToken, cookieOptions);
    if (refreshToken) res.cookie('sv_refresh', refreshToken, cookieOptions);

    // Also return session object to the client for demo; production should rely on cookies.
    return res.json({ session, user: data.user });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/logout — clears server cookies
app.post('/api/logout', (req, res) => {
  res.clearCookie('sv_access');
  res.clearCookie('sv_refresh');
  return res.json({ logged_out: true });
});

// POST /api/credit-daily-roi — credits daily ROI to active investments
app.post('/api/credit-daily-roi', async (req, res) => {
  try {
    // Investment plan configurations (should match the ones in planConfig.ts)
    const PLAN_CONFIG = {
      '3-Day Plan': { durationDays: 3, dailyRate: 0.02, bonus: 0.05 },
      '7-Day Plan': { durationDays: 7, dailyRate: 0.025, bonus: 0.075 },
      '12-Day Plan': { durationDays: 12, dailyRate: 0.03, bonus: 0.09 },
      '15-Day Plan': { durationDays: 15, dailyRate: 0.035, bonus: 0.105 },
      '3-Month Plan': { durationDays: 90, dailyRate: 0.04, bonus: 0.12 },
      '6-Month Plan': { durationDays: 180, dailyRate: 0.045, bonus: 0.135 }
    };

    // Get all active investments
    const { data: activeInvestments, error: invError } = await supabase
      .from('investments')
      .select('*')
      .eq('status', 'Active')
      .or('authStatus.is.null,authStatus.eq.approved');

    if (invError) {
      console.error('Error fetching active investments:', invError);
      return res.status(500).json({ error: 'Failed to fetch investments' });
    }

    if (!activeInvestments || activeInvestments.length === 0) {
      return res.json({ message: 'No active investments found to credit ROI', processed: 0 });
    }

    let processed = 0;
    let completed = 0;

    for (const investment of activeInvestments) {
      try {
        const planConfig = PLAN_CONFIG[investment.plan];
        if (!planConfig) {
          console.warn(`Unknown plan: ${investment.plan} for investment ${investment.id}`);
          continue;
        }

        // Calculate daily ROI amount
        const dailyRoiAmount = investment.capital * planConfig.dailyRate;

        // Check if investment is still within duration
        // Use startDate (approval date) if available, otherwise fall back to creation date
        const startDate = investment.startDate ? new Date(investment.startDate) : new Date(investment.date);
        const now = new Date();
        const daysElapsed = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));

        // Check if we already credited ROI today (compare dates)
        // Use startDate as baseline for crediting, not creation date
        const investmentStartDate = investment.startDate ? new Date(investment.startDate) : new Date(investment.date);
        const lastCreditDate = investment.updated_at ? new Date(investment.updated_at) : investmentStartDate;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const lastCreditDay = new Date(lastCreditDate);
        lastCreditDay.setHours(0, 0, 0, 0);

        if (lastCreditDay >= today) {
          console.log(`ROI already credited today for investment ${investment.id}`);
          continue;
        }

        if (daysElapsed >= planConfig.durationDays) {
          // Investment completed - credit all remaining ROI plus final bonus
          const totalExpectedRoi = investment.capital * planConfig.dailyRate * planConfig.durationDays;
          const remainingRoi = totalExpectedRoi - (investment.creditedRoi || 0);
          const finalBonus = investment.capital * planConfig.bonus;

          // Update investment as completed
          await supabase
            .from('investments')
            .update({
              status: 'completed',
              creditedRoi: totalExpectedRoi,
              creditedBonus: finalBonus,
              updated_at: new Date().toISOString()
            })
            .eq('id', investment.id);

          // Credit remaining ROI and bonus to user's balance
          const { data: userData } = await supabase
            .from('users')
            .select('balance, bonus')
            .eq('idnum', investment.idnum)
            .single();

          if (userData) {
            const newBalance = (userData.balance || 0) + remainingRoi;
            const newBonus = (userData.bonus || 0) + finalBonus;

            await supabase
              .from('users')
              .update({
                balance: newBalance,
                bonus: newBonus,
                updated_at: new Date().toISOString()
              })
              .eq('idnum', investment.idnum);
          }

          console.log(`Completed investment ${investment.id}: Credited remaining ROI $${remainingRoi.toFixed(2)} and final bonus $${finalBonus.toFixed(2)}`);
          completed++;
        } else {
          // Credit daily ROI for active investment
          await supabase
            .from('investments')
            .update({
              creditedRoi: (investment.creditedRoi || 0) + dailyRoiAmount,
              updated_at: new Date().toISOString()
            })
            .eq('id', investment.id);

          // Credit daily ROI to user's balance
          const { data: userData } = await supabase
            .from('users')
            .select('balance')
            .eq('idnum', investment.idnum)
            .single();

          if (userData) {
            const newBalance = (userData.balance || 0) + dailyRoiAmount;
            await supabase
              .from('users')
              .update({
                balance: newBalance,
                updated_at: new Date().toISOString()
              })
              .eq('idnum', investment.idnum);
          }

          console.log(`Credited $${dailyRoiAmount.toFixed(2)} daily ROI for investment ${investment.id} (${investment.plan})`);
        }

        processed++;

      } catch (invProcessError) {
        console.error(`Error processing investment ${investment.id}:`, invProcessError);
      }
    }

    return res.json({
      message: `Daily ROI crediting completed`,
      processed,
      completed,
      totalInvestments: activeInvestments.length
    });

  } catch (err) {
    console.error('Daily ROI crediting error:', err);
    return res.status(500).json({ error: 'Server error during ROI crediting' });
  }
});

// GET /api/scheduler/status — check scheduler status
app.get('/api/scheduler/status', (req, res) => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(503).json({ 
      status: 'disabled',
      reason: 'Supabase not configured'
    });
  }
  
  return res.json({
    status: 'enabled',
    message: 'Daily ROI scheduler is running',
    schedule: 'Every day at 12:00 AM (midnight) UTC',
    note: 'Server must remain running for scheduler to work'
  });
});

// ========== INVESTMENT PENDING NOTIFICATION ENDPOINT ==========
app.post('/api/investments/pending-notification', async (req, res) => {
  console.log('\n🔵 [ENDPOINT CALLED] /api/investments/pending-notification');
  console.log('Method:', req.method);
  console.log('Body received:', JSON.stringify(req.body, null, 2));

  if (req.method !== 'POST') {
    console.error('❌ Invalid method:', req.method);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { investmentId, userId, userEmail, plan, amount, userName, dailyRoiRate, duration } = req.body;

    console.log('\n📋 Validating input data:');
    console.log('  ✓ investmentId:', investmentId ? '✅' : '❌');
    console.log('  ✓ userId:', userId ? '✅' : '❌');
    console.log('  ✓ userEmail:', userEmail ? '✅' : '❌');
    console.log('  ✓ plan:', plan ? '✅' : '❌');
    console.log('  ✓ amount:', amount ? '✅' : '❌');

    const providerStatus = getEmailProviderStatus();
    console.log('\n🔐 Checking email provider:');
    console.log('  Requested Provider:', providerStatus.requestedProvider);
    console.log('  Active Provider:', providerStatus.activeProvider || 'none');
    console.log('  Brevo Configured:', providerStatus.hasBrevo ? '✅ Yes' : '❌ No');
    console.log('  Mailjet Configured:', providerStatus.hasMailjet ? '✅ Yes' : '❌ No');
    console.log('  SMTP Configured:', providerStatus.hasSmtp ? '✅ Yes' : '❌ No');

    if (!providerStatus.activeProvider) {
      console.error('❌ No email provider configured - CANNOT SEND EMAIL');
      return res.status(500).json({ 
        error: 'Email service not configured',
        details: 'Configure TurboSMTP SMTP credentials'
      });
    }

    // Validate minimum required fields
    if (!investmentId || !userId) {
      console.error('❌ Missing critical fields: investmentId or userId');
      return res.status(400).json({
        error: 'Missing required fields: investmentId, userId'
      });
    }

    if (!userEmail) {
      console.error('❌ Missing userEmail - cannot send email');
      return res.status(400).json({
        error: 'Missing userEmail'
      });
    }

    if (!plan || !amount) {
      console.error('❌ Missing investment details: plan or amount');
      return res.status(400).json({
        error: 'Missing investment details'
      });
    }

    // Prepare email data
    const finalUserName = userName || 'Valued Member';
    const finalAmount = parseFloat(amount) || 0;
    const finalPlan = plan || 'Investment Plan';
    const finalRoi = parseFloat(dailyRoiRate) || 0;
    const finalDuration = parseInt(duration) || 0;

    const dailyRoiAmount = (finalAmount * finalRoi).toFixed(2);
    const totalReturn = (finalAmount * finalRoi * finalDuration).toFixed(2);

    console.log('\n✉️  Email data prepared:');
    console.log('  To:', userEmail);
    console.log('  User:', finalUserName);
    console.log('  Plan:', finalPlan);
    console.log('  Amount: $' + finalAmount);
    console.log('  Daily ROI: $' + dailyRoiAmount);

    // Create email HTML
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Investment Pending</title>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; background-color: #ffffff; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 20px auto; background: #ffffff; border-radius: 8px; box-shadow: 0 0 10px rgba(0,0,0,0.1); overflow: hidden; }
    .header { background: #ffffff; color: #0f172a; padding: 30px 20px; text-align: center; }
    .header h1 { margin: 0; font-size: 28px; }
    .content { padding: 30px; }
    .info-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    .info-table tr td { padding: 12px; border-bottom: 1px solid #eee; }
    .info-table tr td:first-child { font-weight: bold; width: 40%; background: #f9f9f9; }
    .highlight { color: #0f172a; font-weight: bold; font-size: 16px; }
    .button { display: inline-block; padding: 12px 30px; background: #f0b90b; color: #000; text-decoration: none; border-radius: 5px; font-weight: bold; margin: 20px 0; }
    .footer { background: #f4f4f4; color: #666; padding: 20px; text-align: center; font-size: 12px; border-top: 1px solid #ddd; }
    .badge { display: inline-block; background: #fbbf24; color: #000; padding: 5px 15px; border-radius: 20px; font-weight: bold; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2 style="margin: 0; color: #f0b90b;">⏳ Investment Received</h2>
    </div>
    <div class="content">
      <p>Hello <strong>${finalUserName}</strong>,</p>
      <p>Thank you for your investment submission! Your <strong>${finalPlan}</strong> investment has been received and is now <span class="badge">PENDING REVIEW</span>.</p>
      
      <h3 style="color: #0f172a; border-bottom: 2px solid #f0b90b; padding-bottom: 10px;">Investment Details</h3>
      <table class="info-table">
        <tr>
          <td>Plan</td>
          <td><strong>${finalPlan}</strong></td>
        </tr>
        <tr>
          <td>Amount</td>
          <td class="highlight">$${finalAmount.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
        </tr>
        <tr>
          <td>Daily ROI</td>
          <td><strong>${(finalRoi * 100).toFixed(2)}%</strong></td>
        </tr>
        <tr>
          <td>Daily Return</td>
          <td class="highlight">$${dailyRoiAmount}</td>
        </tr>
        <tr>
          <td>Duration</td>
          <td><strong>${finalDuration} days</strong></td>
        </tr>
        <tr>
          <td>Total Expected Return</td>
          <td class="highlight">$${totalReturn}</td>
        </tr>
      </table>

      <p><strong>What's Next?</strong></p>
      <ul>
        <li>Our team will review your investment request</li>
        <li>You'll receive an approval email shortly</li>
        <li>Returns begin accruing immediately upon approval</li>
      </ul>

      <div style="text-align: center;">
        <a href="${SITE_URL}/dashboard" class="button">View Dashboard</a>
      </div>
    </div>
    <div class="footer">
      <p>&copy; ${new Date().getFullYear()} eToro Trust Capital. All rights reserved.</p>
      <p>This is an automated message. Please do not reply.</p>
    </div>
  </div>
</body>
</html>`;

    console.log(`\n📤 Sending pending-investment email via ${providerStatus.activeProvider}...`);
    const result = await sendTransactionalEmail({
      to: userEmail,
      toName: finalUserName,
      subject: '⏳ Investment Received - Pending Review',
      html,
    });

    if (!result.sent) {
      throw new Error('No active email provider could send the pending investment email');
    }

    console.log('\n✅ EMAIL SENT SUCCESSFULLY!');
    console.log('  Provider:', result.provider);
    console.log('  Message ID:', result.messageId);
    console.log('  To:', userEmail);

    return res.status(200).json({
      success: true,
      message: 'Investment notification email sent successfully',
      messageId: result.messageId,
      provider: result.provider,
      emailSent: true
    });

  } catch (error) {
    console.error('\n❌ ERROR IN ENDPOINT:', error.message);
    console.error('Full error:', error);
    
    return res.status(500).json({
      success: false,
      error: 'Failed to send email',
      message: error.message
    });
  }
});
// ========== END INVESTMENT PENDING NOTIFICATION ENDPOINT ==========

// POST /api/investments/create — Create a new investment from user's balance
app.post('/api/investments/create', async (req, res) => {
  try {
    const { userId, planId, planName, amount, roi, durationDays, status } = req.body || {};

    console.log('\n🔵 [ENDPOINT CALLED] /api/investments/create');
    console.log('Body received:', { userId, planId, planName, amount, roi, durationDays, status });

    // Validate required fields
    if (!userId || !planId || !planName || !amount || roi === undefined || !durationDays) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Fetch user to verify balance
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('idnum, balance, email, userName, name')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      console.error('❌ User not found:', userError);
      return res.status(404).json({ error: 'User not found' });
    }

    const userBalance = user.balance || 0;
    const investmentAmount = parseFloat(amount);

    // Verify sufficient balance
    if (investmentAmount > userBalance) {
      return res.status(400).json({ 
        error: 'Insufficient balance',
        available: userBalance,
        requested: investmentAmount
      });
    }

    // Deduct investment amount from user balance
    const newBalance = userBalance - investmentAmount;
    await supabase
      .from('users')
      .update({ balance: newBalance })
      .eq('id', userId);

    // Create investment record
    const investmentRecord = {
      idnum: user.idnum,
      userId: userId,
      plan: planName,
      planId: planId,
      capital: investmentAmount,
      roi: roi,
      durationDays: durationDays,
      status: status || 'pending',
      authStatus: 'pending',
      creditedRoi: 0,
      creditedBonus: 0,
      date: new Date().toISOString(),
      created_at: new Date().toISOString()
    };

    const { data: investment, error: investError } = await supabase
      .from('investments')
      .insert(investmentRecord)
      .select()
      .single();

    if (investError) {
      console.error('❌ Investment creation error:', investError);
      
      // Refund balance if investment creation failed
      await supabase
        .from('users')
        .update({ balance: userBalance })
        .eq('id', userId);
      
      return res.status(500).json({ error: 'Failed to create investment' });
    }

    // Create notification for admin
    try {
      const adminNotificationSent = await sendAdminActivityEmail({
        subject: 'New Investment Request',
        heading: 'New Investment Pending Approval',
        rows: [
          { label: 'User', value: user.userName || user.name || user.email },
          { label: 'Email', value: user.email },
          { label: 'Plan', value: planName },
          { label: 'Amount', value: `$${investmentAmount.toFixed(2)}` },
          { label: 'ROI', value: `${roi}%` },
          { label: 'Duration', value: `${durationDays} days` },
          { label: 'Investment ID', value: investment.id }
        ]
      });
      console.log('Admin notification sent:', adminNotificationSent);
    } catch (adminNotifyErr) {
      console.warn('⚠️ Failed to send admin notification:', adminNotifyErr);
    }

    // Send confirmation email to user
    try {
      const expectedReturn = (investmentAmount * roi / 100).toFixed(2);
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #0f172a; border-bottom: 2px solid #f0b90b; padding-bottom: 10px;">Investment Request Received</h2>
          <p>Hi ${user.userName || user.name || 'User'},</p>
          <p>Your investment request has been received and is pending approval. Here are the details:</p>
          
          <table style="width: 100%; border-collapse: collapse; margin: 20px 0; border: 1px solid #e5e7eb;">
            <tr style="background: #f3f4f6; border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 12px; font-weight: bold; color: #0f172a;">Plan</td>
              <td style="padding: 12px; color: #0f172a;">${planName}</td>
            </tr>
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 12px; font-weight: bold; color: #0f172a;">Investment Amount</td>
              <td style="padding: 12px; color: #f0b90b; font-weight: bold;">$${investmentAmount.toFixed(2)}</td>
            </tr>
            <tr style="background: #f3f4f6; border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 12px; font-weight: bold; color: #0f172a;">ROI Rate</td>
              <td style="padding: 12px; color: #0f172a;">${roi}%</td>
            </tr>
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 12px; font-weight: bold; color: #0f172a;">Expected Return</td>
              <td style="padding: 12px; color: #10b981; font-weight: bold;">$${expectedReturn}</td>
            </tr>
            <tr style="background: #f3f4f6;">
              <td style="padding: 12px; font-weight: bold; color: #0f172a;">Duration</td>
              <td style="padding: 12px; color: #0f172a;">${durationDays} days</td>
            </tr>
          </table>
          
          <p>Our team will review your investment and send you an approval email shortly. Returns will begin accruing immediately upon approval.</p>
          
          <p>Questions? Contact our support team.</p>
          
          <p style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; color: #64748b; font-size: 12px;">
            © ${new Date().getFullYear()} eToro Trust Capital. All rights reserved.
          </p>
        </div>
      `;

      const emailSent = await sendTransactionalEmail({
        to: user.email,
        toName: user.userName || user.name || 'User',
        subject: 'Investment Request Received',
        html: addEmailTranslationFeature(html)
      });

      console.log('User confirmation email sent:', emailSent);
    } catch (emailErr) {
      console.warn('⚠️ Failed to send user confirmation email:', emailErr);
    }

    console.log(`✅ Investment created: ID=${investment.id}, Amount=$${investmentAmount}, User=${user.email}`);

    return res.status(201).json({
      success: true,
      message: 'Investment created successfully',
      investment: {
        id: investment.id,
        plan: planName,
        amount: investmentAmount,
        roi: roi,
        status: investment.status,
        newBalance: newBalance
      }
    });

  } catch (err) {
    console.error('❌ Investment creation error:', err);
    return res.status(500).json({ 
      error: 'Server error creating investment',
      message: err.message
    });
  }
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
    
    // Initialize the daily ROI scheduler
    if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
      console.log('\n');
      initScheduler();
    } else {
      console.warn('⚠️  Supabase not configured. Daily ROI scheduler will not start.');
    }
  });
}

module.exports = app;


import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';
import { initScheduler } from './scheduler.js';
import emailService from './emailService.js';
import { getEmailProviderStatus, sendTransactionalEmail } from './mailProvider.js';
import handleDepositApproval from './deposits/approve.js';
import handleInvestmentPending from './investments/pending.js';
import handleInvestmentPendingNotification from './investments/pending-notification.js';
import handleSendPendingNotification from './investments/send-pending-notification.js';

dotenv.config();

const PORT = process.env.PORT || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RECAPTCHA_SECRET = process.env.RECAPTCHA_SECRET || '';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || process.env.EMAIL_REPLY_TO || process.env.EMAIL_FROM || 'noreply@etorocapital.online';
const SITE_URL = (process.env.EMAIL_SITE_URL || process.env.VITE_APP_URL || `https://${process.env.APP_DOMAIN || 'etorocapitalinvestment.vercel.app'}`).replace(/\/$/, '');
const EMAIL_LOGO_PATH = '/images/email-logo.png';
const LOGO_IMAGE = process.env.EMAIL_LOGO_URL || `${SITE_URL}${EMAIL_LOGO_PATH}`;
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
    <div style="padding:24px; border-bottom:3px solid #f0b90b; text-align:center;">
      <a href="${SITE_URL}" target="_blank" style="display:inline-block; text-decoration:none; margin-bottom:14px;">
        <img src="${LOGO_IMAGE}" alt="eToro Trust Capital" width="180" style="display:block; max-width:180px; height:auto; border:0;" />
      </a>
      <h2 style="margin:0; color:#0f172a;">${heading}</h2>
    </div>
    <div style="padding:24px;">
      <p style="margin:0 0 16px; color:#475569;">A user activity needs admin review.</p>
      <table style="width:100%; border-collapse:collapse; border:1px solid #e5e7eb;">
        ${htmlRows}
      </table>
      <p style="margin:20px 0 0;"><a href="${(process.env.VITE_APP_URL || '').replace(/\/$/, '')}/dashboard/admin" style="display:inline-block; background:#f0b90b; color:#000; text-decoration:none; padding:10px 16px; border-radius:6px; font-weight:700;">Open Admin Dashboard</a></p>
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

  const sent = await emailService.sendDepositRequest(userEmail, userName, amount, method, currency, txHash, proofUrl);
  if (sent) return res.json({ success: true });
  return res.status(500).json({ error: 'Failed to send deposit request email' });
});

// 3. Deposit Status Update
app.post('/api/notify/deposit-status', async (req, res) => {
  const { userEmail, userName, amount, status, reason } = req.body;
  if (!userEmail || !status) return res.status(400).json({ error: 'Missing details' });

  const sent = await emailService.sendDepositStatus(userEmail, userName, amount, status, reason);
  if (sent) return res.json({ success: true });
  return res.status(500).json({ error: 'Failed to send deposit status email' });
});

// 4. Withdrawal Request
app.post('/api/notify/withdrawal-request', async (req, res) => {
  const { userEmail, userName, amount, method, wallet } = req.body;
  
  const sent = await emailService.sendWithdrawalRequest(userEmail, userName, amount, method, wallet);
  if (sent) return res.json({ success: true });
  return res.status(500).json({ error: 'Failed to send withdrawal request email' });
});

// 5. Withdrawal Status
app.post('/api/notify/withdrawal-status', async (req, res) => {
  const { userEmail, userName, amount, status, reason } = req.body;
  
  const sent = await emailService.sendWithdrawalStatus(userEmail, userName, amount, status, reason);
  if (sent) return res.json({ success: true });
  return res.status(500).json({ error: 'Failed to send withdrawal status email' });
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

// Admin: Approve investment (backend-driven, idempotent email)
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
    const authLower = (investment.authStatus || '').toLowerCase();
    if (statusLower === 'active' || authLower === 'approved') {
      return res.json({ success: true, alreadyApproved: true, investment });
    }

    const startDate = new Date().toISOString();

    // Update to Active + approved 
    // Note: Supabase converts camelCase to snake_case for unquoted columns
    console.log('📝 Attempting investment update for:', investmentId);
    const { data: updated, error: updateError } = await supabase
      .from('investments')
      .update({ 
        status: 'Active', 
        'authStatus': 'approved',  // Quoted to preserve camelCase
        'startDate': startDate     // Quoted to preserve camelCase
      })
      .eq('id', investmentId)
      .select()
      .single();

    if (updateError) {
      console.error('❌ update investment error:', JSON.stringify(updateError, null, 2));
      console.error('Update payload:', { status: 'Active', authStatus: 'approved', startDate });
      return res.status(500).json({ error: 'Failed to approve investment', details: updateError?.message });
    }

    // Fetch user for notification + email
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('idnum, email, userName, name')
      .eq('idnum', updated.idnum)
      .single();

    if (userError) {
      console.error('❌ fetch user for investment approval error:', userError);
      return res.status(500).json({ error: 'Failed to fetch user for approval' });
    }

    // Persist in-app notification (best-effort)
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
      console.error('⚠️ notification insert failed:', notifyErr);
    }

    // Send approval email (idempotent guard handled by status check above)
    const emailDetails = {
      id: investmentId,
      amount: updated.capital,
      plan: updated.plan || 'Investment Plan',
      startDate: updated.startDate || startDate,
      status: updated.status || 'Active'
    };

    try {
      const emailSent = await emailService.sendInvestmentApproved(
        user.email,
        user.userName || user.name || user.email,
        emailDetails
      );
      console.log('✅ Investment approval email sent:', emailSent);
      return res.json({ success: true, emailSent, investment: updated });
    } catch (emailErr) {
      console.error('⚠️ Email send error:', emailErr.message || emailErr);
      // Still return success even if email fails, the investment is already approved
      return res.json({ success: true, emailSent: false, investment: updated, emailError: emailErr.message });
    }
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

// 6. Admin: Approve deposit (status update)
app.post('/api/admin/deposits/approve', async (req, res) => {
  try {
    const { depositId } = req.body || {};
    if (!depositId) return res.status(400).json({ error: 'depositId is required' });

    // Fetch deposit
    const { data: deposit, error: fetchError } = await supabase
      .from('deposits')
      .select('*')
      .eq('id', depositId)
      .single();

    if (fetchError || !deposit) {
      console.error('❌ fetch deposit error:', fetchError);
      return res.status(404).json({ error: 'Deposit not found' });
    }

    if (deposit.status === 'Approved') {
      return res.json({ success: true, alreadyApproved: true, deposit });
    }

    // Update Deposit
    const { data: updated, error: updateError } = await supabase
      .from('deposits')
      .update({ status: 'Approved', authStatus: 'approved' })
      .eq('id', depositId)
      .select()
      .single();
    
    if (updateError) {
       console.error('❌ update deposit error:', updateError);
       return res.status(500).json({ error: 'Failed to approve deposit' });
    }
    
    // Fetch user for notification
    const { data: user } = await supabase
      .from('users')
      .select('email, userName, name, idnum')
      .eq('idnum', deposit.idnum)
      .single();

    if (user) {
        // Persist Notification
        try {
          await supabase.from('notifications').insert({
              idnum: user.idnum,
              title: 'Deposit Approved',
              message: `Your deposit of $${Number(deposit.amount).toLocaleString()} has been approved and credited to your balance.`,
              type: 'success',
              read: false, 
              created_at: new Date().toISOString()
          });
        } catch (nErr) {
          console.warn('⚠️ Notification insert failed', nErr);
        }

        // Add logging for email notification
        console.log('[DepositEmail] sendDepositStatus will be called with:', {
          userEmail: user.email,
          userName: user.userName || user.name || 'User',
          amount: deposit.amount,
          status: 'approved',
          reason: undefined
        });
        // Send Email
        const emailResult = await emailService.sendDepositStatus(
             user.email,
             user.userName || user.name || 'User',
             deposit.amount,
             'approved',
             undefined
        );
        console.log('[DepositEmail] sendDepositStatus result:', emailResult);
        console.log(`✅ Deposit ${depositId} approved, email sent to ${user.email}`);
    }

    return res.json({ success: true, deposit: updated });
  } catch (err) {
    console.error('❌ Deposit approval error:', err);
    return res.status(500).json({ error: 'Server error approving deposit' });
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
          console.log('Support email set but no email provider configured:', SUPPORT_EMAIL);
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

// POST /api/notify/investment-created
app.post('/api/notify/investment-created', async (req, res) => {
  try {
    const { idnum, plan, capital, roi, duration } = req.body || {};
    if (!idnum || !plan || !capital) return res.status(400).json({ error: 'Missing required fields' });

    // Fetch user email
    const { data: user, error } = await supabase
      .from('users')
      .select('email, userName')
      .eq('idnum', idnum)
      .single();

    if (error || !user || !user.email) {
      console.warn(`User ${idnum} not found or no email for investment notification`);
      return res.status(404).json({ error: 'User not found' });
    }

    // Send investment submitted email
    const sent = await emailService.sendInvestmentSubmitted(
      user.email,
      user.userName || 'Investor',
      plan,
      capital,
      roi,
      duration
    );
    console.log('[InvestmentEmail] sendInvestmentSubmitted result:', sent);
    res.json({ success: sent });
  } catch (err) {
    console.error('❌ Investment created notification error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/send-email - send arbitrary email using TurboSMTP / SMTP
app.post('/api/send-email', async (req, res) => {
  try {
    const { to, subject, html } = req.body || {};
    console.log('\n' + '='.repeat(70));
    console.log('📧 /api/send-email - Email Request Received');
    console.log('='.repeat(70));
    console.log('Details:', { 
      to, 
      subject: subject?.substring(0, 60), 
      htmlLength: html?.length || 0 
    });
    
    if (!to || !subject || !html) {
      console.error('❌ Missing required fields:', { to: !!to, subject: !!subject, html: !!html });
      return res.status(400).json({ error: 'Missing required fields: to, subject, html' });
    }

    const providerStatus = getEmailProviderStatus();
    console.log('Email Provider Config:', providerStatus);

    const result = await sendTransactionalEmail({ to, subject, html: addEmailTranslationFeature(html) });
    if (result.sent) {
      console.log(`✅ ${result.provider} send successful to:`, to);
      console.log('='.repeat(70) + '\n');
      return res.json({ sent: true, provider: result.provider, messageId: result.messageId });
    }

    console.error('❌ No email provider configured!');
    console.log('='.repeat(70) + '\n');
    return res.status(400).json({ error: 'No mail provider configured (TurboSMTP / SMTP)' });
  } catch (err) {
    console.error('❌ Email Send Error:', {
      message: err.message,
      fullError: err.message
    });
    console.log('='.repeat(70) + '\n');
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

// ========== ISOLATED EMAIL ENDPOINTS ==========
app.post('/api/deposits/approve', handleDepositApproval);
app.post('/api/investments/pending', handleInvestmentPending);
app.post('/api/investments/pending-notification', handleInvestmentPendingNotification);
app.post('/api/investments/send-pending-notification', handleSendPendingNotification);
// ========== END ISOLATED EMAIL ENDPOINTS ==========

if (process.argv[1] === fileURLToPath(import.meta.url)) {
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

export default app;

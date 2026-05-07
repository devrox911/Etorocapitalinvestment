
const DEFAULT_SITE_URL = 'https://etorocapitalinvestment.vercel.app';
const SITE_URL = (process.env.EMAIL_SITE_URL || process.env.VITE_APP_URL || `https://${process.env.APP_DOMAIN || 'etorocapitalinvestment.vercel.app'}` || DEFAULT_SITE_URL).replace(/\/$/, '');
const EMAIL_LOGO_PATH = '/images/email-logo.png';
const LOGO_BASE64 = require('fs').readFileSync(__dirname + '/emaillogo-base64.js', 'utf-8').trim();
const LOGO_IMAGE = process.env.EMAIL_LOGO_URL || LOGO_BASE64;
const GOOGLE_TRANSLATE_URL = 'https://translate.google.com/?sl=en&tl=auto&op=translate';

const styles = `
  body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; background-color: #f5f5f5; margin: 0; padding: 0; }
  .container { max-width: 600px; margin: 20px auto; background: #ffffff; border-radius: 8px; overflow: hidden; border: 1px solid #ddd; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
  .header { background: linear-gradient(135deg, #0f172a 0%, #1a202c 100%); color: #ffffff; padding: 50px 20px; text-align: center; }
  .header img { max-width: 200px; height: auto; display: block; margin: 0 auto; }
  .header p { margin: 15px 0 0 0; color: #f0b90b; font-size: 14px; letter-spacing: 1px; font-weight: bold; }
  .content { padding: 30px 20px; color: #333; background-color: #ffffff; }
  .content h2 { color: #0f172a; margin-top: 0; margin-bottom: 15px; }
  .content p { line-height: 1.8; margin: 0 0 15px 0; }
  .footer { background-color: #f5f5f5; color: #666; padding: 20px; text-align: center; font-size: 12px; border-top: 1px solid #ddd; }
  .button { display: inline-block; padding: 12px 24px; background-color: #f0b90b; color: #000; text-decoration: none; border-radius: 5px; font-weight: bold; margin-top: 20px; border: none; cursor: pointer; }
  .button:hover { background-color: #daa500; }
  .translate-box { margin: 24px 0 0; padding: 16px; text-align: center; background: #f9f9f9; border: 1px solid #ddd; border-radius: 8px; }
  .translate-box p { margin: 0 0 10px; color: #666; font-size: 13px; }
  .translate-link { display: inline-block; padding: 9px 16px; background: #ffffff; color: #0f172a; text-decoration: none; border: 2px solid #f0b90b; border-radius: 6px; font-weight: 600; font-size: 13px; }
  .info-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
  .info-table td { padding: 12px; border-bottom: 1px solid #eee; }
  .info-table td:first-child { font-weight: bold; color: #0f172a; width: 40%; background-color: #f9f9f9; }
  .info-table tr:nth-child(even) td:first-child { background-color: #f9f9f9; }
  .highlight { color: #f0b90b; font-weight: bold; }
  ul { color: #333; }
  ul li { margin-bottom: 10px; line-height: 1.6; }
`;

const wrapTemplate = (title, bodyContent) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>${styles}</style>
</head>
<body style="margin: 0; padding: 0; background-color: #f5f5f5;">
  <div class="container" style="max-width: 600px; margin: 20px auto; background: #ffffff; border-radius: 8px; overflow: hidden; border: 1px solid #ddd; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <!-- Dark Header with Logo -->
    <div style="background: linear-gradient(135deg, #0f172a 0%, #1a202c 100%); padding: 50px 20px; text-align: center;">
      <a href="${SITE_URL}" target="_blank" style="text-decoration: none; display: inline-block;">
        <img src="${LOGO_IMAGE}" alt="eToro Trust Capital Logo" width="200" height="auto" style="display: block; max-width: 100%; height: auto; border: 0; font-family: sans-serif; font-size: 20px; color: #f0b90b; font-weight: bold;" onerror="this.style.display='none'; this.parentElement.innerHTML += '<div style=\\'color: #f0b90b; font-size: 24px; font-weight: bold; letter-spacing: 2px;\\'>eTORO TRUST CAPITAL</div>'" />
      </a>
      <p style="margin: 15px 0 0 0; color: #f0b90b; font-size: 14px; letter-spacing: 1px; font-weight: bold;">eTORO TRUST CAPITAL</p>
    </div>
    
    <!-- White Content Area -->
    <div style="padding: 30px 20px; color: #333; background-color: #ffffff;">
      ${bodyContent}
      <div style="margin: 24px 0 0; padding: 16px; text-align: center; background: #f9f9f9; border: 1px solid #ddd; border-radius: 8px;">
        <p style="margin: 0 0 10px; color: #666; font-size: 13px;">Need this notification in another language?</p>
        <a href="${GOOGLE_TRANSLATE_URL}" target="_blank" style="display: inline-block; padding: 9px 16px; background: #ffffff; color: #0f172a; text-decoration: none; border: 2px solid #f0b90b; border-radius: 6px; font-weight: 600; font-size: 13px;">Open Google Translate</a>
      </div>
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

module.exports = {
  welcome: (name) => wrapTemplate('Welcome to eToro Trust Capital', `
    <h2>Welcome, ${name}!</h2>
    <p>Thank you for joining eToro Trust Capital. We are thrilled to have you on board.</p>
    <p>Your account has been successfully created. You can now access your dashboard, explore our investment plans, and start your journey to financial freedom.</p>
    <p><strong>Next Steps:</strong></p>
    <ul>
      <li>Complete your KYC verification.</li>
      <li>Explore our tailored investment plans.</li>
      <li>Make your first deposit.</li>
    </ul>
    <center><a href="${SITE_URL}/login" class="button">Login to Dashboard</a></center>
  `),

  depositRequestUser: (name, amount, method, currency, txHash) => wrapTemplate('Deposit Confirmation', `
    <h2>Deposit Request Received</h2>
    <p>Hello ${name},</p>
    <p>We have received your deposit request. It is currently <strong>Pending</strong> waiting for blockchain confirmation and admin approval.</p>
    <table class="info-table">
      <tr><td>Amount:</td><td>$${amount}</td></tr>
      <tr><td>Method:</td><td>${method} ${currency ? `(${currency})` : ''}</td></tr>
      ${txHash ? `<tr><td>Transaction Hash:</td><td><small>${txHash.substring(0, 20)}...</small></td></tr>` : ''}
      <tr><td>Status:</td><td>Pending</td></tr>
    </table>
    <p>You will receive another email once your deposit is approved.</p>
  `),

  depositRequestAdmin: (userName, amount, method, txHash, proofUrl) => wrapTemplate('New Deposit Request', `
    <h2>New Deposit Action Required</h2>
    <p>A new deposit request has been submitted by <strong>${userName}</strong>.</p>
    <table class="info-table">
      <tr><td>User:</td><td>${userName}</td></tr>
      <tr><td>Amount:</td><td>$${amount}</td></tr>
      <tr><td>Method:</td><td>${method}</td></tr>
      <tr><td>Tx Hash:</td><td><small>${txHash}</small></td></tr>
    </table>
    <p>Please log in to the admin panel to review and approve/reject this request.</p>
    ${proofUrl ? `<p><a href="${proofUrl}" target="_blank">View Payment Proof</a></p>` : ''}
    <center><a href="${SITE_URL}/admin" class="button">Go to Admin Panel</a></center>
  `),

  depositApproved: (name, amount) => wrapTemplate('Deposit Approved', `
    <h2>Deposit Approved!</h2>
    <p>Hello ${name},</p>
    <p>Great news! Your deposit of <span class="highlight">$${amount}</span> has been successfully approved and credited to your account balance.</p>
    <p>You can now use these funds to purchase an investment plan.</p>
    <center><a href="${SITE_URL}/dashboard" class="button">View Balance</a></center>
  `),
  
  depositRejected: (name, amount, reason) => wrapTemplate('Deposit Rejected', `
    <h2>Deposit Rejected</h2>
    <p>Hello ${name},</p>
    <p>We regret to inform you that your deposit request for <span class="highlight">$${amount}</span> has been rejected.</p>
    ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ''}
    <p>If you believe this is an error, please contact support.</p>
  `),

  roiCredited: (name, planName, amount, newBalance, date) => wrapTemplate('Daily ROI Credited', `
    <h2>Daily Profit Received</h2>
    <p>Hello ${name},</p>
    <p>Your daily ROI for the plan <strong>${planName}</strong> has been credited.</p>
    <table class="info-table">
      <tr><td>Amount Credited:</td><td class="highlight">+$${amount}</td></tr>
      <tr><td>Plan:</td><td>${planName}</td></tr>
      <tr><td>Date:</td><td>${date}</td></tr>
      <tr><td>Current Balance:</td><td>$${newBalance}</td></tr>
    </table>
    <p>Keep your investment active to continue earning daily returns!</p>
  `),

  withdrawalRequestUser: (name, amount, method, wallet) => wrapTemplate('Withdrawal Request Submitted', `
    <h2>Withdrawal Request Pending</h2>
    <p>Hello ${name},</p>
    <p>Your withdrawal request has been received and is being processed.</p>
    <table class="info-table">
      <tr><td>Amount:</td><td>$${amount}</td></tr>
      <tr><td>Method:</td><td>${method}</td></tr>
      <tr><td>Destination:</td><td><small>${wallet}</small></td></tr>
      <tr><td>Status:</td><td>Pending</td></tr>
    </table>
    <p>Processing times may vary. We will notify you once the funds are sent.</p>
  `),

  withdrawalRequestAdmin: (userName, amount, method, wallet) => wrapTemplate('New Withdrawal Request', `
    <h2>New Withdrawal Request</h2>
    <p>User <strong>${userName}</strong> has requested a withdrawal.</p>
    <table class="info-table">
      <tr><td>User:</td><td>${userName}</td></tr>
      <tr><td>Amount:</td><td>$${amount}</td></tr>
      <tr><td>Method:</td><td>${method}</td></tr>
      <tr><td>Wallet:</td><td><small>${wallet}</small></td></tr>
    </table>
    <center><a href="${SITE_URL}/admin" class="button">Review Request</a></center>
  `),

  withdrawalStatus: (name, amount, status, reason) => wrapTemplate(`Withdrawal ${status}`, `
    <h2>Withdrawal Update</h2>
    <p>Hello ${name},</p>
    <p>Your withdrawal request for <strong>$${amount}</strong> has been <strong>${status.toUpperCase()}</strong>.</p>
    ${status === 'rejected' && reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ''}
    ${status === 'approved' ? '<p>The funds should appear in your wallet shortly.</p>' : ''}
  `),

  withdrawalApproved: (name, amount, method, wallet) => wrapTemplate('Withdrawal Approved', `
    <h2>Withdrawal Approved</h2>
    <p>Hello ${name},</p>
    <p>Your withdrawal request has been approved and is now being processed.</p>
    <table class="info-table">
      <tr><td>Amount:</td><td class="highlight">$${amount}</td></tr>
      <tr><td>Method:</td><td>${method}</td></tr>
      <tr><td>Destination:</td><td><small>${wallet || 'N/A'}</small></td></tr>
      <tr><td>Status:</td><td>Approved</td></tr>
    </table>
    <p>The funds should reflect in your destination wallet or account shortly.</p>
  `),

  investmentApproved: (name, details) => wrapTemplate('Investment Approved', `
    <h2>Investment Approved</h2>
    <p>Hello ${name},</p>
    <p>Great news! Your investment has been reviewed and activated.</p>
    <table class="info-table">
      <tr><td>Investment ID:</td><td>${details.id}</td></tr>
      <tr><td>Plan:</td><td>${details.plan}</td></tr>
      <tr><td>Amount:</td><td class="highlight">$${Number(details.amount || 0).toLocaleString()}</td></tr>
      <tr><td>Start Date:</td><td>${details.startDate}</td></tr>
      <tr><td>Status:</td><td style="color: #22c55e;">${details.status || 'Active'}</td></tr>
    </table>
    <p>You will now begin earning daily returns based on your selected plan. You can track progress anytime from your dashboard.</p>
    <center><a href="${SITE_URL}/dashboard" class="button">View My Investment</a></center>
  `)
};

/**
 * Scheduler for daily ROI crediting
 * Runs every day at 12:00 AM (midnight) UTC
 */
const schedule = require('node-schedule');
const { createClient } = require('@supabase/supabase-js');
const { sendTransactionalEmail } = require('./mailProvider');
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EMAIL_NOTIFICATIONS_ENABLED = process.env.VITE_EMAIL_NOTIFICATIONS_ENABLED === 'true';
const APP_NAME = process.env.EMAIL_FROM_NAME || 'eToro Trust Capital';

const formatCurrency = (amount) =>
  Number(amount || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

let supabase = null;
if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false } });
} else {
  console.warn('Supabase credentials not configured. Scheduler will not work properly.');
}

// Investment plan configurations (should match the ones in planConfig.ts)
const PLAN_CONFIG = {
  '3-Day Plan': { durationDays: 3, dailyRate: 0.10, bonus: 0.05 },
  '7-Day Plan': { durationDays: 7, dailyRate: 0.10, bonus: 0.075 },
  '12-Day Plan': { durationDays: 12, dailyRate: 0.03, bonus: 0.09 },
  '15-Day Plan': { durationDays: 15, dailyRate: 0.035, bonus: 0.105 },
  '3-Month Plan': { durationDays: 90, dailyRate: 0.04, bonus: 0.12 },
  '6-Month Plan': { durationDays: 180, dailyRate: 0.045, bonus: 0.135 }
};

async function sendROINotificationEmail(userEmail, userName, roiAmount, investmentPlan, currentBalance, totalEarnings) {
  if (!EMAIL_NOTIFICATIONS_ENABLED) {
    console.log(`Email notifications disabled. Would have sent ROI email to: ${userEmail}`);
    return;
  }

  try {
    const result = await sendTransactionalEmail({
      to: userEmail,
      toName: userName,
      subject: `Daily ROI Credited - ${APP_NAME}`,
      html: `
        <p>Hello ${userName || 'Investor'},</p>
        <p>Your daily ROI of <strong>$${formatCurrency(roiAmount)}</strong> from the <strong>${investmentPlan}</strong> has been credited to your account.</p>
        <p>Total earnings so far: <strong>$${formatCurrency(totalEarnings)}</strong></p>
        <p>Current balance: <strong>$${formatCurrency(currentBalance)}</strong></p>
      `,
    });

    if (result.sent) {
      console.log(`ROI notification email sent to ${userEmail}`);
    } else {
      console.log(`Email provider not configured. Skipping email for ${userEmail}`);
    }
  } catch (error) {
    console.error(`Failed to send ROI notification email to ${userEmail}:`, error);
  }
}

async function sendInvestmentCompletionEmail(userEmail, userName, investmentPlan, totalROI, bonusAmount, currentBalance) {
  if (!EMAIL_NOTIFICATIONS_ENABLED) {
    console.log(`Email notifications disabled. Would have sent completion email to: ${userEmail}`);
    return;
  }

  try {
    const totalEarnings = totalROI + bonusAmount;
    const result = await sendTransactionalEmail({
      to: userEmail,
      toName: userName,
      subject: `Investment Plan Completed - ${APP_NAME}`,
      html: `
        <p>Hello ${userName || 'Investor'},</p>
        <p>Your <strong>${investmentPlan}</strong> investment has completed successfully.</p>
        <p>Total ROI earned: <strong>$${formatCurrency(totalROI)}</strong></p>
        <p>Bonus credited: <strong>$${formatCurrency(bonusAmount)}</strong></p>
        <p>Total earnings: <strong>$${formatCurrency(totalEarnings)}</strong></p>
        <p>Your new balance: <strong>$${formatCurrency(currentBalance)}</strong></p>
      `,
    });

    if (result.sent) {
      console.log(`Investment completion email sent to ${userEmail}`);
    } else {
      console.log(`Email provider not configured. Skipping email for ${userEmail}`);
    }
  } catch (error) {
    console.error(`Failed to send completion email to ${userEmail}:`, error);
  }
}

/**
 * Credit daily ROI to all active investments
 */
async function creditDailyROI() {
  if (!supabase) {
    console.error('❌ Supabase not configured. Cannot run ROI crediting.');
    return;
  }

  try {
    console.log(`\n⏰ [${new Date().toISOString()}] Starting daily ROI crediting process...`);

    // Get all active investments
    const { data: activeInvestments, error: invError } = await supabase
      .from('investments')
      .select('*')
      .eq('status', 'Active')
      .eq('authStatus', 'approved');

    if (invError) {
      console.error('❌ Error fetching active investments:', invError);
      return;
    }

    if (!activeInvestments || activeInvestments.length === 0) {
      console.log('ℹ️  No active investments found to credit ROI');
      return;
    }

    console.log(`📊 Found ${activeInvestments.length} active investments to process`);

    let processedCount = 0;
    let completedCount = 0;
    let errorCount = 0;

    for (const investment of activeInvestments) {
      try {
        const planConfig = PLAN_CONFIG[investment.plan];
        if (!planConfig) {
          console.warn(`⚠️  Unknown plan: ${investment.plan} for investment ${investment.id}`);
          errorCount++;
          continue;
        }

        // Calculate daily ROI amount
        const dailyRoiAmount = investment.capital * planConfig.dailyRate;

        // Check if investment is still within duration
        const startDate = investment.startDate ? new Date(investment.startDate) : null;
        const now = new Date();
        if (!startDate || Number.isNaN(startDate.getTime())) {
          console.warn(`⚠️  Skipping investment ${investment.id}: missing approval start date`);
          errorCount++;
          continue;
        }
        const daysElapsed = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        if (daysElapsed < 1) {
          console.log(`⏭️  No ROI or bonus due yet for investment ${investment.id}: less than 24 hours since approval`);
          continue;
        }

        // Check if we already credited ROI today
        const lastCreditDate = investment.updated_at ? new Date(investment.updated_at) : startDate;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const lastCreditDay = new Date(lastCreditDate);
        lastCreditDay.setHours(0, 0, 0, 0);

        if (lastCreditDay >= today) {
          console.log(`⏭️  ROI already credited today for investment ${investment.id}`);
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
            .select('balance, bonus, email, name, userName')
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

            // Send investment completion email
            const userEmail = userData.email;
            const userName = userData.name || userData.userName;
            await sendInvestmentCompletionEmail(userEmail, userName, investment.plan, remainingRoi, finalBonus, newBalance);
          }

          console.log(`✅ Completed investment ${investment.id}: Credited remaining ROI $${remainingRoi.toFixed(2)} and final bonus $${finalBonus.toFixed(2)}`);
          completedCount++;
        } else {
          // Credit daily ROI for active investment
          await supabase
            .from('investments')
            .update({
              creditedRoi: (investment.creditedRoi || 0) + dailyRoiAmount,
              updated_at: new Date().toISOString()
            })
            .eq('id', investment.id);

          // Get user data for balance update
          const { data: userData } = await supabase
            .from('users')
            .select('balance, email, name, userName')
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

            // Send daily ROI notification email
            const userEmail = userData.email;
            const userName = userData.name || userData.userName;
            const totalEarnings = (investment.creditedRoi || 0) + dailyRoiAmount;
            await sendROINotificationEmail(userEmail, userName, dailyRoiAmount, investment.plan, newBalance, totalEarnings);
          }

          console.log(`💰 Credited $${dailyRoiAmount.toFixed(2)} ROI for investment ${investment.id} (${investment.plan})`);
          processedCount++;
        }

      } catch (invProcessError) {
        console.error(`❌ Error processing investment ${investment.id}:`, invProcessError.message);
        errorCount++;
      }
    }

    console.log(`\n📈 ROI Crediting Summary:`);
    console.log(`   ✅ Processed: ${processedCount}`);
    console.log(`   🎉 Completed: ${completedCount}`);
    console.log(`   ⚠️  Errors: ${errorCount}`);
    console.log(`   ✓ Daily ROI crediting completed at ${new Date().toISOString()}\n`);

  } catch (err) {
    console.error('❌ Fatal error in daily ROI crediting:', err);
  }
}

/**
 * Initialize the scheduler
 */
function initScheduler() {
  try {
    // Schedule to run every day at 12:00 AM (midnight) UTC
    // Cron format: second minute hour day-of-month month day-of-week
    // '0 0 0 * * *' means every day at 00:00:00
    const job = schedule.scheduleJob('0 0 0 * * *', creditDailyROI);
    
    console.log('✅ Daily ROI Scheduler initialized');
    console.log('⏰ Scheduled to run every day at 12:00 AM (midnight) UTC');
    console.log(`🕐 Next execution: ${job.nextInvocation()}`);
    
    return job;
  } catch (error) {
    console.error('❌ Failed to initialize scheduler:', error);
    return null;
  }
}

/**
 * Manually trigger ROI crediting (for testing)
 */
async function manualCredit() {
  console.log('🚀 Manually triggering daily ROI crediting...');
  await creditDailyROI();
}

module.exports = {
  initScheduler,
  creditDailyROI,
  manualCredit
};

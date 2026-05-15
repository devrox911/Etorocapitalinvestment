import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase configuration. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false }
});

const PLAN_CONFIG = {
  '3-Day Plan': { durationDays: 3, dailyRate: 0.10, bonus: 0.05 },
  '7-Day Plan': { durationDays: 7, dailyRate: 0.03, bonus: 0.075 },
  '12-Day Plan': { durationDays: 12, dailyRate: 0.035, bonus: 0.09 },
  '15-Day Plan': { durationDays: 15, dailyRate: 0.04, bonus: 0.105 },
  '3-Month Plan': { durationDays: 90, dailyRate: 0.04, bonus: 0.12 },
  '6-Month Plan': { durationDays: 180, dailyRate: 0.05, bonus: 0.135 }
};

const dollars = (value) => Math.round((Number(value) || 0) * 100) / 100;
const getCreditedRoi = (investment) => Number(investment.creditedRoi ?? investment.credited_roi ?? 0) || 0;
const getCreditedBonus = (investment) => Number(investment.creditedBonus ?? investment.credited_bonus ?? 0) || 0;
const getInvestmentStartDate = (investment) => {
  const rawDate = investment.startDate || investment.start_date;
  const parsedDate = rawDate ? new Date(rawDate) : null;
  return parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : null;
};

async function creditDailyROI() {
  console.log(`[${new Date().toISOString()}] Starting daily ROI crediting process...`);

  const { data: activeInvestments, error: invError } = await supabase
    .from('investments')
    .select('*')
    .eq('status', 'Active')
    .eq('authStatus', 'approved');

  if (invError) {
    throw new Error(`Failed to fetch active investments: ${invError.message}`);
  }

  if (!activeInvestments || activeInvestments.length === 0) {
    console.log('No active investments found to credit ROI.');
    return { processed: 0, completed: 0, skipped: 0, errors: 0, totalCredited: 0 };
  }

  let processed = 0;
  let completed = 0;
  let skipped = 0;
  let errors = 0;
  let totalCredited = 0;
  const now = new Date();
  const dayMs = 1000 * 60 * 60 * 24;

  for (const investment of activeInvestments) {
    try {
      const planConfig = PLAN_CONFIG[investment.plan];
      if (!planConfig) {
        console.warn(`Skipping investment ${investment.id}: unknown plan "${investment.plan}".`);
        skipped++;
        continue;
      }

      const capital = Number(investment.capital) || 0;
      const dailyRoiAmount = dollars(capital * planConfig.dailyRate);
      const startDate = getInvestmentStartDate(investment);

      if (!capital || !startDate) {
        console.warn(`Skipping investment ${investment.id}: missing capital or approval start date.`);
        skipped++;
        continue;
      }

      const daysElapsed = Math.floor((now.getTime() - startDate.getTime()) / dayMs);
      if (daysElapsed < 1) {
        console.log(`Skipping investment ${investment.id}: less than 24 hours since approval.`);
        skipped++;
        continue;
      }
      const payableDays = Math.min(Math.max(daysElapsed, 0), planConfig.durationDays);
      const totalExpectedRoi = dollars(dailyRoiAmount * planConfig.durationDays);
      const expectedRoiToDate = dollars(dailyRoiAmount * payableDays);
      const creditedRoi = getCreditedRoi(investment);
      const roiToCredit = dollars(Math.max(0, expectedRoiToDate - creditedRoi));
      const isComplete = daysElapsed >= planConfig.durationDays;
      const finalBonus = isComplete ? dollars(capital * planConfig.bonus) : 0;
      const bonusToCredit = dollars(Math.max(0, finalBonus - getCreditedBonus(investment)));

      if (roiToCredit <= 0 && bonusToCredit <= 0 && !isComplete) {
        skipped++;
        continue;
      }

      const { data: userData, error: userFetchError } = await supabase
        .from('users')
        .select('balance, bonus')
        .eq('idnum', investment.idnum)
        .single();

      if (userFetchError || !userData) {
        throw new Error(`Failed to fetch user ${investment.idnum}: ${userFetchError?.message || 'not found'}`);
      }

      const investmentUpdate = {
        creditedRoi: dollars(creditedRoi + roiToCredit),
        updated_at: now.toISOString()
      };

      if (isComplete) {
        investmentUpdate.status = 'completed';
        investmentUpdate.creditedRoi = totalExpectedRoi;
        investmentUpdate.creditedBonus = finalBonus;
      }

      const { error: investmentUpdateError } = await supabase
        .from('investments')
        .update(investmentUpdate)
        .eq('id', investment.id);

      if (investmentUpdateError) {
        throw new Error(`Failed to update investment ${investment.id}: ${investmentUpdateError.message}`);
      }

      const { error: userUpdateError } = await supabase
        .from('users')
        .update({
          balance: dollars((userData.balance || 0) + roiToCredit),
          bonus: dollars((userData.bonus || 0) + bonusToCredit),
          updated_at: now.toISOString()
        })
        .eq('idnum', investment.idnum);

      if (userUpdateError) {
        throw new Error(`Failed to update user ${investment.idnum}: ${userUpdateError.message}`);
      }

      processed++;
      totalCredited = dollars(totalCredited + roiToCredit);

      if (isComplete) {
        completed++;
        console.log(`Completed ${investment.id}: ROI $${roiToCredit.toFixed(2)}, bonus $${bonusToCredit.toFixed(2)}.`);
      } else {
        console.log(`Credited ${investment.id}: ROI $${roiToCredit.toFixed(2)}.`);
      }
    } catch (error) {
      errors++;
      console.error(`Error processing investment ${investment.id}:`, error.message);
    }
  }

  return { processed, completed, skipped, errors, totalCredited };
}

creditDailyROI()
  .then((summary) => {
    console.log('Daily ROI crediting completed:', summary);
    process.exit(summary.errors > 0 ? 1 : 0);
  })
  .catch((error) => {
    console.error('Daily ROI crediting failed:', error.message);
    process.exit(1);
  });

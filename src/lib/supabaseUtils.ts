import { supabase } from '@/config/supabase'
import bcrypt from 'bcryptjs'

// Export the supabase instance for direct use
export { supabase }

// Create a typed client to avoid errors when Supabase is not configured
const db = supabase as any

// Type definitions
export interface UserRecord {
  id?: string
  idnum?: string
  name?: string
  userName?: string
  email?: string
  password?: string
  phoneNumber?: string
  country?: string
  city?: string
  address?: string
  balance?: number
  bonus?: number
  completedTrades?: number
  date?: string
  avatar?: string
  investmentCount?: number
  referralCount?: number
  referralBonusTotal?: number
  referralCode?: string | null
  referralCodeExpiresAt?: string | null
  referralCodeIssuedAt?: string | null
  referredByCode?: string | null
  referralLevel?: number
  authStatus?: string | null
  role?: 'user' | 'admin' | 'superadmin'
}

export interface ReferralRecord {
  id?: string
  referrerId?: string
  referredId?: string
  referralCode?: string
  bonusEarned?: number
  bonusAwarded?: boolean
  level?: number
  created_at?: string
  referredUser?: UserRecord | null
}

export interface ReferralSummary {
  count: number
  bonusTotal: number
  referrals: ReferralRecord[]
}

export interface InvestmentRecord {
  id?: string
  idnum?: string
  plan?: string
  status?: string
  capital?: number
  roi?: number
  bonus?: number
  duration?: number
  paymentOption?: string
  transactionHash?: string | null
  paymentProofUrl?: string | null
  authStatus?: string
  creditedRoi?: number
  creditedBonus?: number
  startDate?: string | null  // When investment was approved/activated
  date?: string
  created_at?: string
}

export interface WithdrawalRecord {
  id?: string
  idnum?: string
  amount?: number
  wallet?: string
  walletAddress?: string | null
  bankName?: string | null
  accountNumber?: string | null
  accountName?: string | null
  routingNumber?: string | null
  status?: string
  method?: string
  authStatus?: string
  date?: string
  created_at?: string
}

export interface DepositRecord {
  id?: string
  idnum?: string
  amount?: number
  method?: string
  walletAddress?: string | null
  bankName?: string | null
  accountNumber?: string | null
  accountName?: string | null
  routingNumber?: string | null
  transactionHash?: string | null
  paymentProofUrl?: string | null
  status?: string
  authStatus?: string
  date?: string
  created_at?: string
}

export interface LoanRecord {
  id?: string
  idnum?: string
  amount?: number
  status?: string
  interestRate?: number
  duration?: number
  authStatus?: string
  date?: string
  created_at?: string
}

export interface KycRecord {
  id?: string
  idnum?: string
  fullName?: string
  dateOfBirth?: string
  nationality?: string
  documentType?: string
  documentNumber?: string
  documentFrontUrl?: string
  documentBackUrl?: string
  selfieUrl?: string
  status?: string
  rejectionReason?: string
  submittedAt?: string
  reviewedAt?: string
  created_at?: string
  updated_at?: string
}

export interface NotificationRecord {
  id?: string
  idnum?: string
  title?: string
  message?: string
  type?: string
  read?: boolean
  created_at?: string
}

const trimTrailingSlash = (value: string) => value.replace(/\/$/, '')

const getApiBaseUrl = () => {
  const currentOrigin =
    typeof window !== 'undefined' ? trimTrailingSlash(window.location.origin) : ''
  const appUrl = trimTrailingSlash(import.meta.env.VITE_APP_URL || '')
  const serverUrl = trimTrailingSlash(import.meta.env.VITE_SERVER_URL || '')
  const isLocalBrowser =
    typeof window !== 'undefined' &&
    /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname)

  // Only use the dedicated backend URL for local browser development.
  if (isLocalBrowser && serverUrl) return serverUrl
  return currentOrigin || appUrl || serverUrl
}

// Backend Notification Helper
const notifyBackend = async (endpoint: string, data: any) => {
  try {
    const apiBase = getApiBaseUrl()
    const fullUrl = endpoint.startsWith('http') ? endpoint : `${apiBase}${endpoint}`
    
    const response = await fetch(fullUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
        console.error('Notification failed:', await response.text());
    }
  } catch (error) {
    console.error('Notification error:', error);
  }
};

// Map database record to application format
const mapUserRecord = (record: any): UserRecord => {
  if (!record || typeof record !== 'object') return record
  const {
    authstatus,
    referral_count,
    referral_bonus_total,
    referral_code,
    referral_code_expires_at,
    referral_code_issued_at,
    referred_by_code,
    referral_level,
    completed_trades,
    ...rest
  } = record
  return {
    ...rest,
    authStatus: authstatus ?? rest.authStatus ?? null,
    referralCount: referral_count ?? rest.referralCount ?? 0,
    referralBonusTotal: referral_bonus_total ?? rest.referralBonusTotal ?? 0,
    referralCode: referral_code ?? rest.referralCode ?? null,
    referralCodeExpiresAt: referral_code_expires_at ?? rest.referralCodeExpiresAt ?? null,
    referralCodeIssuedAt: referral_code_issued_at ?? rest.referralCodeIssuedAt ?? null,
    referredByCode: referred_by_code ?? rest.referredByCode ?? null,
    referralLevel: referral_level ?? rest.referralLevel ?? 0,
    completedTrades: completed_trades ?? rest.completedTrades ?? 0,
  }
}

const mapInvestmentRecord = (record: any): InvestmentRecord => {
  if (!record || typeof record !== 'object') return record
  // Handle both snake_case (from older database) and camelCase (current schema)
  const { 
    paymentoption, 
    authstatus, 
    transaction_hash, 
    payment_proof_url, 
    credited_roi, 
    credited_bonus, 
    start_date,
    creditedRoi,
    creditedBonus,
    startDate,
    ...rest 
  } = record
  return {
    ...rest,
    paymentOption: paymentoption ?? record.paymentOption ?? 'Bitcoin',
    authStatus: authstatus ?? record.authStatus ?? 'unseen',
    transactionHash: transaction_hash ?? record.transactionHash ?? null,
    paymentProofUrl: payment_proof_url ?? record.paymentProofUrl ?? null,
    creditedRoi: creditedRoi ?? credited_roi ?? record.creditedRoi ?? 0,
    creditedBonus: creditedBonus ?? credited_bonus ?? record.creditedBonus ?? 0,
    startDate: startDate ?? start_date ?? record.startDate ?? null,
  }
}

const mapReferralRecord = (record: any): ReferralRecord => {
  if (!record || typeof record !== 'object') return record
  const {
    referrer_id,
    referred_id,
    referral_code,
    bonus_earned,
    ...rest
  } = record

  return {
    ...rest,
    referrerId: referrer_id ?? record.referrerId,
    referredId: referred_id ?? record.referredId,
    referralCode: referral_code ?? record.referralCode,
    bonusEarned: bonus_earned ?? record.bonusEarned ?? 0,
  }
}

const mapWithdrawalRecord = (record: any): WithdrawalRecord => {
  if (!record || typeof record !== 'object') return record
  const { 
    wallet_address, 
    bank_name, 
    account_number, 
    account_name, 
    routing_number,
    authstatus,
    authStatus, 
    ...rest 
  } = record

  return {
    ...rest,
    walletAddress: record.walletAddress ?? record.wallet_address ?? null,
    bankName: record.bankName ?? record.bank_name ?? null,
    accountNumber: record.accountNumber ?? record.account_number ?? null,
    accountName: record.accountName ?? record.account_name ?? null,
    routingNumber: record.routingNumber ?? record.routing_number ?? null,
    authStatus: authStatus ?? authstatus ?? 'pending'
  }
}

const normalizeInvestmentPayload = (investmentData: Partial<InvestmentRecord> = {}) => ({
  idnum: investmentData.idnum,
  plan: investmentData.plan,
  status: investmentData.status || 'pending',
  capital: investmentData.capital ?? 0,
  roi: investmentData.roi ?? 0,
  bonus: investmentData.bonus ?? 0,
  duration: investmentData.duration ?? 5,
  "paymentOption": investmentData.paymentOption ?? 'Bitcoin',
  "transactionHash": investmentData.transactionHash ?? null,
  "paymentProofUrl": investmentData.paymentProofUrl ?? null,
  "authStatus": investmentData.authStatus ?? 'unseen',
  creditedRoi: investmentData.creditedRoi ?? 0,
  creditedBonus: investmentData.creditedBonus ?? 0,
  "startDate": (investmentData.startDate && investmentData.startDate !== '') ? investmentData.startDate : null,
})

// Referral helpers
const REFERRAL_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const REFERRAL_CODE_LENGTH = 8
const REFERRAL_CODE_RETRY_LIMIT = 12
const REFERRAL_DEFAULT_EXPIRATION_DAYS = 30
const REFERRAL_MAX_LEVEL = 3

const addDaysToNow = (days: number) => {
  const base = new Date()
  base.setUTCDate(base.getUTCDate() + (Number.isFinite(days) ? days : REFERRAL_DEFAULT_EXPIRATION_DAYS))
  return base.toISOString()
}

const randomReferralCode = (seed = '') => {
  const sanitizedSeed = (seed || '')
    .replace(/[^A-Z0-9]/gi, '')
    .toUpperCase()
  const prefix = sanitizedSeed.slice(0, 2).padEnd(2, 'G')
  let output = prefix

  while (output.length < REFERRAL_CODE_LENGTH) {
    const index = Math.floor(Math.random() * REFERRAL_CODE_ALPHABET.length)
    output += REFERRAL_CODE_ALPHABET[index]
  }

  return output
}

// Generate unique user ID
const generateUserId = () => {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 7)
  return `USR${timestamp}${random}`.toUpperCase()
}

// Authentication helpers
export const supabaseAuth = {
  async signup(email: string, password: string, userData: Partial<UserRecord> = {}): Promise<UserRecord> {
    // Check if email already exists
    const existingUser = await supabaseDb.getUserByEmail(email)
    if (existingUser) {
      throw new Error('Email already registered')
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10)

    // Generate unique user ID
    const idnum = generateUserId()

    // Generate referral code for this new user
    const referralCode = randomReferralCode(userData.userName as string || '')

    // Create user record
    const newUser = await supabaseDb.createUser({
      idnum,
      email,
      password: hashedPassword,
      balance: 0,
      bonus: 0,
      investmentCount: 0,
      referralCount: 0,
      referralCode: referralCode,
      referralCodeIssuedAt: new Date().toISOString(),
      referralCodeExpiresAt: addDaysToNow(REFERRAL_DEFAULT_EXPIRATION_DAYS),
      referredByCode: userData.referredByCode || null,
      role: 'user',
      ...userData,
    })

    // Handle referral tracking - record relationship but DON'T award bonus yet
    // Bonus will be awarded when referred user makes their first deposit/investment
    if (userData.referredByCode) {
      try {
        const referrer = await supabaseDb.getUserByReferralCode(userData.referredByCode)
        
        if (referrer && referrer.idnum) {
          // Update referrer's referral count
          const newReferralCount = (referrer.referralCount || 0) + 1

          // Create referral record with bonusAwarded=false (will be awarded later)
          await supabaseDb.createReferral({
            referrerId: referrer.idnum,
            referredId: idnum,
            referralCode: userData.referredByCode,
            bonusEarned: 0, // Will be calculated when deposit/investment is made
            level: 1,
            bonusAwarded: false, // Track that bonus hasn't been awarded yet
          })
          
          // Just update the referral count, not balance
          await supabaseDb.updateUser(referrer.idnum, {
            referralCount: newReferralCount,
          })
          
          console.log(`✅ Referral relationship created for ${email} referred by ${referrer.email}. Bonus will be awarded on first deposit/investment.`);
        }
      } catch (error) {
        console.warn('Referral tracking failed:', error)
        // Don't fail signup if referral processing fails
      }
    }

    // Send Welcome Email
    try {
      await notifyBackend('/api/notify/welcome', { 
        email, 
        name: userData.name || userData.userName || email.split('@')[0] 
      });
      console.log(`✅ Welcome email notification sent to ${email}`);
    } catch (error) {
      console.error(`❌ Failed to send welcome email to ${email}:`, error);
    }

    // Send referral signup notification if applicable (for referrer awareness)
    if (userData.referredByCode) {
      try {
        const referrer = await supabaseDb.getUserByReferralCode(userData.referredByCode)
        if (referrer && referrer.email) {
          await notifyBackend('/api/notify/referral-signup', {
            referrerId: referrer.idnum,
            referrerEmail: referrer.email,
            referrerName: referrer.userName || referrer.name || referrer.email.split('@')[0],
            newUserEmail: email,
            newUserName: userData.userName || userData.name || email.split('@')[0],
            referralBonus: 'pending', // Will be awarded after first deposit
            totalReferrals: (referrer.referralCount || 0) + 1,
          })
          console.log(`✅ Referral signup notification sent to ${referrer.email}`);
        }
      } catch (error) {
        console.warn('Referral signup notification failed:', error);
      }
    }

    // Send admin notification for new user signup
    try {
      await notifyBackend('/api/notify/admin/new-user-signup', {
        userEmail: email,
        userName: userData.userName || userData.name || 'New User',
        phoneNumber: userData.phoneNumber || '',
        referralCode: newUser.referralCode,
      })
      console.log(`✅ Admin signup notification sent`);
    } catch (error) {
      console.warn('Admin signup notification failed:', error);
    }

    return newUser
  },

  async login(emailOrUsername: string, password: string): Promise<UserRecord | null> {
    // Try to get user by email first, then by username
    let user = await supabaseDb.getUserByEmail(emailOrUsername)
    
    if (!user) {
      // If not found by email, try username
      user = await supabaseDb.getUserByUsername(emailOrUsername)
    }
    
    if (!user) {
      return null
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password || '')
    if (!isValidPassword) {
      return null
    }

    // Return user without password
    const { password: _, ...userWithoutPassword } = user
    return userWithoutPassword
  },

  async getUserBySession(): Promise<UserRecord | null> {
    const userStr = localStorage.getItem('activeUser') || sessionStorage.getItem('activeUser')
    if (!userStr) return null

    let userData
    try {
      userData = JSON.parse(userStr)
    } catch (error) {
      console.error('Error parsing user session:', error)
      return null
    }

    if (userData.idnum) {
      // Allow database errors to propagate so we can distinguish "not found" vs "error"
      return await supabaseDb.getUserByIdnum(userData.idnum)
    }

    return null
  },
}

// Database operations
export const supabaseDb = {
  // User operations
  async getAllUsers(): Promise<UserRecord[]> {
    const { data, error } = await db
      .from('users')
      .select('*')
      .order('created_at', { ascending: false })
    
    if (error) throw error
    return (data || []).map(mapUserRecord)
  },

  async getUserByIdnum(idnum: string): Promise<UserRecord | null> {
    const { data, error } = await db
      .from('users')
      .select('*')
      .eq('idnum', idnum)
      .single()
    
    if (error) {
      if (error.code === 'PGRST116') return null
      throw error
    }
    return mapUserRecord(data)
  },

  async getUserByEmail(email: string): Promise<UserRecord | null> {
    const { data, error } = await db
      .from('users')
      .select('*')
      .eq('email', email)
      .single()
    
    if (error) {
      if (error.code === 'PGRST116') return null
      throw error
    }
    return mapUserRecord(data)
  },

  async getUserByUsername(userName: string): Promise<UserRecord | null> {
    const { data, error } = await db
      .from('users')
      .select('*')
      .eq('userName', userName)
      .single()
    
    if (error) {
      if (error.code === 'PGRST116') return null
      throw error
    }
    return mapUserRecord(data)
  },

  async getUserByReferralCode(referralCode: string): Promise<UserRecord | null> {
    const { data, error } = await db
      .from('users')
      .select('*')
      .eq('referralCode', referralCode)
      .single()
    
    if (error) {
      if (error.code !== 'PGRST116') throw error
    } else {
      return mapUserRecord(data)
    }

    const { data: userByIdnum, error: idnumError } = await db
      .from('users')
      .select('*')
      .eq('idnum', referralCode)
      .single()

    if (idnumError) {
      if (idnumError.code === 'PGRST116') return null
      throw idnumError
    }

    return mapUserRecord(userByIdnum)
  },

  async getReferralSummary(referrerId: string, referralCode?: string | null): Promise<ReferralSummary> {
    const referralsById = new Map<string, ReferralRecord>()
    let bonusTotal = 0

    try {
      const { data, error } = await db
        .from('referrals')
        .select('*')
        .eq('referrerId', referrerId)
        .order('created_at', { ascending: false })

      if (error) throw error

      ;(data || []).map(mapReferralRecord).forEach((referral: ReferralRecord) => {
        if (!referral.referredId) return
        referralsById.set(referral.referredId, referral)
        bonusTotal += Number(referral.bonusEarned || 0)
      })
    } catch (error) {
      console.warn('Could not fetch referrals table summary:', error)
    }

    const referralLookupValues = Array.from(new Set([referralCode, referrerId].filter(Boolean))) as string[]

    if (referralLookupValues.length > 0) {
      try {
        const { data, error } = await db
          .from('users')
          .select('idnum, name, "userName", email, date, created_at, "referredByCode"')
          .in('referredByCode', referralLookupValues)
          .order('created_at', { ascending: false })

        if (error) throw error

        ;(data || []).forEach((user: any) => {
          if (!user.idnum || referralsById.has(user.idnum)) return
          referralsById.set(user.idnum, {
            referredId: user.idnum,
            referralCode: user.referredByCode || referralCode || referrerId,
            bonusEarned: 0,
            bonusAwarded: false, // Bonus not yet awarded until deposit/investment is made
            level: 1,
            created_at: user.created_at || user.date,
            referredUser: mapUserRecord(user),
          })
        })
      } catch (error) {
        console.warn('Could not fetch referred users summary:', error)
      }
    }

    const referredIds = Array.from(referralsById.keys())
    if (referredIds.length > 0) {
      try {
        const { data, error } = await db
          .from('users')
          .select('idnum, name, "userName", email, date, created_at, "referredByCode"')
          .in('idnum', referredIds)

        if (error) throw error

        const usersById = new Map(
          (data || [])
            .map(mapUserRecord)
            .filter((user: UserRecord) => user.idnum)
            .map((user: UserRecord) => [user.idnum as string, user])
        )

        referralsById.forEach((referral, referredId) => {
          if (!referral.referredUser) {
            referral.referredUser = usersById.get(referredId) || null
          }
        })
      } catch (error) {
        console.warn('Could not hydrate referral users:', error)
      }
    }

    return {
      count: referralsById.size,
      bonusTotal,
      referrals: Array.from(referralsById.values()),
    }
  },

  async createUser(userData: Partial<UserRecord>): Promise<UserRecord> {
    const { data, error } = await db
      .from('users')
      .insert([userData])
      .select()
      .single()
    
    if (error) throw error
    return mapUserRecord(data)
  },

  async updateUser(idnum: string, updates: Partial<UserRecord>): Promise<UserRecord> {
    const { data, error } = await db
      .from('users')
      .update(updates)
      .eq('idnum', idnum)
      .select()
      .single()
    
    if (error) throw error
    return mapUserRecord(data)
  },

  async createReferral(referralData: Partial<ReferralRecord>): Promise<ReferralRecord | null> {
    const payload = {
      referrerId: referralData.referrerId,
      referredId: referralData.referredId,
      referralCode: referralData.referralCode,
      bonusEarned: referralData.bonusEarned ?? 0,
      level: referralData.level ?? 1,
    }

    const { data, error } = await db
      .from('referrals')
      .upsert([payload], { onConflict: 'referrerId,referredId' })
      .select()
      .single()

    if (error) {
      console.warn('Referral record insert failed:', error)
      return null
    }

    return mapReferralRecord(data)
  },

  async awardReferralBonus(referredUserId: string, depositOrInvestmentAmount: number): Promise<boolean> {
    try {
      // Find the referral record for this user
      const { data: referralData, error: referralError } = await db
        .from('referrals')
        .select('*')
        .eq('referredId', referredUserId)
        .single()

      if (referralError || !referralData) {
        console.log(`ℹ️ No referral found for user ${referredUserId}. No bonus to award.`)
        return false
      }

      // Check if bonus has already been awarded
      const bonusAwarded = referralData.bonusAwarded === true
      if (bonusAwarded) {
        console.log(`ℹ️ Referral bonus already awarded for referral ID ${referralData.id}`)
        return false
      }

      // Calculate 5% bonus
      const bonusAmount = parseFloat((depositOrInvestmentAmount * 0.05).toFixed(2))
      
      if (bonusAmount <= 0) {
        console.warn('Bonus amount is zero or negative, skipping award')
        return false
      }

      // Get the referrer's current data
      const { data: referrerData, error: referrerError } = await db
        .from('users')
        .select('*')
        .eq('idnum', referralData.referrerId)
        .single()

      if (referrerError || !referrerData) {
        console.error('Referrer not found:', referralData.referrerId)
        return false
      }

      // Update referral record with bonus earned and mark as awarded
      const { error: updateReferralError } = await db
        .from('referrals')
        .update({
          bonusEarned: bonusAmount,
          bonusAwarded: true,
        })
        .eq('id', referralData.id)

      if (updateReferralError) {
        console.error('Failed to update referral record:', updateReferralError)
        return false
      }

      // Update referrer's balance and referral bonus total
      const newBalance = (referrerData.balance || 0) + bonusAmount
      const newReferralBonusTotal = (referrerData.referralBonusTotal || 0) + bonusAmount

      const { error: updateUserError } = await db
        .from('users')
        .update({
          balance: newBalance,
          referralBonusTotal: newReferralBonusTotal,
        })
        .eq('idnum', referralData.referrerId)

      if (updateUserError) {
        console.error('Failed to update referrer balance:', updateUserError)
        return false
      }

      console.log(`✅ Referral bonus awarded: $${bonusAmount} (5% of $${depositOrInvestmentAmount}) to referrer ${referralData.referrerId}`)
      
      // Send notification to referrer
      try {
        await notifyBackend('/api/notify/referral-bonus', {
          referrerId: referralData.referrerId,
          referrerEmail: referrerData.email,
          referrerName: referrerData.userName || referrerData.name,
          bonusAmount: bonusAmount,
          sourceAmount: depositOrInvestmentAmount,
          sourceType: 'deposit_or_investment',
          referredUserEmail: referrerData.email,
          newTotalBonus: newReferralBonusTotal,
        })
        console.log(`✅ Referral bonus notification sent to ${referrerData.email}`)
      } catch (err) {
        console.warn('Failed to send referral bonus notification:', err)
      }

      return true
    } catch (error) {
      console.error('Error awarding referral bonus:', error)
      return false
    }
  },

  async deleteUser(idnum: string): Promise<void> {
    const { error } = await db
      .from('users')
      .delete()
      .eq('idnum', idnum)
    
    if (error) throw error
  },

  // Investment operations
  async getAllInvestments(): Promise<InvestmentRecord[]> {
    const { data, error } = await db
      .from('investments')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) throw error
    return (data || []).map(mapInvestmentRecord)
  },

  async getInvestmentsByUser(idnum: string): Promise<InvestmentRecord[]> {
    console.log('🔵 [getInvestmentsByUser] Fetching investments for user:', idnum);
    
    const { data, error } = await db
      .from('investments')
      .select('*')
      .eq('idnum', idnum)
      .order('created_at', { ascending: false })
    
    if (error) {
      console.error('🔴 [getInvestmentsByUser] ERROR fetching investments:', error);
      throw error
    }
    
    console.log('✅ [getInvestmentsByUser] Found', data?.length || 0, 'investments:', data);
    return (data || []).map(mapInvestmentRecord)
  },

  async createInvestment(investmentData: Partial<InvestmentRecord>): Promise<InvestmentRecord> {
    const payload = normalizeInvestmentPayload(investmentData)
    // Sanitize payload: convert empty strings to null to avoid invalid timestamps
    const sanitizedPayload = Object.fromEntries(
      Object.entries(payload).map(([k, v]) => [k, (v === '' ? null : v)])
    ) as Partial<InvestmentRecord>

    console.log('🔵 [createInvestment] Starting investment creation with payload:', payload);
    console.log('🔵 [createInvestment] Sanitized payload for DB insert:', sanitizedPayload);
    
    const { data, error } = await db
      .from('investments')
      .insert([sanitizedPayload])
      .select()
      .single()
    
    if (error) {
      console.error('🔴 [createInvestment] ERROR inserting investment:', error);
      console.error('🔴 [createInvestment] Error code:', error.code);
      console.error('🔴 [createInvestment] Error message:', error.message);
      console.error('🔴 [createInvestment] Error details:', error.details);
      throw error
    }
    
    console.log('✅ [createInvestment] Investment created successfully:', data);
    
    // Send admin notification for new investment
    try {
      const user = await supabaseDb.getUserByIdnum(investmentData.idnum || '')
      if (user && user.email) {
        await notifyBackend('/api/notify/admin/new-user-investment', {
          userEmail: user.email,
          userName: user.userName || user.name || 'User',
          investmentId: data.id,
          plan: data.plan,
          capital: data.capital,
          duration: data.duration,
          roi: data.roi,
        })
        console.log(`✅ Admin investment notification sent`);
      }
    } catch (error) {
      console.warn('Admin investment notification failed:', error);
    }
    
    return mapInvestmentRecord(data)
  },

  async updateInvestment(id: string, updates: Partial<InvestmentRecord>): Promise<InvestmentRecord> {
    const { data, error } = await db
      .from('investments')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    
    if (error) throw error
    return mapInvestmentRecord(data)
  },

  async approveInvestment(investmentId: string): Promise<InvestmentRecord> {
    const apiBase = getApiBaseUrl()
    const response = await fetch(`${apiBase}/api/admin/investments/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ investmentId })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || 'Failed to approve investment');
    }

    const payload = await response.json();
    if (!payload || !payload.investment) {
      throw new Error('Invalid approval response from server');
    }

    return mapInvestmentRecord(payload.investment);
  },

  async approveWithdrawal(withdrawalId: string): Promise<WithdrawalRecord> {
    const apiBase = getApiBaseUrl()
    const response = await fetch(`${apiBase}/api/admin/withdrawals/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ withdrawalId })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || 'Failed to approve withdrawal');
    }

    const payload = await response.json();
    if (!payload || !payload.withdrawal) {
      throw new Error('Invalid approval response from server');
    }

    return mapWithdrawalRecord(payload.withdrawal);
  },

  async deleteInvestment(id: string): Promise<void> {
    const { error } = await db
      .from('investments')
      .delete()
      .eq('id', id)
    
    if (error) throw error
  },

  // Withdrawal operations
  async getAllWithdrawals(): Promise<WithdrawalRecord[]> {
    const { data, error } = await db
      .from('withdrawals')
      .select('*')
      .order('created_at', { ascending: false })
    
    if (error) throw error
    return data || []
  },

  async getWithdrawalsByUser(idnum: string): Promise<WithdrawalRecord[]> {
    const { data, error } = await db
      .from('withdrawals')
      .select('*')
      .eq('idnum', idnum)
      .order('created_at', { ascending: false })
    
    if (error) throw error
    return data || []
  },

  async createWithdrawal(withdrawalData: Partial<WithdrawalRecord>): Promise<WithdrawalRecord> {
    const { data, error } = await db
      .from('withdrawals')
      .insert([withdrawalData])
      .select()
      .single()
    
    if (error) throw error

    // Notify Backend
    if (data && data.idnum) {
      const user = await supabaseDb.getUserByIdnum(data.idnum)
      if (user && user.email) {
        notifyBackend('/api/notify/withdrawal-request', {
          userEmail: user.email,
          userName: user.name || user.email,
          amount: data.amount,
          method: data.method,
          wallet: data.walletAddress || data.accountNumber
        })
      }
    }

    return data
  },

  async updateWithdrawal(id: string, updates: Partial<WithdrawalRecord>): Promise<WithdrawalRecord> {
    const { data, error } = await db
      .from('withdrawals')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    
    if (error) throw error

    // Notify if status changed
    if (data && updates.status && ['approved', 'rejected'].includes(updates.status)) {
       const user = await supabaseDb.getUserByIdnum(data.idnum!)
       if (user && user.email) {
         notifyBackend('/api/notify/withdrawal-status', {
           userEmail: user.email,
           userName: user.name || user.email,
           amount: data.amount,
           status: updates.status,
           reason: 'Processed by admin'
         })
       }
    }

    return data
  },

  async uploadPaymentProof(userId: string, file: File): Promise<string> {
    const fileExt = file.name.split('.').pop()
    const fileName = `${userId}/${Date.now()}.${fileExt}`

    const { error: uploadError } = await (supabase as any).storage
      .from('payment-proofs')
      .upload(fileName, file)

    if (uploadError) throw uploadError

    const { data } = (supabase as any).storage
      .from('payment-proofs')
      .getPublicUrl(fileName)

    return data.publicUrl
  },

  async uploadKycDocument(userId: string, file: File, docType: string): Promise<string> {
    const fileExt = file.name.split('.').pop()
    const fileName = `${userId}/${docType}_${Date.now()}.${fileExt}`

    const { error: uploadError } = await (supabase as any).storage
      .from('kyc-documents')
      .upload(fileName, file)

    if (uploadError) throw uploadError

    const { data } = (supabase as any).storage
      .from('kyc-documents')
      .getPublicUrl(fileName)

    return data.publicUrl
  },

  // Deposit operations
  async getAllDeposits(): Promise<DepositRecord[]> {
    const { data, error } = await db
      .from('deposits')
      .select('*')
      .order('created_at', { ascending: false })
    
    if (error) throw error
    return data || []
  },

  async getDepositsByUser(idnum: string): Promise<DepositRecord[]> {
    const { data, error } = await db
      .from('deposits')
      .select('*')
      .eq('idnum', idnum)
      .order('created_at', { ascending: false })
    
    if (error) throw error
    return data || []
  },

  async createDeposit(depositData: Partial<DepositRecord>): Promise<DepositRecord> {
    const { data, error } = await db
      .from('deposits')
      .insert([depositData])
      .select()
      .single()
    
    if (error) throw error

    // Notify Backend
    if (data && data.idnum) {
      const user = await supabaseDb.getUserByIdnum(data.idnum)
      if (user && user.email) {
        const proofUrl =
          data.paymentProofUrl && !/^https?:\/\//i.test(data.paymentProofUrl)
            ? (supabase as any).storage.from('payment-proofs').getPublicUrl(data.paymentProofUrl).data.publicUrl
            : data.paymentProofUrl

        notifyBackend('/api/notify/deposit-request', {
          userEmail: user.email,
          userName: user.name || user.email,
          amount: data.amount,
          method: data.method,
          txHash: data.transactionHash,
          proofUrl
        })
      }
    }

    return data
  },

  async updateDeposit(id: string, updates: Partial<DepositRecord>): Promise<DepositRecord> {
    const { data, error } = await db
      .from('deposits')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    
    if (error) throw error

    // Notify if status changed
    if (data && updates.status && ['approved', 'rejected'].includes(updates.status)) {
       const user = await supabaseDb.getUserByIdnum(data.idnum!)
       if (user && user.email) {
         notifyBackend('/api/notify/deposit-status', {
           userEmail: user.email,
           userName: user.name || user.email,
           amount: data.amount,
           status: updates.status,
           reason: 'Review complete' // You could pass rejection reason if schema supported it
         })
       }
    }

    return data
  },

  // KYC operations
  async getAllKycRequests(): Promise<KycRecord[]> {
    const { data, error } = await db
      .from('kyc_verifications')
      .select('*')
      .order('submittedAt', { ascending: false })
    
    if (error) throw error
    return data || []
  },

  async getKycByUser(idnum: string): Promise<KycRecord[]> {
    const { data, error } = await db
      .from('kyc_verifications')
      .select('*')
      .eq('idnum', idnum)
      .order('submittedAt', { ascending: false })
    
    if (error) throw error
    return data || []
  },

  async updateKycStatus(id: string, status: string, rejectionReason?: string): Promise<KycRecord> {
    const updates: any = { status, reviewedAt: new Date().toISOString() }
    if (rejectionReason) updates.rejectionReason = rejectionReason
    
    const { data, error } = await db
      .from('kyc_verifications')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    
    if (error) throw error
    return data
  },

  async createKyc(kycData: Partial<KycRecord>): Promise<KycRecord> {
    const { data, error } = await db
      .from('kyc_verifications')
      .insert([kycData])
      .select()
      .single()
    
    if (error) throw error
    return data
  },

  // Notification operations
  async getNotificationsByUser(idnum: string): Promise<NotificationRecord[]> {
    const { data, error } = await db
      .from('notifications')
      .select('*')
      .eq('idnum', idnum)
      .order('created_at', { ascending: false })
    
    if (error) throw error
    return data || []
  },

  async createNotification(notificationData: Partial<NotificationRecord>): Promise<NotificationRecord> {
    const { data, error } = await db
      .from('notifications')
      .insert([notificationData])
      .select()
      .single()
    
    if (error) throw error
    return data
  },

  async markNotificationAsRead(id: string): Promise<NotificationRecord> {
    const { data, error } = await db
      .from('notifications')
      .update({ read: true })
      .eq('id', id)
      .select()
      .single()
    
    if (error) throw error
    return data
  },

  async markAllNotificationsAsRead(idnum: string): Promise<void> {
    const { error } = await db
      .from('notifications')
      .update({ read: true })
      .eq('idnum', idnum)
      .eq('read', false)
    
    if (error) throw error
  },

  // Loan operations
  async getAllLoans(): Promise<LoanRecord[]> {
    const { data, error } = await db
      .from('loans')
      .select('*')
      .order('created_at', { ascending: false })
    
    if (error) throw error
    return data || []
  },

  async getLoansByUser(idnum: string): Promise<LoanRecord[]> {
    const { data, error } = await db
      .from('loans')
      .select('*')
      .eq('idnum', idnum)
      .order('created_at', { ascending: false })
    
    if (error) throw error
    return data || []
  },

  async createLoan(loan: LoanRecord): Promise<LoanRecord> {
    const { data, error } = await db
      .from('loans')
      .insert(loan)
      .select()
      .single()
    
    if (error) throw error
    return data
  },

  async updateLoan(id: string, updates: Partial<LoanRecord>): Promise<LoanRecord> {
    const { data, error } = await db
      .from('loans')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    
    if (error) throw error
    return data
  },
}

// Realtime subscriptions
export const supabaseRealtime = {
  subscribeToUsers(callback: (payload: any) => void) {
    return db
      .channel('userlogs-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'userlogs' }, callback)
      .subscribe()
  },

  subscribeToInvestments(callback: (payload: any) => void) {
    return db
      .channel('investments-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'investments' }, callback)
      .subscribe()
  },

  subscribeToWithdrawals(callback: (payload: any) => void) {
    return db
      .channel('withdrawals-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'withdrawals' }, callback)
      .subscribe()
  },

  subscribeToDeposits(callback: (payload: any) => void) {
    return db
      .channel('deposits-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deposits' }, callback)
      .subscribe()
  },

  subscribeToLoans(callback: (payload: any) => void) {
    return db
      .channel('loans-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'loans' }, callback)
      .subscribe()
  },

  subscribeToKyc(callback: (payload: any) => void) {
    return db
      .channel('kyc-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kyc_verifications' }, callback)
      .subscribe()
  },
}

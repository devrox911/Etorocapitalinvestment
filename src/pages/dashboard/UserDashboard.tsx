import { useState, useEffect, useContext, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import LanguageSwitcher from '@/components/ui/LanguageSwitcher'
import { useNavigate, Link } from 'react-router-dom'
import { supabaseDb, supabaseRealtime, supabase, DepositRecord, ReferralRecord } from '@/lib/supabaseUtils'
import { PLAN_CONFIG, formatPercent } from '@/utils/planConfig'
import { UserRole } from '@/utils/roles'
import { fetchCryptoPrices, fetchDetailedCryptoPrices, formatPrice, formatMarketCap, CryptoPrice, CryptoPrices } from '@/utils/cryptoPrices'
import {
  sendWithdrawalNotification,
  sendKYCNotification,
  sendLoanNotification
} from '@/utils/emailService'
import { useAuth } from '@/context/AuthContext'
import StockTrading from '@/pages/StockTrading'
import '@/styles/modern-dashboard.css'

interface UserData {
  id?: string
  idnum?: string
  name?: string
  userName?: string
  email?: string
  balance?: number
  bonus?: number
  referralCount?: number
  referralBonusTotal?: number
  referralCode?: string
  phoneNumber?: string
  country?: string
  city?: string
  address?: string
  role?: UserRole
  avatar?: string
}

interface Investment {
  id?: string
  plan?: string
  capital?: number
  roi?: number
  dailyRoi?: number        // Daily ROI amount
  earnedRoi?: number       // ROI earned so far (credited daily)
  totalExpectedRoi?: number // Total expected ROI at end of duration
  bonus?: number
  creditedRoi?: number     // Total ROI credited to user
  creditedBonus?: number   // Total bonus credited to user
  status?: string
  date?: string
  startDate?: string | null       // When investment was activated
  updated_at?: string
  created_at?: string
  duration?: number
  daysCompleted?: number   // Days that have been credited
  authStatus?: string
}

interface RoiPopupItem {
  id: string
  plan: string
  amount: number
  status?: string
}

interface DummyInvestmentAlert {
  id: string
  userName: string
  amount: number
  plan: string
  location: string
}

const formatCurrency = (amount: number = 0) =>
  amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const getReferralUsername = (referral: ReferralRecord) =>
  referral.referredUser?.userName?.trim() || 'Username unavailable'

const getReferralDetails = (referral: ReferralRecord) => {
  const pieces = [
    referral.referredUser?.name?.trim(),
    referral.referredId ? `ID: ${referral.referredId}` : '',
    referral.created_at ? new Date(referral.created_at).toLocaleDateString() : 'Referral signup',
  ].filter(Boolean)

  return pieces.join(' • ')
}

const getInvestmentEarnings = (investment: Investment) =>
  (Number(investment.creditedRoi || 0) + Number(investment.creditedBonus || 0)) ||
  Number(investment.earnedRoi || 0) ||
  Number(investment.roi || 0)

const getTodayKey = () => new Date().toISOString().slice(0, 10)

const DashboardMarquee = ({ btcPrice, loading }: { btcPrice: number; loading: boolean }) => {
  const bitcoinMessage = btcPrice > 0
    ? `Bitcoin live price: $${formatPrice(btcPrice)}/BTC. Trade with 0% fees on selected pairs.`
    : loading
      ? 'Loading live Bitcoin price...'
      : 'Bitcoin live price temporarily unavailable. Trade with 0% fees on selected pairs.'

  return (
  <div className="dashboard-marquee">
    <div className="marquee-content">
      <span className="marquee-item"><i className="icofont-rocket-alt-2"></i> {bitcoinMessage}</span>
      <span className="marquee-item"><i className="icofont-star"></i> New "Diamond Hands" Plan available: Earn 150% ROI in 30 Days.</span>
      <span className="marquee-item"><i className="icofont-gift"></i> Limited Time: Refer a friend and earn 10% commission on their first deposit or investment!</span>
      <span className="marquee-item"><i className="icofont-shield-alt"></i> Security Update: Enable 2FA for enhanced account protection.</span>
      <span className="marquee-item"><i className="icofont-chart-growth"></i> Top Gainer: ETH up 12% in the last 24 hours.</span>
      <span className="marquee-item"><i className="icofont-info-circle"></i> System Maintenance scheduled for Sunday 02:00 UTC.</span>
    </div>
  </div>
  )
}

const DUMMY_INVESTMENT_ALERTS: Omit<DummyInvestmentAlert, 'id'>[] = [
  { userName: 'Michael R.', amount: 2400, plan: '3-Day Plan', location: 'Canada' },
  { userName: 'Sophia M.', amount: 6800, plan: '7-Day Plan', location: 'United Kingdom' },
  { userName: 'Daniel K.', amount: 12500, plan: '12-Day Plan', location: 'Germany' },
  { userName: 'Aisha B.', amount: 18000, plan: '15-Day Plan', location: 'UAE' },
  { userName: 'Robert L.', amount: 47500, plan: '3-Month Plan', location: 'United States' },
  { userName: 'Elena V.', amount: 62500, plan: '6-Month Plan', location: 'Spain' },
  { userName: 'James T.', amount: 95000, plan: '3-Month Plan', location: 'Australia' },
  { userName: 'Nora H.', amount: 135000, plan: '6-Month Plan', location: 'Switzerland' },
  { userName: 'Samuel P.', amount: 8200, plan: '7-Day Plan', location: 'South Africa' },
  { userName: 'Isabella C.', amount: 28500, plan: '15-Day Plan', location: 'Italy' },
  { userName: 'Omar S.', amount: 72000, plan: '3-Month Plan', location: 'Qatar' },
  { userName: 'Grace W.', amount: 155000, plan: '6-Month Plan', location: 'Singapore' },
]

const randomBetween = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min

function UserDashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user: currentUser, isAuthenticated, updateUser, logout } = useAuth();
  const kycSectionRef = useRef<HTMLDivElement | null>(null);
  const [scrollToKycOnProfileOpen, setScrollToKycOnProfileOpen] = useState(false);

  const trimTrailingSlash = (value: string) => value.replace(/\/$/, '');
  const getApiBaseUrl = () => {
    const currentOrigin =
      typeof window !== 'undefined' ? trimTrailingSlash(window.location.origin) : '';
    const appUrl = trimTrailingSlash(import.meta.env.VITE_APP_URL || '');
    const serverUrl = trimTrailingSlash(import.meta.env.VITE_SERVER_URL || '');
    const isLocalBrowser =
      typeof window !== 'undefined' &&
      /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname);

    if (isLocalBrowser && serverUrl) return serverUrl;
    return currentOrigin || appUrl || serverUrl;
  };

  // Note: Removed automatic profit detection on balance changes
  // Profit notifications should only be sent from backend when ROI is actually credited

  const syncSessionUser = (dbUser: any) => {
    // Sync user data without checking for profit credits
    // The backend will send explicit profit credit notifications when ROI is credited via cron jobs
    
    updateUser({
      id: dbUser.id,
      email: dbUser.email,
      name: dbUser.name,
      userName: dbUser.userName,
      role: dbUser.role || currentUser?.role,
      idnum: dbUser.idnum,
      balance: dbUser.balance,
      bonus: dbUser.bonus,
      referralCount: dbUser.referralCount,
      avatar: dbUser.avatar,
      completedTrades: dbUser.completedTrades,
      phoneNumber: dbUser.phoneNumber,
      address: dbUser.address,
      city: dbUser.city,
      country: dbUser.country,
      referralCode: dbUser.referralCode,
      referralBonusTotal: dbUser.referralBonusTotal,
      authStatus: dbUser.authStatus,
    });
  };

  // Polling-based user balance refresh
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    async function fetchLatestUser() {
      if (currentUser?.idnum) {
        try {
          const dbUser = await supabaseDb.getUserByIdnum(currentUser.idnum);
          if (dbUser) {
            syncSessionUser(dbUser);
          }
        } catch (err) {
          console.warn('Could not refresh user balance:', err);
        }
      }
    }
    fetchLatestUser();
    interval = setInterval(fetchLatestUser, 30000); // 30 seconds
    return () => { if (interval) clearInterval(interval); };
  }, [currentUser?.idnum, updateUser]);

      // Notification type
      interface Notification {
        id: string | number;
        message: string;
        type: string;
        read: boolean;
        title?: string;
        created_at?: string;
      }
      // Notifications state
      const [notifications, setNotifications] = useState<Notification[]>([]);

  // Helper function to add notifications for account activities
  const addNotification = async (title: string, message: string, type: 'success' | 'info' | 'warning' | 'error' = 'info') => {
    // Create local temporary ID
    const tempId = Date.now();
    
    // Optimistic UI update
    const newNotification: Notification = {
      id: tempId,
      title,
      message,
      type,
      read: false,
      created_at: new Date().toISOString()
    };
    
    setNotifications(prev => [newNotification, ...prev]);
    
    // Persist to Supabase if user is logged in
    if (currentUser?.idnum) {
      try {
        await supabaseDb.createNotification({
          idnum: currentUser.idnum,
          title,
          message,
          type,
          read: false
        });
      } catch (err) {
        console.error('Failed to save notification to database:', err);
      }
    }
    
    // Also persist to localStorage as backup
    const stored = JSON.parse(localStorage.getItem('userNotifications') || '[]');
    stored.unshift(newNotification);
    localStorage.setItem('userNotifications', JSON.stringify(stored.slice(0, 50))); // Keep last 50
  };
  // Notifications modal state
  const [showNotifications, setShowNotifications] = useState(false);
  // Track the last displayed success notification ID for auto-dismiss
  const [lastDisplayedSuccessId, setLastDisplayedSuccessId] = useState<string | number | null>(null);

  // Auto-dismiss toast notification after 5 seconds
  useEffect(() => {
    const recentSuccess = notifications.find((n: Notification) => n.type === 'success');
    if (recentSuccess && recentSuccess.id !== lastDisplayedSuccessId) {
      setLastDisplayedSuccessId(recentSuccess.id);
      const timeout = setTimeout(() => {
        // Remove this notification from the list to hide the toast
        setNotifications(prev => prev.filter(n => n.id !== recentSuccess.id));
        setLastDisplayedSuccessId(null);
      }, 5000); // 5 seconds
      return () => clearTimeout(timeout);
    }
  }, [notifications, lastDisplayedSuccessId]);

      // Helper to force balance refresh after deposit or admin update
      async function refreshUserBalance() {
        if (currentUser?.idnum) {
          try {
            const dbUser = await supabaseDb.getUserByIdnum(currentUser.idnum);
            if (dbUser) {
              syncSessionUser(dbUser);
            }
          } catch (err) {
            console.error('Failed to refresh balance:', err);
          }
        }
      }

  // Live Crypto prices state
  const [cryptoPrices, setCryptoPrices] = useState<CryptoPrices>({ BTC: 0, ETH: 0, USDT: 1, BNB: 0, XRP: 0, SOL: 0, DOGE: 0, ADA: 0 });
  const [cryptoDetails, setCryptoDetails] = useState<CryptoPrice[]>([]);
  const [cryptoLoading, setCryptoLoading] = useState(true);

  // Fetch live crypto prices with enhanced real-time updates
  useEffect(() => {
    async function loadCryptoPrices() {
      setCryptoLoading(true);
      try {
        console.log('📊 Loading real-time crypto prices for dashboard...');
        const [prices, details] = await Promise.all([
          fetchCryptoPrices(),
          fetchDetailedCryptoPrices()
        ]);

        // Validate that we have real data
        const validPrices = Object.values(prices).filter(p => p > 0).length;
        if (validPrices >= 3) {
          setCryptoPrices(prices);
          setCryptoDetails(details);
          console.log(`✅ Dashboard crypto prices updated: ${validPrices} valid prices, ${details.length} detailed entries`);
        } else {
          console.warn('⚠️ Insufficient real-time data received, keeping previous values');
        }
      } catch (error) {
        console.error('❌ Failed to load crypto prices:', error);
      }
      setCryptoLoading(false);
    }

    // Initial load
    loadCryptoPrices();

    // Update every 30 seconds for real-time trading data (reduced frequency for better performance)
    const interval = setInterval(loadCryptoPrices, 30000);
    return () => clearInterval(interval);
  }, []);

  // Modal alert state
  const [modalAlert, setModalAlert] = useState({ show: false, type: 'info', title: '', message: '' });
  function closeAlert() { setModalAlert({ ...modalAlert, show: false }); }

  // Confirm modal state
  const [confirmModal, setConfirmModal] = useState({ show: false, title: '', message: '', onConfirm: () => {}, onCancel: () => {}, confirmText: '', cancelText: '' });
  function closeConfirm() { setConfirmModal({ ...confirmModal, show: false }); }
  // ...other state and function declarations...

  // ...all state and function declarations...

  // ...all state and function declarations...

  // ...all state and function declarations...

  // ...all state and function declarations...

  useEffect(() => {
    // Use current user from AuthContext
    const userData = currentUser;

    async function initDashboard() {
      try {
        // Check if user is authenticated
        if (!isAuthenticated || !userData) {
          navigate('/login');
          return;
        }

        // Initialize email service (no-op; server-side email delivery will handle sending)
        // Fetch real investments from database
        try {
          console.log('Fetching investments for user:', userData.idnum);
          console.log('User data:', userData);
          if (userData.idnum) {
            const userInvestments = await supabaseDb.getInvestmentsByUser(userData.idnum);
            console.log('Raw investments from database:', userInvestments);
            console.log('Number of investments fetched:', userInvestments.length);
            setInvestments(userInvestments);
            // Update localStorage for consistency
            localStorage.setItem('userInvestments', JSON.stringify(userInvestments));
            console.log('Investments saved to state and localStorage');

            const referralSummary = await supabaseDb.getReferralSummary(userData.idnum, userData.referralCode);
            setDownlineReferrals(referralSummary.referrals);
            if (
              referralSummary.count !== (userData.referralCount || 0) ||
              referralSummary.bonusTotal !== (userData.referralBonusTotal || 0)
            ) {
              syncSessionUser({
                ...userData,
                referralCount: Math.max(referralSummary.count, userData.referralCount || 0),
                referralBonusTotal: Math.max(referralSummary.bonusTotal, userData.referralBonusTotal || 0),
              });
            }
            
            // Fetch withdrawals
            const userWithdrawals = await supabaseDb.getWithdrawalsByUser(userData.idnum);
            setWithdrawals(userWithdrawals);

            // Fetch deposits
            const userDeposits = await supabaseDb.getDepositsByUser(userData.idnum);
            setDeposits(userDeposits);

          } else {
            console.warn('No user idnum found for fetching investments');
          }
        } catch (dbError) {
          console.error('Database fetch error:', dbError);
          console.log('Could not fetch investments from database, using localStorage:', dbError);
          // Fallback to localStorage
          const investmentsRaw = localStorage.getItem('userInvestments');
          if (investmentsRaw) {
            const localInvestments = JSON.parse(investmentsRaw);
            console.log('Loaded from localStorage:', localInvestments.length, 'investments');
            setInvestments(localInvestments);
          } else {
            console.log('No investments found in localStorage either');
            setInvestments([]);
          }
        }

        // Fetch real notifications from database
        try {
          if (userData.idnum) {
            const userNotifications = await supabaseDb.getNotificationsByUser(userData.idnum);
            const formattedNotifications = userNotifications.map(notif => ({
              id: notif.id || Date.now().toString(),
              title: notif.title || 'Notification',
              message: notif.message || '',
              type: notif.type || 'info',
              read: notif.read || false,
              created_at: notif.created_at || new Date().toISOString()
            }));
            setNotifications(formattedNotifications);
            localStorage.setItem('userNotifications', JSON.stringify(formattedNotifications));
          }
        } catch (dbError) {
          console.log('Could not fetch notifications from database, using localStorage:', dbError);
          // Fallback to localStorage notifications
          const storedNotifications = localStorage.getItem('userNotifications');
          if (storedNotifications) {
            const parsedNotifications = JSON.parse(storedNotifications);
            // Add welcome notification if no notifications exist
            if (parsedNotifications.length === 0) {
              const welcomeNotification: Notification = {
                id: Date.now(),
                title: t('notifications.welcomeTitle'),
                message: t('notifications.welcomeMessage'),
                type: 'info',
                read: false,
                created_at: new Date().toISOString()
              };
              setNotifications([welcomeNotification]);
              localStorage.setItem('userNotifications', JSON.stringify([welcomeNotification]));
            } else {
              setNotifications(parsedNotifications);
            }
          } else {
            // First time user - set welcome notification
            const welcomeNotification: Notification = {
              id: Date.now(),
              title: t('notifications.welcomeTitle'),
              message: t('notifications.welcomeMessageWithName', { name: userData.name || userData.userName || 'to your dashboard' }),
              type: 'success',
              read: false,
              created_at: new Date().toISOString()
            };
            setNotifications([welcomeNotification]);
            localStorage.setItem('userNotifications', JSON.stringify([welcomeNotification]));
          }
        }

        // Fetch KYC data from database
        try {
          if (userData.idnum) {
            const userKyc = await supabaseDb.getKycByUser(userData.idnum);
            if (userKyc && userKyc.length > 0) {
              // Get the most recent KYC submission
              const latestKyc = userKyc.sort((a, b) => new Date(b.submittedAt || 0).getTime() - new Date(a.submittedAt || 0).getTime())[0];
              setKycData(latestKyc);
            }
          }
        } catch (dbError) {
          console.log('Could not fetch KYC data from database:', dbError);
          setKycData(null);
        }

        // Fetch Loans from database
        try {
          if (userData.idnum) {
            const userLoans = await supabaseDb.getLoansByUser(userData.idnum);
            if (userLoans && userLoans.length > 0) {
              setLoans(userLoans);
            }
          }
        } catch (dbError) {
          console.log('Could not fetch loans from database:', dbError);
          setLoans([]);
        }

        // Fetch Withdrawals from database
        try {
          if (userData.idnum) {
            const userWithdrawals = await supabaseDb.getWithdrawalsByUser(userData.idnum);
            if (userWithdrawals && userWithdrawals.length > 0) {
              setWithdrawals(userWithdrawals);
            }
          }
        } catch (dbError) {
          console.log('Could not fetch withdrawals from database:', dbError);
          setWithdrawals([]);
        }

        // Set up real-time subscriptions
        if (userData?.idnum) {
          // KYC status updates subscription
          const kycSubscription = supabaseRealtime.subscribeToKyc(async (payload) => {
            console.log('KYC update received:', payload);
            if (payload.new && payload.new.userId === userData.idnum) {
              // Refresh KYC data when status changes
              try {
                if (userData.idnum) {
                  const userKyc = await supabaseDb.getKycByUser(userData.idnum);
                  if (userKyc && userKyc.length > 0) {
                    const latestKyc = userKyc.sort((a, b) => new Date(b.submittedAt || 0).getTime() - new Date(a.submittedAt || 0).getTime())[0];
                    setKycData(latestKyc);
                    
                    // Show notification for status change
                    if (latestKyc.status === 'approved') {
                    addNotification(
                        t('alerts.titleKycApproved') + ' ✅',
                        t('alerts.kycApproved'),
                        'success'
                      );
                      showAlert('success', t('alerts.titleKycApproved'), t('alerts.kycApproved'));
                  } else if (latestKyc.status === 'rejected') {
                    addNotification(
                      t('alerts.titleKycUpdate'),
                      t('alerts.kycUpdate'),
                      'warning'
                    );
                    showAlert('warning', t('alerts.titleKycUpdate'), t('alerts.kycUpdate'));
                  }
                }
              }
              } catch (error) {
                console.error('Error refreshing KYC data:', error);
              }
            }
          });

          // Store subscription for cleanup
          (window as any).kycSubscription = kycSubscription;

          // Loan status updates subscription
          const loanSubscription = supabaseRealtime.subscribeToLoans(async (payload) => {
            console.log('Loan update received:', payload);
            if (payload.new && payload.new.idnum === userData.idnum) {
              // Refresh loan data when status changes
              try {
                if (userData.idnum) {
                  const userLoans = await supabaseDb.getLoansByUser(userData.idnum);
                  if (userLoans && userLoans.length > 0) {
                    setLoans(userLoans);

                    // Show notification for status change
                    const updatedLoan = userLoans.find(l => l.id === payload.new.id);
                    if (updatedLoan) {
                      if (updatedLoan.status === 'approved') {
                        addNotification(
                          'Loan Approved',
                          `Your loan request of $${updatedLoan.amount?.toLocaleString()} has been approved.`,
                          'success'
                        );
                        showAlert('success', 'Loan Approved!', `Your loan request of $${updatedLoan.amount?.toLocaleString()} has been approved.`);
                      } else if (updatedLoan.status === 'rejected') {
                        addNotification(
                          'Loan Application Update',
                          `Your loan request of $${updatedLoan.amount?.toLocaleString()} has been reviewed.`,
                          'warning'
                        );
                        showAlert('warning', 'Loan Application Update', 'Your loan request has been reviewed. Please check your dashboard for details.');
                      }
                    }
                  }
                }
              } catch (error) {
                console.error('Error refreshing loan data:', error);
              }
            }
          });

          // Store subscription for cleanup
          (window as any).loanSubscription = loanSubscription;

          // Investment status updates subscription
          const investmentSubscription = supabaseRealtime.subscribeToInvestments(async (payload) => {
            console.log('Investment update received:', payload);
            if (payload.new && payload.new.idnum === userData.idnum) {
              // Refresh investment data when status changes
              try {
                if (userData.idnum) {
                  const userInvestments = await supabaseDb.getInvestmentsByUser(userData.idnum);
                  setInvestments(userInvestments);

                  // Show notification for status change
                  const updatedInvestment = userInvestments.find(inv => inv.id === payload.new.id);
                  if (updatedInvestment) {
                    if (updatedInvestment.status === 'Active') {
                      addNotification(
                        'Investment Approved',
                        `Your investment of $${updatedInvestment.capital?.toLocaleString()} in ${updatedInvestment.plan} has been approved and is now active.`,
                        'success'
                      );
                      showAlert('success', 'Investment Approved!', `Your investment of $${updatedInvestment.capital?.toLocaleString()} has been approved and is now active.`);
                    } else if (updatedInvestment.status === 'Rejected') {
                      addNotification(
                        'Investment Application Update',
                        `Your investment request of $${updatedInvestment.capital?.toLocaleString()} has been reviewed.`,
                        'warning'
                      );
                      showAlert('warning', 'Investment Application Update', 'Your investment request has been reviewed. Please check your dashboard for details.');
                    }
                  }
                }
              } catch (error) {
                console.error('Error refreshing investment data:', error);
              }
            }
          });

          // Store subscription for cleanup
          (window as any).investmentSubscription = investmentSubscription;

          // Withdrawal status updates subscription
          const withdrawalSubscription = supabaseRealtime.subscribeToWithdrawals(async (payload) => {
            console.log('Withdrawal update received:', payload);
            if (payload.new && payload.new.idnum === userData.idnum) {
              // Show notification for status change (withdrawals are not stored in state since they're not displayed in UI)
              if (payload.new.status === 'Approved') {
                addNotification(
                  'Withdrawal Approved! ✅',
                  `Your withdrawal request of $${payload.new.amount?.toLocaleString()} has been approved and processed.`,
                  'success'
                );
                showAlert('success', 'Withdrawal Approved!', `Your withdrawal request of $${payload.new.amount?.toLocaleString()} has been approved and processed.`);
              } else if (payload.new.status === 'Rejected') {
                addNotification(
                  'Withdrawal Request Update',
                  `Your withdrawal request of $${payload.new.amount?.toLocaleString()} has been reviewed.`,
                  'warning'
                );
                showAlert('warning', 'Withdrawal Request Update', 'Your withdrawal request has been reviewed. Please check your dashboard for details.');
              }
            }
          });

          // Store subscription for cleanup
          (window as any).withdrawalSubscription = withdrawalSubscription;
        }
      } catch (error) {
        console.error('Error initializing dashboard:', error);
        navigate('/login');
      } finally {
        setLoading(false);
      }
    }
    initDashboard();
  }, [navigate]);

  // Cleanup subscriptions on unmount
  useEffect(() => {
    return () => {
      if ((window as any).kycSubscription) {
        (window as any).kycSubscription.unsubscribe();
      }
      if ((window as any).loanSubscription) {
        (window as any).loanSubscription.unsubscribe();
      }
      if ((window as any).investmentSubscription) {
        (window as any).investmentSubscription.unsubscribe();
      }
      if ((window as any).withdrawalSubscription) {
        (window as any).withdrawalSubscription.unsubscribe();
      }
    };
  }, []);

  // Auto-refresh all tables every 20 seconds
  useEffect(() => {
    let refreshInterval: ReturnType<typeof setInterval> | null = null;
    
    const refreshAllData = async () => {
      try {
        if (!currentUser?.idnum) return;

        // Fetch all user data in parallel
        const [investments, withdrawals, loans, deposits, referralSummary] = await Promise.all([
          supabaseDb.getInvestmentsByUser(currentUser.idnum),
          supabaseDb.getWithdrawalsByUser(currentUser.idnum),
          supabaseDb.getLoansByUser(currentUser.idnum),
          supabaseDb.getDepositsByUser(currentUser.idnum),
          supabaseDb.getReferralSummary(currentUser.idnum, currentUser.referralCode),
        ]);

        // Update all state with fresh data
        if (investments) {
          setInvestments(investments);
        }
        if (withdrawals) {
          setWithdrawals(withdrawals);
        }
        if (loans) {
          setLoans(loans);
        }
        if (deposits) {
          setDeposits(deposits);
        }
        if (referralSummary) {
          setDownlineReferrals(referralSummary.referrals);
          const syncedReferralCount = Math.max(referralSummary.count, currentUser.referralCount || 0);
          const syncedReferralBonus = Math.max(referralSummary.bonusTotal, currentUser.referralBonusTotal || 0);
          if (
            syncedReferralCount !== (currentUser.referralCount || 0) ||
            syncedReferralBonus !== (currentUser.referralBonusTotal || 0)
          ) {
            updateUser({
              referralCount: syncedReferralCount,
              referralBonusTotal: syncedReferralBonus,
            });
          }
        }
      } catch (error) {
        console.warn('Auto-refresh failed for user dashboard:', error);
      }
    };

    // Set up auto-refresh interval (5 seconds)
    refreshInterval = setInterval(refreshAllData, 5000);

    // Cleanup interval on unmount
    return () => {
      if (refreshInterval) clearInterval(refreshInterval);
    };
  }, [currentUser?.idnum, currentUser?.referralCode, currentUser?.referralCount, currentUser?.referralBonusTotal, updateUser]);

  // Placeholder alert/confirm functions
  function showAlert(type: string, title: string, message: string) {
    setModalAlert({ show: true, type, title, message });
    setTimeout(() => setModalAlert((prev) => ({ ...prev, show: false })), 5000)
  }

  function showConfirm(title: string, message: string, onConfirm: () => void, onCancel?: () => void, confirmText?: string, cancelText?: string) {
    if (window.confirm(`${title}: ${message}`)) {
      onConfirm();
    } else if (onCancel) {
      onCancel();
    }
  }
  const [loading, setLoading] = useState(true)
  const [investments, setInvestments] = useState<Investment[]>([])
  const [withdrawals, setWithdrawals] = useState<any[]>([])
  const [downlineReferrals, setDownlineReferrals] = useState<ReferralRecord[]>([])
  const [roiPopup, setRoiPopup] = useState<{ show: boolean; items: RoiPopupItem[]; total: number; storageKey: string; signature: string }>({
    show: false,
    items: [],
    total: 0,
    storageKey: '',
    signature: '',
  })
  const [investmentError, setInvestmentError] = useState<string | null>(null)
  const [loans, setLoans] = useState<any[]>([])
  const [kycData, setKycData] = useState<any>(null)
  const [profileState, setProfileState] = useState<string>('Dashboard')
  const [showSidePanel, setShowSidePanel] = useState(false)
  const [dummyInvestmentAlert, setDummyInvestmentAlert] = useState<DummyInvestmentAlert | null>(null)

  useEffect(() => {
    let showTimer: ReturnType<typeof setTimeout> | null = null
    let hideTimer: ReturnType<typeof setTimeout> | null = null
    let cancelled = false

    const showNextAlert = () => {
      if (cancelled) return

      const alert = DUMMY_INVESTMENT_ALERTS[randomBetween(0, DUMMY_INVESTMENT_ALERTS.length - 1)]
      setDummyInvestmentAlert({
        ...alert,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      })

      hideTimer = setTimeout(() => {
        setDummyInvestmentAlert(null)
      }, 7200)

      showTimer = setTimeout(showNextAlert, randomBetween(22000, 38000))
    }

    showTimer = setTimeout(showNextAlert, randomBetween(4500, 9000))

    return () => {
      cancelled = true
      if (showTimer) clearTimeout(showTimer)
      if (hideTimer) clearTimeout(hideTimer)
    }
  }, [])

  useEffect(() => {
    if (!currentUser?.idnum || investments.length === 0) return;

    const items = investments
      .map((investment) => ({
        id: investment.id || `${investment.plan}-${investment.date || investment.created_at || ''}`,
        plan: investment.plan || 'Investment Plan',
        amount: getInvestmentEarnings(investment),
        status: investment.status,
      }))
      .filter((item) => item.amount > 0);

    if (items.length === 0) return;

    const signature = items
      .map((item) => `${item.id}:${item.amount}`)
      .sort()
      .join('|');
    const storageKey = `roi-return-popup:${currentUser.idnum}:${getTodayKey()}`;

    if (localStorage.getItem(storageKey) === signature) return;

    setRoiPopup({
      show: true,
      items,
      total: items.reduce((sum, item) => sum + item.amount, 0),
      storageKey,
      signature,
    });
  }, [currentUser?.idnum, investments]);

  const closeRoiPopup = () => {
    if (roiPopup.storageKey && roiPopup.signature) {
      localStorage.setItem(roiPopup.storageKey, roiPopup.signature);
    }
    setRoiPopup((prev) => ({ ...prev, show: false }));
  };
  const [editMode, setEditMode] = useState(false)
  const [editForm, setEditForm] = useState({
    name: '',
    userName: '',
    email: '',
    phoneNumber: '',
    country: '',
    city: '',
    address: ''
  })
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  })
  const [copied, setCopied] = useState(false)
  
  // Deposit Wizard states
  const [depositStep, setDepositStep] = useState(1);
  const [depositAmount, setDepositAmount] = useState('');
  const [selectedDepositCategory, setSelectedDepositCategory] = useState<'crypto' | 'bank'>('crypto');
  const [selectedDepositMethod, setSelectedDepositMethod] = useState('Bitcoin');
  const [depositProof, setDepositProof] = useState<File | null>(null);
  const [depositTxHash, setDepositTxHash] = useState('');
  const [deposits, setDeposits] = useState<DepositRecord[]>([]); // Added deposits state
  const [depositLoading, setDepositLoading] = useState(false);
  const [depositError, setDepositError] = useState('');
  const depositSubmitInFlightRef = useRef(false);

  // Helper function for copying deposit details
  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getProfileEditForm = () => ({
    name: currentUser?.name || '',
    userName: currentUser?.userName || '',
    email: currentUser?.email || '',
    phoneNumber: currentUser?.phoneNumber || '',
    country: currentUser?.country || '',
    city: currentUser?.city || '',
    address: currentUser?.address || ''
  });
  
  // Investment modal states
  const [showInvestmentModal, setShowInvestmentModal] = useState(false)
  const [investmentStep, setInvestmentStep] = useState<'select' | 'confirm' | 'choose-method' | 'payment' | 'success'>('select')
  const [selectedPlan, setSelectedPlan] = useState<any>(null)
  const [investmentForm, setInvestmentForm] = useState({
    capital: '',
    paymentMethod: 'Bitcoin',
    transactionHash: '',
    bankSlip: null as File | null
  })
  const [paymentCopied, setPaymentCopied] = useState(false)
  const [isInvestmentSubmitting, setIsInvestmentSubmitting] = useState(false)
  const [investmentRetryAt, setInvestmentRetryAt] = useState(0)
  const investmentSessionIdRef = useRef('')
  const investmentSubmitInFlightRef = useRef(false)
  
  // KYC modal states
  const [showKycModal, setShowKycModal] = useState(false)
  const [kycStep, setKycStep] = useState<'intro' | 'personal' | 'documents' | 'review' | 'success'>('intro')
  const [kycSubmitting, setKycSubmitting] = useState(false)
  const kycSubmitInFlightRef = useRef(false)
  const [kycForm, setKycForm] = useState({
    idNumber: '',
    idType: 'passport',
    idDocument: null as File | null,
    addressDocument: null as File | null,
    selfieDocument: null as File | null
  })
  
  // Withdrawal modal states
  const [showWithdrawalModal, setShowWithdrawalModal] = useState(false)
  const [withdrawalStep, setWithdrawalStep] = useState<'amount' | 'method' | 'details' | 'confirm' | 'success'>('amount')
  const [withdrawalForm, setWithdrawalForm] = useState({
    amount: '',
    method: 'Bitcoin',
    walletAddress: '',
    bankName: '',
    accountNumber: '',
    accountName: '',
    routingNumber: ''
  })
  const [withdrawalLoading, setWithdrawalLoading] = useState(false)
  const withdrawalSubmitInFlightRef = useRef(false)
  
  // Loan modal states
  const [showLoanModal, setShowLoanModal] = useState(false)
  const [loanStep, setLoanStep] = useState<'personal' | 'work' | 'financial' | 'confirm' | 'success'>('personal')
  const [loanForm, setLoanForm] = useState({
    // Personal Information
    fullName: currentUser?.name || currentUser?.userName || '',
    dateOfBirth: '',
    phoneNumber: currentUser?.phoneNumber || '',
    address: currentUser?.address || '',
    city: currentUser?.city || '',
    country: currentUser?.country || '',
    maritalStatus: '',
    dependents: '',

    // Work Information
    employmentStatus: '',
    employerName: '',
    jobTitle: '',
    monthlyIncome: '',
    workExperience: '',
    employerPhone: '',
    employerAddress: '',

    // Financial Information
    amount: '',
    duration: '30',
    purpose: '',
    monthlyExpenses: '',
    otherIncome: '',
    existingDebts: '',
    collateral: '',

    // References
    reference1Name: '',
    reference1Phone: '',
    reference1Relationship: '',
    reference2Name: '',
    reference2Phone: '',
    reference2Relationship: ''
  });
  const [loanLoading, setLoanLoading] = useState(false)
  const loanSubmitInFlightRef = useRef(false)

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const copyReferralLink = () => {
    const referralLink = `${window.location.origin}/signup?ref=${currentUser?.referralCode || currentUser?.idnum}`
    navigator.clipboard.writeText(referralLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleEditProfile = async () => {
    if (!editMode) {
      // Enter edit mode - populate form with current user data
      setEditForm(getProfileEditForm())
      setEditMode(true)
      return
    }

    try {
      const trimmedName = editForm.name.trim()
      const trimmedUserName = editForm.userName.trim()
      const trimmedEmail = editForm.email.trim()
      const trimmedPhoneNumber = editForm.phoneNumber.trim()
      const trimmedCountry = editForm.country.trim()
      const trimmedCity = editForm.city.trim()
      const trimmedAddress = editForm.address.trim()

      if (!trimmedName) {
        showAlert('error', t('alerts.titleValidationError'), 'Full name is required')
        return
      }

      if (!trimmedUserName) {
        showAlert('error', t('alerts.titleValidationError'), 'Username is required')
        return
      }

      // Validate required fields
      if (!trimmedEmail) {
        showAlert('error', t('alerts.titleValidationError'), t('alerts.validationErrorEmailRequired'))
        return
      }

      // Basic email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!emailRegex.test(trimmedEmail)) {
        showAlert('error', t('alerts.titleValidationError'), t('alerts.validationErrorInvalidEmail'))
        return
      }

      // Update user in database
      if (currentUser?.idnum) {
        await supabaseDb.updateUser(currentUser.idnum, {
          name: trimmedName,
          userName: trimmedUserName,
          email: trimmedEmail,
          phoneNumber: trimmedPhoneNumber || undefined,
          country: trimmedCountry || undefined,
          city: trimmedCity || undefined,
          address: trimmedAddress || undefined
        })

        const updatedUser = {
          ...currentUser,
          name: trimmedName,
          userName: trimmedUserName,
          email: trimmedEmail,
          phoneNumber: trimmedPhoneNumber,
          country: trimmedCountry,
          city: trimmedCity,
          address: trimmedAddress
        }
        updateUser(updatedUser)
        setEditForm(updatedUser)

        setEditMode(false)
        addNotification('Profile Updated', t('alerts.profileUpdated'), 'success')
        showAlert('success', t('alerts.titleProfileUpdated'), t('alerts.profileUpdated'))
      }
    } catch (error) {
      console.error('Error updating profile:', error)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
      showAlert('error', t('alerts.titleUpdateFailed'), t('alerts.updateFailed', { errorMessage }))
    }
  }

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      showAlert('error', t('alerts.titlePasswordMismatch'), t('alerts.passwordMismatch'))
      return
    }

    if (passwordForm.newPassword.length < 6) {
      showAlert('error', t('alerts.titlePasswordTooShort'), t('alerts.passwordTooShort'))
      return
    }

    try {
      // You'll need to implement password change in supabaseUtils
      addNotification(
        'Password Change Attempted',
        'A password change was requested on your account. If this was not you, please contact support.',
        'warning'
      )
      showAlert('info', t('alerts.titleFeatureComingSoon'), t('alerts.featureComingSoon'))
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
    } catch (error) {
      console.error('Error changing password:', error)
      showAlert('error', t('alerts.titlePasswordChangeFailed'), t('alerts.passwordChangeFailed'))
    }
  }

  const handleDeleteAccount = async () => {
    showConfirm(
      t('confirm.deleteAccountTitle'),
      t('confirm.deleteAccountMessage'),
      () => {
        // First confirmation passed, show second confirmation
          showConfirm(
          t('confirm.finalWarningTitle'),
          t('confirm.finalWarningMessage'),
          async () => {
            // Proceed with account deletion
            try {
              // You'll need to implement account deletion in supabaseUtils
              showAlert('info', t('alerts.titleAccountDeletionComingSoon'), t('alerts.accountDeletionComingSoon'))
            } catch (error) {
              console.error('Error deleting account:', error)
              showAlert('error', t('alerts.titleDeletionFailed'), t('alerts.deletionFailed'))
            }
          },
          () => {
            // Second confirmation cancelled
          },
          t('confirm.finalWarningConfirmText'),
          t('common.cancel')
        )
      },
      () => {
        // First confirmation cancelled
      },
      'Continue',
      'Cancel'
    )
  }

  // Investment modal handlers
  const cryptoPaymentMethods = {
    Bitcoin: {
      name: 'Bitcoin (BTC)',
      address: '14nkRtKqATBXudhd9yqSpLMZyy8JETmStH',
      network: 'Bitcoin Network',
      icon: '₿'
    },
    Ethereum: {
      name: 'Ethereum (ETH)',
      address: '0x33a056a59729fda369c03eff8e075c1f2537b41b',
      network: 'Ethereum Network (ERC-20)',
      icon: 'Ξ'
    },
    'USDT-ERC20': {
      name: 'Tether (USDT) - ERC20',
      address: '0x33a056a59729fda369c03eff8e075c1f2537b41b',
      network: 'Ethereum Network (ERC-20)',
      icon: '₮'
    },
    'USDT-BEP20': {
      name: 'Tether (USDT) - BEP20',
      address: '0x33a056a59729fda369c03eff8e075c1f2537b41b',
      network: 'Binance Smart Chain (BEP-20)',
      icon: '₮'
    },
    'USDT-TRC20': {
      name: 'Tether (USDT) - TRC20',
      address: 'TFnH5RHhiF19scPtuZQwwiYmHfgp54Exta',
      network: 'Tron Network (TRC-20)',
      icon: '₮'
    },
  }

  const paymentMethods = {
    Crypto: {
      name: 'Crypto',
      description: 'Choose a crypto network and upload proof',
      icon: '₿'
    },
    Balance: {
      name: 'Account Balance',
      description: 'Use funds already available in your wallet',
      icon: '$'
    },
    Bank: {
      name: 'Bank Transfer',
      accountName: 'eToro Trust Capital Investments Ltd.',
      accountNumber: '1234567890',
      bankName: 'Global Trust Bank',
      routingNumber: 'GTB001234',
      swiftCode: 'GTBKUS33',
      icon: '🏦'
    }
  }

  const handleStartInvestment = (plan: any, initialPaymentMethod = 'Balance') => {
    setSelectedPlan(plan)
    investmentSessionIdRef.current = `INVSESSION-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    investmentSubmitInFlightRef.current = false
    setIsInvestmentSubmitting(false)
    setInvestmentRetryAt(0)
    setInvestmentForm({
      capital: plan.minCapital.toString(),
      paymentMethod: initialPaymentMethod,
      transactionHash: '',
      bankSlip: null
    })
    setInvestmentStep('select')
    setShowInvestmentModal(true)
  }

  const selectedCryptoMethod =
    cryptoPaymentMethods[investmentForm.paymentMethod as keyof typeof cryptoPaymentMethods] ||
    cryptoPaymentMethods.Bitcoin

  const isCryptoPayment = investmentForm.paymentMethod in cryptoPaymentMethods
  const selectedPaymentName = isCryptoPayment
    ? selectedCryptoMethod.name
    : paymentMethods[investmentForm.paymentMethod as keyof typeof paymentMethods]?.name || 'Payment Method'

  const debitUserWallet = async (amount: number) => {
    if (!currentUser?.idnum) {
      throw new Error('User session not found')
    }

    const freshUser = await supabaseDb.getUserByIdnum(currentUser.idnum)
    if (!freshUser) {
      throw new Error('Could not refresh user balance')
    }

    const currentBalance = Number(freshUser.balance || 0)
    const currentBonus = Number(freshUser.bonus || 0)
    const availableBalance = currentBalance + currentBonus

    if (amount > availableBalance) {
      throw new Error(`Insufficient balance. Available balance is $${formatCurrency(availableBalance)}.`)
    }

    const balanceDebit = Math.min(currentBalance, amount)
    const bonusDebit = amount - balanceDebit
    const newBalance = currentBalance - balanceDebit
    const newBonus = currentBonus - bonusDebit

    await supabaseDb.updateUser(currentUser.idnum, {
      balance: newBalance,
      bonus: newBonus,
    })

    updateUser({ balance: newBalance, bonus: newBonus })

    return {
      previousBalance: currentBalance,
      previousBonus: currentBonus,
      newBalance,
      newBonus,
    }
  }

  const externalPaymentMethods = {
    ...cryptoPaymentMethods,
    Bank: paymentMethods.Bank,
  }

  const restoreUserWallet = async (previousBalance: number, previousBonus: number) => {
    if (!currentUser?.idnum) return

    try {
      await supabaseDb.updateUser(currentUser.idnum, {
        balance: previousBalance,
        bonus: previousBonus,
      })
      updateUser({ balance: previousBalance, bonus: previousBonus })
    } catch (rollbackError) {
      console.error('Failed to restore wallet after investment error:', rollbackError)
    }
  }

  const handleInvestmentNext = async () => {
    if (investmentStep === 'select') {
      const capital = parseFloat(investmentForm.capital)
      if (!capital || capital < selectedPlan.minCapital) {
        showAlert('error', t('alerts.titleInvalidAmount'), t('alerts.invalidAmountMin', { min: selectedPlan.minCapital.toLocaleString() }))
        return
      }
      if (selectedPlan.maxCapital && capital > selectedPlan.maxCapital) {
        showAlert('error', t('alerts.titleInvalidAmount'), t('alerts.invalidAmountMax', { max: selectedPlan.maxCapital.toLocaleString() }))
        return
      }
      if (investmentForm.paymentMethod === 'Balance' && capital > totalBalance) {
        showAlert('error', 'Insufficient Balance', `Available account balance is $${formatCurrency(totalBalance)}.`)
        return
      }
      setInvestmentStep('confirm')
    } else if (investmentStep === 'confirm') {
      const capital = parseFloat(investmentForm.capital)
      if (!capital || capital < selectedPlan.minCapital) {
        showAlert('error', t('alerts.titleInvalidAmount'), t('alerts.invalidAmountMin', { min: selectedPlan.minCapital.toLocaleString() }))
        return
      }
      if (selectedPlan.maxCapital && capital > selectedPlan.maxCapital) {
        showAlert('error', t('alerts.titleInvalidAmount'), t('alerts.invalidAmountMax', { max: selectedPlan.maxCapital.toLocaleString() }))
        return
      }
      setInvestmentStep('choose-method')
    } else if (investmentStep === 'choose-method') {
      if (investmentForm.paymentMethod === 'Balance') {
        await handleSubmitInvestment()
        return
      }
      setInvestmentStep('payment')
    } else if (investmentStep === 'payment') {
      // Validate payment proof before submitting
      if (!investmentForm.transactionHash || investmentForm.transactionHash.trim() === '') {
        showAlert('error', t('alerts.titleTransactionHashRequired'), t('alerts.transactionHashRequired'))
        return
      }
      if (!investmentForm.bankSlip) {
        showAlert('error', t('alerts.titlePaymentProofRequired'), t('alerts.paymentProofRequired'))
        return
      }
      // Payment proof validated, proceed to submit
      try {
        // Upload payment proof to Supabase Storage (optional for now)
        let paymentProofUrl = null;
        if (investmentForm.bankSlip) {
          try {
            const fileExt = investmentForm.bankSlip.name.split('.').pop();
            const fileName = `${currentUser?.idnum || 'unknown'}_${Date.now()}.${fileExt}`;
            const { data: uploadData, error: uploadError } = await (supabase as any).storage
              .from('payment-proofs')
              .upload(fileName, investmentForm.bankSlip);

            if (uploadError) {
              console.warn('Payment proof upload failed, continuing without proof:', uploadError);
              // Don't return - allow investment creation without proof for now
            } else {
              paymentProofUrl = uploadData.path;
              console.log('Payment proof uploaded successfully:', paymentProofUrl);
            }
          } catch (storageError) {
            console.warn('Storage error, continuing without payment proof:', storageError);
            // Continue without payment proof
          }
        }

        const investmentPayload = {
          idnum: currentUser?.idnum || '',
          plan: selectedPlan.name,
          capital: parseFloat(investmentForm.capital),
          roi: selectedPlan.roi,
          duration: selectedPlan.duration,
          paymentOption: investmentForm.paymentMethod,
          transactionHash: investmentForm.transactionHash,
          paymentProofUrl,
          status: 'Pending',
          authStatus: 'unseen',
        }
        console.log('📤 [Investment] Creating investment with payload:', investmentPayload);
        console.log('📤 [Investment] Current user idnum:', currentUser?.idnum);
        
        const newInvestment = await supabaseDb.createInvestment(investmentPayload)
        console.log('✅ [Investment] Response from createInvestment:', newInvestment);
        console.log('Investment created successfully:', newInvestment);
        console.log('Investment ID:', newInvestment.id);
        console.log('Investment idnum:', newInvestment.idnum);
        console.log('Current user idnum:', currentUser?.idnum);
        console.log('Payment proof URL:', paymentProofUrl);

        // Notify backend to send investment pending email via server endpoint
        try {
          const apiBase = getApiBaseUrl();
          console.log('📧 Calling /api/investments/send-pending-notification for investment:', newInvestment.id);
          const emailResponse = await fetch(`${apiBase}/api/investments/send-pending-notification`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              investmentId: newInvestment.id || '',
              userId: currentUser?.idnum || '',
              amount: parseFloat(investmentForm.capital),
              plan: selectedPlan.name,
              dailyRoiRate: selectedPlan.roi,
              duration: selectedPlan.duration,
              userEmail: currentUser?.email || '',
              userName: currentUser?.userName || currentUser?.name || 'User'
            })
          });
          
          if (emailResponse.ok) {
            const result = await emailResponse.json();
            console.log('✅ Investment pending notification sent:', result.messageId);
          } else {
            const error = await emailResponse.json();
            console.warn('⚠️  Email send failed:', error);
          }
        } catch (notifyErr) {
          console.warn('⚠️  Failed to request investment pending notification:', notifyErr);
        }
        
        // Refetch investments from Supabase to ensure persistence
        console.log('📥 [Investment] Fetching all investments for user:', currentUser?.idnum);
        const userInvestments = await supabaseDb.getInvestmentsByUser(currentUser?.idnum || '')
        console.log('📥 [Investment] Fetched investments count:', userInvestments.length);
        setInvestments(userInvestments)
        localStorage.setItem('userInvestments', JSON.stringify(userInvestments))
        setInvestmentStep('success')
        // Add notification for investment submission
        addNotification(
          'Investment Submitted! 📈',
          `Your ${selectedPlan.name} investment of $${parseFloat(investmentForm.capital).toLocaleString()} has been submitted for review.`,
          'info'
        )
        // Show classy popup
        showAlert(
          'success',
          'Investment Created!',
          `Your ${selectedPlan.name} investment of $${parseFloat(investmentForm.capital).toLocaleString()} has been created. You'll earn $${selectedPlan.dailyRoi.toLocaleString()} daily for ${selectedPlan.duration} days once activated.`
        )
        
        // Clear any previous error
        setInvestmentError(null)
        
        // Auto-close modal after 4 seconds
        setTimeout(() => {
          closeInvestmentModal()
        }, 4000)
      } catch (err) {
        console.error('🔴 [Investment] CRITICAL ERROR creating investment:', err);
        console.error('🔴 [Investment] Error details:', err instanceof Error ? err.message : err);
        setInvestmentError(err instanceof Error ? err.message : 'Unknown error occurred');
        showAlert('error', '❌ Investment Failed', `Error: ${err instanceof Error ? err.message : 'Unknown error occurred'}`)
      }
    }
  }

  const handleInvestmentBack = () => {
    if (investmentStep === 'payment') {
      setInvestmentStep('choose-method')
    } else if (investmentStep === 'choose-method') {
      setInvestmentStep('confirm')
    } else if (investmentStep === 'confirm') {
      setInvestmentStep('select')
    }
  }

  // KYC Modal Handlers
  const handleStartKyc = () => {
    setKycStep('intro')
    setShowKycModal(true)
  }

  const openKycVerificationModal = () => {
    setScrollToKycOnProfileOpen(false)
    setProfileState('Profile')
    setShowSidePanel(false)
    handleStartKyc()
  }

  const openProfileKycSection = () => {
    setProfileState('Profile')
    setShowSidePanel(false)
    setScrollToKycOnProfileOpen(true)
  }

  useEffect(() => {
    if (profileState !== 'Profile' || !scrollToKycOnProfileOpen) return

    const frameId = window.requestAnimationFrame(() => {
      kycSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setScrollToKycOnProfileOpen(false)
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [profileState, scrollToKycOnProfileOpen])

  const handleKycNext = async () => {
    if (kycStep === 'intro') {
      setKycStep('personal')
    } else if (kycStep === 'personal') {
      if (!kycForm.idNumber || !kycForm.idType) {
        showAlert('error', t('alerts.titleMissingInformation'), t('alerts.missingInformation'))
        return
      }
      setKycStep('documents')
    } else if (kycStep === 'documents') {
      if (!kycForm.idDocument || !kycForm.addressDocument || !kycForm.selfieDocument) {
        showAlert('error', t('alerts.missingDocumentsTitle'), t('alerts.missingDocumentsMessage'))
        return
      }
      setKycStep('review')
    } else if (kycStep === 'review') {
      if (kycSubmitInFlightRef.current || kycSubmitting) {
        return
      }

      // Submit KYC to database
      try {
        kycSubmitInFlightRef.current = true
        setKycSubmitting(true)

        if (!currentUser?.idnum) {
          showAlert('error', 'Error', 'User ID not found');
          return;
        }

        const userIdnum = currentUser.idnum

        const uploadDocument = async (
          file: File | null,
          documentType: 'id' | 'address' | 'selfie'
        ) => {
          if (!file) return ''

          try {
            return await supabaseDb.uploadKycDocument(userIdnum, file, documentType)
          } catch (uploadErr) {
            console.error(`Failed to upload ${documentType} document:`, uploadErr)
            throw uploadErr
          }
        }

        const [idDocUrl, addressDocUrl, selfieUrl] = await Promise.all([
          uploadDocument(kycForm.idDocument, 'id'),
          uploadDocument(kycForm.addressDocument, 'address'),
          uploadDocument(kycForm.selfieDocument, 'selfie'),
        ])

        const kycDataToSubmit = {
          idnum: userIdnum,
          fullName: currentUser.name || currentUser.userName || 'Unknown',
          dateOfBirth: '1990-01-01', // Placeholder as form lacks this field
          nationality: 'United States', // Placeholder as form lacks this field
          documentType: kycForm.idType,
          documentNumber: kycForm.idNumber,
          documentFrontUrl: idDocUrl,
          documentBackUrl: addressDocUrl, 
          selfieUrl: selfieUrl,
          status: 'pending',
          submittedAt: new Date().toISOString()
        }

        const createdKyc = await supabaseDb.createKyc(kycDataToSubmit)

        try {
          const apiBase = getApiBaseUrl()
          const response = await fetch(`${apiBase}/api/notify/kyc-request`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userEmail: currentUser.email || '',
              userName: currentUser.userName || currentUser.name || 'User',
              userId: userIdnum,
              documentType: kycForm.idType,
              documentNumber: kycForm.idNumber,
              documentFrontUrl: idDocUrl,
              documentBackUrl: addressDocUrl,
              selfieUrl,
            }),
          })
          if (!response.ok) throw new Error('KYC admin notification request failed')
        } catch (notifyErr) {
          console.warn('Failed to send KYC admin notification:', notifyErr)
        }

        if (currentUser.email) {
          await sendKYCNotification(
            currentUser.email,
            currentUser.userName || currentUser.name || 'User',
            'pending'
          )
        }

        // Update user status immediately in session and database.
        updateUser({ ...currentUser, authStatus: 'pending' })
        await supabaseDb.updateUser(userIdnum, { authStatus: 'pending' })

        addNotification(
          'KYC Documents Submitted',
          'Your KYC verification documents have been submitted for review. This may take 1-3 business days.',
          'info'
        )
        setKycData(createdKyc || {
          ...kycDataToSubmit,
          status: 'pending'
        })
        setKycStep('success')
      } catch (error) {
        console.error('Error submitting KYC:', error)
        addNotification(
          'KYC Submission Failed',
          'There was an error submitting your KYC documents. Please try again.',
          'error'
        )
      } finally {
        kycSubmitInFlightRef.current = false
        setKycSubmitting(false)
      }
    }
  }

  const handleKycBack = () => {
    if (kycStep === 'documents') {
      setKycStep('personal')
    } else if (kycStep === 'personal') {
      setKycStep('intro')
    } else if (kycStep === 'review') {
      setKycStep('documents')
    }
  }

  const closeKycModal = () => {
    if (kycSubmitting) {
      return
    }

    setShowKycModal(false)
    setKycStep('intro')
  }

  const handleFileUpload = (type: 'idDocument' | 'addressDocument' | 'selfieDocument', e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0]
      setKycForm((currentForm) => ({ ...currentForm, [type]: file }))
    }
  }

  // Withdrawal Modal Handlers
  const handleStartWithdrawal = () => {
    setWithdrawalStep('amount')
    setShowWithdrawalModal(true)
  }

  const handleWithdrawalNext = async () => {
    // Check KYC status first
    const kycStatus = currentUser?.authStatus?.toLowerCase();
    if (kycStatus !== 'approved' && kycStatus !== 'verified') {
      showAlert('warning', 'KYC Verification Required', 'You must complete identity verification to withdraw funds.');
      return;
    }

    if (withdrawalStep === 'amount') {
      const amount = parseFloat(withdrawalForm.amount)
      if (!amount || amount < 50) {
        alert('Minimum withdrawal is $50')
        return
      }
      
      // Refresh balance from database before checking
      try {
        const dbUser = await supabaseDb.getUserByIdnum(currentUser?.idnum || '')
        if (dbUser && currentUser) {
          // Convert null values to undefined for compatibility
          const userForUpdate = {
            ...dbUser,
            referralCode: dbUser.referralCode || undefined,
            authStatus: dbUser.authStatus || undefined,
            role: (dbUser.role as any) || 'user'
          }
          updateUser(userForUpdate)
        }
      } catch (error) {
        console.error('Error refreshing balance:', error)
      }
      
      // Calculate locked investment capital (active investments that haven't completed their period)
      // Removed restriction: User can withdraw even with active investments
      const lockedInvestmentCapital = 0
      
      const availableBalance = ((currentUser?.balance || 0) + (currentUser?.bonus || 0)) - lockedInvestmentCapital

      if (amount > availableBalance) {
          alert('Insufficient balance')
        return
      }

      // Check Daily Withdrawal Limit
      const DAILY_LIMIT = 50000;
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      
      const todaysWithdrawals = withdrawals.filter((w: any) => {
        const wDate = w.date || w.created_at; // Support both date fields
        // Count pending and approved withdrawals for the daily limit
        return wDate && wDate.startsWith(today) && w.status !== 'Rejected'; 
      });

      const todaysTotal = todaysWithdrawals.reduce((sum: number, w: any) => sum + (Number(w.amount) || 0), 0);

      if (todaysTotal + amount > DAILY_LIMIT) {
        showAlert('error', 'Daily Limit Exceeded', `You have exceeded the daily withdrawal limit of $${DAILY_LIMIT.toLocaleString()}. You have already withdrawn $${todaysTotal.toLocaleString()} today. Please try again tomorrow.`);
        return;
      }

      setWithdrawalStep('method')
    } else if (withdrawalStep === 'method') {
      setWithdrawalStep('details')
    } else if (withdrawalStep === 'details') {
      if (withdrawalForm.method === 'Bank Transfer') {
        if (!withdrawalForm.bankName || !withdrawalForm.accountNumber || !withdrawalForm.accountName) {
          alert('Please fill in all bank details')
          return
        }
      } else {
        if (!withdrawalForm.walletAddress) {
          alert('Please enter wallet address')
          return
        }
      }
      setWithdrawalStep('confirm')
    } else if (withdrawalStep === 'confirm') {
      if (withdrawalSubmitInFlightRef.current) return
      withdrawalSubmitInFlightRef.current = true
      setWithdrawalLoading(true)

      // Submit withdrawal
      const amount = parseFloat(withdrawalForm.amount)
      
      try {
        const newWithdrawal = {
          idnum: currentUser?.idnum,
          amount,
          method: withdrawalForm.method,
          walletAddress: withdrawalForm.method !== 'Bank Transfer' ? withdrawalForm.walletAddress ?? undefined : undefined,
          bankName: withdrawalForm.method === 'Bank Transfer' ? withdrawalForm.bankName ?? undefined : undefined,
          accountNumber: withdrawalForm.method === 'Bank Transfer' ? withdrawalForm.accountNumber ?? undefined : undefined,
          accountName: withdrawalForm.method === 'Bank Transfer' ? withdrawalForm.accountName ?? undefined : undefined,
          routingNumber: withdrawalForm.method === 'Bank Transfer' ? withdrawalForm.routingNumber ?? undefined : undefined,
          status: 'pending',
          authStatus: 'pending',
          date: new Date().toISOString()
        }
        
        // Cast to any to satisfy TypeScript in environments where WithdrawalRecord may differ
        const savedWithdrawal = await supabaseDb.createWithdrawal(newWithdrawal as any)

        // Deduct balance from database immediately to lock funds
        if (currentUser?.idnum) {
            // Fetch fresh user data to ensure we have the latest balance
            const freshUser = await supabaseDb.getUserByIdnum(currentUser.idnum);
            if (freshUser) {
                const currentBalance = freshUser.balance || 0;
                const currentBonus = freshUser.bonus || 0;
                const currentTotalBalance = currentBalance + currentBonus;
                
                // Only proceed if balance is sufficient (double check)
                if (currentTotalBalance >= amount) {
                    const balanceDebit = Math.min(currentBalance, amount);
                    const bonusDebit = amount - balanceDebit;
                    const newBalance = currentBalance - balanceDebit;
                    const newBonus = currentBonus - bonusDebit;

                    await supabaseDb.updateUser(currentUser.idnum, { balance: newBalance, bonus: newBonus });
                    console.log('Balance deducted successfully');
                    
                    // Update local state immediately with the new balance
                    if (updateUser) {
                        updateUser({ balance: newBalance, bonus: newBonus });
                    }
                    
                    // Force a full refresh to be sure
                    refreshUserBalance();
                } else {
                    console.warn('Insufficient balance check failed during deduction');
                }
            }
        }
        
        // Send user and admin email notification
        try {
          const apiBase = getApiBaseUrl();
          const destination = withdrawalForm.method === 'Bank Transfer'
            ? `${withdrawalForm.bankName || 'Bank'} ${withdrawalForm.accountNumber || ''}`.trim()
            : withdrawalForm.walletAddress || '';

          const notifyResponse = await fetch(`${apiBase}/api/notify/withdrawal-request`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userEmail: currentUser?.email || '',
              userName: currentUser?.userName || currentUser?.name || 'User',
              amount,
              method: withdrawalForm.method,
              wallet: destination
            })
          });
          if (!notifyResponse.ok) throw new Error('Withdrawal notification request failed');
        } catch (notifyErr) {
          console.warn('Failed to send withdrawal admin notification:', notifyErr);
          await sendWithdrawalNotification(
            currentUser?.email || '',
            currentUser?.userName || currentUser?.name || '',
            'pending',
            amount,
            withdrawalForm.method
          );
        }
        
        addNotification(
          'Withdrawal Requested',
          `Your withdrawal request of $${amount.toLocaleString()} via ${withdrawalForm.method} has been submitted for processing.`,
          'info'
        )
        setWithdrawalStep('success')
      } catch (error) {
        console.error('Error creating withdrawal:', error)
        showAlert('error', t('alerts.failedToSubmitWithdrawalTitle'), t('alerts.failedToSubmitWithdrawalMessage'))
      } finally {
        withdrawalSubmitInFlightRef.current = false
        setWithdrawalLoading(false)
      }
    }
  }

  const handleWithdrawalBack = () => {
    if (withdrawalStep === 'method') {
      setWithdrawalStep('amount')
    } else if (withdrawalStep === 'details') {
      setWithdrawalStep('method')
    } else if (withdrawalStep === 'confirm') {
      setWithdrawalStep('details')
    }
  }

  const closeWithdrawalModal = () => {
    if (withdrawalLoading) return

    setShowWithdrawalModal(false)
    setWithdrawalStep('amount')
    setWithdrawalForm({
      amount: '',
      method: 'Bitcoin',
      walletAddress: '',
      bankName: '',
      accountNumber: '',
      accountName: '',
      routingNumber: ''
    })
  }

  // Loan modal handlers
  const handleStartLoan = () => {
    setLoanStep('personal')
    setShowLoanModal(true)
  }

  const handleLoanNext = async () => {
    if (loanStep === 'personal') {
      // Validate personal information
      if (!loanForm.fullName || !loanForm.dateOfBirth || !loanForm.phoneNumber || !loanForm.address || !loanForm.city || !loanForm.country) {
        showAlert('error', t('alerts.titleMissingInformation'), 'Please fill in all personal information fields.')
        return
      }
      setLoanStep('work')
    } else if (loanStep === 'work') {
      // Validate work information
      if (!loanForm.employmentStatus || !loanForm.employerName || !loanForm.jobTitle || !loanForm.monthlyIncome || !loanForm.workExperience) {
        showAlert('error', t('alerts.titleMissingInformation'), 'Please fill in all work information fields.')
        return
      }
      setLoanStep('financial')
    } else if (loanStep === 'financial') {
      // Validate financial information
      const amount = parseFloat(loanForm.amount)
      const maxLoan = totalCapital * 0.5
      if (!amount || amount < 100) {
        showAlert('error', t('alerts.titleInvalidAmount'), t('alerts.invalidAmountMin', { min: 100 }))
        return
      }
      if (amount > maxLoan) {
        showAlert('error', t('alerts.titleInvalidAmount'), t('alerts.invalidAmountMax', { max: maxLoan.toLocaleString() }))
        return
      }
      if (!loanForm.purpose || !loanForm.monthlyExpenses) {
        showAlert('error', t('alerts.titleMissingInformation'), 'Please fill in loan purpose and monthly expenses.')
        return
      }
      setLoanStep('confirm')
    } else if (loanStep === 'confirm') {
      if (loanSubmitInFlightRef.current) return
      loanSubmitInFlightRef.current = true
      setLoanLoading(true)

      // Submit loan request to database
      try {
        const amount = parseFloat(loanForm.amount)
        const interestRate = loanForm.duration === '30' ? 5 : loanForm.duration === '60' ? 10 : 15
        const duration = parseInt(loanForm.duration)
        const interestAmount = amount * (interestRate / 100) * (duration / 30)
        const totalRepayment = amount + interestAmount
        
        const newLoan = {
          idnum: currentUser?.idnum,
          amount,
          interestRate,
          duration,
          purpose: loanForm.purpose,
          totalRepayment,
          status: 'pending',
          authStatus: 'pending',
          date: new Date().toISOString(),

          // Personal Information
          fullName: loanForm.fullName,
          dateOfBirth: loanForm.dateOfBirth,
          phoneNumber: loanForm.phoneNumber,
          address: loanForm.address,
          city: loanForm.city,
          country: loanForm.country,
          maritalStatus: loanForm.maritalStatus,
          dependents: loanForm.dependents ? parseInt(loanForm.dependents) : null,

          // Work Information
          employmentStatus: loanForm.employmentStatus,
          employerName: loanForm.employerName,
          jobTitle: loanForm.jobTitle,
          monthlyIncome: loanForm.monthlyIncome ? parseFloat(loanForm.monthlyIncome) : null,
          workExperience: loanForm.workExperience ? parseInt(loanForm.workExperience) : null,
          employerPhone: loanForm.employerPhone,
          employerAddress: loanForm.employerAddress,

          // Financial Information
          monthlyExpenses: loanForm.monthlyExpenses ? parseFloat(loanForm.monthlyExpenses) : null,
          otherIncome: loanForm.otherIncome ? parseFloat(loanForm.otherIncome) : null,
          existingDebts: loanForm.existingDebts ? parseFloat(loanForm.existingDebts) : null,
          collateral: loanForm.collateral,

          // References
          reference1Name: loanForm.reference1Name,
          reference1Phone: loanForm.reference1Phone,
          reference1Relationship: loanForm.reference1Relationship,
          reference2Name: loanForm.reference2Name,
          reference2Phone: loanForm.reference2Phone,
          reference2Relationship: loanForm.reference2Relationship
        }
        
        const savedLoan = await supabaseDb.createLoan(newLoan)

        try {
          const apiBase = getApiBaseUrl()
          const response = await fetch(`${apiBase}/api/notify/loan-request`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userEmail: currentUser?.email || '',
              userName: currentUser?.userName || currentUser?.name || loanForm.fullName || 'User',
              userId: currentUser?.idnum || '',
              amount,
              duration,
              purpose: loanForm.purpose,
              interestRate,
              totalRepayment,
              phoneNumber: loanForm.phoneNumber,
              employmentStatus: loanForm.employmentStatus,
              monthlyIncome: loanForm.monthlyIncome ? parseFloat(loanForm.monthlyIncome) : null,
            }),
          })
          if (!response.ok) throw new Error('Loan admin notification request failed')
        } catch (notifyErr) {
          console.warn('Failed to send loan admin notification:', notifyErr)
        }
        
        // Send email notification
        await sendLoanNotification(
          currentUser?.email || '',
          currentUser?.userName || currentUser?.name || '',
          'pending',
          amount,
          duration
        )
        
        // Update local state
        setLoans(prev => [savedLoan, ...prev])
        
        addNotification(
          'Loan Request Submitted',
          `Your loan request of $${amount.toLocaleString()} for ${duration} days has been submitted for review.`,
          'info'
        )
        setLoanStep('success')
      } catch (error) {
        console.error('Error creating loan:', error)
        showAlert('error', t('alerts.loanSubmitFailedTitle'), t('alerts.loanSubmitFailedMessage'))
      } finally {
        loanSubmitInFlightRef.current = false
        setLoanLoading(false)
      }
    }
  }

  const handleLoanBack = () => {
    if (loanStep === 'work') {
      setLoanStep('personal')
    } else if (loanStep === 'financial') {
      setLoanStep('work')
    } else if (loanStep === 'confirm') {
      setLoanStep('financial')
    } else if (loanStep === 'success') {
      setLoanStep('confirm')
    }
  }

  const closeLoanModal = () => {
    if (loanLoading) return

    setShowLoanModal(false)
    setLoanStep('personal')
    setLoanForm({
      // Personal Information
      fullName: currentUser?.name || currentUser?.userName || '',
      dateOfBirth: '',
      phoneNumber: currentUser?.phoneNumber || '',
      address: currentUser?.address || '',
      city: currentUser?.city || '',
      country: currentUser?.country || '',
      maritalStatus: '',
      dependents: '',

      // Work Information
      employmentStatus: '',
      employerName: '',
      jobTitle: '',
      monthlyIncome: '',
      workExperience: '',
      employerPhone: '',
      employerAddress: '',

      // Financial Information
      amount: '',
      duration: '30',
      purpose: '',
      monthlyExpenses: '',
      otherIncome: '',
      existingDebts: '',
      collateral: '',

      // References
      reference1Name: '',
      reference1Phone: '',
      reference1Relationship: '',
      reference2Name: '',
      reference2Phone: '',
      reference2Relationship: ''
    })
  }

  // Helper function for copying payment details
  const copyPaymentAddress = () => {
    const method = isCryptoPayment
      ? selectedCryptoMethod
      : paymentMethods[investmentForm.paymentMethod as keyof typeof paymentMethods]
    const textToCopy = 'address' in method
      ? method.address
      : 'accountNumber' in method
        ? `Account: ${method.accountNumber}\nBank: ${method.bankName}\nRouting: ${method.routingNumber}`
        : method.name
    
    navigator.clipboard.writeText(textToCopy)
    setPaymentCopied(true)
    setTimeout(() => setPaymentCopied(false), 2000)
  }

  const handleSubmitInvestment = async () => {
    let walletDebit: Awaited<ReturnType<typeof debitUserWallet>> | null = null

    try {
      const now = Date.now()
      if (investmentSubmitInFlightRef.current || isInvestmentSubmitting) {
        showAlert('info', 'Submitting Investment', 'Your investment is already being submitted. Please hold on.')
        return
      }
      if (investmentRetryAt > now) {
        const secondsLeft = Math.ceil((investmentRetryAt - now) / 1000)
        showAlert('warning', 'Please Hold On', `Network issue detected. Please wait ${secondsLeft} seconds before trying again.`)
        return
      }

      const capital = parseFloat(investmentForm.capital)
      if (isNaN(capital) || capital <= 0) {
        showAlert('error', 'Invalid Amount', 'Please enter a valid amount greater than 0')
        return
      }
      if (capital < selectedPlan.minCapital) {
        showAlert('error', t('alerts.titleInvalidAmount'), t('alerts.invalidAmountMin', { min: selectedPlan.minCapital.toLocaleString() }))
        return
      }
      if (selectedPlan.maxCapital && capital > selectedPlan.maxCapital) {
        showAlert('error', t('alerts.titleInvalidAmount'), t('alerts.invalidAmountMax', { max: selectedPlan.maxCapital.toLocaleString() }))
        return
      }

      const isBalancePayment = investmentForm.paymentMethod === 'Balance'

      if (!isBalancePayment) {
        if (!investmentForm.transactionHash || investmentForm.transactionHash.trim() === '') {
          showAlert('error', t('alerts.titleTransactionHashRequired'), t('alerts.transactionHashRequired'))
          return
        }
        if (!investmentForm.bankSlip) {
          showAlert('error', t('alerts.titlePaymentProofRequired'), t('alerts.paymentProofRequired'))
          return
        }
      }

      investmentSubmitInFlightRef.current = true
      setIsInvestmentSubmitting(true)

      if (isBalancePayment) {
        walletDebit = await debitUserWallet(capital)
      }

      const dailyRoi = capital * selectedPlan.dailyRate  // Daily earnings
      const totalExpectedRoi = dailyRoi * selectedPlan.durationDays  // Total expected over duration
      const bonus = capital * selectedPlan.referralBonus

      const newInvestment = {
        id: 'INV' + Date.now(),
        idnum: currentUser?.idnum,
        userName: currentUser?.userName || currentUser?.name,
        plan: selectedPlan.name,
        status: 'Pending',
        capital,
        dailyRoi,                    // Daily ROI amount
        earnedRoi: 0,                // Starts at 0, credited daily
        totalExpectedRoi,            // Total expected at end
        roi: 0,                      // Current ROI earned (same as earnedRoi for compatibility)
        bonus,
        duration: selectedPlan.durationDays,
        daysCompleted: 0,            // No days completed yet
        paymentOption: investmentForm.paymentMethod,
        transactionHash: isBalancePayment ? `BALANCE-${investmentSessionIdRef.current || Date.now()}` : investmentForm.transactionHash,
        authStatus: 'unseen',
        date: new Date().toISOString(),
        startDate: null               // Will be set when activated by admin
      }

      // Try database first, fallback to local storage
      let investmentSaved = false;
      try {
        console.log('Creating investment in database:', newInvestment);
        const savedInvestment = await supabaseDb.createInvestment(newInvestment);
        console.log('Investment saved to database');
        investmentSaved = true;

        try {
          const apiBase = getApiBaseUrl();
          await fetch(`${apiBase}/api/investments/send-pending-notification`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              investmentId: savedInvestment.id || newInvestment.id,
              userId: currentUser?.idnum || '',
              amount: capital,
              plan: selectedPlan.name,
              dailyRoiRate: selectedPlan.dailyRate,
              duration: selectedPlan.durationDays,
              userEmail: currentUser?.email || '',
              userName: currentUser?.userName || currentUser?.name || 'User'
            })
          });
        } catch (notifyErr) {
          console.warn('Failed to request pending investment email for fallback flow:', notifyErr);
        }
      } catch (dbError) {
        console.error('Database save failed:', dbError);

        if (isBalancePayment) {
          if (walletDebit) {
            await restoreUserWallet(walletDebit.previousBalance, walletDebit.previousBonus)
          }
          throw dbError
        }

        console.log('Database unavailable, storing locally')
        investmentSaved = false;
        // Store in localStorage as fallback
        const localInvestments = JSON.parse(localStorage.getItem('userInvestments') || '[]')
        localInvestments.push(newInvestment)
        localStorage.setItem('userInvestments', JSON.stringify(localInvestments))
      }

      // Update local state
      setInvestments(prev => [...prev, newInvestment])
      
      // Add notification for investment creation
      addNotification(
        t('notifications.investmentCreatedTitle'),
        isBalancePayment
          ? `Your ${selectedPlan.name} investment of $${capital.toLocaleString()} has been created from your account balance.`
          : t('notifications.investmentCreatedMessage', { capital: capital.toLocaleString(), plan: selectedPlan.name, daily: dailyRoi.toLocaleString(), duration: selectedPlan.durationDays }),
        'success'
      )
      
      showAlert(
        'success',
        t('alerts.investmentCreatedTitle'),
        isBalancePayment
          ? `Your ${selectedPlan.name} investment of $${capital.toLocaleString()} has been created from your account balance.`
          : t('alerts.investmentCreatedMessage', { planName: selectedPlan.name, capital: capital.toLocaleString(), daily: dailyRoi.toLocaleString(), duration: selectedPlan.durationDays })
      )
      
      setInvestmentStep('success')
      
      setTimeout(() => {
        setShowInvestmentModal(false)
        setInvestmentStep('select')
        setSelectedPlan(null)
        setIsInvestmentSubmitting(false)
        setInvestmentRetryAt(0)
        investmentSessionIdRef.current = ''
        investmentSubmitInFlightRef.current = false
        setInvestmentForm({ capital: '', paymentMethod: 'Bitcoin', transactionHash: '', bankSlip: null })
        refreshUserBalance();
      }, 3000)
    } catch (error) {
      console.error('Error creating investment:', error)
      setInvestmentRetryAt(Date.now() + 10000)
      setIsInvestmentSubmitting(false)
      investmentSubmitInFlightRef.current = false
      showAlert(
        'error',
        t('alerts.investmentFailedTitle'),
        error instanceof Error
          ? `${error.message} Please hold on for 10 seconds before trying again.`
          : `${t('alerts.investmentFailedMessage')} Please hold on for 10 seconds before trying again.`
      )
    }
  }

  const closeInvestmentModal = () => {
    setShowInvestmentModal(false)
    setInvestmentStep('select')
    setSelectedPlan(null)
    setIsInvestmentSubmitting(false)
    setInvestmentRetryAt(0)
    investmentSessionIdRef.current = ''
    investmentSubmitInFlightRef.current = false
    setInvestmentForm({ capital: '', paymentMethod: 'Bitcoin', transactionHash: '', bankSlip: null })
  }

  // Show all investments except those explicitly deleted (if any)
  const visibleInvestments = investments.filter(inv =>
    inv.status?.toLowerCase() !== 'deleted' && inv.status !== undefined
  );
  // For totals, count active/approved/completed
  const approvedInvestments = investments.filter(inv =>
    inv.status?.toLowerCase() === 'active' ||
    inv.status?.toLowerCase() === 'approved' ||
    inv.status?.toLowerCase() === 'completed'
  );
  const totalCapital = approvedInvestments.reduce((sum, inv) => sum + (inv.capital || 0), 0)
  const totalROI = approvedInvestments.reduce((sum, inv) => sum + (inv.roi || 0), 0)
  // Total Earned = Only CREDITED ROI + CREDITED BONUS (actual earnings, not expected)
  const totalEarned = approvedInvestments.reduce((sum, inv) => sum + (inv.creditedRoi || 0) + (inv.creditedBonus || 0), 0)
  // Calculate total returns (Realized ROI + Realized Bonus + Returned Capital for completed plans)
  const totalReturns = approvedInvestments.reduce((sum, inv) => {
    const profit = (inv.creditedRoi || 0) + (inv.creditedBonus || 0)
    const capitalReturned = inv.status?.toLowerCase() === 'completed' ? (inv.capital || 0) : 0
    return sum + profit + capitalReturned
  }, 0)
  const totalBalance = (currentUser?.balance || 0) + (currentUser?.bonus || 0)
  const configuredInvestmentAmount = parseFloat(investmentForm.capital) || 0
  const balanceAfterConfiguredInvestment = totalBalance - configuredInvestmentAmount
  const downlineCount = Math.max(currentUser?.referralCount || 0, downlineReferrals.length)
  const downlineEarnings = Math.max(
    currentUser?.referralBonusTotal || 0,
    downlineReferrals.reduce((sum, referral) => sum + Number(referral.bonusEarned || 0), 0)
  )

  // Deposit Final Submit Handler
  const handleFinalDepositSubmit = async () => {
    if (depositSubmitInFlightRef.current) return;
    if (!currentUser?.idnum) return;
    depositSubmitInFlightRef.current = true;
    setDepositLoading(true);
    setDepositError('');

    try {
      // Validate mandatory fields
      if (!depositProof) {
        throw new Error('Payment proof image/document is required');
      }
      if (!depositTxHash) {
        throw new Error('Transaction ID / Hash is required');
      }

      let proofUrl = '';
      if (depositProof) {
         try {
           proofUrl = await supabaseDb.uploadPaymentProof(currentUser.idnum, depositProof);
         } catch(e) {
           console.error("Upload error", e);
           throw new Error("Failed to upload payment proof. Please try again or check file size.");
         }
      }

      const amount = parseFloat(depositAmount);
            
      await supabaseDb.createDeposit({
        idnum: currentUser.idnum,
        amount: amount,
        method: selectedDepositMethod,
        transactionHash: depositTxHash,
        paymentProofUrl: proofUrl,
        status: 'pending',
        authStatus: 'pending',
        date: new Date().toISOString()
      });

      try {
        const apiBase = getApiBaseUrl();
        const notifyResponse = await fetch(`${apiBase}/api/notify/deposit-request`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userEmail: currentUser?.email || '',
            userName: currentUser?.userName || currentUser?.name || 'User',
            amount,
            method: selectedDepositMethod,
            currency: selectedDepositMethod,
            txHash: depositTxHash,
            proofUrl
          })
        });
        if (!notifyResponse.ok) throw new Error('Deposit notification request failed');
      } catch (notifyErr) {
        console.warn('Failed to send deposit admin notification:', notifyErr);
      }

      addNotification(
        'Deposit Submitted',
        `Your deposit of $${amount.toLocaleString()} via ${selectedDepositMethod} is currently under review by the admin.`,
        'success'
      );

      // Reset form
      setDepositStep(1);
      setDepositAmount('');
      setDepositProof(null);
      setDepositTxHash('');
      
      // Refresh deposits list
      const latestDeposits = await supabaseDb.getDepositsByUser(currentUser.idnum);
      setDeposits(latestDeposits);

      setProfileState('Deposit'); // Stay on Deposit page to see the history
      
      showAlert('success', 'Deposit Submitted', 'Your deposit has been submitted successfully and is pending approval.');
      
      // Refresh user balance (in case it changes)
      refreshUserBalance()
    } catch (err: any) {
      console.error('Deposit Error:', err);
      setDepositError(err.message || 'Failed to submit deposit');
      showAlert('error', 'Submission Failed', err.message || 'An error occurred during verification.');
    } finally {
      depositSubmitInFlightRef.current = false;
      setDepositLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="dashboard-loading">
        <div className="loading-spinner"></div>
        <p>Loading Dashboard...</p>
      </div>
    )
  }

  return (
    <div className="modern-dashboard">
      {dummyInvestmentAlert && (
        <div className="dummy-investment-alert" role="status" aria-live="polite">
          <div className="dummy-investment-alert__icon">
            <i className="icofont-chart-growth"></i>
          </div>
          <div className="dummy-investment-alert__body">
            <div className="dummy-investment-alert__eyebrow">Live investment</div>
            <div className="dummy-investment-alert__title">
              {dummyInvestmentAlert.userName} just invested ${formatCurrency(dummyInvestmentAlert.amount)}
            </div>
            <div className="dummy-investment-alert__meta">
              {dummyInvestmentAlert.plan} <span>{dummyInvestmentAlert.location}</span>
            </div>
          </div>
          <button
            type="button"
            className="dummy-investment-alert__close"
            aria-label="Dismiss investment alert"
            onClick={() => setDummyInvestmentAlert(null)}
          >
            <i className="icofont-close"></i>
          </button>
        </div>
      )}

      {roiPopup.show && (
        <div
          onClick={closeRoiPopup}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(2, 6, 23, 0.72)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100000,
            padding: '18px',
          }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              width: 'min(460px, 100%)',
              background: 'linear-gradient(145deg, #151a22 0%, #0f141b 100%)',
              border: '1px solid rgba(240,185,11,0.22)',
              borderRadius: '14px',
              boxShadow: '0 24px 70px rgba(0,0,0,0.48)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: '16px',
                padding: '20px 20px 14px',
                borderBottom: '1px solid rgba(255,255,255,0.08)',
              }}
            >
              <div>
                <p style={{ color: '#f0b90b', fontSize: '12px', fontWeight: 700, margin: '0 0 6px', textTransform: 'uppercase' }}>
                  Return credited
                </p>
                <h2 style={{ color: '#f8fafc', fontSize: '22px', lineHeight: 1.2, margin: 0 }}>
                  ${formatCurrency(roiPopup.total)} earned
                </h2>
              </div>
              <button
                onClick={closeRoiPopup}
                aria-label="Close ROI summary"
                style={{
                  width: '34px',
                  height: '34px',
                  borderRadius: '8px',
                  border: '1px solid rgba(255,255,255,0.1)',
                  background: 'rgba(255,255,255,0.05)',
                  color: '#cbd5e1',
                  cursor: 'pointer',
                  display: 'grid',
                  placeItems: 'center',
                }}
              >
                <i className="icofont-close"></i>
              </button>
            </div>

            <div style={{ padding: '14px 20px 6px' }}>
              {roiPopup.items.slice(0, 5).map((item) => (
                <div
                  key={item.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '14px',
                    padding: '12px 0',
                    borderBottom: '1px solid rgba(255,255,255,0.06)',
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ color: '#f8fafc', fontSize: '14px', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {item.plan}
                    </div>
                    <div style={{ color: '#94a3b8', fontSize: '12px', marginTop: '3px', textTransform: 'capitalize' }}>
                      {item.status || 'credited'}
                    </div>
                  </div>
                  <div style={{ color: '#4ade80', fontSize: '14px', fontWeight: 800, whiteSpace: 'nowrap' }}>
                    +${formatCurrency(item.amount)}
                  </div>
                </div>
              ))}
              {roiPopup.items.length > 5 && (
                <p style={{ color: '#94a3b8', fontSize: '12px', margin: '12px 0 0' }}>
                  {roiPopup.items.length - 5} more investment returns included.
                </p>
              )}
            </div>

            <div style={{ padding: '16px 20px 20px' }}>
              <button
                onClick={closeRoiPopup}
                style={{
                  width: '100%',
                  border: 'none',
                  borderRadius: '10px',
                  background: 'linear-gradient(135deg, #f0b90b 0%, #f8d33a 100%)',
                  color: '#111827',
                  padding: '12px 16px',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Header Bar (mobile UX parity with AdminDashboard) */}
      <div className="mobile-header">
        <button
          className="mobile-header-btn"
          onClick={() => setShowSidePanel(!showSidePanel)}
          aria-label="Toggle menu"
        >
          <i className="icofont-navigation-menu"></i>
        </button>
        <h1 className="mobile-header-title">{profileState}</h1>
        <div className="mobile-header-logo">
          <span style={{ color: '#f0b90b', fontWeight: 700 }}>CV</span>
        </div>
      </div>
      {/* Sidebar */}
      <aside className={`dashboard-sidebar ${showSidePanel ? 'mobile-open' : ''}`}>
        <div className="sidebar-header">
          {/* Language Switcher for Dashboard sidebar */}
          <div style={{ marginTop: 8, marginBottom: 8 }}>
            <LanguageSwitcher variant="dashboard" />
          </div>
          <Link to="/" className="logo-link">
            <img src="/images/big.png" alt="eToro Trust Capital" className="sidebar-logo" />
          </Link>
        </div>

        <div className="sidebar-user">
          <div className="user-avatar">
            <img src={`/images/${currentUser?.avatar || 'avatar_male_1'}.svg`} alt="Avatar" />
          </div>
          <div className="user-info">
            <h3>{currentUser?.name || currentUser?.userName}</h3>
            <p>{currentUser?.email}</p>
          </div>
        </div>

        {/* Notifications Button */}
        <div className="sidebar-notifications">
          <button className="sidebar-notification-btn" onClick={() => setShowNotifications(true)}>
            <i className="icofont-notification"></i>
            <span>Notifications</span>
            {notifications.filter(n => !n.read).length > 0 && (
              <span className="sidebar-notif-badge">{notifications.filter(n => !n.read).length}</span>
            )}
          </button>
        </div>

        <nav className="sidebar-nav">
          <button
            className={`nav-item ${profileState === 'Dashboard' ? 'active' : ''}`}
            onClick={() => { setProfileState('Dashboard'); setShowSidePanel(false); }}
          >
            <i className="icofont-dashboard-web"></i>
            <span>Dashboard</span>
          </button>
          <button
            className={`nav-item ${profileState === 'Wallet' ? 'active' : ''}`}
            onClick={() => { setProfileState('Wallet'); setShowSidePanel(false); }}
          >
            <i className="icofont-wallet"></i>
            <span>Wallet</span>
          </button>
          <button
            className={`nav-item ${profileState === 'Deposit' ? 'active' : ''}`}
            onClick={() => { setProfileState('Deposit'); setShowSidePanel(false); }}
          >
            <i className="icofont-plus-circle"></i>
            <span>Deposit Funds</span>
          </button>
          <button
            className={`nav-item ${profileState === 'Investments' ? 'active' : ''}`}
            onClick={() => { setProfileState('Investments'); setShowSidePanel(false); }}
          >
            <i className="icofont-chart-growth"></i>
            <span>Investments</span>
            {investments.filter(i => i.authStatus !== 'seen').length > 0 && (
              <span className="badge">{investments.filter(i => i.authStatus !== 'seen').length}</span>
            )}
          </button>
          <button
            className={`nav-item ${profileState === 'Withdrawals' ? 'active' : ''}`}
            onClick={() => { setProfileState('Withdrawals'); setShowSidePanel(false); }}
          >
            <i className="icofont-money"></i>
            <span>Withdrawals</span>
          </button>
          <button
            className={`nav-item ${profileState === 'Bonus' ? 'active' : ''}`}
            onClick={() => { setProfileState('Bonus'); setShowSidePanel(false); }}
          >
            <i className="icofont-gift"></i>
            <span>Bonus</span>
          </button>
          <button
            className={`nav-item ${profileState === 'Downline' ? 'active' : ''}`}
            onClick={() => { setProfileState('Downline'); setShowSidePanel(false); }}
          >
            <i className="icofont-users-social"></i>
            <span>Downline</span>
          </button>
          <button
            className={`nav-item ${profileState === 'Loans' ? 'active' : ''}`}
            onClick={() => { setProfileState('Loans'); setShowSidePanel(false); }}
          >
            <i className="icofont-money-bag"></i>
            <span>Loans</span>
          </button>
          <button
            className={`nav-item ${profileState === 'Stocks' ? 'active' : ''}`}
            onClick={() => { setProfileState('Stocks'); setShowSidePanel(false); }}
            title="Stock Trading - Coming Soon"
          >
            <i className="icofont-chart-line"></i>
            <span>Stock Trading (Coming Soon)</span>
          </button>
          <button
            className={`nav-item ${profileState === 'Profile' ? 'active' : ''}`}
            onClick={openProfileKycSection}
          >
            <i className="icofont-user-suited"></i>
            <span>Profile & KYC</span>
          </button>
          <button
            className={`nav-item ${profileState === 'Support' ? 'active' : ''}`}
            onClick={() => { setProfileState('Support'); setShowSidePanel(false); }}
          >
            <i className="icofont-live-support"></i>
            <span>Support</span>
          </button>
                    {/* Admin Panel Link - Only visible to admin users */}
          {(currentUser?.role === 'admin' || currentUser?.role === 'superadmin') && (
            <button
              className="nav-item"
              onClick={() => navigate('/admin')}
              style={{
                background: 'linear-gradient(135deg, rgba(139,92,246,0.15) 0%, rgba(59,130,246,0.15) 100%)',
                border: '1px solid rgba(139,92,246,0.3)',
                marginTop: '0.5rem'
              }}
            >
              <i className="icofont-shield"></i>
              <span>Admin Panel</span>
            </button>
          )}
        </nav>

        <div className="sidebar-footer">
          <button className="logout-btn" onClick={handleLogout}>
            <i className="icofont-sign-out"></i>
            <span>Log Out</span>
          </button>
        </div>

        {showSidePanel && (
          <button className="sidebar-close" onClick={() => setShowSidePanel(false)}>
            <i className="icofont-close"></i>
          </button>
        )}
      </aside>

      {/* Main Content */}
      <main className="dashboard-main">
        <DashboardMarquee btcPrice={cryptoPrices.BTC} loading={cryptoLoading} />
        
        {/* KYC Warning Banner */}
        {currentUser?.authStatus?.toLowerCase() !== 'approved' && currentUser?.authStatus?.toLowerCase() !== 'verified' && (
          <div style={{
            background: 'linear-gradient(135deg, rgba(239,68,68,0.1) 0%, rgba(239,68,68,0.2) 100%)',
            border: '1px solid rgba(239,68,68,0.3)',
            padding: '1rem 1.5rem',
            marginBottom: '2rem',
            borderRadius: '16px',
            color: '#ef4444',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            boxShadow: '0 4px 6px -1px rgba(239, 68, 68, 0.1)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <div style={{
                background: 'rgba(239,68,68,0.2)',
                width: '40px',
                height: '40px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <i className="icofont-warning-alt" style={{ fontSize: '1.25rem' }}></i>
              </div>
              <div>
                <h4 style={{ margin: '0 0 0.25rem 0', fontSize: '1rem', fontWeight: 600 }}>Action Required: Complete Identity Verification</h4>
                <p style={{ margin: 0, fontSize: '0.85rem', opacity: 0.9, color: '#f8fafc' }}>Your account is limited. Withdrawals are disabled until KYC is verified.</p>
              </div>
            </div>
            <button 
              onClick={openKycVerificationModal}
              style={{
                background: '#ef4444',
                color: 'white',
                border: 'none',
                padding: '0.625rem 1.25rem',
                borderRadius: '8px',
                fontWeight: 600,
                fontSize: '0.85rem',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                boxShadow: '0 2px 4px rgba(239, 68, 68, 0.2)'
              }}
            >
              Verify Now <i className="icofont-arrow-right"></i>
            </button>
          </div>
        )}

        <div className="dashboard-content">
          {profileState === 'Dashboard' && (
            <>
              {/* Stats Grid */}
              <div className="stats-grid">
                <div className="stat-card primary">
                  <div className="stat-icon">
                    <i className="icofont-wallet"></i>
                  </div>
                  <div className="stat-details">
                    <p className="stat-label">Total Balance</p>
                    <h2 className="stat-value">${totalBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</h2>
                    <p className="stat-change positive">+12.5% this month</p>
                  </div>
                </div>

                <div className="stat-card">
                  <div className="stat-icon" style={{ background: 'rgba(34, 197, 94, 0.1)', color: '#22c55e' }}>
                    <i className="icofont-dollar"></i>
                  </div>
                  <div className="stat-details">
                    <p className="stat-label">Available Balance</p>
                    <h2 className="stat-value">${totalBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</h2>
                    <p className="stat-info">Ready for withdrawal</p>
                  </div>
                </div>

                <div className="stat-card">
                  <div className="stat-icon">
                    <i className="icofont-chart-growth"></i>
                  </div>
                  <div className="stat-details">
                    <p className="stat-label">Total Returns</p>
                    <h2 className="stat-value">${totalReturns.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</h2>
                    <p className="stat-change positive">+${totalEarned.toLocaleString()} earned</p>
                  </div>
                </div>

                <div className="stat-card">
                  <div className="stat-icon">
                    <i className="icofont-users"></i>
                  </div>
                  <div className="stat-details">
                    <p className="stat-label">Referrals</p>
                    <h2 className="stat-value">{downlineCount}</h2>
                    <p className="stat-info">Active network members</p>
                  </div>
                </div>
              </div>

              {/* Recent Activity */}
              <div className="activity-section">
                <div className="section-header">
                  <h3>Recent Investments</h3>
                  <Link to="#" className="view-all">View All →</Link>
                </div>
                <div className="activity-list">
                  {investments.length === 0 ? (
                    <div className="empty-state">
                      <i className="icofont-chart-line"></i>
                      <p>No investments yet</p>
                      <button className="cta-btn" onClick={() => setProfileState('Investments')}>Start Investing</button>
                    </div>
                  ) : (
                    investments.slice(0, 5).map((inv, idx) => (
                      <div key={idx} className="activity-item">
                        <div className="activity-icon">
                          <i className="icofont-money-bag"></i>
                        </div>
                        <div className="activity-details">
                          <h4>{inv.plan} Plan</h4>
                          <p>{new Date(inv.date || '').toLocaleDateString()}</p>
                        </div>
                        <div className="activity-amount">
                          <p className="amount">${(inv.capital || 0).toLocaleString()}</p>
                          <span className={`status-badge ${inv.status}`}>{inv.status}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Quick Actions */}
              <div className="quick-actions">
                <div className="section-header">
                  <h3>Quick Actions</h3>
                </div>
                <div className="actions-grid">
                  <button className="action-card" onClick={() => setProfileState('Deposit')}>
                    <i className="icofont-plus-circle"></i>
                    <h4>Deposit Funds</h4>
                    <p>Add money to your wallet</p>
                  </button>
                  <button className="action-card" onClick={() => setProfileState('Investments')}>
                    <i className="icofont-plus-circle"></i>
                    <h4>New Investment</h4>
                    <p>Start earning today</p>
                  </button>
                  <button className="action-card" onClick={() => setProfileState('Withdrawals')}>
                    <i className="icofont-pay"></i>
                    <h4>Withdraw Funds</h4>
                    <p>Cash out earnings</p>
                  </button>
                  <button className="action-card" onClick={() => setProfileState('Referrals')}>
                    <i className="icofont-share"></i>
                    <h4>Refer & Earn</h4>
                    <p>Invite friends</p>
                  </button>
                  <button className="action-card" onClick={() => setProfileState('Profile')}>
                    <i className="icofont-settings"></i>
                    <h4>Settings</h4>
                    <p>Manage account</p>
                  </button>
                </div>
              </div>
            </>
          )}

          {profileState === 'Deposit' && (
            <div className="page-section">
              <div className="page-header">
                <h2><i className="icofont-plus-circle"></i> Deposit Funds</h2>
              </div>
              
              <div className="deposit-wizard-container" style={{ maxWidth: 800, margin: '0 auto' }}>
                <div className="wizard-stepper" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2rem', position: 'relative' }}>
                  {[1, 2, 3, 4].map(step => (
                    <div key={step} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 1, cursor: step < depositStep ? 'pointer' : 'default' }} onClick={() => step < depositStep && setDepositStep(step)}>
                      <div style={{
                        width: 32, height: 32, borderRadius: '50%',
                        background: step <= depositStep ? 'var(--accent)' : 'var(--surface)',
                        border: step <= depositStep ? 'none' : '2px solid var(--border)',
                        color: step <= depositStep ? 'var(--bg)' : 'var(--text-muted)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold'
                      }}>
                        {step < depositStep ? <i className="icofont-check"></i> : step}
                      </div>
                      <span style={{ fontSize: '0.8rem', marginTop: 8, color: step <= depositStep ? 'var(--accent)' : 'var(--text-muted)' }}>
                        {step === 1 ? 'Method' : step === 2 ? 'Details' : step === 3 ? 'Proof' : 'Confirm'}
                      </span>
                    </div>
                  ))}
                  <div style={{ position: 'absolute', top: 16, left: 0, right: 0, height: 2, background: 'var(--border)', zIndex: 0 }}>
                    <div style={{ width: `${((depositStep - 1) / 3) * 100}%`, height: '100%', background: 'var(--accent)', transition: 'width 0.3s ease' }}></div>
                  </div>
                </div>

                <div className="wizard-content" style={{ background: 'var(--surface)', padding: '2rem', borderRadius: 16, boxShadow: '0 4px 20px rgba(0,0,0,0.2)' }}>
                  
                  {depositStep === 1 && (
                    <div className="step-content">
                      <h3 style={{ textAlign: 'center', marginBottom: '1.5rem' }}>Select Deposit Category</h3>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                        <div 
                          className={`category-card ${selectedDepositCategory === 'crypto' ? 'active' : ''}`}
                          onClick={() => { setSelectedDepositCategory('crypto'); setSelectedDepositMethod('Bitcoin'); setDepositStep(2); }}
                          style={{ 
                            padding: '2rem', border: '2px solid var(--border)', borderRadius: 12, cursor: 'pointer', textAlign: 'center',
                            background: selectedDepositCategory === 'crypto' ? 'rgba(240,185,11,0.1)' : 'transparent',
                            borderColor: selectedDepositCategory === 'crypto' ? 'var(--accent)' : 'var(--border)'
                          }}
                        >
                          <i className="icofont-bitcoin" style={{ fontSize: '3rem', color: 'var(--accent)', marginBottom: '1rem', display: 'block' }}></i>
                          <h4>Crypto Deposit</h4>
                          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Bitcoin, Ethereum, USDT</p>
                        </div>
                        <div 
                          className={`category-card ${selectedDepositCategory === 'bank' ? 'active' : ''}`}
                          onClick={() => { setSelectedDepositCategory('bank'); setSelectedDepositMethod('Bank'); setDepositStep(2); }}
                          style={{ 
                            padding: '2rem', border: '2px solid var(--border)', borderRadius: 12, cursor: 'pointer', textAlign: 'center',
                            background: selectedDepositCategory === 'bank' ? 'rgba(240,185,11,0.1)' : 'transparent',
                            borderColor: selectedDepositCategory === 'bank' ? 'var(--accent)' : 'var(--border)'
                          }}
                        >
                          <i className="icofont-bank-transfer" style={{ fontSize: '3rem', color: 'var(--accent)', marginBottom: '1rem', display: 'block' }}></i>
                          <h4>Bank Transfer</h4>
                          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>SWIFT, SEPA, Wire</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {depositStep === 2 && (
                    <div className="step-content">
                      <h3 style={{ marginBottom: '1.5rem' }}>Enter Details</h3>
                      
                      <div className="form-group" style={{ marginBottom: '1.5rem' }}>
                        <label style={{ display: 'block', marginBottom: 8, fontWeight: 600 }}>Deposit Amount (USD)</label>
                        <div className="input-group" style={{ display: 'flex', alignItems: 'center' }}>
                          <span style={{ padding: '0.75rem', background: 'var(--bg)', border: '1px solid var(--border)', borderRight: 'none', borderRadius: '8px 0 0 8px', color: 'var(--text-muted)' }}>$</span>
                          <input 
                            type="number" 
                            value={depositAmount} 
                            onChange={e => setDepositAmount(e.target.value)}
                            placeholder="Min: 100"
                            style={{ flex: 1, padding: '0.75rem', border: '1px solid var(--border)', borderRadius: '0 8px 8px 0', background: 'var(--bg)', color: 'var(--text)' }}
                          />
                        </div>
                        {parseFloat(depositAmount) < 10 && <p style={{ color: 'red', fontSize: '0.8rem', marginTop: 4 }}>Minimum deposit is $10</p>}
                      </div>

                      {selectedDepositCategory === 'crypto' && (
                        <div className="form-group" style={{ marginBottom: '1.5rem' }}>
                          <label style={{ display: 'block', marginBottom: 8, fontWeight: 600 }}>Select Network / Asset</label>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                            {Object.entries(cryptoPaymentMethods).map(([key, method]) => (
                                <button
                                  key={key}
                                  onClick={() => setSelectedDepositMethod(key)}
                                  style={{
                                    padding: '0.5rem 1rem',
                                    borderRadius: 6,
                                    border: selectedDepositMethod === key ? '1px solid var(--accent)' : '1px solid var(--border)',
                                    background: selectedDepositMethod === key ? 'rgba(240,185,11,0.1)' : 'transparent',
                                    color: 'var(--text)',
                                    cursor: 'pointer',
                                    opacity: selectedDepositMethod === key ? 1 : 0.7
                                  }}
                                >
                                  {(method as any).name}
                                </button>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="details-box" style={{ background: 'var(--bg)', padding: '1.5rem', borderRadius: 8, border: '1px solid var(--border)' }}>
                        <h4 style={{ fontSize: '1rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem', marginBottom: '1rem' }}>Payment Instructions</h4>
                         {'address' in externalPaymentMethods[selectedDepositMethod as keyof typeof externalPaymentMethods] ? (
                            <div className="crypto-details">
                              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem' }}>
                                <img src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${(externalPaymentMethods[selectedDepositMethod as keyof typeof externalPaymentMethods] as any).address}`} alt="QR" style={{ border: '4px solid white' }} />
                              </div>
                              <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: 4 }}>Address:</p>
                              <div style={{ display: 'flex', gap: 8 }}>
                                <code style={{ flex: 1, background: '#111', padding: 8, borderRadius: 4, wordBreak: 'break-all', color: 'var(--accent)' }}>{(externalPaymentMethods[selectedDepositMethod as keyof typeof externalPaymentMethods] as any).address}</code>
                                <button onClick={() => handleCopy((externalPaymentMethods[selectedDepositMethod as keyof typeof externalPaymentMethods] as any).address || '')} style={{ background: 'var(--accent)', color: 'black', border: 'none', borderRadius: 4, width: 36, cursor: 'pointer' }}>
                                  <i className="icofont-copy"></i>
                                </button>
                              </div>
                            </div>
                         ) : (
                            <div className="bank-details">
                                <p style={{ marginBottom: 4 }}><strong>Bank Name:</strong> {(externalPaymentMethods['Bank'] as any).bankName}</p>
                                <p style={{ marginBottom: 4 }}><strong>Account:</strong> {(externalPaymentMethods['Bank'] as any).accountName}</p>
                                <p style={{ marginBottom: 4 }}><strong>Number:</strong> {(externalPaymentMethods['Bank'] as any).accountNumber} <i className="icofont-copy" style={{ cursor: 'pointer', color: 'var(--accent)' }} onClick={() => handleCopy((externalPaymentMethods['Bank'] as any).accountNumber)}></i></p>
                                <p style={{ marginBottom: 4 }}><strong>Routing:</strong> {(externalPaymentMethods['Bank'] as any).routingNumber}</p>
                                <p><strong>SWIFT:</strong> {(externalPaymentMethods['Bank'] as any).swiftCode}</p>
                            </div>
                         )}
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '2rem' }}>
                         <button onClick={() => setDepositStep(1)} style={{ padding: '0.75rem 1.5rem', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, cursor: 'pointer' }}>Back</button>
                         <button 
                            disabled={!depositAmount || parseFloat(depositAmount) <= 0}
                            onClick={() => parseFloat(depositAmount) > 0 && setDepositStep(3)} 
                            style={{ padding: '0.75rem 2rem', background: 'var(--accent)', color: 'black', fontWeight: 'bold', border: 'none', borderRadius: 8, cursor: 'pointer', opacity: !depositAmount ? 0.5 : 1 }}
                          >
                           Next Step
                         </button>
                      </div>
                    </div>
                  )}

                  {depositStep === 3 && (
                    <div className="step-content">
                       <h3 style={{ marginBottom: '1.5rem' }}>Proof of Payment</h3>
                       <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>Please upload a screenshot of your payment and enter the transaction content ID / Hash for verification.</p>

                       <div className="form-group" style={{ marginBottom: '1.5rem' }}>
                          <label style={{ display: 'block', marginBottom: 8, fontWeight: 600 }}>Transaction Hash / ID</label>
                          <input 
                            type="text" 
                            value={depositTxHash} 
                            onChange={e => setDepositTxHash(e.target.value)}
                            placeholder="e.g. 0x8f7a..."
                            style={{ width: '100%', padding: '0.75rem', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg)', color: 'var(--text)' }}
                          />
                       </div>

                       <div className="form-group" style={{ marginBottom: '1.5rem' }}>
                          <label style={{ display: 'block', marginBottom: 8, fontWeight: 600 }}>Upload Payment Screenshot</label>
                          <div 
                            style={{ 
                              border: '2px dashed var(--border)', borderRadius: 8, padding: '2rem', textAlign: 'center', cursor: 'pointer',
                              background: depositProof ? 'rgba(240,185,11,0.05)' : 'transparent'
                            }}
                            onClick={() => document.getElementById('proof-upload')?.click()}
                          >
                            <input 
                              id="proof-upload" 
                              type="file" 
                              accept="image/*,.pdf" 
                              onChange={e => e.target.files && setDepositProof(e.target.files[0])}
                              style={{ display: 'none' }}
                            />
                            <i className="icofont-upload-alt" style={{ fontSize: '2rem', color: 'var(--text-muted)' }}></i>
                            <p style={{ marginTop: '1rem', color: depositProof ? 'var(--accent)' : 'var(--text)' }}>
                              {depositProof ? depositProof.name : 'Click to Upload proof'}
                            </p>
                          </div>
                       </div>

                       <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '2rem' }}>
                         <button onClick={() => setDepositStep(2)} style={{ padding: '0.75rem 1.5rem', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, cursor: 'pointer' }}>Back</button>
                         <button 
                            disabled={!depositTxHash && !depositProof}
                            onClick={() => (depositTxHash || depositProof) && setDepositStep(4)} 
                            style={{ padding: '0.75rem 2rem', background: 'var(--accent)', color: 'black', fontWeight: 'bold', border: 'none', borderRadius: 8, cursor: 'pointer', opacity: (!depositTxHash && !depositProof) ? 0.5 : 1 }}
                          >
                           Review
                         </button>
                      </div>
                    </div>
                  )}

                  {depositStep === 4 && (
                    <div className="step-content">
                      <h3 style={{ marginBottom: '1.5rem' }}>Confirm Deposit</h3>
                      
                      <div className="review-box" style={{ background: 'var(--bg)', borderRadius: 8, overflow: 'hidden' }}>
                        <div style={{ padding: '1rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--text-muted)' }}>Amount</span>
                          <strong style={{ fontSize: '1.2rem', color: 'var(--accent)' }}>${parseFloat(depositAmount).toLocaleString()}</strong>
                        </div>
                        <div style={{ padding: '1rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--text-muted)' }}>Method</span>
                          <strong>{(externalPaymentMethods[selectedDepositMethod as keyof typeof externalPaymentMethods] as any).name}</strong>
                        </div>
                        <div style={{ padding: '1rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--text-muted)' }}>Tx Hash</span>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '150px' }}>{depositTxHash || 'Not provided'}</span>
                        </div>
                         <div style={{ padding: '1rem', display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--text-muted)' }}>Proof File</span>
                          <span>{depositProof ? depositProof.name : 'Not provided'}</span>
                        </div>
                      </div>

                      <div style={{ marginTop: '1.5rem', padding: '1rem', background: 'rgba(255, 100, 100, 0.1)', border: '1px solid rgba(255, 100, 100, 0.3)', borderRadius: 8, fontSize: '0.9rem' }}>
                        <i className="icofont-warning-alt" style={{ marginRight: 8 }}></i>
                        Please ensure you have sent the exact amount. Deposits are manually verified and will be credited once confirmed.
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '2rem' }}>
                         <button onClick={() => setDepositStep(3)} style={{ padding: '0.75rem 1.5rem', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, cursor: 'pointer' }}>Back</button>
                         <button 
                            onClick={handleFinalDepositSubmit}
                            disabled={depositLoading}
                            style={{ padding: '0.75rem 2rem', background: depositLoading ? 'rgba(240,185,11,0.55)' : 'var(--accent)', color: 'black', fontWeight: 'bold', border: 'none', borderRadius: 8, cursor: depositLoading ? 'not-allowed' : 'pointer' }}
                          >
                           {depositLoading ? 'Submitting...' : 'Submit Application'}
                         </button>
                      </div>
                    </div>
                  )}

                </div>

                {/* Deposit History Section */}
                <div style={{ marginTop: '3rem', maxWidth: 800, margin: '3rem auto 0' }}>
                  <div className="section-header">
                     <h3><i className="icofont-history"></i> Deposit History</h3>
                  </div>
                  <div className="investments-list" style={{ marginTop: '1rem', background: 'var(--surface)', borderRadius: 16, overflow: 'hidden', border: '1px solid var(--border)' }}>
                    <div className="table-container history-table-shell">
                      <table className="history-table data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)' }}>
                            <th style={{ padding: '1rem', textAlign: 'left', color: 'var(--text-muted)' }}>Date</th>
                            <th style={{ padding: '1rem', textAlign: 'left', color: 'var(--text-muted)' }}>Method</th>
                            <th style={{ padding: '1rem', textAlign: 'left', color: 'var(--text-muted)' }}>Amount</th>
                            <th style={{ padding: '1rem', textAlign: 'right', color: 'var(--text-muted)' }}>Status</th>
                          </tr>
                        </thead>
                         <tbody>
                            {deposits.length > 0 ? (
                              deposits.slice(0, 10).map((dep, idx) => (
                                <tr key={idx} style={{ borderBottom: '1px solid var(--border)' }}>
                                  <td data-label="Date" style={{ padding: '1rem' }}>{new Date(dep.created_at || new Date()).toLocaleDateString()}</td>
                                  <td data-label="Method" style={{ padding: '1rem' }}>{dep.method}</td>
                                  <td data-label="Amount" style={{ padding: '1rem', fontWeight: 600 }}>${dep.amount?.toLocaleString()}</td>
                                  <td data-label="Status" style={{ padding: '1rem', textAlign: 'right' }}>
                                    <span className={`status-badge ${dep.status || 'pending'}`} style={{ 
                                      textTransform: 'capitalize',
                                      padding: '0.25rem 0.75rem',
                                      borderRadius: '12px',
                                      fontSize: '0.8rem',
                                      background: (dep.status === 'approved' || dep.status === 'completed') ? 'rgba(16, 185, 129, 0.2)' : 
                                                  (dep.status === 'rejected') ? 'rgba(239, 68, 68, 0.2)' : 'rgba(245, 158, 11, 0.2)',
                                      color: (dep.status === 'approved' || dep.status === 'completed') ? '#10b981' : 
                                             (dep.status === 'rejected') ? '#ef4444' : '#f59e0b'
                                    }}>
                                      {dep.status || 'Pending'}
                                    </span>
                                  </td>
                                </tr>
                              ))
                            ) : (
                              <tr>
                                <td colSpan={4} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                                  No deposit history found.
                                </td>
                              </tr>
                            )}
                         </tbody>
                      </table>
                    </div>
                  </div>
                </div>

              </div>
            </div>
          )}

          {profileState === 'Wallet' && (
            <div className="page-section">
              <div className="page-header">
                <h2><i className="icofont-wallet"></i> Wallet Overview</h2>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  {cryptoLoading && <span style={{ color: '#f0b90b', fontSize: '12px' }}><i className="icofont-refresh"></i> Updating...</span>}
                  <button type="button" className="primary-btn" onClick={() => setProfileState('Deposit')}><i className="icofont-plus-circle"></i> Deposit</button>
                </div>
              </div>

              {/* Balance Cards - Using stats-grid like Dashboard */}
              <div className="stats-grid">
                <div className="stat-card primary">
                  <div className="stat-icon">
                    <i className="icofont-dollar-true"></i>
                  </div>
                  <div className="stat-details">
                    <p className="stat-label">Fiat Balance</p>
                    <h2 className="stat-value">${totalBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</h2>
                    <p className="stat-change positive"><i className="icofont-check-circled"></i> Available: ${totalBalance.toLocaleString()}</p>
                    <p className="stat-info" style={{ color: '#f0b90b' }}><i className="icofont-gift"></i> Bonus: +${(currentUser?.bonus || 0).toLocaleString()}</p>
                  </div>
                </div>

                <div className="stat-card">
                  <div className="stat-icon" style={{ background: 'rgba(247, 147, 26, 0.1)', color: '#f7931a' }}>
                    <i className="icofont-bitcoin"></i>
                  </div>
                  <div className="stat-details">
                    <p className="stat-label">Bitcoin (BTC)</p>
                    <h2 className="stat-value">0.00 BTC</h2>
                    <p className="stat-info"><i className="icofont-dollar"></i> ≈ $0.00 USD</p>
                    <p className="stat-change positive"><i className="icofont-chart-line"></i> ${formatPrice(cryptoPrices.BTC)}/BTC</p>
                  </div>
                </div>

                <div className="stat-card">
                  <div className="stat-icon" style={{ background: 'rgba(98, 126, 234, 0.1)', color: '#627eea' }}>
                    <i className="icofont-ethereum"></i>
                  </div>
                  <div className="stat-details">
                    <p className="stat-label">Ethereum (ETH)</p>
                    <h2 className="stat-value">0.00 ETH</h2>
                    <p className="stat-info"><i className="icofont-dollar"></i> ≈ $0.00 USD</p>
                    <p className="stat-change positive"><i className="icofont-chart-line"></i> ${formatPrice(cryptoPrices.ETH)}/ETH</p>
                  </div>
                </div>

                <div className="stat-card">
                  <div className="stat-icon" style={{ background: 'rgba(16, 185, 129, 0.1)', color: '#10b981' }}>
                    <i className="icofont-cur-dollar"></i>
                  </div>
                  <div className="stat-details">
                    <p className="stat-label">USDT (Tether)</p>
                    <h2 className="stat-value">0.00 USDT</h2>
                    <p className="stat-info"><i className="icofont-dollar"></i> ≈ $0.00 USD</p>
                    <p className="stat-change positive"><i className="icofont-chart-line"></i> ${formatPrice(cryptoPrices.USDT)}/USDT</p>
                  </div>
                </div>
              </div>

              {/* Live Crypto Market Prices */}
              <div className="profile-card" style={{ marginTop: '24px' }}>
                <div className="profile-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3><i className="icofont-chart-line-alt"></i> Live Market Prices</h3>
                  <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)' }}>
                    <i className="icofont-refresh"></i> Auto-updates every 60s
                  </span>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table className="wallet-table">
                    <thead>
                      <tr className="wallet-table-header">
                        <th>#</th>
                        <th>Asset</th>
                        <th style={{ textAlign: 'right' }}>Price</th>
                        <th style={{ textAlign: 'right' }}>24h Change</th>
                        <th style={{ textAlign: 'right' }}>Market Cap</th>
                        <th style={{ textAlign: 'right' }}>24h High/Low</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cryptoDetails.map((crypto, idx) => (
                        <tr key={crypto.id} className="wallet-row">
                          <td data-label="#" className="index">{idx + 1}</td>
                          <td data-label="Asset">
                            <div className="asset">
                              <img
                                src={crypto.image}
                                alt={crypto.name}
                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                              />
                              <div>
                                <div className="asset-name">{crypto.name}</div>
                                <div className="asset-symbol">{crypto.symbol}</div>
                              </div>
                            </div>
                          </td>
                          <td data-label="Price" className="price">${formatPrice(crypto.current_price)}</td>
                          <td data-label="24h Change" className={crypto.price_change_percentage_24h >= 0 ? 'change-positive' : 'change-negative'}>
                            <i className={crypto.price_change_percentage_24h >= 0 ? 'icofont-arrow-up' : 'icofont-arrow-down'}></i>
                            {Math.abs(crypto.price_change_percentage_24h).toFixed(2)}%
                          </td>
                          <td data-label="Market Cap" className="marketcap">{formatMarketCap(crypto.market_cap)}</td>
                          <td data-label="24h High/Low" className="high-low">
                            <div style={{ color: '#4ade80' }}>${formatPrice(crypto.high_24h)}</div>
                            <div style={{ color: '#f87171' }}>${formatPrice(crypto.low_24h)}</div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Quick Actions - Using actions-grid like Dashboard */}
              <div className="quick-actions">
                <div className="section-header">
                  <h3>Quick Actions</h3>
                </div>
                <div className="actions-grid">
                  <button type="button" className="action-card" onClick={() => setProfileState('Deposit')}>
                    <i className="icofont-plus-circle"></i>
                    <span>Deposit</span>
                  </button>
                  <button className="action-card" onClick={handleStartWithdrawal}>
                    <i className="icofont-money"></i>
                    <span>Withdraw</span>
                  </button>
                  <button className="action-card">
                    <i className="icofont-exchange"></i>
                    <span>Transfer</span>
                  </button>
                  <button className="action-card" onClick={() => setProfileState('Investments')}>
                    <i className="icofont-chart-growth"></i>
                    <span>Invest</span>
                  </button>
                </div>
              </div>

              {/* Transaction History */}
              <div className="activity-section">
                <div className="section-header">
                  <h3><i className="icofont-history"></i> Transaction History</h3>
                  <button className="view-all">Filter <i className="icofont-filter"></i></button>
                </div>

                {investments.length === 0 ? (
                  <div className="empty-state">
                    <i className="icofont-chart-line"></i>
                    <p>No transactions yet</p>
                    <button className="cta-btn" onClick={() => setProfileState('Investments')}>Start Investing</button>
                  </div>
                ) : (
                  <div className="activity-list">
                    {investments.slice(0, 5).map((inv, idx) => (
                      <div key={idx} className="activity-item">
                        <div className="activity-icon">
                          <i className="icofont-chart-line"></i>
                        </div>
                        <div className="activity-details">
                          <h4>{inv.plan}</h4>
                          <p>{new Date(inv.date || '').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                        </div>
                        <div className="activity-amount negative">
                          -${(inv.capital || 0).toLocaleString()}
                        </div>
                        <span className={`status-badge ${inv.status}`}>{inv.status}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {profileState === 'Bonus' && (
            <div className="page-section">
              <div className="page-header">
                <h2><i className="icofont-gift"></i> Bonus & Rewards</h2>
              </div>

              {/* Bonus Overview */}
              <div className="stats-grid">
                <div className="stat-card primary">
                  <div className="stat-icon">
                    <i className="icofont-gift"></i>
                  </div>
                  <div className="stat-details">
                    <p className="stat-label">Current Bonus</p>
                    <h2 className="stat-value">${(currentUser?.bonus || 0).toLocaleString()}</h2>
                    <p className="stat-info">Available for withdrawal</p>
                  </div>
                </div>

                <div className="stat-card">
                  <div className="stat-icon" style={{ background: 'rgba(16, 185, 129, 0.1)', color: '#10b981' }}>
                    <i className="icofont-chart-growth"></i>
                  </div>
                  <div className="stat-details">
                    <p className="stat-label">Total Earned</p>
                    <h2 className="stat-value">${totalEarned.toLocaleString()}</h2>
                    <p className="stat-info">From all investments</p>
                  </div>
                </div>

                <div className="stat-card">
                  <div className="stat-icon" style={{ background: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b' }}>
                    <i className="icofont-users-social"></i>
                  </div>
                  <div className="stat-details">
                    <p className="stat-label">Referral Bonus</p>
                    <h2 className="stat-value">${downlineEarnings.toLocaleString()}</h2>
                    <p className="stat-info">From referrals</p>
                  </div>
                </div>
              </div>

              {/* Bonus History */}
              <div className="profile-card" style={{ marginTop: '24px' }}>
                <div className="profile-card-header">
                  <h3><i className="icofont-history"></i> Bonus History</h3>
                </div>
                <div className="activity-list">
                  {investments.filter(inv => (inv.bonus || 0) > 0).length === 0 ? (
                    <div className="empty-state">
                      <i className="icofont-gift"></i>
                      <p>No bonus earned yet</p>
                      <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)', marginTop: '8px' }}>
                        Start investing to earn bonus rewards!
                      </p>
                    </div>
                  ) : (
                    investments.filter(inv => (inv.bonus || 0) > 0).slice(0, 10).map((inv, idx) => (
                      <div key={idx} className="activity-item">
                        <div className="activity-icon" style={{ background: 'rgba(16, 185, 129, 0.1)', color: '#10b981' }}>
                          <i className="icofont-gift"></i>
                        </div>
                        <div className="activity-details">
                          <h4>Bonus from {inv.plan}</h4>
                          <p>{new Date(inv.date || '').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                        </div>
                        <div className="activity-amount positive">
                          +${(inv.bonus || 0).toLocaleString()}
                        </div>
                        <span className="status-badge approved">Earned</span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Bonus Information */}
              <div className="profile-card" style={{ marginTop: '24px' }}>
                <div className="profile-card-header">
                  <h3><i className="icofont-info-circle"></i> How Bonus Works</h3>
                </div>
                <div style={{ padding: '20px' }}>
                  <div style={{ display: 'grid', gap: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                      <div style={{ overflowX: 'auto' }}>
                        <p style={{ color: '#94a3b8' }}>No additional bonus details available.</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {profileState === 'Investments' && (
            <div className="page-section">
              <div className="page-header">
                <h2><i className="icofont-chart-line"></i> Investments</h2>
                <button className="primary-btn" onClick={() => handleStartInvestment(PLAN_CONFIG[0])}>
                  <i className="icofont-plus"></i> New Investment
                </button>
              </div>

              {/* Investment Stats Grid */}
              <div className="stats-grid">
                <div className="stat-card primary">
                  <div className="stat-icon">
                    <i className="icofont-money-bag"></i>
                  </div>
                  <div className="stat-details">
                    <p className="stat-label">Total Invested</p>
                    <h2 className="stat-value">${approvedInvestments.reduce((sum, inv) => sum + (inv.capital || 0), 0).toLocaleString()}</h2>
                    <p className="stat-info">Approved investments</p>
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-icon" style={{ background: 'rgba(16, 185, 129, 0.1)', color: '#10b981' }}>
                    <i className="icofont-chart-growth"></i>
                  </div>
                  <div className="stat-details">
                    <p className="stat-label">Active Plans</p>
                    <h2 className="stat-value">{investments.filter(inv => inv.status?.toLowerCase() === 'active').length}</h2>
                    <p className="stat-info">Currently earning</p>
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-icon" style={{ background: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6' }}>
                    <i className="icofont-dollar-true"></i>
                  </div>
                  <div className="stat-details">
                    <p className="stat-label">Total Returns</p>
                    <h2 className="stat-value">${totalReturns.toLocaleString()}</h2>
                    <p className="stat-info">Profit earned</p>
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-icon" style={{ background: 'rgba(147, 51, 234, 0.1)', color: '#a855f7' }}>
                    <i className="icofont-check-circled"></i>
                  </div>
                  <div className="stat-details">
                    <p className="stat-label">Completed</p>
                    <h2 className="stat-value">{investments.filter(inv => inv.status?.toLowerCase() === 'completed').length}</h2>
                    <p className="stat-info">Finished plans</p>
                  </div>
                </div>
              </div>

              {/* Investment History */}
              {investments.length > 0 && (
                <div style={{
                  marginTop: '24px',
                  background: 'linear-gradient(145deg, #1e2329 0%, #181a20 100%)',
                  borderRadius: '16px',
                  border: '1px solid rgba(240, 185, 11, 0.12)',
                  overflow: 'hidden'
                }}>
                  {/* Header */}
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '18px 20px',
                    borderBottom: '1px solid rgba(240, 185, 11, 0.1)',
                    background: 'rgba(0,0,0,0.15)'
                  }}>
                    <h3 style={{
                      color: '#fff',
                      fontSize: '16px',
                      fontWeight: '600',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      margin: 0
                    }}>
                      <i className="icofont-clock-time" style={{ color: '#f0b90b' }}></i>
                      Investment History
                    </h3>
                    <span style={{
                      background: 'rgba(240, 185, 11, 0.12)',
                      color: '#f0b90b',
                      padding: '5px 14px',
                      borderRadius: '20px',
                      fontSize: '12px',
                      fontWeight: '600'
                    }}>{investments.length} investments</span>
                  </div>
                  
                  {/* Investment List */}
                  <div style={{ padding: '12px' }}>
                    {investments.map((inv, idx) => (
                      <div 
                        key={idx} 
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '14px',
                          padding: '14px 16px',
                          background: inv.status?.toLowerCase() === 'rejected' ? 'rgba(239, 68, 68, 0.08)' : 'rgba(255,255,255,0.02)',
                          borderRadius: '12px',
                          marginBottom: idx < investments.length - 1 ? '10px' : '0',
                          border: `1px solid ${inv.status?.toLowerCase() === 'rejected' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(255,255,255,0.04)'}`,
                          transition: 'background 0.2s, transform 0.2s',
                          cursor: 'pointer'
                        }}
                        onMouseEnter={e => {
                          (e.currentTarget as HTMLDivElement).style.background = inv.status?.toLowerCase() === 'rejected' ? 'rgba(239, 68, 68, 0.12)' : 'rgba(240, 185, 11, 0.06)';
                          (e.currentTarget as HTMLDivElement).style.transform = 'translateX(4px)';
                        }}
                        onMouseLeave={e => {
                          (e.currentTarget as HTMLDivElement).style.background = inv.status?.toLowerCase() === 'rejected' ? 'rgba(239, 68, 68, 0.08)' : 'rgba(255,255,255,0.02)';
                          (e.currentTarget as HTMLDivElement).style.transform = 'none';
                        }}
                      >
                        {/* Icon */}
                        <div style={{ 
                          width: '44px',
                          height: '44px',
                          borderRadius: '12px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '18px',
                          flexShrink: 0,
                          background: inv.status?.toLowerCase() === 'active' 
                            ? 'rgba(16, 185, 129, 0.15)' 
                            : inv.status?.toLowerCase() === 'completed'
                            ? 'rgba(59, 130, 246, 0.15)'
                            : inv.status?.toLowerCase() === 'rejected'
                            ? 'rgba(239, 68, 68, 0.15)'
                            : 'rgba(251, 191, 36, 0.15)',
                          color: inv.status?.toLowerCase() === 'active' 
                            ? '#10b981' 
                            : inv.status?.toLowerCase() === 'completed'
                            ? '#3b82f6'
                            : inv.status?.toLowerCase() === 'rejected'
                            ? '#ef4444'
                            : '#fbbf24'
                        }}>
                          <i className={
                            inv.status?.toLowerCase() === 'active' ? 'icofont-chart-growth' : 
                            inv.status?.toLowerCase() === 'completed' ? 'icofont-check-circled' : 
                            inv.status?.toLowerCase() === 'rejected' ? 'icofont-close' : 
                            'icofont-sand-clock'
                          }></i>
                        </div>
                        
                        {/* Details */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ 
                            color: '#fff', 
                            fontSize: '14px', 
                            fontWeight: '600',
                            marginBottom: '4px'
                          }}>{inv.plan}</div>
                          <div style={{ 
                            color: 'rgba(255,255,255,0.5)', 
                            fontSize: '12px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px'
                          }}>
                            <span style={{ color: '#f0b90b' }}>${(inv.capital || 0).toLocaleString()}</span>
                            <span>•</span>
                            <span>{inv.duration} days</span>
                            <span>•</span>
                            <span>{new Date(inv.date || '').toLocaleDateString()}</span>
                          </div>
                        </div>
                        
                        {/* Right Side */}
                        <div style={{ 
                          textAlign: 'right',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'flex-end',
                          gap: '6px'
                        }}>
                          <div style={{ 
                            color: inv.status?.toLowerCase() === 'rejected' ? '#ef4444' : '#4ade80', 
                            fontSize: '13px', 
                            fontWeight: '700'
                          }}>
                            {inv.status?.toLowerCase() === 'rejected' 
                              ? 'Rejected'
                              : inv.status?.toLowerCase() === 'active' 
                              ? `+$${formatCurrency(getInvestmentEarnings(inv))} earned`
                              : `+$${formatCurrency(getInvestmentEarnings(inv) || inv.totalExpectedRoi || inv.roi || 0)}`
                            }
                          </div>
                          {inv.status === 'active' && inv.dailyRoi && (
                            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '10px' }}>
                              ${inv.dailyRoi.toLocaleString()}/day
                            </div>
                          )}
                          <span style={{
                            padding: '4px 12px',
                            borderRadius: '20px',
                            fontSize: '10px',
                            fontWeight: '600',
                            textTransform: 'uppercase',
                            letterSpacing: '0.5px',
                            background: inv.status === 'active' 
                              ? 'rgba(16, 185, 129, 0.15)' 
                              : inv.status === 'completed'
                              ? 'rgba(59, 130, 246, 0.15)'
                              : inv.status === 'Rejected'
                              ? 'rgba(239, 68, 68, 0.15)'
                              : 'rgba(251, 191, 36, 0.15)',
                            color: inv.status === 'active' 
                              ? '#10b981' 
                              : inv.status === 'completed'
                              ? '#3b82f6'
                              : inv.status === 'Rejected'
                              ? '#ef4444'
                              : '#fbbf24'
                          }}>
                            {inv.status === 'active' && inv.daysCompleted !== undefined 
                              ? `Day ${inv.daysCompleted}/${inv.duration}`
                              : inv.status
                            }
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Available Investment Plans - 3 per row */}
              <div className="profile-card" style={{ marginTop: '24px' }}>
                <div className="profile-card-header">
                  <h3><i className="icofont-star"></i> Available Investment Plans</h3>
                </div>
                <div style={{ 
                  display: 'grid', 
                  gridTemplateColumns: window.innerWidth <= 768 ? 'repeat(1, 1fr)' : window.innerWidth <= 1024 ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)', 
                  gap: window.innerWidth <= 768 ? '16px' : '20px',
                  padding: window.innerWidth <= 768 ? '16px' : '20px'
                }}>
                  {PLAN_CONFIG.map((plan) => (
                    <div 
                      key={plan.id}
                      style={{
                        background: plan.featured 
                          ? 'linear-gradient(145deg, rgba(240, 185, 11, 0.15), rgba(26, 26, 26, 0.98))'
                          : 'linear-gradient(145deg, #1e2329 0%, #181a20 100%)',
                        border: plan.featured 
                          ? '2px solid rgba(240, 185, 11, 0.5)' 
                          : '1px solid rgba(240,185,11,0.12)',
                        borderRadius: '16px',
                        display: 'flex',
                        flexDirection: 'column',
                        position: 'relative',
                        overflow: 'hidden',
                        boxSizing: 'border-box',
                        padding: '18px 16px',
                        boxShadow: plan.featured
                          ? '0 6px 24px 0 rgba(240,185,11,0.12)'
                          : '0 2px 12px 0 rgba(0,0,0,0.15)',
                        transition: 'transform 0.2s, box-shadow 0.2s',
                        cursor: 'pointer',
                      }}
                      onMouseEnter={e => {
                        (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-4px)';
                        (e.currentTarget as HTMLDivElement).style.boxShadow = '0 12px 32px 0 rgba(240,185,11,0.15)';
                      }}
                      onMouseLeave={e => {
                        (e.currentTarget as HTMLDivElement).style.transform = 'none';
                        (e.currentTarget as HTMLDivElement).style.boxShadow = plan.featured
                          ? '0 6px 24px 0 rgba(240,185,11,0.12)'
                          : '0 2px 12px 0 rgba(0,0,0,0.15)';
                      }}
                    >
                      {plan.featured && (
                        <div style={{
                          position: 'absolute',
                          top: '12px',
                          right: '-28px',
                          background: 'linear-gradient(135deg, #f0b90b, #d4a50a)',
                          color: '#000',
                          padding: '3px 36px',
                          fontSize: '10px',
                          fontWeight: '700',
                          transform: 'rotate(45deg)',
                          textTransform: 'uppercase'
                        }}>
                          Popular
                        </div>
                      )}
                      {/* Header */}
                      <div style={{ textAlign: 'center', marginBottom: '12px' }}>
                        <h4 style={{ 
                          color: plan.featured ? '#f0b90b' : '#fff', 
                          fontSize: '16px', 
                          fontWeight: '700',
                          marginBottom: '2px',
                          lineHeight: '1.2'
                        }}>{plan.name}</h4>
                        <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '11px', margin: 0 }}>{plan.subtitle}</p>
                      </div>
                      
                      {/* Daily ROI */}
                      <div style={{ 
                        textAlign: 'center', 
                        marginBottom: '12px',
                        padding: '10px 8px',
                        background: 'rgba(0, 0, 0, 0.25)',
                        borderRadius: '10px'
                      }}>
                        <div style={{ 
                          color: '#4ade80', 
                          fontSize: '24px', 
                          fontWeight: '700',
                          lineHeight: '1'
                        }}>
                          {formatPercent(plan.dailyRate)}
                        </div>
                        <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: '10px', marginTop: '2px' }}>
                          Daily ROI
                        </div>
                      </div>

                      {/* Details */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px' }}>
                        <div style={{ 
                          display: 'flex', 
                          justifyContent: 'space-between',
                          padding: '6px 10px',
                          background: 'rgba(255,255,255,0.03)',
                          borderRadius: '6px'
                        }}>
                          <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: '11px' }}>Duration</span>
                          <span style={{ color: '#fff', fontWeight: '600', fontSize: '11px' }}>{plan.durationLabel}</span>
                        </div>
                        <div style={{ 
                          display: 'flex', 
                          justifyContent: 'space-between',
                          padding: '6px 10px',
                          background: 'rgba(255,255,255,0.03)',
                          borderRadius: '6px'
                        }}>
                          <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: '11px' }}>Min</span>
                          <span style={{ color: '#f0b90b', fontWeight: '600', fontSize: '11px' }}>${plan.minCapital.toLocaleString()}</span>
                        </div>
                        <div style={{ 
                          display: 'flex', 
                          justifyContent: 'space-between',
                          padding: '6px 10px',
                          background: 'rgba(255,255,255,0.03)',
                          borderRadius: '6px'
                        }}>
                          <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: '11px' }}>Max</span>
                          <span style={{ color: '#f0b90b', fontWeight: '600', fontSize: '11px' }}>${plan.maxCapital?.toLocaleString() || '∞'}</span>
                        </div>
                        <div style={{ 
                          display: 'flex', 
                          justifyContent: 'space-between',
                          padding: '6px 10px',
                          background: 'rgba(255,255,255,0.03)',
                          borderRadius: '6px'
                        }}>
                          <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: '11px' }}>Total ROI</span>
                          <span style={{ color: '#4ade80', fontWeight: '600', fontSize: '11px' }}>{formatPercent(plan.dailyRate * plan.durationDays)}</span>
                        </div>
                      </div>

                      {/* Example Profit */}
                      <div style={{
                        padding: '8px 10px',
                        background: 'rgba(16, 185, 129, 0.08)',
                        borderRadius: '8px',
                        marginBottom: '12px',
                        textAlign: 'center'
                      }}>
                        <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: '10px', marginBottom: '2px' }}>
                          Invest ${plan.minCapital.toLocaleString()}
                        </div>
                        <div style={{ color: '#4ade80', fontSize: '13px', fontWeight: '700' }}>
                          Earn ${plan.sampleEarning.toLocaleString()}
                        </div>
                      </div>

                      {/* CTA Button */}
                      <button 
                        onClick={() => handleStartInvestment(plan)}
                        style={{
                          width: '100%',
                          padding: '10px',
                          background: plan.featured 
                            ? 'linear-gradient(135deg, #f0b90b, #d4a50a)'
                            : 'linear-gradient(135deg, rgba(240, 185, 11, 0.18), rgba(240, 185, 11, 0.08))',
                          border: plan.featured ? 'none' : '1px solid rgba(240, 185, 11, 0.25)',
                          borderRadius: '8px',
                          color: plan.featured ? '#000' : '#f0b90b',
                          fontWeight: '600',
                          fontSize: '12px',
                          cursor: 'pointer',
                          transition: 'all 0.3s ease',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '6px',
                          marginTop: 'auto'
                        }}
                      >
                        <i className="icofont-plus-circle"></i> Invest Now
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {profileState === 'Withdrawals' && (
            <div className="page-section">
              <div className="page-header">
                <h2><i className="icofont-pay"></i> Withdrawals</h2>
                <button className="primary-btn" onClick={handleStartWithdrawal}>
                  <i className="icofont-money"></i> Request Withdrawal
                </button>
              </div>

              {/* Withdrawal Stats Grid */}
              <div className="stats-grid">
                <div className="stat-card primary">
                  <div className="stat-icon">
                    <i className="icofont-wallet"></i>
                  </div>
                  <div className="stat-details">
                    <p className="stat-label">Available Balance</p>
                    <h2 className="stat-value">${totalBalance.toLocaleString()}</h2>
                    <p className="stat-info">Ready to withdraw</p>
                  </div>
                </div>

                <div className="stat-card">
                  <div className="stat-icon" style={{ background: 'rgba(16, 185, 129, 0.1)', color: '#10b981' }}>
                    <i className="icofont-check-circled"></i>
                  </div>
                  <div className="stat-details">
                    <p className="stat-label">Total Withdrawn</p>
                    <h2 className="stat-value">${withdrawals.filter(w => w.status?.toLowerCase() === 'approved' || w.status?.toLowerCase() === 'completed').reduce((sum, w) => sum + (parseFloat(w.amount) || 0), 0).toLocaleString()}</h2>
                    <p className="stat-info">All time</p>
                  </div>
                </div>

                <div className="stat-card">
                  <div className="stat-icon" style={{ background: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6' }}>
                    <i className="icofont-clock-time"></i>
                  </div>
                  <div className="stat-details">
                    <p className="stat-label">Pending</p>
                    <h2 className="stat-value">${withdrawals.filter(w => w.status?.toLowerCase() === 'pending').reduce((sum, w) => sum + (parseFloat(w.amount) || 0), 0).toLocaleString()}</h2>
                    <p className="stat-info">In progress</p>
                  </div>
                </div>

                <div className="stat-card">
                  <div className="stat-icon" style={{ background: 'rgba(147, 51, 234, 0.1)', color: '#a855f7' }}>
                    <i className="icofont-ui-settings"></i>
                  </div>
                  <div className="stat-details">
                    <p className="stat-label">Daily Limit</p>
                    <h2 className="stat-value">$50,000</h2>
                    <p className="stat-info">Min: $50</p>
                  </div>
                </div>
              </div>

              {/* How It Works */}
              <div className="profile-card" style={{ marginTop: '1.5rem' }}>
                <h4><i className="icofont-info-circle"></i> How It Works</h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem' }}>
                  <div style={{ 
                    padding: '1rem', 
                    background: 'rgba(240,185,11,0.05)', 
                    borderRadius: '8px',
                    border: '1px solid rgba(240,185,11,0.1)',
                    textAlign: 'center'
                  }}>
                    <div style={{ 
                      width: '40px', 
                      height: '40px', 
                      borderRadius: '50%', 
                      background: 'rgba(240,185,11,0.2)', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center',
                      margin: '0 auto 0.75rem',
                      color: '#f0b90b',
                      fontWeight: 700
                    }}>1</div>
                    <h5 style={{ color: '#f8fafc', marginBottom: '0.25rem' }}>Request</h5>
                    <p style={{ color: '#94a3b8', fontSize: '0.75rem', margin: 0 }}>Enter amount & details</p>
                  </div>
                  <div style={{ 
                    padding: '1rem', 
                    background: 'rgba(59,130,246,0.05)', 
                    borderRadius: '8px',
                    border: '1px solid rgba(59,130,246,0.1)',
                    textAlign: 'center'
                  }}>
                    <div style={{ 
                      width: '40px', 
                      height: '40px', 
                      borderRadius: '50%', 
                      background: 'rgba(59,130,246,0.2)', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center',
                      margin: '0 auto 0.75rem',
                      color: '#3b82f6',
                      fontWeight: 700
                    }}>2</div>
                    <h5 style={{ color: '#f8fafc', marginBottom: '0.25rem' }}>Verification</h5>
                    <p style={{ color: '#94a3b8', fontSize: '0.75rem', margin: 0 }}>Reviewed in 2-4 hours</p>
                  </div>
                  <div style={{ 
                    padding: '1rem', 
                    background: 'rgba(147,51,234,0.05)', 
                    borderRadius: '8px',
                    border: '1px solid rgba(147,51,234,0.1)',
                    textAlign: 'center'
                  }}>
                    <div style={{ 
                      width: '40px', 
                      height: '40px', 
                      borderRadius: '50%', 
                      background: 'rgba(147,51,234,0.2)', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center',
                      margin: '0 auto 0.75rem',
                      color: '#a855f7',
                      fontWeight: 700
                    }}>3</div>
                    <h5 style={{ color: '#f8fafc', marginBottom: '0.25rem' }}>Processing</h5>
                    <p style={{ color: '#94a3b8', fontSize: '0.75rem', margin: 0 }}>Transferred in 24h</p>
                  </div>
                  <div style={{ 
                    padding: '1rem', 
                    background: 'rgba(16,185,129,0.05)', 
                    borderRadius: '8px',
                    border: '1px solid rgba(16,185,129,0.1)',
                    textAlign: 'center'
                  }}>
                    <div style={{ 
                      width: '40px', 
                      height: '40px', 
                      borderRadius: '50%', 
                      background: 'rgba(16,185,129,0.2)', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center',
                      margin: '0 auto 0.75rem',
                      color: '#10b981'
                    }}><i className="icofont-check"></i></div>
                    <h5 style={{ color: '#f8fafc', marginBottom: '0.25rem' }}>Receive</h5>
                    <p style={{ color: '#94a3b8', fontSize: '0.75rem', margin: 0 }}>Funds in your wallet</p>
                  </div>
                </div>
              </div>

              {/* Payment Methods */}
              <div className="profile-card" style={{ marginTop: '1.5rem' }}>
                <h4><i className="icofont-credit-card"></i> Payment Methods</h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '1rem' }}>
                  <div style={{ 
                    padding: '1rem', 
                    background: 'rgba(247,147,26,0.05)', 
                    borderRadius: '8px',
                    border: '1px solid rgba(247,147,26,0.1)',
                    textAlign: 'center'
                  }}>
                    <i className="icofont-bitcoin" style={{ color: '#f7931a', fontSize: '2rem', marginBottom: '0.5rem', display: 'block' }}></i>
                    <h5 style={{ color: '#f8fafc', marginBottom: '0.25rem', fontSize: '0.875rem' }}>Bitcoin</h5>
                    <p style={{ color: '#10b981', fontSize: '0.75rem', margin: 0 }}>Instant</p>
                  </div>
                  <div style={{ 
                    padding: '1rem', 
                    background: 'rgba(98,126,234,0.05)', 
                    borderRadius: '8px',
                    border: '1px solid rgba(98,126,234,0.1)',
                    textAlign: 'center'
                  }}>
                    <i className="icofont-ethereum" style={{ color: '#627eea', fontSize: '2rem', marginBottom: '0.5rem', display: 'block' }}></i>
                    <h5 style={{ color: '#f8fafc', marginBottom: '0.25rem', fontSize: '0.875rem' }}>Ethereum</h5>
                    <p style={{ color: '#10b981', fontSize: '0.75rem', margin: 0 }}>Instant</p>
                  </div>
                  <div style={{ 
                    padding: '1rem', 
                    background: 'rgba(16,185,129,0.05)', 
                    borderRadius: '8px',
                    border: '1px solid rgba(16,185,129,0.1)',
                    textAlign: 'center'
                  }}>
                    <i className="icofont-cur-dollar" style={{ color: '#10b981', fontSize: '2rem', marginBottom: '0.5rem', display: 'block' }}></i>
                    <h5 style={{ color: '#f8fafc', marginBottom: '0.25rem', fontSize: '0.875rem' }}>USDT</h5>
                    <p style={{ color: '#10b981', fontSize: '0.75rem', margin: 0 }}>Instant</p>
                  </div>
                  <div style={{ 
                    padding: '1rem', 
                    background: 'rgba(59,130,246,0.05)', 
                    borderRadius: '8px',
                    border: '1px solid rgba(59,130,246,0.1)',
                    textAlign: 'center'
                  }}>
                    <i className="icofont-bank-alt" style={{ color: '#3b82f6', fontSize: '2rem', marginBottom: '0.5rem', display: 'block' }}></i>
                    <h5 style={{ color: '#f8fafc', marginBottom: '0.25rem', fontSize: '0.875rem' }}>Bank</h5>
                    <p style={{ color: '#64748b', fontSize: '0.75rem', margin: 0 }}>1-2 days</p>
                  </div>
                </div>
              </div>

              {/* Withdrawal History */}
              <div className="activity-section" style={{ marginTop: '1.5rem' }}>
                <div className="section-header">
                  <h3><i className="icofont-history"></i> Withdrawal History</h3>
                </div>
                {withdrawals.length > 0 ? (
                  <div className="table-container">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Amount</th>
                          <th>Method</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {withdrawals.map((w, i) => (
                          <tr key={w.id || i}>
                            <td style={{ color: '#94a3b8' }}>{new Date(w.created_at).toLocaleDateString()}</td>
                            <td style={{ fontWeight: 600, color: '#f0b90b' }}>${parseFloat(w.amount).toLocaleString()}</td>
                            <td>{w.method}</td>
                            <td>
                              <span className={`status-badge ${
                                w.status?.toLowerCase() === 'approved' || w.status?.toLowerCase() === 'completed' ? 'success' :
                                w.status?.toLowerCase() === 'rejected' ? 'danger' :
                                'pending'
                              }`}>
                                {w.status?.toLowerCase() === 'approved' ? 'Completed' : w.status ? w.status.charAt(0).toUpperCase() + w.status.slice(1) : 'Pending'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="empty-state">
                    <i className="icofont-pay"></i>
                    <p>No withdrawal history</p>
                    <small style={{ color: '#64748b' }}>Your completed withdrawals will appear here</small>
                  </div>
                )}
              </div>
            </div>
          )}

          {profileState === 'Loans' && (
            <div className="page-section">
              <div className="page-header">
                <h2><i className="icofont-dollar-plus"></i> Loan Management</h2>
                <button className="primary-btn" onClick={handleStartLoan}>
                  <i className="icofont-plus"></i> Request Loan
                </button>
              </div>

              {/* Loan Stats Grid */}
              <div className="stats-grid">
                <div className="stat-card primary">
                  <div className="stat-icon">
                    <i className="icofont-money-bag"></i>
                  </div>
                  <div className="stat-details">
                    <p className="stat-label">Total Investment</p>
                    <h2 className="stat-value">${totalCapital.toLocaleString()}</h2>
                    <p className="stat-info">Your collateral value</p>
                  </div>
                </div>

                <div className="stat-card">
                  <div className="stat-icon" style={{ background: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6' }}>
                    <i className="icofont-bank-alt"></i>
                  </div>
                  <div className="stat-details">
                    <p className="stat-label">Available to Borrow</p>
                    <h2 className="stat-value">${(totalCapital * 0.5).toLocaleString()}</h2>
                    <p className="stat-info">Up to 50% of investment</p>
                  </div>
                </div>

                <div className="stat-card">
                  <div className="stat-icon" style={{ background: 'rgba(16, 185, 129, 0.1)', color: '#10b981' }}>
                    <i className="icofont-percentage"></i>
                  </div>
                  <div className="stat-details">
                    <p className="stat-label">Interest Rate</p>
                    <h2 className="stat-value">5%</h2>
                    <p className="stat-change positive">Low monthly rate</p>
                  </div>
                </div>

                <div className="stat-card">
                  <div className="stat-icon" style={{ background: 'rgba(147, 51, 234, 0.1)', color: '#a855f7' }}>
                    <i className="icofont-tasks"></i>
                  </div>
                  <div className="stat-details">
                    <p className="stat-label">Active Loans</p>
                    <h2 className="stat-value">{loans.filter(l => l.status === 'approved' || l.status === 'active').length}</h2>
                    <p className="stat-info">{loans.filter(l => l.status === 'pending').length} pending approval</p>
                  </div>
                </div>
              </div>

              {/* Loan Benefits */}
              <div className="profile-card" style={{ marginTop: '1.5rem' }}>
                <h4><i className="icofont-star"></i> Loan Benefits</h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                  <div style={{ 
                    padding: '1rem', 
                    background: 'rgba(16,185,129,0.05)', 
                    borderRadius: '8px',
                    border: '1px solid rgba(16,185,129,0.1)'
                  }}>
                    <i className="icofont-flash" style={{ color: '#10b981', fontSize: '1.5rem', marginBottom: '0.5rem', display: 'block' }}></i>
                    <h5 style={{ color: '#f8fafc', marginBottom: '0.25rem' }}>Instant Approval</h5>
                    <p style={{ color: '#94a3b8', fontSize: '0.8125rem', margin: 0 }}>Get funds within 24 hours</p>
                  </div>
                  <div style={{ 
                    padding: '1rem', 
                    background: 'rgba(240,185,11,0.05)', 
                    borderRadius: '8px',
                    border: '1px solid rgba(240,185,11,0.1)'
                  }}>
                    <i className="icofont-percentage" style={{ color: '#f0b90b', fontSize: '1.5rem', marginBottom: '0.5rem', display: 'block' }}></i>
                    <h5 style={{ color: '#f8fafc', marginBottom: '0.25rem' }}>Low Interest</h5>
                    <p style={{ color: '#94a3b8', fontSize: '0.8125rem', margin: 0 }}>Just 5% monthly rate</p>
                  </div>
                  <div style={{ 
                    padding: '1rem', 
                    background: 'rgba(59,130,246,0.05)', 
                    borderRadius: '8px',
                    border: '1px solid rgba(59,130,246,0.1)'
                  }}>
                    <i className="icofont-calendar" style={{ color: '#3b82f6', fontSize: '1.5rem', marginBottom: '0.5rem', display: 'block' }}></i>
                    <h5 style={{ color: '#f8fafc', marginBottom: '0.25rem' }}>Flexible Terms</h5>
                    <p style={{ color: '#94a3b8', fontSize: '0.8125rem', margin: 0 }}>30, 60, or 90 day terms</p>
                  </div>
                </div>
              </div>

              {/* Active Loans Section */}
              <div className="activity-section" style={{ marginTop: '1.5rem' }}>
                <div className="section-header">
                  <h3><i className="icofont-tasks"></i> Your Loans</h3>
                </div>
                {loans.length === 0 ? (
                  <div className="empty-state">
                    <i className="icofont-dollar-plus"></i>
                    <p>No loan requests yet</p>
                    <button className="cta-btn" onClick={handleStartLoan}>
                      <i className="icofont-plus-circle"></i> Request Your First Loan
                    </button>
                  </div>
                ) : (
                  <div className="table-container">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Amount</th>
                          <th>Duration</th>
                          <th>Interest</th>
                          <th>Status</th>
                          <th>Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {loans.map((loan, index) => (
                          <tr key={loan.id || index}>
                              <td data-label="Amount" style={{ fontWeight: 600, color: '#f0b90b' }}>
                                ${loan.amount?.toLocaleString() || '0'}
                              </td>
                              <td data-label="Duration">{loan.duration || 30} days</td>
                              <td data-label="Interest">{loan.interestRate || 5}%</td>
                              <td data-label="Status">
                                <span className={`status-badge ${
                                  loan.status === 'approved' || loan.status === 'active' ? 'success' :
                                  loan.status === 'rejected' ? 'danger' : 'pending'
                                }`}>
                                  {loan.status || 'Pending'}
                                </span>
                              </td>
                              <td data-label="Date" style={{ color: '#94a3b8', fontSize: '0.875rem' }}>
                                {loan.date ? new Date(loan.date).toLocaleDateString() : 'N/A'}
                              </td>
                            </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {profileState === 'KYC' && (
            <div className="page-section">
              <div className="page-header">
                <h2><i className="icofont-id-card"></i> KYC Verification</h2>
                <button className="primary-btn" onClick={handleStartKyc}>
                  <i className="icofont-verification-check"></i> Start Verification
                </button>
              </div>

              {/* KYC Status Cards */}
              <div className="stats-grid">
                <div className="stat-card primary">
                  <div className="stat-icon">
                    <i className="icofont-verification-check"></i>
                  </div>
                  <div className="stat-details">
                    <p className="stat-label">Verification Status</p>
                      <h2 className="stat-value">{kycData?.status ? kycData.status.charAt(0).toUpperCase() + kycData.status.slice(1) : "Pending"}</h2>
                    <p className="stat-info">Complete verification to unlock features</p>
                  </div>
                </div>

                <div className="stat-card">
                  <div className="stat-icon" style={{ background: 'rgba(16, 185, 129, 0.1)', color: '#10b981' }}>
                    <i className="icofont-check-circled"></i>
                  </div>
                  <div className="stat-details">
                    <p className="stat-label">Steps Completed</p>
                    <h2 className="stat-value">1/4</h2>
                    <p className="stat-info">Personal info submitted</p>
                  </div>
                </div>

                <div className="stat-card">
                  <div className="stat-icon" style={{ background: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6' }}>
                    <i className="icofont-unlock"></i>
                  </div>
                  <div className="stat-details">
                    <p className="stat-label">Withdrawal Limit</p>
                    <h2 className="stat-value">$1,000</h2>
                    <p className="stat-change positive">+$9,000 after KYC</p>
                  </div>
                </div>
              </div>

              {/* Verification Progress Card */}
              <div className="profile-card" style={{ marginTop: '1.5rem' }}>
                <h4><i className="icofont-tasks-alt"></i> Verification Progress</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <div className="info-row" style={{ 
                    background: 'rgba(16,185,129,0.1)', 
                    borderRadius: '8px', 
                    padding: '1rem',
                    border: '1px solid rgba(16,185,129,0.2)'
                  }}>
                    <span className="label" style={{ color: '#10b981' }}>
                      <i className="icofont-check-circled"></i> Personal Information
                    </span>
                    <span className="value" style={{ color: '#10b981' }}>Completed</span>
                  </div>
                  <div className="info-row" style={{ 
                    background: 'rgba(148,163,184,0.1)', 
                    borderRadius: '8px', 
                    padding: '1rem',
                    border: '1px solid rgba(148,163,184,0.2)'
                  }}>
                    <span className="label">
                      <i className="icofont-clock-time"></i> Identity Document
                    </span>
                    <span className="value" style={{ color: '#94a3b8' }}>Pending</span>
                  </div>
                  <div className="info-row" style={{ 
                    background: 'rgba(148,163,184,0.1)', 
                    borderRadius: '8px', 
                    padding: '1rem',
                    border: '1px solid rgba(148,163,184,0.2)'
                  }}>
                    <span className="label">
                      <i className="icofont-clock-time"></i> Proof of Address
                    </span>
                    <span className="value" style={{ color: '#94a3b8' }}>Pending</span>
                  </div>
                  <div className="info-row" style={{ 
                    background: 'rgba(148,163,184,0.1)', 
                    borderRadius: '8px', 
                    padding: '1rem',
                    border: '1px solid rgba(148,163,184,0.2)'
                  }}>
                    <span className="label">
                      <i className="icofont-clock-time"></i> Selfie Verification
                    </span>
                    <span className="value" style={{ color: '#94a3b8' }}>Pending</span>
                  </div>
                </div>
              </div>

              {/* Benefits Card */}
              <div className="profile-card" style={{ marginTop: '1.5rem' }}>
                <h4><i className="icofont-gift"></i> KYC Benefits</h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                  <div style={{ 
                    padding: '1rem', 
                    background: 'rgba(240,185,11,0.05)', 
                    borderRadius: '8px',
                    border: '1px solid rgba(240,185,11,0.1)'
                  }}>
                    <i className="icofont-wallet" style={{ color: '#f0b90b', fontSize: '1.5rem', marginBottom: '0.5rem', display: 'block' }}></i>
                    <h5 style={{ color: '#f8fafc', marginBottom: '0.25rem' }}>Higher Limits</h5>
                    <p style={{ color: '#94a3b8', fontSize: '0.8125rem', margin: 0 }}>Withdraw up to $10,000/day</p>
                  </div>
                  <div style={{ 
                    padding: '1rem', 
                    background: 'rgba(16,185,129,0.05)', 
                    borderRadius: '8px',
                    border: '1px solid rgba(16,185,129,0.1)'
                  }}>
                    <i className="icofont-lock" style={{ color: '#10b981', fontSize: '1.5rem', marginBottom: '0.5rem', display: 'block' }}></i>
                    <h5 style={{ color: '#f8fafc', marginBottom: '0.25rem' }}>Enhanced Security</h5>
                    <p style={{ color: '#94a3b8', fontSize: '0.8125rem', margin: 0 }}>Additional account protection</p>
                  </div>
                  <div style={{ 
                    padding: '1rem', 
                    background: 'rgba(59,130,246,0.05)', 
                    borderRadius: '8px',
                    border: '1px solid rgba(59,130,246,0.1)'
                  }}>
                    <i className="icofont-star" style={{ color: '#3b82f6', fontSize: '1.5rem', marginBottom: '0.5rem', display: 'block' }}></i>
                    <h5 style={{ color: '#f8fafc', marginBottom: '0.25rem' }}>Premium Features</h5>
                    <p style={{ color: '#94a3b8', fontSize: '0.8125rem', margin: 0 }}>Access exclusive investment plans</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {profileState === 'Profile' && (
            <div className="page-section">
              <div className="page-header">
                <h2><i className="icofont-user-alt-7"></i> Profile Settings</h2>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  {editMode && (
                    <button 
                      className="secondary-btn" 
                      onClick={() => {
                        setEditMode(false)
                        // Reset form to current user data
                        setEditForm(getProfileEditForm())
                      }}
                      style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)' }}
                    >
                      <i className="icofont-close"></i> Cancel
                    </button>
                  )}
                  <button className="primary-btn" onClick={handleEditProfile}>
                    <i className={editMode ? "icofont-save" : "icofont-edit"}></i> {editMode ? 'Save Changes' : 'Edit Profile'}
                  </button>
                </div>
              </div>

              {/* Profile Stats */}
              <div className="stats-grid">
                <div className="stat-card primary">
                  <div className="stat-icon">
                    <i className="icofont-user"></i>
                  </div>
                  <div className="stat-details">
                    <p className="stat-label">Account Status</p>
                    <h2 className="stat-value">Active</h2>
                    <p className="stat-change positive"><i className="icofont-check-circled"></i> Verified email</p>
                  </div>
                </div>

                <div className="stat-card">
                  <div className="stat-icon">
                    <i className="icofont-id-card"></i>
                  </div>
                  <div className="stat-details">
                    <p className="stat-label">KYC Status</p>
                      <h2 className="stat-value">{kycData?.status ? kycData.status.charAt(0).toUpperCase() + kycData.status.slice(1) : "Pending"}</h2>
                    <p className="stat-info">Complete verification</p>
                  </div>
                </div>

                <div className="stat-card">
                  <div className="stat-icon">
                    <i className="icofont-calendar"></i>
                  </div>
                  <div className="stat-details">
                    <p className="stat-label">Member Since</p>
                    <h2 className="stat-value">{new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</h2>
                    <p className="stat-info">Account created</p>
                  </div>
                </div>

                <div className="stat-card">
                  <div className="stat-icon">
                    <i className="icofont-users"></i>
                  </div>
                  <div className="stat-details">
                    <p className="stat-label">Referrals</p>
                    <h2 className="stat-value">{downlineCount}</h2>
                    <p className="stat-info">Network members</p>
                  </div>
                </div>
              </div>

              {/* Account Information */}
              <div className="profile-card" style={{ marginTop: '1.5rem', marginBottom: '1.5rem' }}>
                <h4><i className="icofont-info-circle"></i> Account Information</h4>
                <div className="info-row">
                  <span className="label"><i className="icofont-user"></i> Full Name</span>
                  {editMode ? (
                    <input
                      type="text"
                      value={editForm.name}
                      onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      placeholder="Enter full name"
                      style={{
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(240,185,11,0.3)',
                        padding: '0.5rem',
                        borderRadius: '6px',
                        color: '#f8fafc',
                        width: '300px'
                      }}
                    />
                  ) : (
                    <span className="value">{currentUser?.name || 'Not provided'}</span>
                  )}
                </div>
                <div className="info-row">
                  <span className="label"><i className="icofont-ui-user"></i> Username</span>
                  {editMode ? (
                    <input
                      type="text"
                      value={editForm.userName}
                      onChange={(e) => setEditForm({ ...editForm, userName: e.target.value })}
                      placeholder="Enter username"
                      style={{
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(240,185,11,0.3)',
                        padding: '0.5rem',
                        borderRadius: '6px',
                        color: '#f8fafc',
                        width: '300px'
                      }}
                    />
                  ) : (
                    <span className="value">{currentUser?.userName || 'Not provided'}</span>
                  )}
                </div>
                <div className="info-row">
                  <span className="label"><i className="icofont-email"></i> Email</span>
                  {editMode ? (
                    <input
                      type="email"
                      value={editForm.email}
                      onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                      style={{
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(240,185,11,0.3)',
                        padding: '0.5rem',
                        borderRadius: '6px',
                        color: '#f8fafc',
                        width: '300px'
                      }}
                    />
                  ) : (
                    <span className="value">{currentUser?.email || 'Not provided'}</span>
                  )}
                </div>
                <div className="info-row">
                  <span className="label"><i className="icofont-id"></i> Account ID</span>
                  <span className="value" style={{ fontFamily: 'monospace' }}>{currentUser?.id || 'N/A'}</span>
                </div>
                <div className="info-row">
                  <span className="label"><i className="icofont-barcode"></i> Register ID</span>
                  <span className="value" style={{ fontFamily: 'monospace' }}>{currentUser?.idnum || 'N/A'}</span>
                </div>
                <div className="info-row">
                  <span className="label"><i className="icofont-phone"></i> Phone Number</span>
                  {editMode ? (
                    <input
                      type="tel"
                      value={editForm.phoneNumber}
                      onChange={(e) => setEditForm({ ...editForm, phoneNumber: e.target.value })}
                      placeholder="Enter phone number"
                      style={{
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(240,185,11,0.3)',
                        padding: '0.5rem',
                        borderRadius: '6px',
                        color: '#f8fafc',
                        width: '300px'
                      }}
                    />
                  ) : (
                    <span className="value">{currentUser?.phoneNumber || 'Not provided'}</span>
                  )}
                </div>
                <div className="info-row">
                  <span className="label"><i className="icofont-flag"></i> Country</span>
                  {editMode ? (
                    <input
                      type="text"
                      value={editForm.country}
                      onChange={(e) => setEditForm({ ...editForm, country: e.target.value })}
                      placeholder="Enter country"
                      style={{
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(240,185,11,0.3)',
                        padding: '0.5rem',
                        borderRadius: '6px',
                        color: '#f8fafc',
                        width: '300px'
                      }}
                    />
                  ) : (
                    <span className="value">{currentUser?.country || 'Not provided'}</span>
                  )}
                </div>
                <div className="info-row">
                  <span className="label"><i className="icofont-location-pin"></i> City</span>
                  {editMode ? (
                    <input
                      type="text"
                      value={editForm.city}
                      onChange={(e) => setEditForm({ ...editForm, city: e.target.value })}
                      placeholder="Enter city"
                      style={{
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(240,185,11,0.3)',
                        padding: '0.5rem',
                        borderRadius: '6px',
                        color: '#f8fafc',
                        width: '300px'
                      }}
                    />
                  ) : (
                    <span className="value">{currentUser?.city || 'Not provided'}</span>
                  )}
                </div>
                <div className="info-row">
                  <span className="label"><i className="icofont-home"></i> Address</span>
                  {editMode ? (
                    <input
                      type="text"
                      value={editForm.address}
                      onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
                      placeholder="Enter address"
                      style={{
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(240,185,11,0.3)',
                        padding: '0.5rem',
                        borderRadius: '6px',
                        color: '#f8fafc',
                        width: '300px'
                      }}
                    />
                  ) : (
                    <span className="value">{currentUser?.address || 'Not provided'}</span>
                  )}
                </div>
              </div>

              {/* Referral Link */}
              <div className="profile-card" style={{ marginBottom: '1.5rem' }}>
                <h4><i className="icofont-link-alt"></i> Referral Link</h4>
                <p className="text-muted" style={{ marginBottom: '1rem', fontSize: '0.875rem' }}>
                  <i className="icofont-share"></i> Share this link to invite friends and earn commissions
                </p>
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                  <input
                    type="text"
                    value={`${window.location.origin}/signup?ref=${currentUser?.referralCode || currentUser?.idnum}`}
                    readOnly
                    style={{
                      flex: 1,
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      padding: '0.75rem',
                      borderRadius: '8px',
                      color: '#cbd5e1',
                      fontFamily: 'monospace',
                      fontSize: '0.875rem'
                    }}
                  />
                  <button
                    onClick={copyReferralLink}
                    className="primary-btn"
                    style={{
                      whiteSpace: 'nowrap',
                      background: copied ? 'rgba(16,185,129,0.2)' : undefined,
                      color: copied ? '#10b981' : undefined,
                      border: copied ? '1px solid rgba(16,185,129,0.3)' : undefined
                    }}
                  >
                    {copied ? '✓ Copied!' : <><i className="icofont-copy"></i> Copy Link</>}
                  </button>
                </div>
              </div>

              {/* Avatar Selection - Only in Edit Mode */}
              {editMode && (
                <div className="profile-card" style={{ marginBottom: '1.5rem' }}>
                  <h4><i className="icofont-camera"></i> Choose Avatar</h4>
                  <p className="text-muted" style={{ marginBottom: '1rem', fontSize: '0.875rem' }}>Select your profile picture</p>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: '0.75rem',
                    maxWidth: '400px'
                  }}>
                    <div 
                      className={`avatar-option ${(currentUser?.avatar || 'avatar_male_1') === 'avatar_male_1' ? 'selected' : ''}`}
                      onClick={() => {
                        updateUser({ avatar: 'avatar_male_1' })
                      }}
                      style={{
                        cursor: 'pointer',
                        padding: '0.75rem',
                        border: (currentUser?.avatar || 'avatar_male_1') === 'avatar_male_1' ? '2px solid #f0b90b' : '1px solid rgba(255,255,255,0.1)',
                        borderRadius: '8px',
                        background: (currentUser?.avatar || 'avatar_male_1') === 'avatar_male_1' ? 'rgba(240,185,11,0.1)' : 'rgba(255,255,255,0.03)',
                        transition: 'all 0.2s ease',
                        textAlign: 'center'
                      }}
                    >
                      <img src="/images/avatar_male_1.svg" alt="Male Avatar 1" style={{
                        width: '60px',
                        height: '60px',
                        borderRadius: '50%',
                        marginBottom: '0.5rem',
                        objectFit: 'cover'
                      }} />
                      <span style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block' }}>Male 1</span>
                    </div>
                    <div 
                      className={`avatar-option ${currentUser?.avatar === 'avatar_male_2' ? 'selected' : ''}`}
                      onClick={() => {
                        updateUser({ avatar: 'avatar_male_2' })
                      }}
                      style={{
                        cursor: 'pointer',
                        padding: '0.75rem',
                        border: currentUser?.avatar === 'avatar_male_2' ? '2px solid #f0b90b' : '1px solid rgba(255,255,255,0.1)',
                        borderRadius: '8px',
                        background: currentUser?.avatar === 'avatar_male_2' ? 'rgba(240,185,11,0.1)' : 'rgba(255,255,255,0.03)',
                        transition: 'all 0.2s ease',
                        textAlign: 'center'
                      }}
                    >
                      <img src="/images/avatar_male_2.svg" alt="Male Avatar 2" style={{
                        width: '60px',
                        height: '60px',
                        borderRadius: '50%',
                        marginBottom: '0.5rem',
                        objectFit: 'cover'
                      }} />
                      <span style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block' }}>Male 2</span>
                    </div>
                    <div 
                      className={`avatar-option ${currentUser?.avatar === 'avatar_female_1' ? 'selected' : ''}`}
                      onClick={() => {
                        updateUser({ avatar: 'avatar_female_1' })
                      }}
                      style={{
                        cursor: 'pointer',
                        padding: '0.75rem',
                        border: currentUser?.avatar === 'avatar_female_1' ? '2px solid #f0b90b' : '1px solid rgba(255,255,255,0.1)',
                        borderRadius: '8px',
                        background: currentUser?.avatar === 'avatar_female_1' ? 'rgba(240,185,11,0.1)' : 'rgba(255,255,255,0.03)',
                        transition: 'all 0.2s ease',
                        textAlign: 'center'
                      }}
                    >
                      <img src="/images/avatar_female_1.svg" alt="Female Avatar" style={{
                        width: '60px',
                        height: '60px',
                        borderRadius: '50%',
                        marginBottom: '0.5rem',
                        objectFit: 'cover'
                      }} />
                      <span style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block' }}>Female</span>
                    </div>
                  </div>
                </div>
              )}

              {/* KYC Verification Status */}
              <div ref={kycSectionRef} className="profile-card" style={{ marginBottom: '1.5rem' }}>
                <h4><i className="icofont-verification-check"></i> KYC Verification</h4>
                <div className="kyc-status-card">
                  <div className="status-header" style={{ marginBottom: '1.5rem' }}>
                    <div style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      padding: '0.5rem 1rem',
                      background: kycData?.status === 'approved' ? 'rgba(34,197,94,0.1)' :
                                 kycData?.status === 'rejected' ? 'rgba(239,68,68,0.1)' : 'rgba(234,179,8,0.1)',
                      border: kycData?.status === 'approved' ? '1px solid rgba(34,197,94,0.3)' :
                             kycData?.status === 'rejected' ? '1px solid rgba(239,68,68,0.3)' : '1px solid rgba(234,179,8,0.3)',
                      borderRadius: '8px',
                      color: kycData?.status === 'approved' ? '#22c55e' :
                             kycData?.status === 'rejected' ? '#ef4444' : '#eab308',
                      fontSize: '0.875rem',
                      fontWeight: 600,
                      marginBottom: '0.75rem'
                    }}>
                      <i className={kycData?.status === 'approved' ? 'icofont-verification-check' :
                                   kycData?.status === 'rejected' ? 'icofont-close' : 'icofont-clock-time'}></i>
                      <span>
                        {kycData?.status === 'approved' ? 'Verified' :
                         kycData?.status === 'rejected' ? 'Rejected' :
                         kycData?.status === 'pending' ? 'Pending Verification' : 'Not Submitted'}
                      </span>
                    </div>
                    <p style={{ color: '#94a3b8', fontSize: '0.875rem', lineHeight: '1.5' }}>
                      {kycData?.status === 'approved' 
                        ? 'Your KYC verification has been approved. You can now access all features including withdrawals and higher investment limits.'
                        : kycData?.status === 'rejected'
                        ? `Your KYC verification was rejected. ${kycData.rejectionReason ? 'Reason: ' + kycData.rejectionReason : 'Please contact support for more details.'}`
                        : kycData?.status === 'pending'
                        ? 'Your KYC verification is being reviewed. We will notify you once the review is complete.'
                        : 'Complete KYC verification to unlock all features including withdrawals and higher investment limits.'
                      }
                    </p>
                  </div>

                  <div style={{ marginBottom: '1.5rem' }}>
                    <h5 style={{ color: '#f8fafc', fontSize: '0.875rem', marginBottom: '0.75rem', fontWeight: 600 }}>
                      Verification Progress
                    </h5>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.75rem',
                        padding: '0.75rem',
                        background: 'rgba(16,185,129,0.1)',
                        borderRadius: '8px',
                        border: '1px solid rgba(16,185,129,0.2)'
                      }}>
                        <i className="icofont-check-circled" style={{ color: '#10b981', fontSize: '1.25rem' }}></i>
                        <span style={{ color: '#10b981', fontWeight: 500 }}>Personal Information</span>
                      </div>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.75rem',
                        padding: '0.75rem',
                        background: 'rgba(148,163,184,0.1)',
                        borderRadius: '8px',
                        border: '1px solid rgba(148,163,184,0.2)'
                      }}>
                        <i className="icofont-clock-time" style={{ color: '#94a3b8', fontSize: '1.25rem' }}></i>
                        <span style={{ color: '#94a3b8', fontWeight: 500 }}>Identity Document</span>
                      </div>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.75rem',
                        padding: '0.75rem',
                        background: 'rgba(148,163,184,0.1)',
                        borderRadius: '8px',
                        border: '1px solid rgba(148,163,184,0.2)'
                      }}>
                        <i className="icofont-clock-time" style={{ color: '#94a3b8', fontSize: '1.25rem' }}></i>
                        <span style={{ color: '#94a3b8', fontWeight: 500 }}>Proof of Address</span>
                      </div>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.75rem',
                        padding: '0.75rem',
                        background: 'rgba(148,163,184,0.1)',
                        borderRadius: '8px',
                        border: '1px solid rgba(148,163,184,0.2)'
                      }}>
                        <i className="icofont-clock-time" style={{ color: '#94a3b8', fontSize: '1.25rem' }}></i>
                        <span style={{ color: '#94a3b8', fontWeight: 500 }}>Selfie Verification</span>
                      </div>
                    </div>
                  </div>

                  <button 
                    className="primary-btn"
                    onClick={handleStartKyc}
                    disabled={kycData?.status === 'approved' || kycData?.status === 'pending'}
                    style={{ 
                      width: '100%', 
                      padding: '1rem', 
                      marginTop: '1rem',
                      opacity: (kycData?.status === 'approved' || kycData?.status === 'pending') ? 0.6 : 1,
                      cursor: (kycData?.status === 'approved' || kycData?.status === 'pending') ? 'not-allowed' : 'pointer'
                    }}
                  >
                    <i className="icofont-verification-check"></i> 
                    {kycData?.status === 'approved' ? 'KYC Verified' :
                     kycData?.status === 'pending' ? 'KYC Under Review' :
                     kycData?.status === 'rejected' ? 'Resubmit KYC' : 'Start KYC Verification'}
                  </button>
                </div>
              </div>

              {/* Change Password */}
              <div className="profile-card" style={{ marginBottom: '1.5rem' }}>
                <h4><i className="icofont-lock"></i> Change Password</h4>
                <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.5rem', color: '#94a3b8', fontSize: '0.875rem' }}>
                      <i className="icofont-key"></i> Current Password
                    </label>
                    <input
                      type="password"
                      value={passwordForm.currentPassword}
                      onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
                      required
                      style={{
                        width: '100%',
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        padding: '0.75rem',
                        borderRadius: '8px',
                        color: '#f8fafc'
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.5rem', color: '#94a3b8', fontSize: '0.875rem' }}>
                      <i className="icofont-key"></i> New Password
                    </label>
                    <input
                      type="password"
                      value={passwordForm.newPassword}
                      onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                      required
                      style={{
                        width: '100%',
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        padding: '0.75rem',
                        borderRadius: '8px',
                        color: '#f8fafc'
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.5rem', color: '#94a3b8', fontSize: '0.875rem' }}>
                      <i className="icofont-check"></i> Confirm New Password
                    </label>
                    <input
                      type="password"
                      value={passwordForm.confirmPassword}
                      onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                      required
                      style={{
                        width: '100%',
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        padding: '0.75rem',
                        borderRadius: '8px',
                        color: '#f8fafc'
                      }}
                    />
                  </div>
                  <button
                    type="submit"
                    className="primary-btn"
                    style={{ alignSelf: 'flex-start' }}
                  >
                    <i className="icofont-check-circled"></i> Update Password
                  </button>
                </form>
              </div>

              {/* Delete Account */}
              <div className="profile-card" style={{ borderColor: 'rgba(239,68,68,0.3)' }}>
                <h4 style={{ color: '#ef4444' }}><i className="icofont-warning"></i> Danger Zone</h4>
                <p style={{ color: '#94a3b8', marginBottom: '1rem' }}>
                  <i className="icofont-exclamation-circle"></i> Once you delete your account, there is no going back. Please be certain.
                </p>
                <button
                  onClick={handleDeleteAccount}
                  style={{
                    padding: '0.75rem 1.5rem',
                    background: 'rgba(239,68,68,0.1)',
                    border: '1px solid rgba(239,68,68,0.3)',
                    borderRadius: '8px',
                    color: '#ef4444',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  <i className="icofont-trash"></i> Delete Account
                </button>
              </div>
            </div>
          )}

          {profileState === 'Downline' && (
            <div className="page-section">
              <div className="page-header">
                <h2><i className="icofont-users-alt-3"></i> Downline Network</h2>
                <button className="primary-btn" onClick={copyReferralLink}>
                  <i className="icofont-share"></i> {copied ? 'Copied!' : 'Share Link'}
                </button>
              </div>

              {/* Referral Stats Grid */}
              <div className="stats-grid">
                <div className="stat-card primary">
                  <div className="stat-icon">
                    <i className="icofont-users-alt-3"></i>
                  </div>
                  <div className="stat-details">
                    <p className="stat-label">Total Downline</p>
                    <h2 className="stat-value">{downlineCount}</h2>
                    <p className="stat-info">Network members</p>
                  </div>
                </div>

                <div className="stat-card">
                  <div className="stat-icon" style={{ background: 'rgba(16, 185, 129, 0.1)', color: '#10b981' }}>
                    <i className="icofont-dollar"></i>
                  </div>
                  <div className="stat-details">
                    <p className="stat-label">Downline Earnings</p>
                    <h2 className="stat-value">${downlineEarnings.toLocaleString()}</h2>
                    <p className="stat-info">Total commissions</p>
                  </div>
                </div>

                <div className="stat-card">
                  <div className="stat-icon" style={{ background: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6' }}>
                    <i className="icofont-chart-growth"></i>
                  </div>
                  <div className="stat-details">
                    <p className="stat-label">Commission Rate</p>
                    <h2 className="stat-value">10%</h2>
                    <p className="stat-change positive">On first deposit/investment</p>
                  </div>
                </div>

                <div className="stat-card">
                  <div className="stat-icon" style={{ background: 'rgba(147, 51, 234, 0.1)', color: '#a855f7' }}>
                    <i className="icofont-gift"></i>
                  </div>
                  <div className="stat-details">
                    <p className="stat-label">Pending Bonuses</p>
                    <h2 className="stat-value">{downlineReferrals.filter(r => !r.bonusAwarded).length}</h2>
                    <p className="stat-info">Awaiting first transaction</p>
                  </div>
                </div>
              </div>

              {/* Referral Link Card */}
              <div className="profile-card" style={{ marginTop: '1.5rem' }}>
                <h4><i className="icofont-link"></i> Your Referral Link</h4>
                <p style={{ color: '#94a3b8', fontSize: '0.875rem', marginBottom: '1rem' }}>
                  Share this link to invite friends and earn commissions
                </p>
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                  <input
                    type="text"
                    value={`${window.location.origin}/signup?ref=${currentUser?.referralCode || currentUser?.idnum}`}
                    readOnly
                    style={{
                      flex: 1,
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      padding: '0.75rem',
                      borderRadius: '8px',
                      color: '#cbd5e1',
                      fontFamily: 'monospace',
                      fontSize: '0.875rem'
                    }}
                  />
                  <button
                    onClick={copyReferralLink}
                    className="primary-btn"
                    style={{
                      whiteSpace: 'nowrap',
                      background: copied ? 'rgba(16,185,129,0.2)' : undefined,
                      color: copied ? '#10b981' : undefined,
                      border: copied ? '1px solid rgba(16,185,129,0.3)' : undefined
                    }}
                  >
                    {copied ? '✓ Copied!' : <><i className="icofont-copy"></i> Copy</>}
                  </button>
                </div>
              </div>

              {/* Referral History */}
              <div className="activity-section" style={{ marginTop: '1.5rem' }}>
                <div className="section-header">
                  <h3><i className="icofont-history"></i> Referral History</h3>
                  <button className="view-all">View All →</button>
                </div>
                {downlineReferrals.length > 0 ? (
                  <div className="activity-list">
                    {downlineReferrals.map((referral, idx) => (
                      <div className="activity-item" key={referral.id || referral.referredId || idx}>
                        <div className="activity-icon">
                          <i className="icofont-user"></i>
                        </div>
                        <div className="activity-details">
                          <h4>{getReferralUsername(referral)}</h4>
                          <p>{getReferralDetails(referral)}</p>
                          <small style={{ color: '#94a3b8', fontSize: '0.75rem', marginTop: '0.25rem' }}>
                            {referral.bonusAwarded ? '✅ Bonus awarded' : '⏳ Awaiting first deposit/investment'}
                          </small>
                        </div>
                        <div className={`activity-amount ${referral.bonusAwarded ? 'positive' : 'neutral'}`}>
                          {referral.bonusAwarded ? `+$${formatCurrency(referral.bonusEarned || 0)}` : 'Pending'}
                        </div>
                        <span className={`status-badge ${referral.bonusAwarded ? 'active' : 'pending'}`}>
                          {referral.bonusAwarded ? 'Earned' : 'Pending'}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">
                    <i className="icofont-users-alt-3"></i>
                    <p>No referrals yet</p>
                    <small style={{ color: '#64748b' }}>Share your referral link to start earning 10% commissions</small>
                  </div>
                )}
              </div>

              {/* How It Works */}
              <div className="profile-card" style={{ marginTop: '1.5rem' }}>
                <h4><i className="icofont-info-circle"></i> How It Works</h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                  <div style={{ 
                    padding: '1rem', 
                    background: 'rgba(240,185,11,0.05)', 
                    borderRadius: '8px',
                    border: '1px solid rgba(240,185,11,0.1)',
                    textAlign: 'center'
                  }}>
                    <div style={{ 
                      width: '40px', 
                      height: '40px', 
                      borderRadius: '50%', 
                      background: 'rgba(240,185,11,0.2)', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center',
                      margin: '0 auto 0.75rem',
                      color: '#f0b90b',
                      fontWeight: 700
                    }}>1</div>
                    <h5 style={{ color: '#f8fafc', marginBottom: '0.25rem' }}>Share Link</h5>
                    <p style={{ color: '#94a3b8', fontSize: '0.8125rem', margin: 0 }}>Copy & share your unique referral link</p>
                  </div>
                  <div style={{ 
                    padding: '1rem', 
                    background: 'rgba(16,185,129,0.05)', 
                    borderRadius: '8px',
                    border: '1px solid rgba(16,185,129,0.1)',
                    textAlign: 'center'
                  }}>
                    <div style={{ 
                      width: '40px', 
                      height: '40px', 
                      borderRadius: '50%', 
                      background: 'rgba(16,185,129,0.2)', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center',
                      margin: '0 auto 0.75rem',
                      color: '#10b981',
                      fontWeight: 700
                    }}>2</div>
                    <h5 style={{ color: '#f8fafc', marginBottom: '0.25rem' }}>First Deposit/Investment</h5>
                    <p style={{ color: '#94a3b8', fontSize: '0.8125rem', margin: 0 }}>They make their first transaction</p>
                  </div>
                  <div style={{ 
                    padding: '1rem', 
                    background: 'rgba(59,130,246,0.05)', 
                    borderRadius: '8px',
                    border: '1px solid rgba(59,130,246,0.1)',
                    textAlign: 'center'
                  }}>
                    <div style={{ 
                      width: '40px', 
                      height: '40px', 
                      borderRadius: '50%', 
                      background: 'rgba(59,130,246,0.2)', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center',
                      margin: '0 auto 0.75rem',
                      color: '#3b82f6',
                      fontWeight: 700
                    }}>3</div>
                    <h5 style={{ color: '#f8fafc', marginBottom: '0.25rem' }}>Earn Rewards</h5>
                    <p style={{ color: '#94a3b8', fontSize: '0.8125rem', margin: 0 }}>Get 10% of their deposit as bonus</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {profileState === 'Support' && (
            <div className="page-section">
              <div className="page-header">
                <h2><i className="icofont-headphone-alt"></i> Support Center</h2>
                <button className="primary-btn" onClick={() => window.location.href = '/contact'}>
                  <i className="icofont-envelope"></i> Open Support Page
                </button>
              </div>

              {/* Support Stats Grid */}
              <div className="stats-grid">
                <div className="stat-card primary">
                  <div className="stat-icon">
                    <i className="icofont-live-support"></i>
                  </div>
                  <div className="stat-details">
                    <p className="stat-label">Live Chat</p>
                    <h2 className="stat-value">Online</h2>
                    <p className="stat-change positive"><i className="icofont-ui-check"></i> Available Now</p>
                  </div>
                </div>

                <div className="stat-card">
                  <div className="stat-icon" style={{ background: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6' }}>
                    <i className="icofont-email"></i>
                  </div>
                  <div className="stat-details">
                    <p className="stat-label">Email Response</p>
                    <h2 className="stat-value">24h</h2>
                    <p className="stat-info">Average response time</p>
                  </div>
                </div>

                <div className="stat-card">
                  <div className="stat-icon" style={{ background: 'rgba(16, 185, 129, 0.1)', color: '#10b981' }}>
                    <i className="icofont-ticket"></i>
                  </div>
                  <div className="stat-details">
                    <p className="stat-label">Open Tickets</p>
                    <h2 className="stat-value">0</h2>
                    <p className="stat-info">No pending issues</p>
                  </div>
                </div>

                <div className="stat-card">
                  <div className="stat-icon" style={{ background: 'rgba(147, 51, 234, 0.1)', color: '#a855f7' }}>
                    <i className="icofont-clock-time"></i>
                  </div>
                  <div className="stat-details">
                    <p className="stat-label">Availability</p>
                    <h2 className="stat-value">24/7</h2>
                    <p className="stat-info">Round the clock support</p>
                  </div>
                </div>
              </div>

              {/* Support Options */}
              <div className="profile-card" style={{ marginTop: '1.5rem' }}>
                <h4><i className="icofont-options"></i> Contact Options</h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem' }}>
                  <div style={{ 
                    padding: '1.25rem', 
                    background: 'rgba(240,185,11,0.05)', 
                    borderRadius: '8px',
                    border: '1px solid rgba(240,185,11,0.1)'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
                      <i className="icofont-live-support" style={{ color: '#f0b90b', fontSize: '1.5rem' }}></i>
                      <div>
                        <h5 style={{ color: '#f8fafc', margin: 0 }}>Live Chat</h5>
                        <span style={{ color: '#10b981', fontSize: '0.75rem' }}>Online</span>
                      </div>
                    </div>
                    <p style={{ color: '#94a3b8', fontSize: '0.8125rem', marginBottom: '1rem' }}>Chat with our team in real-time</p>
                    <button className="primary-btn" style={{ width: '100%', padding: '0.75rem' }} onClick={() => (window as any).openSuppaChat && (window as any).openSuppaChat()}>
                      <i className="icofont-speech-comments"></i> Start Chat
                    </button>
                  </div>
                  <div style={{ 
                    padding: '1.25rem', 
                    background: 'rgba(59,130,246,0.05)', 
                    borderRadius: '8px',
                    border: '1px solid rgba(59,130,246,0.1)'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
                      <i className="icofont-email" style={{ color: '#3b82f6', fontSize: '1.5rem' }}></i>
                      <div>
                        <h5 style={{ color: '#f8fafc', margin: 0 }}>Email</h5>
                        <span style={{ color: '#64748b', fontSize: '0.75rem' }}>24h response</span>
                      </div>
                    </div>
                    <p style={{ color: '#94a3b8', fontSize: '0.8125rem', marginBottom: '1rem' }}>Use the support form for account-specific help</p>
                    <button 
                      className="secondary-btn" 
                      style={{ width: '100%', padding: '0.75rem' }}
                      onClick={() => window.location.href = '/contact'}
                    >
                      <i className="icofont-envelope"></i> Open Support Form
                    </button>
                  </div>
                  <div style={{ 
                    padding: '1.25rem', 
                    background: 'rgba(16,185,129,0.05)', 
                    borderRadius: '8px',
                    border: '1px solid rgba(16,185,129,0.1)'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
                      <i className="icofont-ticket" style={{ color: '#10b981', fontSize: '1.5rem' }}></i>
                      <div>
                        <h5 style={{ color: '#f8fafc', margin: 0 }}>Ticket</h5>
                        <span style={{ color: '#64748b', fontSize: '0.75rem' }}>Track issues</span>
                      </div>
                    </div>
                    <p style={{ color: '#94a3b8', fontSize: '0.8125rem', marginBottom: '1rem' }}>Create and track support tickets</p>
                    <button className="secondary-btn" style={{ width: '100%', padding: '0.75rem' }}>
                      <i className="icofont-plus"></i> Create Ticket
                    </button>
                  </div>
                </div>
              </div>

              {/* FAQ Section */}
              <div className="profile-card" style={{ marginTop: '1.5rem' }}>
                <h4><i className="icofont-question-circle"></i> Frequently Asked Questions</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <div className="info-row" style={{ 
                    background: 'rgba(255,255,255,0.03)', 
                    borderRadius: '8px', 
                    padding: '1rem',
                    border: '1px solid rgba(255,255,255,0.05)',
                    flexDirection: 'column',
                    alignItems: 'flex-start'
                  }}>
                    <span className="label" style={{ color: '#f8fafc', fontWeight: 500, marginBottom: '0.5rem' }}>
                      <i className="icofont-simple-right" style={{ color: '#f0b90b', marginRight: '0.5rem' }}></i>
                      How do I make my first investment?
                    </span>
                    <span className="value" style={{ color: '#94a3b8', fontSize: '0.875rem', paddingLeft: '1.5rem' }}>
                      Go to Investments, select a plan, choose payment method, and follow instructions.
                    </span>
                  </div>
                  <div className="info-row" style={{ 
                    background: 'rgba(255,255,255,0.03)', 
                    borderRadius: '8px', 
                    padding: '1rem',
                    border: '1px solid rgba(255,255,255,0.05)',
                    flexDirection: 'column',
                    alignItems: 'flex-start'
                  }}>
                    <span className="label" style={{ color: '#f8fafc', fontWeight: 500, marginBottom: '0.5rem' }}>
                      <i className="icofont-simple-right" style={{ color: '#f0b90b', marginRight: '0.5rem' }}></i>
                      When can I withdraw my earnings?
                    </span>
                    <span className="value" style={{ color: '#94a3b8', fontSize: '0.875rem', paddingLeft: '1.5rem' }}>
                      Request withdrawal anytime from Withdrawals section. Processing takes 24-48 hours.
                    </span>
                  </div>
                  <div className="info-row" style={{ 
                    background: 'rgba(255,255,255,0.03)', 
                    borderRadius: '8px', 
                    padding: '1rem',
                    border: '1px solid rgba(255,255,255,0.05)',
                    flexDirection: 'column',
                    alignItems: 'flex-start'
                  }}>
                    <span className="label" style={{ color: '#f8fafc', fontWeight: 500, marginBottom: '0.5rem' }}>
                      <i className="icofont-simple-right" style={{ color: '#f0b90b', marginRight: '0.5rem' }}></i>
                      What documents do I need for KYC?
                    </span>
                    <span className="value" style={{ color: '#94a3b8', fontSize: '0.875rem', paddingLeft: '1.5rem' }}>
                      Government ID, proof of address, and a selfie holding your ID.
                    </span>
                  </div>
                  <div className="info-row" style={{ 
                    background: 'rgba(255,255,255,0.03)', 
                    borderRadius: '8px', 
                    padding: '1rem',
                    border: '1px solid rgba(255,255,255,0.05)',
                    flexDirection: 'column',
                    alignItems: 'flex-start'
                  }}>
                    <span className="label" style={{ color: '#f8fafc', fontWeight: 500, marginBottom: '0.5rem' }}>
                      <i className="icofont-simple-right" style={{ color: '#f0b90b', marginRight: '0.5rem' }}></i>
                      How does the referral program work?
                    </span>
                    <span className="value" style={{ color: '#94a3b8', fontSize: '0.875rem', paddingLeft: '1.5rem' }}>
                      Share your referral link. When friends invest, you earn 5% commission.
                    </span>
                  </div>
                  <div className="info-row" style={{ 
                    background: 'rgba(255,255,255,0.03)', 
                    borderRadius: '8px', 
                    padding: '1rem',
                    border: '1px solid rgba(255,255,255,0.05)',
                    flexDirection: 'column',
                    alignItems: 'flex-start'
                  }}>
                    <span className="label" style={{ color: '#f8fafc', fontWeight: 500, marginBottom: '0.5rem' }}>
                      <i className="icofont-simple-right" style={{ color: '#f0b90b', marginRight: '0.5rem' }}></i>
                      What payment methods are accepted?
                    </span>
                    <span className="value" style={{ color: '#94a3b8', fontSize: '0.875rem', paddingLeft: '1.5rem' }}>
                      Bitcoin (BTC), Ethereum (ETH), USDT (Tether), and bank transfers.
                    </span>
                  </div>
                </div>
              </div>

              {/* Contact Info */}
              <div className="profile-card" style={{ marginTop: '1.5rem', borderColor: 'rgba(240,185,11,0.2)' }}>
                <h4><i className="icofont-info-circle"></i> Still Need Help?</h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem' }}>
                  <div>
                    <p style={{ color: '#64748b', fontSize: '0.8125rem', marginBottom: '0.25rem' }}>Support Page</p>
                    <a href="/contact" style={{ color: '#f0b90b', textDecoration: 'none', fontWeight: 500 }}>
                      Open contact form
                    </a>
                  </div>
                  <div>
                    <p style={{ color: '#64748b', fontSize: '0.8125rem', marginBottom: '0.25rem' }}>Response Time</p>
                    <p style={{ color: '#f8fafc', margin: 0, fontWeight: 500 }}>Within 24 hours</p>
                  </div>
                  <div>
                    <p style={{ color: '#64748b', fontSize: '0.8125rem', marginBottom: '0.25rem' }}>Availability</p>
                    <p style={{ color: '#10b981', margin: 0, fontWeight: 500 }}>
                      <i className="icofont-clock-time"></i> 24/7
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {profileState === 'Referrals' && (
            <div className="page-section">
              <div className="page-header">
                <h2><i className="icofont-share"></i> Referrals</h2>
                <div>
                  <button className="primary-btn" onClick={copyReferralLink}><i className="icofont-copy"></i> Copy Link</button>
                </div>
              </div>

              <div className="profile-card">
                <h4>Your Referral Link</h4>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <code style={{ background: 'rgba(255,255,255,0.03)', padding: '0.5rem 1rem', borderRadius: 8, color: '#f8fafc' }}>
                    {`${window.location.origin}/signup?ref=${currentUser?.referralCode || currentUser?.idnum || ''}`}
                  </code>
                  <button className="primary-btn" onClick={copyReferralLink}>Copy Link</button>
                </div>

                <div style={{ marginTop: '1rem' }}>
                  <p style={{ color: '#94a3b8' }}><strong>Referrals:</strong> {downlineCount}</p>
                  <p style={{ color: '#94a3b8' }}><strong>Referral Bonus:</strong> ${downlineEarnings.toLocaleString()}</p>
                  <p style={{ color: '#94a3b8', marginTop: '0.5rem' }}>Share this link and earn commission when your referees invest.</p>
                </div>
              </div>
            </div>
          )}

          {profileState === 'Stocks' && (
            <div className="page-section">
              <div className="page-header">
                <h2><i className="icofont-chart-line"></i> Stock Trading</h2>
              </div>

              <div className="profile-card">
                <h4>Coming Soon</h4>
                <p style={{ color: '#94a3b8' }}>The Stock Trading feature is coming soon. Join the waitlist to be notified when it launches.</p>
                <div style={{ marginTop: '1rem' }}>
                  <button
                    className="primary-btn"
                    onClick={() => {
                      try {
                        localStorage.setItem('waitlist_stock_trading', 'true')
                      } catch {}
                      showAlert('success', 'Joined Waitlist', 'You have been added to the Stock Trading waitlist.')
                    }}
                  >Join Waitlist</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Mobile overlay handled by CSS + sidebar show state (mobile header toggles sidebar) */}

      {/* Investment Modal */}
      {showInvestmentModal && selectedPlan && (
        <div className="modal-overlay" onClick={closeInvestmentModal}>
          <div className="modal-container" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={closeInvestmentModal}>
              <i className="icofont-close"></i>
            </button>

            {/* Step 1: Select Amount & Payment Method */}
            {investmentStep === 'select' && (
              <div className="modal-content">
                <div className="modal-header">
                  <h2><i className="icofont-chart-growth"></i> Create Investment</h2>
                  <p>Configure your investment in {selectedPlan.name}</p>
                </div>

                <div className="modal-body">
                  <div className="investment-summary-card">
                    <div className="investment-summary-heading">
                      <div>
                        <h3>{selectedPlan.name}</h3>
                        <p>Set the amount and choose how to fund it.</p>
                      </div>
                      <span>{investmentForm.paymentMethod === 'Balance' ? 'Balance' : selectedPaymentName}</span>
                    </div>
                    <div className="summary-grid">
                      <div>
                        <span className="label">Daily ROI</span>
                        <span className="value">{formatPercent(selectedPlan.dailyRate)}</span>
                      </div>
                      <div>
                        <span className="label">Duration</span>
                        <span className="value">{selectedPlan.durationLabel}</span>
                      </div>
                      <div>
                        <span className="label">Total Return</span>
                        <span className="value">{formatPercent(selectedPlan.dailyRate * selectedPlan.durationDays)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="form-group">
                    <label>Investment Amount (USD)</label>
                    <input
                      type="number"
                      value={investmentForm.capital}
                      onChange={(e) => setInvestmentForm({ ...investmentForm, capital: e.target.value })}
                      min={selectedPlan.minCapital}
                      max={selectedPlan.maxCapital || undefined}
                      placeholder={`Min: $${selectedPlan.minCapital.toLocaleString()}`}
                      className="modal-input investment-amount-input"
                    />
                    <small className="input-hint">
                      Range: ${selectedPlan.minCapital.toLocaleString()}
                      {selectedPlan.maxCapital && ` - $${selectedPlan.maxCapital.toLocaleString()}`}
                    </small>
                  </div>

                  {investmentForm.paymentMethod === 'Balance' && (
                    <div className="balance-funding-panel">
                      <div>
                        <span>Available Account Balance</span>
                        <strong>${formatCurrency(totalBalance)}</strong>
                      </div>
                      <div>
                        <span>Investment Amount</span>
                        <strong>${formatCurrency(configuredInvestmentAmount)}</strong>
                      </div>
                      <div className={balanceAfterConfiguredInvestment < 0 ? 'negative' : 'positive'}>
                        <span>Balance After Investment</span>
                        <strong>${formatCurrency(Math.max(balanceAfterConfiguredInvestment, 0))}</strong>
                      </div>
                    </div>
                  )}

                  <div className="form-group">
                    <label>Payment Method</label>
                    <div className="payment-methods-grid">
                      {Object.entries(paymentMethods).map(([key, method]) => (
                        <button
                          key={key}
                          className={`payment-method-card ${key === 'Crypto' ? isCryptoPayment ? 'active' : '' : investmentForm.paymentMethod === key ? 'active' : ''}`}
                          onClick={() => {
                            setInvestmentForm({
                              ...investmentForm,
                              paymentMethod: key === 'Crypto' ? 'Bitcoin' : key,
                              transactionHash: '',
                              bankSlip: null,
                            })
                          }}
                        >
                          <span className="method-icon">{method.icon}</span>
                          <span className="method-copy">
                            <span className="method-name">{method.name}</span>
                            {'description' in method && <span className="method-description">{method.description}</span>}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {investmentForm.capital && parseFloat(investmentForm.capital) >= selectedPlan.minCapital && (
                    <div className="earnings-preview">
                      <h4>Daily Earnings Projection</h4>
                      <div className="preview-grid">
                        <div>
                          <span className="label">You Invest</span>
                          <span className="value">${parseFloat(investmentForm.capital).toLocaleString()}</span>
                        </div>
                        <div>
                          <span className="label">Daily Earnings</span>
                          <span className="value positive">
                            +${(parseFloat(investmentForm.capital) * selectedPlan.dailyRate).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/day
                          </span>
                        </div>
                        <div>
                          <span className="label">Duration</span>
                          <span className="value">{selectedPlan.durationDays} days</span>
                        </div>
                        <div>
                          <span className="label">Total Expected (after {selectedPlan.durationDays} days)</span>
                          <span className="value">
                            ${(parseFloat(investmentForm.capital) * selectedPlan.dailyRate * selectedPlan.durationDays).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="modal-footer">
                  <button className="btn-secondary" onClick={closeInvestmentModal}>
                    Cancel
                  </button>
                  <button className="btn-primary" onClick={handleInvestmentNext}>
                    Continue <i className="icofont-arrow-right"></i>
                  </button>
                </div>
              </div>
            )}

            {/* Step 2: Confirm Details */}
            {investmentStep === 'confirm' && (
              <div className="modal-content">
                <div className="modal-header">
                  <h2><i className="icofont-chart-growth"></i> Investment Summary</h2>
                  <p>{selectedPlan.name}</p>
                </div>

                <div className="modal-body">
                  <div className="confirmation-card">
                    <div className="confirm-row">
                      <span>Plan</span>
                      <strong>{selectedPlan.name}</strong>
                    </div>
                    <div className="confirm-row">
                      <span>Investment Amount</span>
                      <strong>${parseFloat(investmentForm.capital).toLocaleString()}</strong>
                    </div>
                    <div className="confirm-row">
                      <span>Daily Earnings</span>
                      <strong className="positive">+${(parseFloat(investmentForm.capital) * selectedPlan.dailyRate).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/day</strong>
                    </div>
                    <div className="confirm-row">
                      <span>Duration</span>
                      <strong>{selectedPlan.durationLabel}</strong>
                    </div>
                    <div className="confirm-row">
                      <span>Total Expected Return</span>
                      <strong>
                        ${(parseFloat(investmentForm.capital) * selectedPlan.dailyRate * selectedPlan.durationDays).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </strong>
                    </div>
                  </div>

                  <div className="warning-box">
                    <i className="icofont-info-circle"></i>
                    <div>
                      Daily earnings are credited after admin approval.
                    </div>
                  </div>
                </div>

                <div className="modal-footer">
                  <button className="btn-secondary" onClick={handleInvestmentBack}>
                    <i className="icofont-arrow-left"></i> Back
                  </button>
                  <button className="btn-primary" onClick={handleInvestmentNext}>
                    Choose Payment Method <i className="icofont-arrow-right"></i>
                  </button>
                </div>
              </div>
            )}

            {/* Step 2.5: Choose Payment Method */}
            {investmentStep === 'choose-method' && (
              <div className="modal-content">
                <div className="modal-header">
                  <h2><i className="icofont-wallet"></i> Payment Method</h2>
                  <p>Select how you want to fund this investment.</p>
                </div>
                <div className="modal-body">
                  <div className="payment-methods-list" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                    {Object.entries(paymentMethods).map(([key, method]) => (
                      <div
                        key={key}
                        className={`payment-method-card${investmentForm.paymentMethod === key ? ' selected' : ''}`}
                        style={{
                          border: (key === 'Crypto' ? isCryptoPayment : investmentForm.paymentMethod === key) ? '1px solid #f0b90b' : '1px solid rgba(255,255,255,0.12)',
                          borderRadius: 6,
                          padding: '0.85rem',
                          cursor: 'pointer',
                          background: (key === 'Crypto' ? isCryptoPayment : investmentForm.paymentMethod === key) ? 'rgba(240,185,11,0.08)' : 'rgba(255,255,255,0.03)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          textAlign: 'left',
                          fontSize: 15,
                        }}
                        onClick={() => {
                          if (key === 'Crypto') {
                            setInvestmentForm({ ...investmentForm, paymentMethod: 'Bitcoin', transactionHash: '', bankSlip: null })
                            setInvestmentStep('payment')
                            return
                          }
                          setInvestmentForm({ ...investmentForm, paymentMethod: key, transactionHash: '', bankSlip: null })
                        }}
                      >
                        <span style={{ fontSize: 18, color: '#f0b90b', width: 24, textAlign: 'center' }}>{method.icon}</span>
                        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                          <span style={{ fontWeight: 600, fontSize: 14, color: '#f8fafc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{method.name}</span>
                          {'bankName' in method && (
                            <span style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{method.bankName}</span>
                          )}
                          {'description' in method && (
                            <span style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{method.description}</span>
                          )}
                          {key === 'Crypto' && (
                            <label className="crypto-network-select-wrap" onClick={(event) => event.stopPropagation()}>
                              <span className="crypto-network-label">Network</span>
                              <span className="crypto-network-select-shell">
                                <i className="icofont-coins crypto-network-icon"></i>
                                <select
                                  className="crypto-network-select"
                                  value={isCryptoPayment ? investmentForm.paymentMethod : 'Bitcoin'}
                                  onChange={(event) => {
                                    setInvestmentForm({
                                      ...investmentForm,
                                      paymentMethod: event.target.value,
                                      transactionHash: '',
                                      bankSlip: null,
                                    })
                                    setInvestmentStep('payment')
                                  }}
                                >
                                  {Object.entries(cryptoPaymentMethods).map(([cryptoKey, cryptoMethod]) => (
                                    <option key={cryptoKey} value={cryptoKey}>
                                      {cryptoMethod.name}
                                    </option>
                                  ))}
                                </select>
                                <i className="icofont-rounded-down crypto-network-chevron"></i>
                              </span>
                            </label>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  {investmentForm.paymentMethod === 'Balance' && (
                    <div className="balance-funding-panel balance-funding-panel--modal">
                      <div className="balance-funding-field">
                        <label>Investment Amount</label>
                        <input
                          type="number"
                          min={selectedPlan.minCapital}
                          max={selectedPlan.maxCapital || undefined}
                          step="0.01"
                          className="modal-input investment-amount-input"
                          value={investmentForm.capital}
                          onChange={(event) => setInvestmentForm({ ...investmentForm, capital: event.target.value })}
                        />
                      </div>
                      <div>
                        <span>Available Account Balance</span>
                        <strong>${formatCurrency(totalBalance)}</strong>
                      </div>
                      <div className={balanceAfterConfiguredInvestment < 0 ? 'negative' : 'positive'}>
                        <span>Balance After Investment</span>
                        <strong>${formatCurrency(Math.max(balanceAfterConfiguredInvestment, 0))}</strong>
                      </div>
                    </div>
                  )}
                </div>
                <div className="modal-footer">
                  <button className="btn-secondary" onClick={handleInvestmentBack}>
                    <i className="icofont-arrow-left"></i> Back
                  </button>
                  <button className="btn-primary" onClick={handleInvestmentNext} disabled={isInvestmentSubmitting}>
                    {investmentForm.paymentMethod === 'Balance' ? 'Invest From Balance' : 'Continue'} <i className="icofont-arrow-right"></i>
                  </button>
                </div>
              </div>
            )}

            {/* Step 3: Payment Details */}
            {investmentStep === 'payment' && (
              <div className="modal-content">
                <div className="modal-header">
                  <h2><i className="icofont-pay"></i> Payment Details</h2>
                  <p>{selectedPaymentName}</p>
                </div>

                <div className="modal-body">
                  <div className="payment-instructions">
                    <div className="payment-amount-box">
                      <label className="amount-label">Amount to Pay</label>
                      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', justifyContent: 'center' }}>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          className="modal-input amount-input"
                          style={{ width: '180px' }}
                          value={investmentForm.capital}
                          onChange={e => setInvestmentForm({ ...investmentForm, capital: e.target.value })}
                        />

                        <div className="amount-preview">
                          <div className="amount-value">${(investmentForm.capital && !isNaN(parseFloat(investmentForm.capital)) ? parseFloat(investmentForm.capital).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00')}</div>
                          <div className="amount-method">via {selectedPaymentName}</div>
                        </div>
                      </div>
                      <small style={{ color: 'var(--muted)', display: 'block', marginTop: '0.5rem' }}>You can edit the amount before making payment.</small>
                    </div>

                    {investmentForm.paymentMethod !== 'Bank' ? (
                      <div className="crypto-payment-details">
                        <div className="detail-row">
                          <span className="detail-label">Network</span>
                          <span className="detail-value">{selectedCryptoMethod.network}</span>
                        </div>
                        <div className="detail-row">
                          <span className="detail-label">Wallet Address</span>
                          <div className="address-box">
                            <code>{selectedCryptoMethod.address}</code>
                            <button className="copy-btn" onClick={copyPaymentAddress}>
                              {paymentCopied ? <i className="icofont-check"></i> : <i className="icofont-copy"></i>}
                            </button>
                          </div>
                        </div>
                        {/* QR code removed as requested */}
                        {/* Transaction Hash Input - Required for crypto */}
                        <div className="detail-row" style={{ marginTop: '1.5rem' }}>
                          <span className="detail-label">Transaction Hash / TXID <span style={{ color: '#ef4444' }}>*</span></span>
                          <input
                            type="text"
                            className="modal-input"
                            placeholder="Enter transaction hash (e.g., 0x1234...abcd)"
                            value={investmentForm.transactionHash}
                            onChange={e => setInvestmentForm({ ...investmentForm, transactionHash: e.target.value })}
                            style={{ width: '100%', marginTop: '0.5rem' }}
                            required
                          />
                        </div>
                        {/* Payment Screenshot Upload - Required for crypto */}
                        <div className="detail-row" style={{ marginTop: '1.5rem' }}>
                          <span className="detail-label">Upload Payment Proof <span style={{ color: '#ef4444' }}>*</span></span>
                          <input
                            type="file"
                            accept="image/*"
                            className="modal-input"
                            onChange={e => setInvestmentForm({ ...investmentForm, bankSlip: e.target.files ? e.target.files[0] : null })}
                            style={{ width: '100%', marginTop: '0.5rem' }}
                            required
                          />
                          {investmentForm.bankSlip && (
                            <span style={{ color: '#10b981', fontSize: '0.85rem', marginTop: '0.5rem', display: 'block' }}>
                              <i className="icofont-check-circled"></i> {investmentForm.bankSlip.name}
                            </span>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="bank-payment-details">
                        <div className="detail-row">
                          <span className="detail-label">Account Name</span>
                          <span className="detail-value">{paymentMethods.Bank.accountName}</span>
                        </div>
                        <div className="detail-row">
                          <span className="detail-label">Account Number</span>
                          <div className="address-box">
                            <code>{paymentMethods.Bank.accountNumber}</code>
                            <button className="copy-btn" onClick={copyPaymentAddress}>
                              {paymentCopied ? <i className="icofont-check"></i> : <i className="icofont-copy"></i>}
                            </button>
                          </div>
                        </div>
                        <div className="detail-row">
                          <span className="detail-label">Bank Name</span>
                          <span className="detail-value">{paymentMethods.Bank.bankName}</span>
                        </div>
                        <div className="detail-row">
                          <span className="detail-label">Routing Number</span>
                          <span className="detail-value">{paymentMethods.Bank.routingNumber}</span>
                        </div>
                        <div className="detail-row">
                          <span className="detail-label">SWIFT Code</span>
                          <span className="detail-value">{paymentMethods.Bank.swiftCode}</span>
                        </div>
                        <div className="detail-row" style={{ marginTop: '1.5rem' }}>
                          <span className="detail-label">Transaction Reference <span style={{ color: '#ef4444' }}>*</span></span>
                          <input
                            type="text"
                            className="modal-input"
                            placeholder="Enter transaction reference/ID"
                            value={investmentForm.transactionHash}
                            onChange={e => setInvestmentForm({ ...investmentForm, transactionHash: e.target.value })}
                            style={{ width: '100%', marginTop: '0.5rem' }}
                            required
                          />
                        </div>
                        <div className="detail-row" style={{ marginTop: '1.5rem' }}>
                          <span className="detail-label">Upload Payment Proof <span style={{ color: '#ef4444' }}>*</span></span>
                          <input
                            type="file"
                            accept="image/*"
                            className="modal-input"
                            onChange={e => setInvestmentForm({ ...investmentForm, bankSlip: e.target.files ? e.target.files[0] : null })}
                            style={{ width: '100%', marginTop: '0.5rem' }}
                            required
                          />
                          {investmentForm.bankSlip && (
                            <span style={{ color: '#10b981', fontSize: '0.85rem', marginTop: '0.5rem', display: 'block' }}>
                              <i className="icofont-check-circled"></i> {investmentForm.bankSlip.name}
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    <div className="payment-notes">
                      <h4><i className="icofont-info-circle"></i> Notes</h4>
                      <ul>
                        <li>Send the exact amount specified above</li>
                        <li>Your investment will be activated after payment confirmation</li>
                        <li>Contact support if you have any issues</li>
                      </ul>
                    </div>
                  </div>
                </div>

                <div className="modal-footer">
                  <button className="btn-secondary" onClick={handleInvestmentBack}>
                    <i className="icofont-arrow-left"></i> Back
                  </button>
                  <button className="btn-primary" onClick={handleSubmitInvestment} disabled={isInvestmentSubmitting}>
                    <i className={isInvestmentSubmitting ? 'icofont-spinner-alt-3' : 'icofont-check'}></i> {isInvestmentSubmitting ? 'Submitting...' : 'Submit Investment'}
                  </button>
                </div>
              </div>
            )}

            {/* Step 4: Success */}
            {investmentStep === 'success' && (
              <div className="modal-content">
                <div className="modal-header" style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '4rem', color: '#10b981', marginBottom: '1rem' }}>
                    <i className="icofont-check-circled"></i>
                  </div>
                  <h2><i className="icofont-thumbs-up"></i> Investment Submitted!</h2>
                  <p>Your investment has been successfully created and is awaiting approval</p>
                </div>

                <div className="modal-body">
                  <div className="confirmation-card" style={{ background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
                    <h3>Investment Details</h3>
                    <div className="confirm-row">
                      <span>Plan</span>
                      <strong>{selectedPlan.name}</strong>
                    </div>
                    <div className="confirm-row">
                      <span>Amount</span>
                      <strong style={{ color: '#10b981' }}>${parseFloat(investmentForm.capital).toLocaleString()}</strong>
                    </div>
                    <div className="confirm-row">
                      <span>Daily Earnings (when active)</span>
                      <strong>+${(parseFloat(investmentForm.capital) * selectedPlan.dailyRate).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/day</strong>
                    </div>
                    <div className="confirm-row">
                      <span>Duration</span>
                      <strong>{selectedPlan.durationDays} days</strong>
                    </div>
                    <div className="confirm-row">
                      <span>Status</span>
                      <strong style={{ color: '#f0b90b' }}>⏳ Pending Approval</strong>
                    </div>
                  </div>

                  <div className="info-box" style={{ marginTop: '1.5rem', background: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.2)', borderRadius: '8px', padding: '1rem' }}>
                    <h4 style={{ color: '#3b82f6', marginTop: 0 }}>What Happens Next?</h4>
                    <ul style={{ margin: '0.5rem 0', paddingLeft: '1.5rem' }}>
                      <li>Your investment is queued for admin review</li>
                      <li>Once approved, your investment will become active</li>
                      <li>You'll earn daily returns automatically credited to your account</li>
                      <li>Check the Investment History section to track status</li>
                    </ul>
                  </div>
                </div>

                <div className="modal-footer">
                  <button className="btn-primary" onClick={closeInvestmentModal} style={{ width: '100%' }}>
                    Back to Dashboard
                  </button>
                </div>
              </div>
            )}

            {/* Error Display */}
            {investmentError && (
              <div className="modal-content">
                <div className="modal-header" style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '4rem', color: '#ef4444', marginBottom: '1rem' }}>
                    <i className="icofont-error"></i>
                  </div>
                  <h2><i className="icofont-close-circled"></i> Investment Failed</h2>
                  <p>There was an error creating your investment</p>
                </div>

                <div className="modal-body">
                  <div className="error-card" style={{ background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '8px', padding: '1rem' }}>
                    <h3 style={{ color: '#ef4444', marginTop: 0 }}>Error Details</h3>
                    <p style={{ margin: 0, fontFamily: 'monospace', fontSize: '0.9rem', wordBreak: 'break-word' }}>{investmentError}</p>
                  </div>

                  <div className="info-box" style={{ marginTop: '1.5rem', background: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.2)', borderRadius: '8px', padding: '1rem' }}>
                    <h4 style={{ color: '#3b82f6', marginTop: 0 }}>What to do next?</h4>
                    <ul style={{ margin: '0.5rem 0', paddingLeft: '1.5rem' }}>
                      <li>Check your internet connection</li>
                      <li>Try again in a few moments</li>
                      <li>Contact support if the problem persists</li>
                      <li>Copy the error message above for reference</li>
                    </ul>
                  </div>
                </div>

                <div className="modal-footer">
                  <button className="btn-secondary" onClick={() => setInvestmentError(null)} style={{ marginRight: '0.5rem' }}>
                    Try Again
                  </button>
                  <button className="btn-primary" onClick={closeInvestmentModal}>
                    Close
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* KYC Verification Modal */}
      {showKycModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.85)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000,
          backdropFilter: 'blur(8px)',
          padding: '1rem'
        }}>
          <div style={{
            background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
            borderRadius: '16px',
            maxWidth: '600px',
            width: '100%',
            maxHeight: '90vh',
            overflow: 'auto',
            boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
            border: '1px solid rgba(240,185,11,0.2)'
          }}>
            {/* Modal Header */}
            <div style={{
              padding: '1.5rem',
              borderBottom: '1px solid rgba(255,255,255,0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <div>
                <h3 style={{ color: '#f8fafc', fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.25rem' }}>
                  KYC Verification
                </h3>
                <p style={{ color: '#94a3b8', fontSize: '0.875rem', margin: 0 }}>
                  Step {kycStep === 'intro' ? '1' : kycStep === 'personal' ? '2' : kycStep === 'documents' ? '3' : kycStep === 'review' ? '4' : '5'} of 5
                </p>
              </div>
              <button
                onClick={closeKycModal}
                disabled={kycSubmitting}
                style={{
                  background: 'rgba(255,255,255,0.1)',
                  border: 'none',
                  borderRadius: '8px',
                  width: '36px',
                  height: '36px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: kycSubmitting ? 'not-allowed' : 'pointer',
                  color: '#f8fafc',
                  fontSize: '1.25rem',
                  opacity: kycSubmitting ? 0.5 : 1
                }}
              >
                ×
              </button>
            </div>

            {/* Modal Body */}
            <div style={{ padding: '2rem' }}>
              {kycStep === 'intro' && (
                <div style={{ textAlign: 'center' }}>
                  <div style={{
                    width: '80px',
                    height: '80px',
                    background: 'linear-gradient(135deg, #f0b90b 0%, #f8d12f 100%)',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 1.5rem',
                    boxShadow: '0 8px 24px rgba(240,185,11,0.3)'
                  }}>
                    <i className="icofont-verification-check" style={{ fontSize: '2.5rem', color: '#0f172a' }}></i>
                  </div>
                  <h4 style={{ color: '#f8fafc', fontSize: '1.5rem', fontWeight: 600, marginBottom: '1rem' }}>
                    Verify Your Identity
                  </h4>
                  <p style={{ color: '#cbd5e1', fontSize: '1rem', lineHeight: '1.6', marginBottom: '1.5rem' }}>
                    To comply with regulations and ensure account security, we need to verify your identity.
                  </p>
                  <div style={{ textAlign: 'left', background: 'rgba(255,255,255,0.05)', borderRadius: '12px', padding: '1.5rem', marginBottom: '1.5rem' }}>
                    <h5 style={{ color: '#f0b90b', fontSize: '0.875rem', fontWeight: 600, marginBottom: '1rem', textTransform: 'uppercase' }}>
                      What You'll Need:
                    </h5>
                    <ul style={{ color: '#cbd5e1', fontSize: '0.875rem', lineHeight: '2', paddingLeft: '1.5rem', margin: 0 }}>
                      <li>Valid government-issued ID (Passport, Driver's License, or National ID)</li>
                      <li>Proof of address (Utility bill or bank statement less than 3 months old)</li>
                      <li>A clear selfie holding your ID document</li>
                      <li>5-10 minutes of your time</li>
                    </ul>
                  </div>
                  <div style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: '8px', padding: '1rem', marginBottom: '1rem' }}>
                    <small style={{ color: '#93c5fd', fontSize: '0.75rem', lineHeight: '1.5' }}>
                      <i className="icofont-lock" style={{ marginRight: '0.5rem' }}></i>
                      Your information is encrypted and securely stored. We never share your data with third parties.
                    </small>
                  </div>
                </div>
              )}

              {kycStep === 'personal' && (
                <div>
                  <h4 style={{ color: '#f8fafc', fontSize: '1.25rem', fontWeight: 600, marginBottom: '1.5rem' }}>
                    Personal Information
                  </h4>
                  <div style={{ marginBottom: '1.5rem' }}>
                    <label style={{ display: 'block', marginBottom: '0.5rem', color: '#cbd5e1', fontSize: '0.875rem', fontWeight: 500 }}>
                      ID Type <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <select
                      value={kycForm.idType}
                      onChange={(e) => setKycForm({ ...kycForm, idType: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '0.75rem',
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: '8px',
                        color: '#f8fafc',
                        fontSize: '0.875rem'
                      }}
                    >
                      <option value="passport">Passport</option>
                      <option value="drivers_license">Driver's License</option>
                      <option value="national_id">National ID Card</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.5rem', color: '#cbd5e1', fontSize: '0.875rem', fontWeight: 500 }}>
                      ID Number <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <input
                      type="text"
                      value={kycForm.idNumber}
                      onChange={(e) => setKycForm({ ...kycForm, idNumber: e.target.value })}
                      placeholder="Enter your ID number"
                      style={{
                        width: '100%',
                        padding: '0.75rem',
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: '8px',
                        color: '#f8fafc',
                        fontSize: '0.875rem'
                      }}
                    />
                  </div>
                </div>
              )}

              {kycStep === 'documents' && (
                <div>
                  <h4 style={{ color: '#f8fafc', fontSize: '1.25rem', fontWeight: 600, marginBottom: '1.5rem' }}>
                    Upload Documents
                  </h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {/* ID Document */}
                    <div>
                      <label style={{ display: 'block', marginBottom: '0.5rem', color: '#cbd5e1', fontSize: '0.875rem', fontWeight: 500 }}>
                        Identity Document <span style={{ color: '#ef4444' }}>*</span>
                      </label>
                      <div style={{
                        background: 'rgba(255,255,255,0.05)',
                        border: '2px dashed rgba(255,255,255,0.1)',
                        borderRadius: '8px',
                        padding: '1.5rem',
                        textAlign: 'center',
                        cursor: 'pointer',
                        transition: 'all 0.3s ease'
                      }}>
                        <input
                          type="file"
                          accept="image/*,.pdf"
                          onChange={(e) => handleFileUpload('idDocument', e)}
                          style={{ display: 'none' }}
                          id="kyc-id-upload"
                        />
                        <label htmlFor="kyc-id-upload" style={{ cursor: 'pointer', display: 'block' }}>
                          {kycForm.idDocument ? (
                            <div>
                              <i className="icofont-file-document" style={{ fontSize: '2rem', color: '#10b981', display: 'block', marginBottom: '0.5rem' }}></i>
                              <span style={{ color: '#10b981', fontSize: '0.875rem' }}>{kycForm.idDocument.name}</span>
                            </div>
                          ) : (
                            <div>
                              <i className="icofont-upload-alt" style={{ fontSize: '2rem', color: '#f0b90b', display: 'block', marginBottom: '0.5rem' }}></i>
                              <span style={{ display: 'block', color: '#cbd5e1', fontSize: '0.875rem' }}>Choose file or drag here</span>
                              <small style={{ color: '#64748b', fontSize: '0.75rem' }}>JPG, PNG or PDF (Max 5MB)</small>
                            </div>
                          )}
                        </label>
                      </div>
                    </div>

                    {/* Address Document */}
                    <div>
                      <label style={{ display: 'block', marginBottom: '0.5rem', color: '#cbd5e1', fontSize: '0.875rem', fontWeight: 500 }}>
                        Proof of Address <span style={{ color: '#ef4444' }}>*</span>
                      </label>
                      <div style={{
                        background: 'rgba(255,255,255,0.05)',
                        border: '2px dashed rgba(255,255,255,0.1)',
                        borderRadius: '8px',
                        padding: '1.5rem',
                        textAlign: 'center',
                        cursor: 'pointer'
                      }}>
                        <input
                          type="file"
                          accept="image/*,.pdf"
                          onChange={(e) => handleFileUpload('addressDocument', e)}
                          style={{ display: 'none' }}
                          id="kyc-address-upload"
                        />
                        <label htmlFor="kyc-address-upload" style={{ cursor: 'pointer', display: 'block' }}>
                          {kycForm.addressDocument ? (
                            <div>
                              <i className="icofont-file-document" style={{ fontSize: '2rem', color: '#10b981', display: 'block', marginBottom: '0.5rem' }}></i>
                              <span style={{ color: '#10b981', fontSize: '0.875rem' }}>{kycForm.addressDocument.name}</span>
                            </div>
                          ) : (
                            <div>
                              <i className="icofont-upload-alt" style={{ fontSize: '2rem', color: '#f0b90b', display: 'block', marginBottom: '0.5rem' }}></i>
                              <span style={{ display: 'block', color: '#cbd5e1', fontSize: '0.875rem' }}>Choose file or drag here</span>
                              <small style={{ color: '#64748b', fontSize: '0.75rem' }}>Utility bill or bank statement</small>
                            </div>
                          )}
                        </label>
                      </div>
                    </div>

                    {/* Selfie Document */}
                    <div>
                      <label style={{ display: 'block', marginBottom: '0.5rem', color: '#cbd5e1', fontSize: '0.875rem', fontWeight: 500 }}>
                        Selfie with ID <span style={{ color: '#ef4444' }}>*</span>
                      </label>
                      <div style={{
                        background: 'rgba(255,255,255,0.05)',
                        border: '2px dashed rgba(255,255,255,0.1)',
                        borderRadius: '8px',
                        padding: '1.5rem',
                        textAlign: 'center',
                        cursor: 'pointer'
                      }}>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(e) => handleFileUpload('selfieDocument', e)}
                          style={{ display: 'none' }}
                          id="kyc-selfie-upload"
                        />
                        <label htmlFor="kyc-selfie-upload" style={{ cursor: 'pointer', display: 'block' }}>
                          {kycForm.selfieDocument ? (
                            <div>
                              <i className="icofont-file-document" style={{ fontSize: '2rem', color: '#10b981', display: 'block', marginBottom: '0.5rem' }}></i>
                              <span style={{ color: '#10b981', fontSize: '0.875rem' }}>{kycForm.selfieDocument.name}</span>
                            </div>
                          ) : (
                            <div>
                              <i className="icofont-upload-alt" style={{ fontSize: '2rem', color: '#f0b90b', display: 'block', marginBottom: '0.5rem' }}></i>
                              <span style={{ display: 'block', color: '#cbd5e1', fontSize: '0.875rem' }}>Choose file or drag here</span>
                              <small style={{ color: '#64748b', fontSize: '0.75rem' }}>Clear photo holding your ID</small>
                            </div>
                          )}
                        </label>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {kycStep === 'review' && (
                <div>
                  <h4 style={{ color: '#f8fafc', fontSize: '1.25rem', fontWeight: 600, marginBottom: '1.5rem' }}>
                    Review Your Information
                  </h4>
                  <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: '12px', padding: '1.5rem', marginBottom: '1rem' }}>
                    <div style={{ marginBottom: '1rem', paddingBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                      <span style={{ color: '#94a3b8', fontSize: '0.75rem', display: 'block', marginBottom: '0.25rem' }}>ID Type</span>
                      <span style={{ color: '#f8fafc', fontSize: '0.875rem', fontWeight: 500 }}>
                        {kycForm.idType === 'passport' ? 'Passport' : kycForm.idType === 'drivers_license' ? "Driver's License" : 'National ID Card'}
                      </span>
                    </div>
                    <div style={{ marginBottom: '1rem', paddingBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                      <span style={{ color: '#94a3b8', fontSize: '0.75rem', display: 'block', marginBottom: '0.25rem' }}>ID Number</span>
                      <span style={{ color: '#f8fafc', fontSize: '0.875rem', fontWeight: 500 }}>{kycForm.idNumber}</span>
                    </div>
                    <div style={{ marginBottom: '1rem', paddingBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                      <span style={{ color: '#94a3b8', fontSize: '0.75rem', display: 'block', marginBottom: '0.25rem' }}>Documents Uploaded</span>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <i className="icofont-check-circled" style={{ color: '#10b981', fontSize: '1rem' }}></i>
                          <span style={{ color: '#cbd5e1', fontSize: '0.875rem' }}>{kycForm.idDocument?.name}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <i className="icofont-check-circled" style={{ color: '#10b981', fontSize: '1rem' }}></i>
                          <span style={{ color: '#cbd5e1', fontSize: '0.875rem' }}>{kycForm.addressDocument?.name}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <i className="icofont-check-circled" style={{ color: '#10b981', fontSize: '1rem' }}></i>
                          <span style={{ color: '#cbd5e1', fontSize: '0.875rem' }}>{kycForm.selfieDocument?.name}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: '8px', padding: '1rem' }}>
                    <small style={{ color: '#86efac', fontSize: '0.75rem', lineHeight: '1.5' }}>
                      <i className="icofont-info-circle" style={{ marginRight: '0.5rem' }}></i>
                      Please ensure all information is correct before submitting. Our team will review your documents within 24-48 hours.
                    </small>
                  </div>
                </div>
              )}

              {kycStep === 'success' && (
                <div style={{ textAlign: 'center' }}>
                  <div style={{
                    width: '80px',
                    height: '80px',
                    background: 'linear-gradient(135deg, #10b981 0%, #34d399 100%)',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 1.5rem',
                    boxShadow: '0 8px 24px rgba(16,185,129,0.3)'
                  }}>
                    <i className="icofont-check" style={{ fontSize: '2.5rem', color: '#fff' }}></i>
                  </div>
                  <h4 style={{ color: '#f8fafc', fontSize: '1.5rem', fontWeight: 600, marginBottom: '1rem' }}>
                    Documents Submitted!
                  </h4>
                  <p style={{ color: '#cbd5e1', fontSize: '1rem', lineHeight: '1.6', marginBottom: '1.5rem' }}>
                    Thank you for submitting your verification documents. Our team will review them within 24-48 hours.
                  </p>
                  <div style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: '12px', padding: '1.5rem', textAlign: 'left' }}>
                    <h5 style={{ color: '#93c5fd', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.75rem' }}>What happens next?</h5>
                    <ul style={{ color: '#cbd5e1', fontSize: '0.875rem', lineHeight: '1.8', paddingLeft: '1.5rem', margin: 0 }}>
                      <li>We'll verify your documents</li>
                      <li>You'll receive an email notification</li>
                      <li>Once approved, you can access all platform features</li>
                    </ul>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div style={{
              padding: '1.5rem',
              borderTop: '1px solid rgba(255,255,255,0.1)',
              display: 'flex',
              gap: '1rem',
              justifyContent: 'flex-end'
            }}>
              {kycStep !== 'intro' && kycStep !== 'success' && (
                <button
                  onClick={handleKycBack}
                  disabled={kycSubmitting}
                  style={{
                    padding: '0.75rem 1.5rem',
                    background: 'rgba(255,255,255,0.1)',
                    border: '1px solid rgba(255,255,255,0.2)',
                    borderRadius: '8px',
                    color: '#f8fafc',
                    fontSize: '0.875rem',
                    fontWeight: 500,
                    cursor: kycSubmitting ? 'not-allowed' : 'pointer',
                    transition: 'all 0.3s ease',
                    opacity: kycSubmitting ? 0.5 : 1
                  }}
                >
                  Back
                </button>
              )}
              {kycStep !== 'success' && (
                <button
                  onClick={handleKycNext}
                  disabled={kycSubmitting}
                  style={{
                    padding: '0.75rem 1.5rem',
                    background: 'linear-gradient(135deg, #f0b90b 0%, #f8d12f 100%)',
                    border: 'none',
                    borderRadius: '8px',
                    color: '#0f172a',
                    fontSize: '0.875rem',
                    fontWeight: 600,
                    cursor: kycSubmitting ? 'not-allowed' : 'pointer',
                    boxShadow: '0 4px 12px rgba(240,185,11,0.3)',
                    transition: 'all 0.3s ease',
                    opacity: kycSubmitting ? 0.7 : 1
                  }}
                >
                  {kycSubmitting ? 'Submitting...' : kycStep === 'review' ? 'Submit Documents' : 'Continue'}
                </button>
              )}
              {kycStep === 'success' && (
                <button
                  onClick={closeKycModal}
                  style={{
                    padding: '0.75rem 1.5rem',
                    background: 'linear-gradient(135deg, #f0b90b 0%, #f8d12f 100%)',
                    border: 'none',
                    borderRadius: '8px',
                    color: '#0f172a',
                    fontSize: '0.875rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    boxShadow: '0 4px 12px rgba(240,185,11,0.3)'
                  }}
                >
                  Close
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* KYC Verification Modal */}
      {/* Withdrawal Modal */}
      {showWithdrawalModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.85)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000,
          backdropFilter: 'blur(8px)',
          padding: '1rem'
        }}>
          <div style={{
            background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
            borderRadius: '16px',
            maxWidth: '600px',
            width: '100%',
            maxHeight: '90vh',
            overflow: 'auto',
            boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
            border: '1px solid rgba(240,185,11,0.2)'
          }}>
            {/* Modal Header */}
            <div style={{
              padding: '1.5rem',
              borderBottom: '1px solid rgba(255,255,255,0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <div>
                <h3 style={{ color: '#f8fafc', fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.25rem' }}>
                  Request Withdrawal
                </h3>
                <p style={{ color: '#94a3b8', fontSize: '0.875rem', margin: 0 }}>
                  Step {withdrawalStep === 'amount' ? '1' : withdrawalStep === 'method' ? '2' : withdrawalStep === 'details' ? '3' : withdrawalStep === 'confirm' ? '4' : '5'} of 5
                </p>
              </div>
              <button
                onClick={closeWithdrawalModal}
                style={{
                  background: 'rgba(255,255,255,0.1)',
                  border: 'none',
                  borderRadius: '8px',
                  width: '36px',
                  height: '36px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  color: '#f8fafc',
                  fontSize: '1.25rem'
                }}
              >
                ×
              </button>
            </div>

            {/* Modal Body */}
            <div style={{ padding: '2rem' }}>
              {/* Step 1: Amount */}
              {withdrawalStep === 'amount' && (
                <div>
                  <h4 style={{ color: '#f8fafc', fontSize: '1.25rem', fontWeight: 600, marginBottom: '1.5rem' }}>
                    Enter Withdrawal Amount
                  </h4>
                  <div style={{
                    background: 'rgba(240,185,11,0.1)',
                    border: '1px solid rgba(240,185,11,0.3)',
                    borderRadius: '12px',
                    padding: '1.5rem',
                    marginBottom: '1.5rem'
                  }}>
                    <p style={{ color: '#94a3b8', fontSize: '0.875rem', marginBottom: '0.5rem' }}>Available Balance</p>
                    <h2 style={{ color: '#f0b90b', fontSize: '2rem', fontWeight: 700, margin: 0 }}>
                      ${totalBalance.toLocaleString()}
                    </h2>
                  </div>
                  <div style={{ marginBottom: '1.5rem' }}>
                    <label style={{ display: 'block', marginBottom: '0.5rem', color: '#cbd5e1', fontSize: '0.875rem', fontWeight: 500 }}>
                      Amount (USD) <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <input
                      type="number"
                      value={withdrawalForm.amount}
                      onChange={(e) => setWithdrawalForm({ ...withdrawalForm, amount: e.target.value })}
                      placeholder="Enter amount"
                      min="50"
                      style={{
                        width: '100%',
                        padding: '0.75rem 1rem',
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: '8px',
                        color: '#f8fafc',
                        fontSize: '1rem',
                        fontWeight: 500
                      }}
                    />
                    <small style={{ color: '#94a3b8', fontSize: '0.75rem', marginTop: '0.5rem', display: 'block' }}>
                      Min: $50 | Max: $50,000 per day
                    </small>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {[100, 500, 1000, 5000].map(amount => (
                      <button
                        key={amount}
                        onClick={() => setWithdrawalForm({ ...withdrawalForm, amount: amount.toString() })}
                        style={{
                          padding: '0.5rem 1rem',
                          background: 'rgba(255,255,255,0.05)',
                          border: '1px solid rgba(255,255,255,0.1)',
                          borderRadius: '8px',
                          color: '#f0b90b',
                          fontSize: '0.875rem',
                          cursor: 'pointer',
                          fontWeight: 500
                        }}
                      >
                        ${amount.toLocaleString()}
                      </button>
                    ))}
                    <button
                      onClick={() => setWithdrawalForm({ ...withdrawalForm, amount: totalBalance.toString() })}
                      style={{
                        padding: '0.5rem 1rem',
                        background: 'rgba(240,185,11,0.1)',
                        border: '1px solid rgba(240,185,11,0.3)',
                        borderRadius: '8px',
                        color: '#f0b90b',
                        fontSize: '0.875rem',
                        cursor: 'pointer',
                        fontWeight: 600
                      }}
                    >
                      All
                    </button>
                  </div>
                </div>
              )}

              {/* Step 2: Payment Method */}
              {withdrawalStep === 'method' && (
                <div>
                  <h4 style={{ color: '#f8fafc', fontSize: '1.25rem', fontWeight: 600, marginBottom: '1.5rem' }}>
                    Select Payment Method
                  </h4>
                  <div style={{ display: 'grid', gap: '1rem' }}>
                    {['Bitcoin', 'Ethereum', 'USDT', 'Bank Transfer'].map(method => (
                      <button
                        key={method}
                        onClick={() => setWithdrawalForm({ ...withdrawalForm, method })}
                        style={{
                          padding: '1.5rem',
                          background: withdrawalForm.method === method ? 'rgba(240,185,11,0.1)' : 'rgba(255,255,255,0.03)',
                          border: withdrawalForm.method === method ? '2px solid #f0b90b' : '1px solid rgba(255,255,255,0.1)',
                          borderRadius: '12px',
                          textAlign: 'left',
                          cursor: 'pointer',
                          transition: 'all 0.3s ease',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '1rem'
                        }}
                      >
                        <div style={{
                          width: '48px',
                          height: '48px',
                          borderRadius: '50%',
                          background: 'rgba(240,185,11,0.2)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '1.5rem',
                          color: '#f0b90b'
                        }}>
                          {method === 'Bitcoin' ? '₿' : method === 'Ethereum' ? 'Ξ' : method === 'USDT' ? '₮' : '🏦'}
                        </div>
                        <div>
                          <div style={{ color: '#f8fafc', fontWeight: 600, fontSize: '1rem' }}>{method}</div>
                          <div style={{ color: '#94a3b8', fontSize: '0.875rem' }}>
                            {method === 'Bank Transfer' ? '1-2 business days' : 'Instant transfer'}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Step 3: Details */}
              {withdrawalStep === 'details' && (
                <div>
                  <h4 style={{ color: '#f8fafc', fontSize: '1.25rem', fontWeight: 600, marginBottom: '1.5rem' }}>
                    {withdrawalForm.method === 'Bank Transfer' ? 'Bank Account Details' : 'Wallet Details'}
                  </h4>
                  {withdrawalForm.method === 'Bank Transfer' ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                      <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem', color: '#cbd5e1', fontSize: '0.875rem', fontWeight: 500 }}>
                          Bank Name <span style={{ color: '#ef4444' }}>*</span>
                        </label>
                        <input
                          type="text"
                          value={withdrawalForm.bankName}
                          onChange={(e) => setWithdrawalForm({ ...withdrawalForm, bankName: e.target.value })}
                          placeholder="Enter bank name"
                          style={{
                            width: '100%',
                            padding: '0.75rem',
                            background: 'rgba(255,255,255,0.05)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '8px',
                            color: '#f8fafc',
                            fontSize: '0.875rem'
                          }}
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem', color: '#cbd5e1', fontSize: '0.875rem', fontWeight: 500 }}>
                          Account Name <span style={{ color: '#ef4444' }}>*</span>
                        </label>
                        <input
                          type="text"
                          value={withdrawalForm.accountName}
                          onChange={(e) => setWithdrawalForm({ ...withdrawalForm, accountName: e.target.value })}
                          placeholder="Enter account holder name"
                          style={{
                            width: '100%',
                            padding: '0.75rem',
                            background: 'rgba(255,255,255,0.05)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '8px',
                            color: '#f8fafc',
                            fontSize: '0.875rem'
                          }}
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem', color: '#cbd5e1', fontSize: '0.875rem', fontWeight: 500 }}>
                          Account Number <span style={{ color: '#ef4444' }}>*</span>
                        </label>
                        <input
                          type="text"
                          value={withdrawalForm.accountNumber}
                          onChange={(e) => setWithdrawalForm({ ...withdrawalForm, accountNumber: e.target.value })}
                          placeholder="Enter account number"
                          style={{
                            width: '100%',
                            padding: '0.75rem',
                            background: 'rgba(255,255,255,0.05)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '8px',
                            color: '#f8fafc',
                            fontSize: '0.875rem'
                          }}
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem', color: '#cbd5e1', fontSize: '0.875rem', fontWeight: 500 }}>
                          Routing Number
                        </label>
                        <input
                          type="text"
                          value={withdrawalForm.routingNumber}
                          onChange={(e) => setWithdrawalForm({ ...withdrawalForm, routingNumber: e.target.value })}
                          placeholder="Enter routing number (optional)"
                          style={{
                            width: '100%',
                            padding: '0.75rem',
                            background: 'rgba(255,255,255,0.05)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '8px',
                            color: '#f8fafc',
                            fontSize: '0.875rem'
                          }}
                        />
                      </div>
                    </div>
                  ) : (
                    <div>
                      <label style={{ display: 'block', marginBottom: '0.5rem', color: '#cbd5e1', fontSize: '0.875rem', fontWeight: 500 }}>
                        Wallet Address <span style={{ color: '#ef4444' }}>*</span>
                      </label>
                      <input
                        type="text"
                        value={withdrawalForm.walletAddress}
                        onChange={(e) => setWithdrawalForm({ ...withdrawalForm, walletAddress: e.target.value })}
                        placeholder={`Enter your ${withdrawalForm.method} wallet address`}
                        style={{
                          width: '100%',
                          padding: '0.75rem',
                          background: 'rgba(255,255,255,0.05)',
                          border: '1px solid rgba(255,255,255,0.1)',
                          borderRadius: '8px',
                          color: '#f8fafc',
                          fontSize: '0.875rem',
                          fontFamily: 'monospace'
                        }}
                      />
                      <small style={{ color: '#94a3b8', fontSize: '0.75rem', marginTop: '0.5rem', display: 'block' }}>
                        Make sure to double-check your wallet address. Transactions cannot be reversed.
                      </small>
                    </div>
                  )}
                </div>
              )}

              {/* Step 4: Confirm */}
              {withdrawalStep === 'confirm' && (
                <div>
                  <h4 style={{ color: '#f8fafc', fontSize: '1.25rem', fontWeight: 600, marginBottom: '1.5rem' }}>
                    Confirm Withdrawal Request
                  </h4>
                  <div style={{
                    background: 'rgba(255,255,255,0.05)',
                    borderRadius: '12px',
                    padding: '1.5rem',
                    marginBottom: '1rem'
                  }}>
                    <div style={{ marginBottom: '1rem', paddingBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                      <span style={{ color: '#94a3b8', fontSize: '0.75rem', display: 'block', marginBottom: '0.25rem' }}>Amount</span>
                      <span style={{ color: '#f8fafc', fontSize: '1.5rem', fontWeight: 700 }}>${parseFloat(withdrawalForm.amount).toLocaleString()}</span>
                    </div>
                    <div style={{ marginBottom: '1rem', paddingBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                      <span style={{ color: '#94a3b8', fontSize: '0.75rem', display: 'block', marginBottom: '0.25rem' }}>Payment Method</span>
                      <span style={{ color: '#f8fafc', fontSize: '0.875rem', fontWeight: 500 }}>{withdrawalForm.method}</span>
                    </div>
                    {withdrawalForm.method === 'Bank Transfer' ? (
                      <>
                        <div style={{ marginBottom: '1rem', paddingBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                          <span style={{ color: '#94a3b8', fontSize: '0.75rem', display: 'block', marginBottom: '0.25rem' }}>Bank Name</span>
                          <span style={{ color: '#f8fafc', fontSize: '0.875rem', fontWeight: 500 }}>{withdrawalForm.bankName}</span>
                        </div>
                        <div style={{ marginBottom: '1rem', paddingBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                          <span style={{ color: '#94a3b8', fontSize: '0.75rem', display: 'block', marginBottom: '0.25rem' }}>Account Name</span>
                          <span style={{ color: '#f8fafc', fontSize: '0.875rem', fontWeight: 500 }}>{withdrawalForm.accountName}</span>
                        </div>
                        <div style={{ marginBottom: '1rem', paddingBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                          <span style={{ color: '#94a3b8', fontSize: '0.75rem', display: 'block', marginBottom: '0.25rem' }}>Account Number</span>
                          <span style={{ color: '#f8fafc', fontSize: '0.875rem', fontWeight: 500 }}>{withdrawalForm.accountNumber}</span>
                        </div>
                      </>
                    ) : (
                      <div style={{ marginBottom: '1rem' }}>
                        <span style={{ color: '#94a3b8', fontSize: '0.75rem', display: 'block', marginBottom: '0.25rem' }}>Wallet Address</span>
                        <span style={{ color: '#f8fafc', fontSize: '0.75rem', fontFamily: 'monospace', wordBreak: 'break-all' }}>{withdrawalForm.walletAddress}</span>
                      </div>
                    )}
                  </div>
                  <div style={{
                    background: 'rgba(251,191,36,0.1)',
                    border: '1px solid rgba(251,191,36,0.3)',
                    borderRadius: '8px',
                    padding: '1rem'
                  }}>
                    <small style={{ color: '#fbbf24', fontSize: '0.75rem', lineHeight: '1.5' }}>
                      <i className="icofont-warning" style={{ marginRight: '0.5rem' }}></i>
                      Your withdrawal will be reviewed within 2-4 hours. Funds will be transferred to your {withdrawalForm.method === 'Bank Transfer' ? 'bank account' : 'wallet'} within 24 hours after approval.
                    </small>
                  </div>
                </div>
              )}

              {/* Step 5: Success */}
              {withdrawalStep === 'success' && (
                <div style={{ textAlign: 'center' }}>
                  <div style={{
                    width: '80px',
                    height: '80px',
                    background: 'linear-gradient(135deg, #10b981 0%, #34d399 100%)',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 1.5rem',
                    boxShadow: '0 8px 24px rgba(16,185,129,0.3)'
                  }}>
                    <i className="icofont-check" style={{ fontSize: '2.5rem', color: '#fff' }}></i>
                  </div>
                  <h4 style={{ color: '#f8fafc', fontSize: '1.5rem', fontWeight: 600, marginBottom: '1rem' }}>
                    Withdrawal Requested!
                  </h4>
                  <p style={{ color: '#cbd5e1', fontSize: '1rem', lineHeight: '1.6', marginBottom: '1.5rem' }}>
                    Your withdrawal request of <strong style={{ color: '#f0b90b' }}>${parseFloat(withdrawalForm.amount).toLocaleString()}</strong> has been submitted successfully.
                  </p>
                  <div style={{
                    background: 'rgba(59,130,246,0.1)',
                    border: '1px solid rgba(59,130,246,0.3)',
                    borderRadius: '12px',
                    padding: '1.5rem',
                    textAlign: 'left',
                    marginBottom: '1rem'
                  }}>
                    <h5 style={{ color: '#93c5fd', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.75rem' }}>What's Next?</h5>
                    <ul style={{ color: '#cbd5e1', fontSize: '0.875rem', lineHeight: '1.8', paddingLeft: '1.5rem', margin: 0 }}>
                      <li>Our team will review your request (2-4 hours)</li>
                      <li>You'll receive an email notification once approved</li>
                      <li>Funds will be transferred within 24 hours</li>
                      <li>Check your withdrawal history for status updates</li>
                    </ul>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div style={{
              padding: '1.5rem',
              borderTop: '1px solid rgba(255,255,255,0.1)',
              display: 'flex',
              gap: '1rem',
              justifyContent: 'flex-end'
            }}>
              {withdrawalStep !== 'amount' && withdrawalStep !== 'success' && (
                <button
                  onClick={handleWithdrawalBack}
                  disabled={withdrawalLoading}
                  style={{
                    padding: '0.75rem 1.5rem',
                    background: 'rgba(255,255,255,0.1)',
                    border: '1px solid rgba(255,255,255,0.2)',
                    borderRadius: '8px',
                    color: '#f8fafc',
                    fontSize: '0.875rem',
                    fontWeight: 500,
                    cursor: withdrawalLoading ? 'not-allowed' : 'pointer',
                    opacity: withdrawalLoading ? 0.6 : 1
                  }}
                >
                  Back
                </button>
              )}
              {withdrawalStep !== 'success' && (
                <button
                  onClick={handleWithdrawalNext}
                  disabled={withdrawalLoading}
                  style={{
                    padding: '0.75rem 1.5rem',
                    background: withdrawalLoading ? 'rgba(240,185,11,0.55)' : 'linear-gradient(135deg, #f0b90b 0%, #f8d12f 100%)',
                    border: 'none',
                    borderRadius: '8px',
                    color: '#0f172a',
                    fontSize: '0.875rem',
                    fontWeight: 600,
                    cursor: withdrawalLoading ? 'not-allowed' : 'pointer',
                    boxShadow: '0 4px 12px rgba(240,185,11,0.3)'
                  }}
                >
                  {withdrawalLoading ? 'Submitting...' : withdrawalStep === 'confirm' ? 'Submit Request' : 'Continue'}
                </button>
              )}
              {withdrawalStep === 'success' && (
                <button
                  onClick={closeWithdrawalModal}
                  style={{
                    padding: '0.75rem 1.5rem',
                    background: 'linear-gradient(135deg, #f0b90b 0%, #f8d12f 100%)',
                    border: 'none',
                    borderRadius: '8px',
                    color: '#0f172a',
                    fontSize: '0.875rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    boxShadow: '0 4px 12px rgba(240,185,11,0.3)'
                  }}
                >
                  Close
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Loan Modal */}
      {showLoanModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.85)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000,
          backdropFilter: 'blur(8px)',
          padding: '1rem'
        }}>
          <div style={{
            background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
            borderRadius: '16px',
            maxWidth: '600px',
            width: '100%',
            maxHeight: '90vh',
            overflow: 'auto',
            boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
            border: '1px solid rgba(59,130,246,0.3)'
          }}>
            {/* Modal Header */}
            <div style={{
              padding: '1.5rem',
              borderBottom: '1px solid rgba(255,255,255,0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <div>
                <h3 style={{ color: '#f8fafc', fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.25rem' }}>
                  Loan Application
                </h3>
                <p style={{ color: '#94a3b8', fontSize: '0.875rem', margin: 0 }}>
                  Step {loanStep === 'personal' ? '1' : loanStep === 'work' ? '2' : loanStep === 'financial' ? '3' : loanStep === 'confirm' ? '4' : '5'} of 5
                </p>
              </div>
              <button
                onClick={closeLoanModal}
                style={{
                  background: 'rgba(255,255,255,0.1)',
                  border: 'none',
                  borderRadius: '8px',
                  width: '36px',
                  height: '36px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  color: '#f8fafc',
                  fontSize: '1.25rem'
                }}
              >
                ×
              </button>
            </div>

            {/* Modal Body */}
            <div style={{ padding: '2rem' }}>
              {/* Step 1: Personal Information */}
              {loanStep === 'personal' && (
                <div>
                  <h4 style={{ color: '#f8fafc', fontSize: '1.25rem', fontWeight: 600, marginBottom: '1.5rem' }}>
                    Personal Information
                  </h4>
                  <div style={{ display: 'grid', gap: '1rem' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                      <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem', color: '#cbd5e1', fontSize: '0.875rem', fontWeight: 500 }}>
                          Full Name <span style={{ color: '#ef4444' }}>*</span>
                        </label>
                        <input
                          type="text"
                          value={loanForm.fullName}
                          onChange={(e) => setLoanForm({ ...loanForm, fullName: e.target.value })}
                          placeholder="Enter your full name"
                          style={{
                            width: '100%',
                            padding: '0.75rem',
                            background: 'rgba(255,255,255,0.05)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '8px',
                            color: '#f8fafc',
                            fontSize: '0.875rem'
                          }}
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem', color: '#cbd5e1', fontSize: '0.875rem', fontWeight: 500 }}>
                          Date of Birth <span style={{ color: '#ef4444' }}>*</span>
                        </label>
                        <input
                          type="date"
                          value={loanForm.dateOfBirth}
                          onChange={(e) => setLoanForm({ ...loanForm, dateOfBirth: e.target.value })}
                          style={{
                            width: '100%',
                            padding: '0.75rem',
                            background: 'rgba(255,255,255,0.05)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '8px',
                            color: '#f8fafc',
                            fontSize: '0.875rem'
                          }}
                        />
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                      <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem', color: '#cbd5e1', fontSize: '0.875rem', fontWeight: 500 }}>
                          Phone Number <span style={{ color: '#ef4444' }}>*</span>
                        </label>
                        <input
                          type="tel"
                          value={loanForm.phoneNumber}
                          onChange={(e) => setLoanForm({ ...loanForm, phoneNumber: e.target.value })}
                          placeholder="+1 (555) 123-4567"
                          style={{
                            width: '100%',
                            padding: '0.75rem',
                            background: 'rgba(255,255,255,0.05)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '8px',
                            color: '#f8fafc',
                            fontSize: '0.875rem'
                          }}
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem', color: '#cbd5e1', fontSize: '0.875rem', fontWeight: 500 }}>
                          Marital Status
                        </label>
                        <select
                          value={loanForm.maritalStatus}
                          onChange={(e) => setLoanForm({ ...loanForm, maritalStatus: e.target.value })}
                          style={{
                            width: '100%',
                            padding: '0.75rem',
                            background: 'rgba(255,255,255,0.05)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '8px',
                            color: '#f8fafc',
                            fontSize: '0.875rem'
                          }}
                        >
                          <option value="">Select status</option>
                          <option value="single">Single</option>
                          <option value="married">Married</option>
                          <option value="divorced">Divorced</option>
                          <option value="widowed">Widowed</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label style={{ display: 'block', marginBottom: '0.5rem', color: '#cbd5e1', fontSize: '0.875rem', fontWeight: 500 }}>
                        Address <span style={{ color: '#ef4444' }}>*</span>
                      </label>
                      <input
                        type="text"
                        value={loanForm.address}
                        onChange={(e) => setLoanForm({ ...loanForm, address: e.target.value })}
                        placeholder="Street address"
                        style={{
                          width: '100%',
                          padding: '0.75rem',
                          background: 'rgba(255,255,255,0.05)',
                          border: '1px solid rgba(255,255,255,0.1)',
                          borderRadius: '8px',
                          color: '#f8fafc',
                          fontSize: '0.875rem'
                        }}
                      />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                      <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem', color: '#cbd5e1', fontSize: '0.875rem', fontWeight: 500 }}>
                          City <span style={{ color: '#ef4444' }}>*</span>
                        </label>
                        <input
                          type="text"
                          value={loanForm.city}
                          onChange={(e) => setLoanForm({ ...loanForm, city: e.target.value })}
                          placeholder="City"
                          style={{
                            width: '100%',
                            padding: '0.75rem',
                            background: 'rgba(255,255,255,0.05)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '8px',
                            color: '#f8fafc',
                            fontSize: '0.875rem'
                          }}
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem', color: '#cbd5e1', fontSize: '0.875rem', fontWeight: 500 }}>
                          Country <span style={{ color: '#ef4444' }}>*</span>
                        </label>
                        <input
                          type="text"
                          value={loanForm.country}
                          onChange={(e) => setLoanForm({ ...loanForm, country: e.target.value })}
                          placeholder="Country"
                          style={{
                            width: '100%',
                            padding: '0.75rem',
                            background: 'rgba(255,255,255,0.05)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '8px',
                            color: '#f8fafc',
                            fontSize: '0.875rem'
                          }}
                        />
                      </div>
                    </div>
                    <div>
                      <label style={{ display: 'block', marginBottom: '0.5rem', color: '#cbd5e1', fontSize: '0.875rem', fontWeight: 500 }}>
                        Number of Dependents
                      </label>
                      <input
                        type="number"
                        value={loanForm.dependents}
                        onChange={(e) => setLoanForm({ ...loanForm, dependents: e.target.value })}
                        placeholder="0"
                        min="0"
                        style={{
                          width: '100%',
                          padding: '0.75rem',
                          background: 'rgba(255,255,255,0.05)',
                          border: '1px solid rgba(255,255,255,0.1)',
                          borderRadius: '8px',
                          color: '#f8fafc',
                          fontSize: '0.875rem'
                        }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Step 2: Work Information */}
              {loanStep === 'work' && (
                <div>
                  <h4 style={{ color: '#f8fafc', fontSize: '1.25rem', fontWeight: 600, marginBottom: '1.5rem' }}>
                    Employment Information
                  </h4>
                  <div style={{ display: 'grid', gap: '1rem' }}>
                    <div>
                      <label style={{ display: 'block', marginBottom: '0.5rem', color: '#cbd5e1', fontSize: '0.875rem', fontWeight: 500 }}>
                        Employment Status <span style={{ color: '#ef4444' }}>*</span>
                      </label>
                      <select
                        value={loanForm.employmentStatus}
                        onChange={(e) => setLoanForm({ ...loanForm, employmentStatus: e.target.value })}
                        style={{
                          width: '100%',
                          padding: '0.75rem',
                          background: 'rgba(255,255,255,0.05)',
                          border: '1px solid rgba(255,255,255,0.1)',
                          borderRadius: '8px',
                          color: '#f8fafc',
                          fontSize: '0.875rem'
                        }}
                      >
                        <option value="">Select employment status</option>
                        <option value="employed">Employed (Full-time)</option>
                        <option value="self-employed">Self-Employed</option>
                        <option value="part-time">Part-time</option>
                        <option value="unemployed">Unemployed</option>
                        <option value="retired">Retired</option>
                        <option value="student">Student</option>
                      </select>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                      <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem', color: '#cbd5e1', fontSize: '0.875rem', fontWeight: 500 }}>
                          Employer Name <span style={{ color: '#ef4444' }}>*</span>
                        </label>
                        <input
                          type="text"
                          value={loanForm.employerName}
                          onChange={(e) => setLoanForm({ ...loanForm, employerName: e.target.value })}
                          placeholder="Company name"
                          style={{
                            width: '100%',
                            padding: '0.75rem',
                            background: 'rgba(255,255,255,0.05)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '8px',
                            color: '#f8fafc',
                            fontSize: '0.875rem'
                          }}
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem', color: '#cbd5e1', fontSize: '0.875rem', fontWeight: 500 }}>
                          Job Title <span style={{ color: '#ef4444' }}>*</span>
                        </label>
                        <input
                          type="text"
                          value={loanForm.jobTitle}
                          onChange={(e) => setLoanForm({ ...loanForm, jobTitle: e.target.value })}
                          placeholder="Your position"
                          style={{
                            width: '100%',
                            padding: '0.75rem',
                            background: 'rgba(255,255,255,0.05)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '8px',
                            color: '#f8fafc',
                            fontSize: '0.875rem'
                          }}
                        />
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                      <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem', color: '#cbd5e1', fontSize: '0.875rem', fontWeight: 500 }}>
                          Monthly Income <span style={{ color: '#ef4444' }}>*</span>
                        </label>
                        <input
                          type="number"
                          value={loanForm.monthlyIncome}
                          onChange={(e) => setLoanForm({ ...loanForm, monthlyIncome: e.target.value })}
                          placeholder="5000"
                          min="0"
                          style={{
                            width: '100%',
                            padding: '0.75rem',
                            background: 'rgba(255,255,255,0.05)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '8px',
                            color: '#f8fafc',
                            fontSize: '0.875rem'
                          }}
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem', color: '#cbd5e1', fontSize: '0.875rem', fontWeight: 500 }}>
                          Work Experience (Years) <span style={{ color: '#ef4444' }}>*</span>
                        </label>
                        <input
                          type="number"
                          value={loanForm.workExperience}
                          onChange={(e) => setLoanForm({ ...loanForm, workExperience: e.target.value })}
                          placeholder="5"
                          min="0"
                          style={{
                            width: '100%',
                            padding: '0.75rem',
                            background: 'rgba(255,255,255,0.05)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '8px',
                            color: '#f8fafc',
                            fontSize: '0.875rem'
                          }}
                        />
                      </div>
                    </div>
                    <div>
                      <label style={{ display: 'block', marginBottom: '0.5rem', color: '#cbd5e1', fontSize: '0.875rem', fontWeight: 500 }}>
                        Employer Phone Number
                      </label>
                      <input
                        type="tel"
                        value={loanForm.employerPhone}
                        onChange={(e) => setLoanForm({ ...loanForm, employerPhone: e.target.value })}
                        placeholder="+1 (555) 123-4567"
                        style={{
                          width: '100%',
                          padding: '0.75rem',
                          background: 'rgba(255,255,255,0.05)',
                          border: '1px solid rgba(255,255,255,0.1)',
                          borderRadius: '8px',
                          color: '#f8fafc',
                          fontSize: '0.875rem'
                        }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', marginBottom: '0.5rem', color: '#cbd5e1', fontSize: '0.875rem', fontWeight: 500 }}>
                        Employer Address
                      </label>
                      <input
                        type="text"
                        value={loanForm.employerAddress}
                        onChange={(e) => setLoanForm({ ...loanForm, employerAddress: e.target.value })}
                        placeholder="Company address"
                        style={{
                          width: '100%',
                          padding: '0.75rem',
                          background: 'rgba(255,255,255,0.05)',
                          border: '1px solid rgba(255,255,255,0.1)',
                          borderRadius: '8px',
                          color: '#f8fafc',
                          fontSize: '0.875rem'
                        }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Step 3: Financial Information */}
              {loanStep === 'financial' && (
                <div>
                  <h4 style={{ color: '#f8fafc', fontSize: '1.25rem', fontWeight: 600, marginBottom: '1.5rem' }}>
                    Financial Information & Loan Details
                  </h4>
                  <div style={{ display: 'grid', gap: '1rem' }}>
                    <div style={{
                      background: 'rgba(59,130,246,0.1)',
                      border: '1px solid rgba(59,130,246,0.3)',
                      borderRadius: '12px',
                      padding: '1.5rem',
                      marginBottom: '1rem'
                    }}>
                      <p style={{ color: '#94a3b8', fontSize: '0.875rem', marginBottom: '0.5rem' }}>Maximum Available Loan</p>
                      <h2 style={{ color: '#60a5fa', fontSize: '2rem', fontWeight: 700, margin: 0 }}>
                        ${(totalCapital * 0.5).toLocaleString()}
                      </h2>
                      <p style={{ color: '#94a3b8', fontSize: '0.75rem', marginTop: '0.25rem' }}>Based on 50% of your total investment</p>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                      <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem', color: '#cbd5e1', fontSize: '0.875rem', fontWeight: 500 }}>
                          Monthly Expenses <span style={{ color: '#ef4444' }}>*</span>
                        </label>
                        <input
                          type="number"
                          value={loanForm.monthlyExpenses}
                          onChange={(e) => setLoanForm({ ...loanForm, monthlyExpenses: e.target.value })}
                          placeholder="2000"
                          min="0"
                          style={{
                            width: '100%',
                            padding: '0.75rem',
                            background: 'rgba(255,255,255,0.05)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '8px',
                            color: '#f8fafc',
                            fontSize: '0.875rem'
                          }}
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem', color: '#cbd5e1', fontSize: '0.875rem', fontWeight: 500 }}>
                          Other Monthly Income
                        </label>
                        <input
                          type="number"
                          value={loanForm.otherIncome}
                          onChange={(e) => setLoanForm({ ...loanForm, otherIncome: e.target.value })}
                          placeholder="500"
                          min="0"
                          style={{
                            width: '100%',
                            padding: '0.75rem',
                            background: 'rgba(255,255,255,0.05)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '8px',
                            color: '#f8fafc',
                            fontSize: '0.875rem'
                          }}
                        />
                      </div>
                    </div>

                    <div>
                      <label style={{ display: 'block', marginBottom: '0.5rem', color: '#cbd5e1', fontSize: '0.875rem', fontWeight: 500 }}>
                        Existing Debts
                      </label>
                      <input
                        type="number"
                        value={loanForm.existingDebts}
                        onChange={(e) => setLoanForm({ ...loanForm, existingDebts: e.target.value })}
                        placeholder="0"
                        min="0"
                        style={{
                          width: '100%',
                          padding: '0.75rem',
                          background: 'rgba(255,255,255,0.05)',
                          border: '1px solid rgba(255,255,255,0.1)',
                          borderRadius: '8px',
                          color: '#f8fafc',
                          fontSize: '0.875rem'
                        }}
                      />
                    </div>

                    <div>
                      <label style={{ display: 'block', marginBottom: '0.5rem', color: '#cbd5e1', fontSize: '0.875rem', fontWeight: 500 }}>
                        Loan Amount (USD) <span style={{ color: '#ef4444' }}>*</span>
                      </label>
                      <input
                        type="number"
                        value={loanForm.amount}
                        onChange={(e) => setLoanForm({ ...loanForm, amount: e.target.value })}
                        placeholder="Enter loan amount"
                        min="100"
                        max={totalCapital * 0.5}
                        style={{
                          width: '100%',
                          padding: '0.75rem 1rem',
                          background: 'rgba(255,255,255,0.05)',
                          border: '1px solid rgba(255,255,255,0.1)',
                          borderRadius: '8px',
                          color: '#f8fafc',
                          fontSize: '1rem',
                          fontWeight: 500
                        }}
                      />
                      <small style={{ color: '#94a3b8', fontSize: '0.75rem', marginTop: '0.5rem', display: 'block' }}>
                        Min: $100 | Max: ${(totalCapital * 0.5).toLocaleString()}
                      </small>
                    </div>

                    <div>
                      <label style={{ display: 'block', marginBottom: '0.5rem', color: '#cbd5e1', fontSize: '0.875rem', fontWeight: 500 }}>
                        Loan Duration <span style={{ color: '#ef4444' }}>*</span>
                      </label>
                      <div style={{ display: 'grid', gap: '0.5rem' }}>
                        {[
                          { value: '30', label: '30 Days', interest: '5%' },
                          { value: '60', label: '60 Days', interest: '10%' },
                          { value: '90', label: '90 Days', interest: '15%' }
                        ].map(option => (
                          <button
                            key={option.value}
                            onClick={() => setLoanForm({ ...loanForm, duration: option.value })}
                            style={{
                              padding: '1rem',
                              background: loanForm.duration === option.value ? 'rgba(59,130,246,0.1)' : 'rgba(255,255,255,0.03)',
                              border: loanForm.duration === option.value ? '2px solid #60a5fa' : '1px solid rgba(255,255,255,0.1)',
                              borderRadius: '8px',
                              textAlign: 'left',
                              cursor: 'pointer',
                              transition: 'all 0.3s ease'
                            }}
                          >
                            <div style={{ color: '#f8fafc', fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.25rem' }}>{option.label}</div>
                            <div style={{ color: '#94a3b8', fontSize: '0.75rem' }}>Interest Rate: {option.interest}</div>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label style={{ display: 'block', marginBottom: '0.5rem', color: '#cbd5e1', fontSize: '0.875rem', fontWeight: 500 }}>
                        Loan Purpose <span style={{ color: '#ef4444' }}>*</span>
                      </label>
                      <textarea
                        value={loanForm.purpose}
                        onChange={(e) => setLoanForm({ ...loanForm, purpose: e.target.value })}
                        placeholder="Please describe how you plan to use this loan..."
                        rows={3}
                        style={{
                          width: '100%',
                          padding: '0.75rem',
                          background: 'rgba(255,255,255,0.05)',
                          border: '1px solid rgba(255,255,255,0.1)',
                          borderRadius: '8px',
                          color: '#f8fafc',
                          fontSize: '0.875rem',
                          resize: 'vertical'
                        }}
                      />
                    </div>

                    <div>
                      <label style={{ display: 'block', marginBottom: '0.5rem', color: '#cbd5e1', fontSize: '0.875rem', fontWeight: 500 }}>
                        Collateral (Optional)
                      </label>
                      <input
                        type="text"
                        value={loanForm.collateral}
                        onChange={(e) => setLoanForm({ ...loanForm, collateral: e.target.value })}
                        placeholder="Any assets you can offer as collateral"
                        style={{
                          width: '100%',
                          padding: '0.75rem',
                          background: 'rgba(255,255,255,0.05)',
                          border: '1px solid rgba(255,255,255,0.1)',
                          borderRadius: '8px',
                          color: '#f8fafc',
                          fontSize: '0.875rem'
                        }}
                      />
                    </div>

                    {loanForm.amount && parseFloat(loanForm.amount) >= 100 && (
                      <div style={{
                        background: 'rgba(240,185,11,0.1)',
                        border: '1px solid rgba(240,185,11,0.3)',
                        borderRadius: '12px',
                        padding: '1rem'
                      }}>
                        <h5 style={{ color: '#f0b90b', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.75rem' }}>
                          Loan Calculation
                        </h5>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                          <span style={{ color: '#cbd5e1', fontSize: '0.875rem' }}>Principal:</span>
                          <span style={{ color: '#f8fafc', fontSize: '0.875rem', fontWeight: 600 }}>
                            ${parseFloat(loanForm.amount).toLocaleString()}
                          </span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                          <span style={{ color: '#cbd5e1', fontSize: '0.875rem' }}>Interest ({loanForm.duration === '30' ? '5%' : loanForm.duration === '60' ? '10%' : '15%'}):</span>
                          <span style={{ color: '#f8fafc', fontSize: '0.875rem', fontWeight: 600 }}>
                            ${(parseFloat(loanForm.amount) * (loanForm.duration === '30' ? 0.05 : loanForm.duration === '60' ? 0.10 : 0.15)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '0.75rem', borderTop: '1px solid rgba(240,185,11,0.3)' }}>
                          <span style={{ color: '#f0b90b', fontSize: '0.875rem', fontWeight: 600 }}>Total Repayment:</span>
                          <span style={{ color: '#f0b90b', fontSize: '1rem', fontWeight: 700 }}>
                            ${(parseFloat(loanForm.amount) * (loanForm.duration === '30' ? 1.05 : loanForm.duration === '60' ? 1.10 : 1.15)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Step 4: References */}
              {loanStep === 'confirm' && (
                <div>
                  <h4 style={{ color: '#f8fafc', fontSize: '1.25rem', fontWeight: 600, marginBottom: '1.5rem' }}>
                    References
                  </h4>
                  <div style={{ display: 'grid', gap: '1.5rem' }}>
                    <div style={{
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '8px',
                      padding: '1rem'
                    }}>
                      <h5 style={{ color: '#f8fafc', fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>Reference 1</h5>
                      <div style={{ display: 'grid', gap: '0.75rem' }}>
                        <input
                          type="text"
                          value={loanForm.reference1Name}
                          onChange={(e) => setLoanForm({ ...loanForm, reference1Name: e.target.value })}
                          placeholder="Full name"
                          style={{
                            width: '100%',
                            padding: '0.5rem',
                            background: 'rgba(255,255,255,0.05)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '4px',
                            color: '#f8fafc',
                            fontSize: '0.875rem'
                          }}
                        />
                        <input
                          type="tel"
                          value={loanForm.reference1Phone}
                          onChange={(e) => setLoanForm({ ...loanForm, reference1Phone: e.target.value })}
                          placeholder="Phone number"
                          style={{
                            width: '100%',
                            padding: '0.5rem',
                            background: 'rgba(255,255,255,0.05)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '4px',
                            color: '#f8fafc',
                            fontSize: '0.875rem'
                          }}
                        />
                        <input
                          type="text"
                          value={loanForm.reference1Relationship}
                          onChange={(e) => setLoanForm({ ...loanForm, reference1Relationship: e.target.value })}
                          placeholder="Relationship (e.g., friend, colleague)"
                          style={{
                            width: '100%',
                            padding: '0.5rem',
                            background: 'rgba(255,255,255,0.05)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '4px',
                            color: '#f8fafc',
                            fontSize: '0.875rem'
                          }}
                        />
                      </div>
                    </div>

                    <div style={{
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '8px',
                      padding: '1rem'
                    }}>
                      <h5 style={{ color: '#f8fafc', fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>Reference 2</h5>
                      <div style={{ display: 'grid', gap: '0.75rem' }}>
                        <input
                          type="text"
                          value={loanForm.reference2Name}
                          onChange={(e) => setLoanForm({ ...loanForm, reference2Name: e.target.value })}
                          placeholder="Full name"
                          style={{
                            width: '100%',
                            padding: '0.5rem',
                            background: 'rgba(255,255,255,0.05)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '4px',
                            color: '#f8fafc',
                            fontSize: '0.875rem'
                          }}
                        />
                        <input
                          type="tel"
                          value={loanForm.reference2Phone}
                          onChange={(e) => setLoanForm({ ...loanForm, reference2Phone: e.target.value })}
                          placeholder="Phone number"
                          style={{
                            width: '100%',
                            padding: '0.5rem',
                            background: 'rgba(255,255,255,0.05)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '4px',
                            color: '#f8fafc',
                            fontSize: '0.875rem'
                          }}
                        />
                        <input
                          type="text"
                          value={loanForm.reference2Relationship}
                          onChange={(e) => setLoanForm({ ...loanForm, reference2Relationship: e.target.value })}
                          placeholder="Relationship (e.g., family, neighbor)"
                          style={{
                            width: '100%',
                            padding: '0.5rem',
                            background: 'rgba(255,255,255,0.05)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '4px',
                            color: '#f8fafc',
                            fontSize: '0.875rem'
                          }}
                        />
                      </div>
                    </div>

                    <div style={{
                      background: 'rgba(59,130,246,0.1)',
                      border: '1px solid rgba(59,130,246,0.3)',
                      borderRadius: '8px',
                      padding: '1rem'
                    }}>
                      <small style={{ color: '#93c5fd', fontSize: '0.75rem', lineHeight: '1.5' }}>
                        <i className="icofont-info-circle" style={{ marginRight: '0.5rem' }}></i>
                        References will be contacted to verify your information. Providing accurate contact details is important for loan approval.
                      </small>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 5: Review & Submit */}
              {loanStep === 'success' && (
                <div>
                  <h4 style={{ color: '#f8fafc', fontSize: '1.25rem', fontWeight: 600, marginBottom: '1.5rem' }}>
                    Review Your Application
                  </h4>
                  <div style={{
                    background: 'rgba(255,255,255,0.05)',
                    borderRadius: '12px',
                    padding: '1.5rem',
                    marginBottom: '1rem',
                    maxHeight: '400px',
                    overflowY: 'auto'
                  }}>
                    <div style={{ display: 'grid', gap: '1rem' }}>
                      <div>
                        <h5 style={{ color: '#f8fafc', fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem' }}>Personal Information</h5>
                        <div style={{ color: '#cbd5e1', fontSize: '0.875rem', lineHeight: '1.6' }}>
                          <div>Name: {loanForm.fullName}</div>
                          <div>Phone: {loanForm.phoneNumber}</div>
                          <div>Address: {loanForm.address}, {loanForm.city}, {loanForm.country}</div>
                          {loanForm.maritalStatus && <div>Marital Status: {loanForm.maritalStatus}</div>}
                          {loanForm.dependents && <div>Dependents: {loanForm.dependents}</div>}
                        </div>
                      </div>

                      <div>
                        <h5 style={{ color: '#f8fafc', fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem' }}>Employment Information</h5>
                        <div style={{ color: '#cbd5e1', fontSize: '0.875rem', lineHeight: '1.6' }}>
                          <div>Status: {loanForm.employmentStatus}</div>
                          <div>Employer: {loanForm.employerName}</div>
                          <div>Job Title: {loanForm.jobTitle}</div>
                          <div>Monthly Income: ${loanForm.monthlyIncome}</div>
                          <div>Experience: {loanForm.workExperience} years</div>
                        </div>
                      </div>

                      <div>
                        <h5 style={{ color: '#f8fafc', fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem' }}>Financial Details</h5>
                        <div style={{ color: '#cbd5e1', fontSize: '0.875rem', lineHeight: '1.6' }}>
                          <div>Loan Amount: ${parseFloat(loanForm.amount).toLocaleString()}</div>
                          <div>Duration: {loanForm.duration} days</div>
                          <div>Monthly Expenses: ${loanForm.monthlyExpenses}</div>
                          {loanForm.otherIncome && <div>Other Income: ${loanForm.otherIncome}</div>}
                          {loanForm.existingDebts && <div>Existing Debts: ${loanForm.existingDebts}</div>}
                          <div>Purpose: {loanForm.purpose}</div>
                        </div>
                      </div>

                      <div>
                        <h5 style={{ color: '#f8fafc', fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem' }}>Loan Calculation</h5>
                        <div style={{ color: '#cbd5e1', fontSize: '0.875rem', lineHeight: '1.6' }}>
                          <div>Principal: ${parseFloat(loanForm.amount).toLocaleString()}</div>
                          <div>Interest Rate: {loanForm.duration === '30' ? '5%' : loanForm.duration === '60' ? '10%' : '15%'}</div>
                          <div>Interest Amount: ${(parseFloat(loanForm.amount) * (loanForm.duration === '30' ? 0.05 : loanForm.duration === '60' ? 0.10 : 0.15)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                          <div style={{ color: '#f0b90b', fontWeight: 600 }}>Total Repayment: ${(parseFloat(loanForm.amount) * (loanForm.duration === '30' ? 1.05 : loanForm.duration === '60' ? 1.10 : 1.15)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div style={{
                    background: 'rgba(239,68,68,0.1)',
                    border: '1px solid rgba(239,68,68,0.3)',
                    borderRadius: '8px',
                    padding: '1rem',
                    marginBottom: '1rem'
                  }}>
                    <small style={{ color: '#fca5a5', fontSize: '0.75rem', lineHeight: '1.5' }}>
                      <strong>Important:</strong> By submitting this application, you agree to repay the full amount plus interest within the specified duration. Failure to repay may result in liquidation of your investments. All information provided will be verified.
                    </small>
                  </div>
                </div>
              )}

            </div>

            {/* Modal Footer */}
            <div style={{
              padding: '1.5rem',
              borderTop: '1px solid rgba(255,255,255,0.1)',
              display: 'flex',
              gap: '1rem',
              justifyContent: 'flex-end'
            }}>
              {loanStep !== 'personal' && loanStep !== 'success' && (
                <button
                  onClick={handleLoanBack}
                  disabled={loanLoading}
                  style={{
                    padding: '0.75rem 1.5rem',
                    background: 'rgba(255,255,255,0.1)',
                    border: '1px solid rgba(255,255,255,0.2)',
                    borderRadius: '8px',
                    color: '#f8fafc',
                    fontSize: '0.875rem',
                    fontWeight: 500,
                    cursor: loanLoading ? 'not-allowed' : 'pointer',
                    opacity: loanLoading ? 0.6 : 1
                  }}
                >
                  Back
                </button>
              )}
              {loanStep !== 'success' && (
                <button
                  onClick={handleLoanNext}
                  disabled={loanLoading}
                  style={{
                    padding: '0.75rem 1.5rem',
                    background: loanLoading ? 'rgba(59,130,246,0.55)' : 'linear-gradient(135deg, #3b82f6 0%, #60a5fa 100%)',
                    border: 'none',
                    borderRadius: '8px',
                    color: '#fff',
                    fontSize: '0.875rem',
                    fontWeight: 600,
                    cursor: loanLoading ? 'not-allowed' : 'pointer',
                    boxShadow: '0 4px 12px rgba(59,130,246,0.3)'
                  }}
                >
                  {loanLoading ? 'Submitting...' : loanStep === 'confirm' ? 'Submit Application' : 'Continue'}
                </button>
              )}
              {loanStep === 'success' && (
                <button
                  onClick={closeLoanModal}
                  style={{
                    padding: '0.75rem 1.5rem',
                    background: 'linear-gradient(135deg, #10b981 0%, #34d399 100%)',
                    border: 'none',
                    borderRadius: '8px',
                    color: '#fff',
                    fontSize: '0.875rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    boxShadow: '0 4px 12px rgba(16,185,129,0.3)'
                  }}
                >
                  Close
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Notifications Modal */}
      {showNotifications && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.75)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 99999,
          animation: 'fadeIn 0.3s ease-out'
        }}>
          <div style={{
            background: 'linear-gradient(135deg, #1e293b 0%, #334155 100%)',
            borderRadius: '16px',
            padding: '2rem',
            maxWidth: '500px',
            width: '90%',
            maxHeight: '80vh',
            overflow: 'hidden',
            boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
            border: '1px solid rgba(255,255,255,0.1)'
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '1.5rem',
              borderBottom: '1px solid rgba(255,255,255,0.1)',
              paddingBottom: '1rem'
            }}>
              <h2 style={{
                color: '#f8fafc',
                fontSize: '1.5rem',
                fontWeight: 700,
                margin: 0
              }}>
                Notifications
              </h2>
              <button
                onClick={() => setShowNotifications(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#94a3b8',
                  fontSize: '1.5rem',
                  cursor: 'pointer',
                  padding: '0.25rem',
                  borderRadius: '4px',
                  transition: 'all 0.2s ease'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
              >
                <i className="icofont-close"></i>
              </button>
            </div>

            <div style={{
              maxHeight: '400px',
              overflowY: 'auto',
              marginBottom: '1.5rem'
            }}>
              {notifications.length === 0 ? (
                <div style={{
                  textAlign: 'center',
                  padding: '2rem',
                  color: '#94a3b8'
                }}>
                  <i className="icofont-notification" style={{ fontSize: '3rem', marginBottom: '1rem', display: 'block' }}></i>
                  <p>No notifications yet</p>
                </div>
              ) : (
                notifications.map((notif: Notification) => (
                  <div
                    key={notif.id}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      padding: '1rem',
                      marginBottom: '0.5rem',
                      borderRadius: '8px',
                      background: notif.read ? 'rgba(255,255,255,0.05)' : 'rgba(59,130,246,0.1)',
                      border: notif.read ? '1px solid rgba(255,255,255,0.05)' : '1px solid rgba(59,130,246,0.3)',
                      cursor: notif.read ? 'default' : 'pointer',
                      transition: 'all 0.2s ease'
                    }}
                    onClick={async () => {
                      if (!notif.read) {
                        try {
                          await supabaseDb.markNotificationAsRead(String(notif.id))
                          setNotifications((prev: Notification[]) => prev.map((n: Notification) => 
                            n.id === notif.id ? { ...n, read: true } : n
                          ))
                        } catch (error) {
                          console.log('Could not mark notification as read:', error)
                        }
                      }
                    }}
                  >
                    <div style={{
                      marginRight: '1rem',
                      marginTop: '0.25rem'
                    }}>
                      {notif.type === 'success' && <i className="icofont-check-circled" style={{ color: '#10b981', fontSize: '1.25rem' }}></i>}
                      {notif.type === 'error' && <i className="icofont-close-circled" style={{ color: '#ef4444', fontSize: '1.25rem' }}></i>}
                      {notif.type === 'warning' && <i className="icofont-warning" style={{ color: '#f59e0b', fontSize: '1.25rem' }}></i>}
                      {notif.type === 'info' && <i className="icofont-info-circle" style={{ color: '#3b82f6', fontSize: '1.25rem' }}></i>}
                      {!['success', 'error', 'warning', 'info'].includes(notif.type) && <i className="icofont-notification" style={{ color: '#94a3b8', fontSize: '1.25rem' }}></i>}
                    </div>
                    <div style={{ flex: 1 }}>
                      <h4 style={{
                        color: '#f8fafc',
                        fontSize: '0.875rem',
                        fontWeight: 600,
                        margin: '0 0 0.25rem 0'
                      }}>
                        {notif.title ? notif.title : 'Notification'}
                      </h4>
                      <p style={{
                        color: '#cbd5e1',
                        fontSize: '0.875rem',
                        lineHeight: '1.4',
                        margin: '0 0 0.5rem 0'
                      }}>
                        {notif.message}
                      </p>
                      <span style={{
                        color: '#64748b',
                        fontSize: '0.75rem'
                      }}>
                        {typeof notif.created_at === 'string' && notif.created_at ? new Date(notif.created_at).toLocaleString() : ''}
                      </span>
                    </div>
                    {!notif.read && (
                      <div style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        background: '#3b82f6',
                        marginTop: '0.5rem'
                      }}></div>
                    )}
                  </div>
                ))
              )}
            </div>

            {notifications.length > 0 && (
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <span style={{
                  color: '#94a3b8',
                  fontSize: '0.875rem'
                }}>
                  {notifications.filter((n: Notification) => !n.read).length} unread
                </span>
                <div>
                  <button
                    onClick={async () => {
                      try {
                        await supabaseDb.markAllNotificationsAsRead(currentUser?.idnum || '')
                        setNotifications(prev => prev.map(n => ({ ...n, read: true })))
                      } catch (error) {
                        console.log('Could not mark all notifications as read:', error)
                      }
                    }}
                    style={{
                      padding: '0.5rem 1rem',
                      background: 'linear-gradient(135deg, #3b82f6 0%, #60a5fa 100%)',
                      border: 'none',
                      borderRadius: '6px',
                      color: '#fff',
                      fontSize: '0.875rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      marginRight: '0.5rem',
                      transition: 'all 0.2s ease'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-1px)'}
                    onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}
                  >
                    Mark All Read
                  </button>
                  <button
                    onClick={() => setShowNotifications(false)}
                    style={{
                      padding: '0.5rem 1rem',
                      background: 'rgba(255,255,255,0.1)',
                      border: '1px solid rgba(255,255,255,0.2)',
                      borderRadius: '6px',
                      color: '#cbd5e1',
                      fontSize: '0.875rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      transition: 'all 0.2s ease'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.2)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                  >
                    Close
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {confirmModal.show && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.75)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 99998,
          animation: 'fadeIn 0.3s ease-out'
        }}>
          <div style={{
            background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
            borderRadius: '16px',
            padding: '1.5rem',
            maxWidth: '400px',
            width: '90%',
            boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
            border: '1px solid rgba(255,255,255,0.05)'
          }}>
            <div style={{
              textAlign: 'center',
              marginBottom: '2rem'
            }}>
              <div style={{
                width: '64px',
                height: '64px',
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 1rem',
                boxShadow: '0 8px 20px rgba(245,158,11,0.3)'
              }}>
                <i className="icofont-warning" style={{ fontSize: '2rem', color: '#fff' }}></i>
              </div>
              <h2 style={{
                color: '#f8fafc',
                fontSize: '1.5rem',
                fontWeight: 700,
                margin: '0 0 1rem 0'
              }}>
                {confirmModal.title}
              </h2>
              <p style={{
                color: '#cbd5e1',
                fontSize: '1rem',
                lineHeight: '1.6',
                margin: 0
              }}>
                {confirmModal.message}
              </p>
            </div>

            <div style={{
              display: 'flex',
              gap: '1rem'
            }}>
              <button
                onClick={() => {
                  confirmModal.onConfirm()
                  closeConfirm()
                }}
                style={{
                  flex: 1,
                  padding: '1rem',
                  background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                  border: 'none',
                  borderRadius: '12px',
                  color: '#fff',
                  fontSize: '1rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  boxShadow: '0 8px 20px rgba(239,68,68,0.3)',
                  transition: 'all 0.3s ease'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-2px)'
                  e.currentTarget.style.boxShadow = '0 12px 30px rgba(239,68,68,0.4)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)'
                  e.currentTarget.style.boxShadow = '0 8px 20px rgba(239,68,68,0.3)'
                }}
              >
                {confirmModal.confirmText}
              </button>
              <button
                onClick={() => {
                  if (confirmModal.onCancel) confirmModal.onCancel()
                  closeConfirm()
                }}
                style={{
                  flex: 1,
                  padding: '1rem',
                  background: 'rgba(255,255,255,0.1)',
                  border: '1px solid rgba(255,255,255,0.2)',
                  borderRadius: '12px',
                  color: '#cbd5e1',
                  fontSize: '1rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.3s ease'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.2)'
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.3)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.1)'
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'
                }}
              >
                {confirmModal.cancelText}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Alert System */}
      {modalAlert.show && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.75)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 999999,
          backdropFilter: 'blur(8px)',
          padding: '1rem',
          animation: 'fadeIn 0.3s ease'
        }}>
          <div style={{
            background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
            borderRadius: '16px',
            maxWidth: '500px',
            width: '100%',
            boxShadow: '0 25px 50px rgba(0,0,0,0.5)',
            border: `1px solid ${
              modalAlert.type === 'success' ? 'rgba(16,185,129,0.3)' :
              modalAlert.type === 'error' ? 'rgba(239,68,68,0.3)' :
              modalAlert.type === 'warning' ? 'rgba(251,191,36,0.3)' :
              'rgba(59,130,246,0.3)'
            }`,
            overflow: 'hidden',
            animation: 'slideUp 0.3s ease'
          }}>
            {/* Header with icon */}
            <div style={{
              background: modalAlert.type === 'success' ? 'linear-gradient(135deg, rgba(16,185,129,0.1) 0%, rgba(5,150,105,0.1) 100%)' :
                         modalAlert.type === 'error' ? 'linear-gradient(135deg, rgba(239,68,68,0.1) 0%, rgba(220,38,38,0.1) 100%)' :
                         modalAlert.type === 'warning' ? 'linear-gradient(135deg, rgba(251,191,36,0.1) 0%, rgba(245,158,11,0.1) 100%)' :
                         'linear-gradient(135deg, rgba(59,130,246,0.1) 0%, rgba(37,99,235,0.1) 100%)',
              padding: '1.5rem',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '1rem',
              borderBottom: `1px solid ${
                modalAlert.type === 'success' ? 'rgba(16,185,129,0.2)' :
                modalAlert.type === 'error' ? 'rgba(239,68,68,0.2)' :
                modalAlert.type === 'warning' ? 'rgba(251,191,36,0.2)' :
                'rgba(59,130,246,0.2)'
              }`
            }}>
              <div style={{
                width: '80px',
                height: '80px',
                borderRadius: '50%',
                background: modalAlert.type === 'success' ? 'rgba(16,185,129,0.2)' :
                           modalAlert.type === 'error' ? 'rgba(239,68,68,0.2)' :
                           modalAlert.type === 'warning' ? 'rgba(251,191,36,0.2)' :
                           'rgba(59,130,246,0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '2.5rem',
                animation: 'pulse 2s infinite'
              }}>
                {modalAlert.type === 'success' && '✅'}
                {modalAlert.type === 'error' && '❌'}
                {modalAlert.type === 'warning' && '⚠️'}
                {modalAlert.type === 'info' && 'ℹ️'}
              </div>
              <h2 style={{
                color: '#f8fafc',
                fontSize: '1.5rem',
                fontWeight: 700,
                margin: 0,
                textAlign: 'center'
              }}>
                {modalAlert.title}
              </h2>
            </div>

            {/* Content */}
            <div style={{
              padding: '1.5rem',
              textAlign: 'center'
            }}>
              <p style={{
                color: '#cbd5e1',
                fontSize: '1rem',
                lineHeight: '1.6',
                margin: '0 0 2rem 0'
              }}>
                {modalAlert.message}
              </p>

              <button
                onClick={closeAlert}
                style={{
                  width: '100%',
                  padding: '1rem',
                  background: modalAlert.type === 'success' ? 'linear-gradient(135deg, #10b981 0%, #34d399 100%)' :
                             modalAlert.type === 'error' ? 'linear-gradient(135deg, #ef4444 0%, #f87171 100%)' :
                             modalAlert.type === 'warning' ? 'linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%)' :
                             'linear-gradient(135deg, #3b82f6 0%, #60a5fa 100%)',
                  border: 'none',
                  borderRadius: '12px',
                  color: '#fff',
                  fontSize: '1rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  boxShadow: '0 8px 20px rgba(0,0,0,0.3)',
                  transition: 'all 0.3s ease'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-2px)'
                  e.currentTarget.style.boxShadow = '0 12px 30px rgba(0,0,0,0.4)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)'
                  e.currentTarget.style.boxShadow = '0 8px 20px rgba(0,0,0,0.3)'
                }}
              >
                {modalAlert.type === 'success' ? 'Great!' : 'Got it'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Profit Notification Toast */}
      {notifications.length > 0 && (() => {
        const recentSuccess = notifications.find((n: Notification) => n.type === 'success');
        if (recentSuccess) {
          return (
            <div
              style={{
                position: 'fixed',
                bottom: '30px',
                right: '30px',
                backgroundColor: '#10b981',
                color: 'white',
                padding: '16px 24px',
                borderRadius: '12px',
                boxShadow: '0 8px 24px rgba(16, 185, 129, 0.35)',
                maxWidth: '380px',
                animation: 'toastSlideIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
                zIndex: 9999,
                fontFamily: 'var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif)',
                backdropFilter: 'blur(10px)',
                border: '1px solid rgba(255,255,255,0.2)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                <span style={{ fontSize: '24px', flexShrink: 0, marginTop: '2px' }}>�</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: '700', fontSize: '15px', marginBottom: '4px', lineHeight: 1.2 }}>
                    {recentSuccess.title || 'Profit Credited'}
                  </div>
                  <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.9)', marginBottom: '6px', lineHeight: 1.4 }}>
                    {recentSuccess.message}
                  </div>
                  <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.7)' }}>
                    {recentSuccess.created_at ? new Date(recentSuccess.created_at).toLocaleTimeString('en-US', { 
                      hour: '2-digit', 
                      minute: '2-digit', 
                      second: '2-digit',
                      hour12: true 
                    }) : new Date().toLocaleTimeString('en-US', { 
                      hour: '2-digit', 
                      minute: '2-digit', 
                      second: '2-digit',
                      hour12: true 
                    })}
                  </div>
                </div>
              </div>
            </div>
          );
        }
      })()}

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        
        @keyframes slideUp {
          from {
            opacity: 0;
            transform: translateY(30px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        
        @keyframes pulse {
          0%, 100% {
            transform: scale(1);
          }
          50% {
            transform: scale(1.05);
          }
        }

        @keyframes toastSlideIn {
          from {
            opacity: 0;
            transform: translateX(400px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }

        @keyframes toastFadeOut {
          from {
            opacity: 1;
            transform: translateX(0);
          }
          to {
            opacity: 0;
            transform: translateX(400px);
          }
        }
      `}</style>
    </div>
  )
}

export default UserDashboard
